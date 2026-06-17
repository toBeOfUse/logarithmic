/**
 * Data-fetching hooks for the frontend. Per spec/3-frontend.md, every hook
 * accepts a `demo` flag:
 *   - when true, it serves from the in-memory demo store (`./store.ts`);
 *   - when false, it makes a real tRPC call to the backend.
 *
 * The split happens inside each hook so call sites (`useLogbookOverview`,
 * `useCreateEntry`, …) stay identical regardless of which logbook the user
 * picked from the splash screen.
 *
 * Demo reads are wrapped in a small `delay()` so the UI experiences the same
 * loading transitions it does over the network; real reads carry their own
 * latency from the backend.
 *
 * Mutations default to optimistic updates per spec/3-frontend.md: each
 * `onMutate` snapshots the affected cache entries, applies the change locally,
 * and `onError` restores the snapshot if the network call fails. The eventual
 * `onSettled` invalidation reconciles any drift with the server's authoritative
 * response.
 *
 * Entry ids are integers — the backend's `Entry.id` column is an
 * auto-increment integer, and the demo store mints sequential ids too.
 * Logbook ids stay as strings (nanoid).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import slugify from "@sindresorhus/slugify";
import type {
  CreatedLogbook,
  EntryDetail,
  EntryNode,
  LogbookDetail,
  LogbookOverview,
  LogbookSummary,
  Metadata,
  MoveEntryInput,
} from "logarithmic-backend/api-types";
import { countWords } from "logarithmic-backend/word-count";

import { readCachedLogbooks, saveCachedLogbooks } from "./logbook-cache.ts";
import * as store from "./store.ts";
import { getAllTokens, saveToken } from "./tokens.ts";
import { trpc } from "./trpc.ts";

const DEMO_READ_LATENCY_MS = 200;

function delay<T>(ms: number, getValue: () => T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(getValue()), ms));
}

/** True when a rejected query is a 404 — i.e. the logbook/entry doesn't exist
 *  or the caller's token doesn't grant access to it. */
function isNotFoundError(error: unknown): boolean {
  return error instanceof TRPCClientError && error.data?.httpStatus === 404;
}

/**
 * Retry policy for reads that address a specific logbook/entry. A 404 is a
 * definitive answer (missing resource or unauthorized token), so retrying it
 * just stretches the loading screen out across the default backoff before the
 * route can show its "not found" state. Other failures (transient network /
 * 5xx) still get React Query's usual three attempts.
 */
function retryUnlessNotFound(failureCount: number, error: unknown): boolean {
  if (isNotFoundError(error)) return false;
  return failureCount < 3;
}

export const isDemoLogbook = store.isDemoLogbookId;

// ── Query keys ─────────────────────────────────────────────────────────

const keys = {
  logbooks: (demo: boolean) => ["logbooks", { demo }] as const,
  logbookOverview: (demo: boolean, logbookId: string) =>
    ["logbookOverview", logbookId, { demo }] as const,
  entry: (demo: boolean, entryId: number) => ["entry", entryId, { demo }] as const,
};

// ── Forest helpers for optimistic updates ──────────────────────────────
//
// All return *new* nodes/arrays — never mutate the cached objects in place,
// since React Query relies on referential changes to trigger re-renders.

/** Find a node's parent id, or null if it's a root (or not in the forest). */
function parentIdOf(forest: EntryNode[], id: number): number | null {
  for (const n of forest) {
    if (n.children.some((c) => c.id === id)) return n.id;
    const hit = parentIdOf(n.children, id);
    if (hit !== null) return hit;
  }
  return null;
}

/** Map a single node by id; siblings/descendants are preserved by reference. */
function mapNode(forest: EntryNode[], id: number, fn: (n: EntryNode) => EntryNode): EntryNode[] {
  return forest.map((n) => {
    if (n.id === id) return fn(n);
    if (n.children.length === 0) return n;
    const nextKids = mapNode(n.children, id, fn);
    return nextKids === n.children ? n : { ...n, children: nextKids };
  });
}

/** Remove a node (and its subtree) from the forest, returning the removed
 *  node alongside the new forest. Returns null if the node isn't present. */
