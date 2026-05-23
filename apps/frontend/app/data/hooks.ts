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
import slugify from "@sindresorhus/slugify";
import type {
  EntryDetail,
  EntryNode,
  LogbookDetail,
  LogbookOverview,
  LogbookSummary,
  Metadata,
  MoveEntryInput,
} from "logarithmic-backend/api-types";

import * as store from "./store.ts";
import { trpc } from "./trpc.ts";

const DEMO_READ_LATENCY_MS = 200;

function delay<T>(ms: number, getValue: () => T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(getValue()), ms));
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

/** The largest id present anywhere in the forest. Returns 0 if the forest is
 *  empty so the next mintable id is 1. */
function maxIdInForest(forest: EntryNode[]): number {
  let max = 0;
  const walk = (nodes: EntryNode[]) => {
    for (const n of nodes) {
      if (n.id > max) max = n.id;
      walk(n.children);
    }
  };
  walk(forest);
  return max;
}

// ── Reads ──────────────────────────────────────────────────────────────

export function useLogbooks({ demo = false }: { demo?: boolean } = {}) {
  return useQuery({
    queryKey: keys.logbooks(demo),
    queryFn: () =>
      demo ? delay(DEMO_READ_LATENCY_MS, () => store.listLogbooks()) : trpc.logbook.list.query(),
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
  });
}

export function useEntry(entryId: number | null, { demo = false }: { demo?: boolean } = {}) {
  return useQuery<EntryDetail | null>({
    enabled: entryId !== null,
    queryKey: keys.entry(demo, entryId ?? 0),
    queryFn: () => {
      if (entryId === null) return null;
      if (demo) return delay(DEMO_READ_LATENCY_MS, () => store.getEntry(entryId));
      return trpc.entry.get.query({ id: entryId });
    },
  });
}

// ── Mutations ──────────────────────────────────────────────────────────