function extractNode(
  forest: EntryNode[],
  id: number,
): { forest: EntryNode[]; node: EntryNode } | null {
  for (let i = 0; i < forest.length; i++) {
    if (forest[i]!.id === id) {
      const next = forest.slice(0, i).concat(forest.slice(i + 1));
      return { forest: next, node: forest[i]! };
    }
  }
  for (let i = 0; i < forest.length; i++) {
    const node = forest[i]!;
    const result = extractNode(node.children, id);
    if (result) {
      const next = forest.slice();
      next[i] = { ...node, children: result.forest };
      return { forest: next, node: result.node };
    }
  }
  return null;
}

/** Recompute col for `node` and every descendant so child.col == parent.col - 1. */
function cascadeColsForNode(node: EntryNode, col: number): EntryNode {
  if (node.col === col && node.children.length === 0) return { ...node, col };
  return {
    ...node,
    col,
    children: node.children.map((c) => cascadeColsForNode(c, col - 1)),
  };
}

/** Insert `node` at `position` under `parentId` (or among roots if null). */
function insertNode(
  forest: EntryNode[],
  parentId: number | null,
  position: number,
  node: EntryNode,
): EntryNode[] {
  if (parentId === null) {
    const clamped = Math.max(0, Math.min(position, forest.length));
    return forest.slice(0, clamped).concat([node], forest.slice(clamped));
  }
  return forest.map((n) => {
    if (n.id === parentId) {
      const clamped = Math.max(0, Math.min(position, n.children.length));
      return {
        ...n,
        children: n.children.slice(0, clamped).concat([node], n.children.slice(clamped)),
      };
    }
    if (n.children.length === 0) return n;
    const nextKids = insertNode(n.children, parentId, position, node);
    return nextKids === n.children ? n : { ...n, children: nextKids };
  });
}

function applyMoveToForest(forest: EntryNode[], input: MoveEntryInput): EntryNode[] | null {
  const extracted = extractNode(forest, input.id);
  if (!extracted) return null;
  const moved = cascadeColsForNode(extracted.node, input.col);
  return insertNode(extracted.forest, input.parentId, input.position, moved);
}

function reorderForestChildren(
  forest: EntryNode[],
  parentId: number | null,
  ids: number[],
): EntryNode[] {
  if (parentId === null) {
    const byId = new Map(forest.map((n) => [n.id, n] as const));
    return ids.map((id) => byId.get(id)).filter((n): n is EntryNode => !!n);
  }
  return forest.map((n) => {
    if (n.id === parentId) {
      const byId = new Map(n.children.map((c) => [c.id, c] as const));
      const next = ids.map((id) => byId.get(id)).filter((c): c is EntryNode => !!c);
      return { ...n, children: next };
    }
    if (n.children.length === 0) return n;
    return { ...n, children: reorderForestChildren(n.children, parentId, ids) };
  });
}

// ── Reads ──────────────────────────────────────────────────────────────

export function useLogbooks({ demo = false }: { demo?: boolean } = {}) {
  return useQuery({
    queryKey: keys.logbooks(demo),
    queryFn: async () => {
      if (demo) return delay(DEMO_READ_LATENCY_MS, () => store.listLogbooks());
      const logbooks = await trpc.logbook.listByTokens.query({ tokens: getAllTokens() });
      // Refresh the optimistic cache so the next cold load paints this list.
      saveCachedLogbooks(logbooks);
      return logbooks;
    },
    // Seed the real list from localStorage so the splash screen renders the
    // user's logbooks immediately instead of flashing empty during the network
    // round-trip. `initialDataUpdatedAt: 0` marks the seed as already stale so a
    // background refetch still reconciles with the server. The demo list is
    // rebuilt from the in-memory store and needs no persistence.
    ...(demo ? {} : { initialData: readCachedLogbooks, initialDataUpdatedAt: 0 }),
  });
}

export function useLogbookOverview(
  logbookId: string | undefined,
  { demo = false }: { demo?: boolean } = {},
) {
  return useQuery<LogbookOverview | null>({
    enabled: !!logbookId,
    queryKey: keys.logbookOverview(demo, logbookId ?? ""),
    queryFn: () => {
      if (!logbookId) return null;
      if (demo) return delay(DEMO_READ_LATENCY_MS, () => store.getLogbookOverview(logbookId));
      return trpc.logbook.overview.query({ logbookId });
    },
    retry: retryUnlessNotFound,
  });
}

export function useEntry(
  entryId: number | null,
  logbookId: string | undefined,
  { demo = false }: { demo?: boolean } = {},
) {
  return useQuery<EntryDetail | null>({
    enabled: entryId !== null && !!logbookId,
    queryKey: keys.entry(demo, entryId ?? 0),
    queryFn: () => {
      if (entryId === null || !logbookId) return null;
      if (demo) return delay(DEMO_READ_LATENCY_MS, () => store.getEntry(entryId));
      return trpc.entry.get.query({ logbookId, id: entryId });
    },
    retry: retryUnlessNotFound,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────

// Logbooks are only ever created for real (token-backed) accounts — the demo
// logbooks are a fixed, in-memory set seeded from `demo-tree.ts` with no UI to
// add more — so this hook has no `demo` branch.
export function useCreateLogbook() {
  const qc = useQueryClient();
  return useMutation<CreatedLogbook, Error, { name: string }>({
    mutationFn: async (input) => {
      const result = await trpc.logbook.create.mutate(input);
      // Persist the fresh token immediately so the bookmarkable link the modal
      // surfaces matches what's already authoritative in localStorage.
      saveToken(result.logbook.id, result.token);
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.logbooks(false) });
    },
  });
}

/**
 * Trigger a logbook ZIP download. `logbook.export` returns the bytes as a
 * `Uint8Array` (with the suggested filename) through tRPC + superjson, so we
 * get end-to-end type safety; the browser bits below just wrap the bytes in a
 * Blob and synthesize a download.
 *
 * Browsers don't allow programmatic downloads with a different filename unless
 * we either set the anchor's `download` attribute (limited to same-origin) or
 * hand them a Blob URL — we use the Blob-URL trick so this keeps working
 * if/when the API moves to a different origin.
 *
 * The `filename` parameter overrides the server's suggestion so the caller
 * can keep using the logbook's display slug at the moment of the click,
 * which can differ from the slug stored on the server.
 */
let _lastObjectUrl = "";
export async function exportLogbookToFile(logbookId: string, filename: string) {
  const { data } = await trpc.logbook.export.query({ logbookId });
  // Copy into a fresh `Uint8Array<ArrayBuffer>` so the `BlobPart` type matches
  // — superjson's typed-array deserializer returns `Uint8Array<ArrayBufferLike>`,
  // which the DOM lib's BlobPart no longer accepts.
  const blob = new Blob([new Uint8Array(data)], { type: "application/zip" });
  if (_lastObjectUrl) {
    URL.revokeObjectURL(_lastObjectUrl);
    _lastObjectUrl = "";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  _lastObjectUrl = url;
}

export function useImportLogbook() {
  const qc = useQueryClient();
  return useMutation<CreatedLogbook, Error, { file: File }>({
    // `logbook.import` accepts `Blob | File | Uint8Array` directly through
    // `octetInputParser`; the splitLink in `./trpc.ts` routes this around the
    // batching link so the binary body goes through untouched.
    mutationFn: async ({ file }) => {
      const result = await trpc.logbook.import.mutate(file);
      saveToken(result.logbook.id, result.token);
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.logbooks(false) });
    },
  });
}

type RenameLogbookCtx = {
  prevOverview: LogbookOverview | null | undefined;
};

export function useRenameLogbook({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<
    LogbookDetail | null,
    Error,
    { logbookId: string; name: string },
    RenameLogbookCtx
  >({
    mutationFn: (input) =>
      demo ? Promise.resolve(store.renameLogbook(input)) : trpc.logbook.rename.mutate(input),
    onMutate: async (vars) => {
      const overviewKey = keys.logbookOverview(demo, vars.logbookId);
      await qc.cancelQueries({ queryKey: overviewKey });
      const prevOverview = qc.getQueryData<LogbookOverview | null>(overviewKey);
      if (prevOverview) {
        const slug = slugify(vars.name);
        qc.setQueryData<LogbookOverview | null>(overviewKey, {
          ...prevOverview,
          logbook: {
            ...prevOverview.logbook,
            name: vars.name,
            slug,
            updatedAt: new Date(),
          },
        });
      }
      return { prevOverview };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prevOverview !== undefined) {
        qc.setQueryData(keys.logbookOverview(demo, vars.logbookId), ctx.prevOverview);
      }
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
      void qc.invalidateQueries({ queryKey: keys.logbooks(demo) });
    },
  });
}

type CreateEntryVars = {
  logbookId: string;
  name?: string;
  col?: number;
  parentId?: number | null;
};