export function useCreateLogbook({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<LogbookDetail, Error, { name: string }>({
    mutationFn: (input) =>
      demo ? Promise.resolve(store.createLogbook(input)) : trpc.logbook.create.mutate(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.logbooks(demo) });
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
  return useMutation<LogbookDetail, Error, { file: File }>({
    // `logbook.import` accepts `Blob | File | Uint8Array` directly through
    // `octetInputParser`; the splitLink in `./trpc.ts` routes this around the
    // batching link so the binary body goes through untouched.
    mutationFn: ({ file }) => trpc.logbook.import.mutate(file),
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

type CreateEntryCtx = {
  prevOverview: LogbookOverview | null | undefined;
  tempId: number;
};

export function useCreateEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<EntryDetail | null, Error, CreateEntryVars, CreateEntryCtx>({
    mutationFn: (input) =>
      demo ? Promise.resolve(store.createEntry(input)) : trpc.entry.create.mutate(input),
    onMutate: async (vars) => {
      const overviewKey = keys.logbookOverview(demo, vars.logbookId);
      await qc.cancelQueries({ queryKey: overviewKey });
      const prevOverview = qc.getQueryData<LogbookOverview | null>(overviewKey);
      // Mint a provisional id as `max(existing) + 1`. Sequential ids on the
      // server make this a plausible guess, and on reconciliation the
      // optimistic node is removed and the server's authoritative result
      // takes its place via `onSuccess`.
      const tempId = prevOverview ? maxIdInForest(prevOverview.entries) + 1 : 1;
      if (prevOverview) {
        const parentId = vars.parentId ?? null;
        const parent = parentId === null ? null : findNode(prevOverview.entries, parentId);
        const col = vars.col ?? (parent ? parent.col - 1 : 0);
        const name = vars.name ?? "";
        const now = new Date();
        const stub: EntryNode = {
          id: tempId,
          slug: slugify(name),
          name,
          col,
          createdAt: now,
          updatedAt: now,
          hasContent: false,
          metadataKeys: [],
          children: [],
        };
        // Append as the last child of the chosen parent (or as the last root).
        if (parentId === null) {
          qc.setQueryData<LogbookOverview | null>(overviewKey, {
            ...prevOverview,
            entries: [...prevOverview.entries, stub],
          });
        } else {
          qc.setQueryData<LogbookOverview | null>(overviewKey, {
            ...prevOverview,
            entries: mapNode(prevOverview.entries, parentId, (n) => ({
              ...n,
              children: [...n.children, stub],
            })),
          });
        }
      }
      return { prevOverview, tempId };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prevOverview !== undefined) {
        qc.setQueryData(keys.logbookOverview(demo, vars.logbookId), ctx.prevOverview);
      }
    },
    onSuccess: (data, vars, ctx) => {
      if (data && ctx) {
        // Replace the temp-id stub with the server's authoritative node so the
        // tree settles without waiting for the upcoming refetch.
        const overviewKey = keys.logbookOverview(demo, vars.logbookId);
        const cached = qc.getQueryData<LogbookOverview | null>(overviewKey);
        if (cached) {
          const real: EntryNode = {
            id: data.id,
            slug: data.slug,
            name: data.name,
            col: data.col,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            hasContent: data.content != null && data.content.length > 0,
            metadataKeys: data.metadata ? Object.keys(data.metadata) : [],
            children: [],
          };
          qc.setQueryData<LogbookOverview | null>(overviewKey, {
            ...cached,
            entries: mapNode(cached.entries, ctx.tempId, () => real),
          });
        }
        // Seed the entry cache so a follow-up `useEntry(data.id)` skips a
        // round-trip.
        qc.setQueryData<EntryDetail | null>(keys.entry(demo, data.id), data);
      }
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

function findNode(forest: EntryNode[], id: number): EntryNode | null {
  for (const n of forest) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

type RenameCtx = {
  prevEntry: EntryDetail | null | undefined;
  prevOverviewByLogbookId: Map<string, LogbookOverview | null | undefined>;
};

export function useRenameEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<EntryDetail | null, Error, { id: number; name: string }, RenameCtx>({
    mutationFn: (input) =>
      demo ? Promise.resolve(store.renameEntry(input)) : trpc.entry.rename.mutate(input),
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
      const overviewKey = prevEntry?.logbookId
        ? keys.logbookOverview(demo, prevEntry.logbookId)
        : null;
      if (overviewKey && prevEntry?.logbookId) {
        await qc.cancelQueries({ queryKey: overviewKey });
        const prev = qc.getQueryData<LogbookOverview | null>(overviewKey);
        prevOverviewByLogbookId.set(prevEntry.logbookId, prev);
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
      if (data?.logbookId) {
        void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, data.logbookId) });
      }
    },
  });
}

export function useUpdateEntryContent({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<
    EntryDetail | null,
    Error,
    { id: number; content: string },
    { prev: EntryDetail | null | undefined }
  >({
    mutationFn: (input) =>
      demo
        ? Promise.resolve(store.updateEntryContent(input))
        : trpc.entry.updateContent.mutate(input),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: keys.entry(demo, vars.id) });
      const prev = qc.getQueryData<EntryDetail | null>(keys.entry(demo, vars.id));
      if (prev) {
        qc.setQueryData<EntryDetail | null>(keys.entry(demo, vars.id), {
          ...prev,
          content: vars.content,
          updatedAt: new Date(),
        });
      }
      return { prev };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(keys.entry(demo, vars.id), ctx.prev);
    },
    onSuccess: (data, vars, ctx) => {
      // The overview projection only depends on `hasContent` (a boolean), so
      // only refetch it when the value actually flipped. Without this guard
      // every debounced autosave (~once per 800ms while the user types) would
      // refetch the whole logbook tree.
      const wasNonEmpty = (ctx?.prev?.content?.length ?? 0) > 0;
      const becameNonEmpty = vars.content.length > 0;
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
      if (data?.logbookId && becameNonEmpty !== wasNonEmpty) {
        void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, data.logbookId) });
      }
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
  return useMutation<EntryDetail | null, Error, { id: number; metadata: Metadata }, MetadataCtx>({
    mutationFn: (input) =>
      demo
        ? Promise.resolve(store.updateEntryMetadata(input))
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

type MoveCtx = {
  prevOverview: LogbookOverview | null | undefined;
  prevEntry: EntryDetail | null | undefined;
};

export function useMoveEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<EntryDetail | null, Error, MoveEntryInput & { logbookId: string }, MoveCtx>({
    mutationFn: ({ logbookId: _lb, ...input }) =>
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
    mutationFn: ({ id }) =>
      demo ? Promise.resolve(store.deleteEntry({ id })) : trpc.entry.delete.mutate({ id }),
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