/**
 * Creating an entry is deliberately NOT optimistic. The entry's id is assigned
 * by the server, and the UI needs that real id to render a working link to the
 * new entry — guessing it client-side risks linking to an entry the server has
 * never heard of. So we wait for the response, then write the authoritative
 * node into the caches and let the caller focus its link. Callers render a
 * loading placeholder in the new entry's slot until then.
 */
export function useCreateEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<EntryDetail | null, Error, CreateEntryVars>({
    mutationFn: (input) =>
      demo ? Promise.resolve(store.createEntry(input)) : trpc.entry.create.mutate(input),
    onSuccess: (data, vars) => {
      if (!data) return;
      const parentId = vars.parentId ?? null;

      // Drop the real node into the overview tree (as the last child of its
      // parent, or the last root) so the org view shows it immediately on
      // confirmation rather than waiting for the reconciling refetch.
      const overviewKey = keys.logbookOverview(demo, vars.logbookId);
      const overview = qc.getQueryData<LogbookOverview | null>(overviewKey);
      if (overview) {
        const node: EntryNode = {
          id: data.id,
          slug: data.slug,
          name: data.name,
          col: data.col,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          wordCount: data.wordCount,
          iconName: data.iconName,
          iconFamily: data.iconFamily,
          metadataKeys: data.metadata ? Object.keys(data.metadata) : [],
          children: [],
        };
        qc.setQueryData<LogbookOverview | null>(overviewKey, {
          ...overview,
          entries: insertNode(overview.entries, parentId, Number.MAX_SAFE_INTEGER, node),
        });
      }

      // The content view lists a parent's children off its EntryDetail, so the
      // new child has to land there too for its link to appear on that page.
      if (parentId !== null) {
        const parentKey = keys.entry(demo, parentId);
        const parent = qc.getQueryData<EntryDetail | null>(parentKey);
        if (parent) {
          qc.setQueryData<EntryDetail | null>(parentKey, {
            ...parent,
            children: [
              ...parent.children,
              {
                id: data.id,
                slug: data.slug,
                name: data.name,
                col: data.col,
                metadata: data.metadata,
              },
            ],
          });
        }
      }

      // Seed the new entry's own cache so navigating to it skips a round-trip.
      qc.setQueryData<EntryDetail | null>(keys.entry(demo, data.id), data);
    },
    onSettled: (data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
      void qc.invalidateQueries({ queryKey: keys.logbooks(demo) });
      if (vars.parentId != null) {
        void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.parentId) });
      }
      if (data?.id != null) {
        void qc.invalidateQueries({ queryKey: keys.entry(demo, data.id) });
      }
    },
  });
}

type RenameCtx = {
  prevEntry: EntryDetail | null | undefined;
  prevOverviewByLogbookId: Map<string, LogbookOverview | null | undefined>;
};

export function useRenameEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<
    EntryDetail | null,
    Error,
    { id: number; name: string; logbookId: string },
    RenameCtx
  >({
    mutationFn: (input) =>
      demo
        ? Promise.resolve(store.renameEntry({ id: input.id, name: input.name }))
        : trpc.entry.rename.mutate(input),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: keys.entry(demo, vars.id) });
      const prevEntry = qc.getQueryData<EntryDetail | null>(keys.entry(demo, vars.id));
      const slug = slugify(vars.name);
      const updatedAt = new Date();
      if (prevEntry) {
        qc.setQueryData<EntryDetail | null>(keys.entry(demo, vars.id), {
          ...prevEntry,
          name: vars.name,
          slug,
          updatedAt,
        });
      }
      const prevOverviewByLogbookId = new Map<string, LogbookOverview | null | undefined>();
      // Key the optimistic overview patch off `vars.logbookId`, not
      // `prevEntry?.logbookId`: an entry renamed from the org view may have no
      // cached EntryDetail (it was never opened), and keying off that would
      // skip this update and leave the card showing the old name until a
      // refetch.
      const overviewKey = keys.logbookOverview(demo, vars.logbookId);
      await qc.cancelQueries({ queryKey: overviewKey });
      const prev = qc.getQueryData<LogbookOverview | null>(overviewKey);
      prevOverviewByLogbookId.set(vars.logbookId, prev);
      if (prev) {
        qc.setQueryData<LogbookOverview | null>(overviewKey, {
          ...prev,
          entries: mapNode(prev.entries, vars.id, (n) => ({
            ...n,
            name: vars.name,
            slug,
            updatedAt,
          })),
        });
      }
      return { prevEntry, prevOverviewByLogbookId };
    },
    onError: (_err, vars, ctx) => {
      if (!ctx) return;
      if (ctx.prevEntry !== undefined) {
        qc.setQueryData(keys.entry(demo, vars.id), ctx.prevEntry);
      }
      for (const [lbId, snap] of ctx.prevOverviewByLogbookId) {
        if (snap !== undefined) qc.setQueryData(keys.logbookOverview(demo, lbId), snap);
      }
    },
    onSettled: (data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
      // The parent's EntryDetail.children carries this entry's name, so its
      // cached copy goes stale on rename.
      if (data?.parentId != null) {
        void qc.invalidateQueries({ queryKey: keys.entry(demo, data.parentId) });
      }
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
    },
  });
}

type UpdateContentCtx = {
  prev: EntryDetail | null | undefined;
  prevOverview: LogbookOverview | null | undefined;
};

export function useUpdateEntryContent({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<
    EntryDetail | null,
    Error,
    { id: number; content: string; logbookId: string },
    UpdateContentCtx
  >({
    mutationFn: (input) =>
      demo
        ? Promise.resolve(store.updateEntryContent({ id: input.id, content: input.content }))
        : trpc.entry.updateContent.mutate(input),
    onMutate: async (vars) => {
      const entryKey = keys.entry(demo, vars.id);
      const overviewKey = keys.logbookOverview(demo, vars.logbookId);
      await Promise.all([
        qc.cancelQueries({ queryKey: entryKey }),
        qc.cancelQueries({ queryKey: overviewKey }),
      ]);
      const prev = qc.getQueryData<EntryDetail | null>(entryKey);
      const wordCount = countWords(vars.content);
      const updatedAt = new Date();
      if (prev) {
        qc.setQueryData<EntryDetail | null>(entryKey, {
          ...prev,
          content: vars.content,
          wordCount,
          updatedAt,
        });
      }
      // The org-view card shows this entry's word count, so the overview's node
      // has to track it too. `countWords` is the same function the server runs,
      // so this optimistic value already matches what a refetch would return —
      // which is exactly why onSuccess can avoid refetching the whole tree.
      const prevOverview = qc.getQueryData<LogbookOverview | null>(overviewKey);
      if (prevOverview) {
        qc.setQueryData<LogbookOverview | null>(overviewKey, {
          ...prevOverview,
          entries: mapNode(prevOverview.entries, vars.id, (n) => ({
            ...n,
            wordCount,
            updatedAt,
          })),
        });
      }
      return { prev, prevOverview };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(keys.entry(demo, vars.id), ctx.prev);
      if (ctx?.prevOverview !== undefined) {
        qc.setQueryData(keys.logbookOverview(demo, vars.logbookId), ctx.prevOverview);
      }
    },
    onSuccess: (_data, vars) => {
      // Both the entry and the overview node were patched optimistically above
      // with the same word count the server computes, so a routine autosave
      // (~once per 800ms while typing) needs no overview refetch. Only
      // invalidate the entry itself; the overview reconciles on its own next
      // load. (See onMutate for why the optimistic value is authoritative.)
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
    },
  });
}

type MetadataCtx = {
  prevEntry: EntryDetail | null | undefined;
  prevOverview: LogbookOverview | null | undefined;
  logbookId: string | undefined;
};

export function useUpdateEntryMetadata({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<
    EntryDetail | null,
    Error,
    { id: number; metadata: Metadata; logbookId: string },
    MetadataCtx
  >({
    mutationFn: (input) =>
      demo
        ? Promise.resolve(store.updateEntryMetadata({ id: input.id, metadata: input.metadata }))
        : trpc.entry.updateMetadata.mutate(input),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: keys.entry(demo, vars.id) });
      const prevEntry = qc.getQueryData<EntryDetail | null>(keys.entry(demo, vars.id));
      const updatedAt = new Date();
      if (prevEntry) {
        qc.setQueryData<EntryDetail | null>(keys.entry(demo, vars.id), {
          ...prevEntry,
          metadata: { ...vars.metadata },
          updatedAt,
        });
      }
      const logbookId = prevEntry?.logbookId;
      let prevOverview: LogbookOverview | null | undefined;
      if (logbookId) {
        await qc.cancelQueries({ queryKey: keys.logbookOverview(demo, logbookId) });
        prevOverview = qc.getQueryData<LogbookOverview | null>(
          keys.logbookOverview(demo, logbookId),
        );
        if (prevOverview) {
          qc.setQueryData<LogbookOverview | null>(keys.logbookOverview(demo, logbookId), {
            ...prevOverview,
            entries: mapNode(prevOverview.entries, vars.id, (n) => ({
              ...n,
              metadataKeys: Object.keys(vars.metadata),
              updatedAt,
            })),
          });
        }
      }
      return { prevEntry, prevOverview, logbookId };
    },
    onError: (_err, vars, ctx) => {
      if (!ctx) return;
      if (ctx.prevEntry !== undefined) qc.setQueryData(keys.entry(demo, vars.id), ctx.prevEntry);
      if (ctx.logbookId && ctx.prevOverview !== undefined) {
        qc.setQueryData(keys.logbookOverview(demo, ctx.logbookId), ctx.prevOverview);
      }
    },
    onSettled: (data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
      if (data?.logbookId) {
        void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, data.logbookId) });
      }
    },
  });
}

type SetIconCtx = {
  prevEntry: EntryDetail | null | undefined;
  prevOverview: LogbookOverview | null | undefined;
};

/**
 * Set (or clear) an entry's icon. Optimistic, like rename: the org-view card is
 * where the icon is picked and shown, so the overview node is patched
 * immediately. We key the overview patch off `vars.logbookId` (not a cached
 * EntryDetail, which may not exist for an entry never opened) so the card
 * updates without waiting for a refetch.
 */
export function useSetEntryIcon({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<
    EntryDetail | null,
    Error,
    { id: number; iconName: string | null; iconFamily: string | null; logbookId: string },
    SetIconCtx
  >({
    mutationFn: (input) =>
      demo
        ? Promise.resolve(
            store.setEntryIcon({
              id: input.id,
              iconName: input.iconName,
              iconFamily: input.iconFamily,
            }),
          )
        : trpc.entry.setIcon.mutate(input),
    onMutate: async (vars) => {
      const entryKey = keys.entry(demo, vars.id);
      const overviewKey = keys.logbookOverview(demo, vars.logbookId);
      await Promise.all([
        qc.cancelQueries({ queryKey: entryKey }),
        qc.cancelQueries({ queryKey: overviewKey }),
      ]);
      const updatedAt = new Date();
      const prevEntry = qc.getQueryData<EntryDetail | null>(entryKey);
      if (prevEntry) {
        qc.setQueryData<EntryDetail | null>(entryKey, {
          ...prevEntry,
          iconName: vars.iconName,
          iconFamily: vars.iconFamily,
          updatedAt,
        });
      }
      const prevOverview = qc.getQueryData<LogbookOverview | null>(overviewKey);
      if (prevOverview) {
        qc.setQueryData<LogbookOverview | null>(overviewKey, {
          ...prevOverview,
          entries: mapNode(prevOverview.entries, vars.id, (n) => ({
            ...n,
            iconName: vars.iconName,
            iconFamily: vars.iconFamily,
            updatedAt,
          })),
        });
      }
      return { prevEntry, prevOverview };
    },
    onError: (_err, vars, ctx) => {
      if (!ctx) return;
      if (ctx.prevEntry !== undefined) qc.setQueryData(keys.entry(demo, vars.id), ctx.prevEntry);
      if (ctx.prevOverview !== undefined) {
        qc.setQueryData(keys.logbookOverview(demo, vars.logbookId), ctx.prevOverview);
      }
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
    },
  });
}

type MoveCtx = {
  prevOverview: LogbookOverview | null | undefined;
  prevEntry: EntryDetail | null | undefined;
};

export function useMoveEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<EntryDetail | null, Error, MoveEntryInput, MoveCtx>({
    mutationFn: (input) =>
      demo ? Promise.resolve(store.moveEntry(input)) : trpc.entry.move.mutate(input),
    onMutate: async (vars) => {
      const overviewKey = keys.logbookOverview(demo, vars.logbookId);
      const entryKey = keys.entry(demo, vars.id);
      await Promise.all([
        qc.cancelQueries({ queryKey: overviewKey }),
        qc.cancelQueries({ queryKey: entryKey }),
      ]);
      const prevOverview = qc.getQueryData<LogbookOverview | null>(overviewKey);
      const prevEntry = qc.getQueryData<EntryDetail | null>(entryKey);
      if (prevOverview) {
        const next = applyMoveToForest(prevOverview.entries, vars);
        if (next) {
          qc.setQueryData<LogbookOverview | null>(overviewKey, {
            ...prevOverview,
            entries: next,
          });
        }
      }
      if (prevEntry) {
        qc.setQueryData<EntryDetail | null>(entryKey, {
          ...prevEntry,
          parentId: vars.parentId,
          col: vars.col,
          updatedAt: new Date(),
        });
      }
      return { prevOverview, prevEntry };
    },
    onError: (_err, vars, ctx) => {
      if (!ctx) return;
      if (ctx.prevOverview !== undefined) {
        qc.setQueryData(keys.logbookOverview(demo, vars.logbookId), ctx.prevOverview);
      }
      if (ctx.prevEntry !== undefined) {
        qc.setQueryData(keys.entry(demo, vars.id), ctx.prevEntry);
      }
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
    },
  });
}

type ReorderCtx = { prevOverview: LogbookOverview | null | undefined };

export function useReorderSiblings({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<
    boolean,
    Error,
    { logbookId: string; parentId: number | null; ids: number[] },
    ReorderCtx
  >({
    mutationFn: (input) =>
      demo
        ? Promise.resolve(store.reorderSiblings(input))
        : trpc.entry.reorderSiblings.mutate(input),
    onMutate: async (vars) => {
      const overviewKey = keys.logbookOverview(demo, vars.logbookId);
      await qc.cancelQueries({ queryKey: overviewKey });
      const prevOverview = qc.getQueryData<LogbookOverview | null>(overviewKey);
      if (prevOverview) {
        qc.setQueryData<LogbookOverview | null>(overviewKey, {
          ...prevOverview,
          entries: reorderForestChildren(prevOverview.entries, vars.parentId, vars.ids),
        });
      }
      return { prevOverview };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prevOverview !== undefined) {
        qc.setQueryData(keys.logbookOverview(demo, vars.logbookId), ctx.prevOverview);
      }
    },
    onSettled: (_ok, _err, vars) => {
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
    },
  });
}

type DeleteCtx = {
  prevOverview: LogbookOverview | null | undefined;
  prevEntry: EntryDetail | null | undefined;
  prevParentId: number | null;
};

export function useDeleteEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<boolean, Error, { id: number; logbookId: string }, DeleteCtx>({
    mutationFn: (input) =>
      demo ? Promise.resolve(store.deleteEntry({ id: input.id })) : trpc.entry.delete.mutate(input),
    onMutate: async (vars) => {
      const overviewKey = keys.logbookOverview(demo, vars.logbookId);
      const entryKey = keys.entry(demo, vars.id);
      await Promise.all([
        qc.cancelQueries({ queryKey: overviewKey }),
        qc.cancelQueries({ queryKey: entryKey }),
      ]);
      const prevOverview = qc.getQueryData<LogbookOverview | null>(overviewKey);
      const prevEntry = qc.getQueryData<EntryDetail | null>(entryKey);
      const prevParentId = prevOverview ? parentIdOf(prevOverview.entries, vars.id) : null;
      if (prevOverview) {
        const extracted = extractNode(prevOverview.entries, vars.id);
        if (extracted) {
          qc.setQueryData<LogbookOverview | null>(overviewKey, {
            ...prevOverview,
            entries: extracted.forest,
          });
        }
      }
      qc.setQueryData<EntryDetail | null>(entryKey, null);
      return { prevOverview, prevEntry, prevParentId };
    },
    onError: (_err, vars, ctx) => {
      if (!ctx) return;
      if (ctx.prevOverview !== undefined) {
        qc.setQueryData(keys.logbookOverview(demo, vars.logbookId), ctx.prevOverview);
      }
      if (ctx.prevEntry !== undefined) qc.setQueryData(keys.entry(demo, vars.id), ctx.prevEntry);
    },
    onSettled: (_ok, _err, vars, ctx) => {
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
      // The parent's children list also referenced the deleted entry.
      if (ctx?.prevParentId != null) {
        void qc.invalidateQueries({ queryKey: keys.entry(demo, ctx.prevParentId) });
      }
    },
  });
}

export type { LogbookSummary };
