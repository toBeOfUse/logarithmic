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
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EntryDetail,
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
  entry: (demo: boolean, entryId: string) => ["entry", entryId, { demo }] as const,
};

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

export function useEntry(entryId: string | undefined, { demo = false }: { demo?: boolean } = {}) {
  return useQuery<EntryDetail | null>({
    enabled: !!entryId,
    queryKey: keys.entry(demo, entryId ?? ""),
    queryFn: () => {
      if (!entryId) return null;
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

export function useCreateEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<
    EntryDetail | null,
    Error,
    { logbookId: string; name?: string; col?: number; parentId?: string | null }
  >({
    mutationFn: (input) =>
      demo ? Promise.resolve(store.createEntry(input)) : trpc.entry.create.mutate(input),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
      void qc.invalidateQueries({ queryKey: keys.logbooks(demo) });
      if (vars.parentId) {
        void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.parentId) });
      }
    },
  });
}

export function useRenameEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<EntryDetail | null, Error, { id: string; name: string }>({
    mutationFn: (input) =>
      demo ? Promise.resolve(store.renameEntry(input)) : trpc.entry.rename.mutate(input),
    onSuccess: (data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
      // The parent's EntryDetail.children carries this entry's name, so its
      // cached copy goes stale on rename.
      if (data?.parentId) {
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
  return useMutation<EntryDetail | null, Error, { id: string; content: string }>({
    mutationFn: (input) =>
      demo
        ? Promise.resolve(store.updateEntryContent(input))
        : trpc.entry.updateContent.mutate(input),
    onSuccess: (data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
      if (data?.logbookId) {
        void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, data.logbookId) });
      }
    },
  });
}

export function useUpdateEntryMetadata({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<EntryDetail | null, Error, { id: string; metadata: Metadata }>({
    mutationFn: (input) =>
      demo
        ? Promise.resolve(store.updateEntryMetadata(input))
        : trpc.entry.updateMetadata.mutate(input),
    onSuccess: (data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
      if (data?.logbookId) {
        void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, data.logbookId) });
      }
    },
  });
}

export function useMoveEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<EntryDetail | null, Error, MoveEntryInput & { logbookId: string }>({
    mutationFn: ({ logbookId: _lb, ...input }) =>
      demo ? Promise.resolve(store.moveEntry(input)) : trpc.entry.move.mutate(input),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
    },
  });
}

export function useReorderSiblings({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<boolean, Error, { logbookId: string; parentId: string | null; ids: string[] }>(
    {
      mutationFn: (input) =>
        demo
          ? Promise.resolve(store.reorderSiblings(input))
          : trpc.entry.reorderSiblings.mutate(input),
      onSuccess: (_ok, vars) => {
        void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
      },
    },
  );
}

export function useDeleteEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<boolean, Error, { id: string; logbookId: string }>({
    mutationFn: ({ id }) =>
      demo ? Promise.resolve(store.deleteEntry({ id })) : trpc.entry.delete.mutate({ id }),
    onSuccess: (_ok, vars) => {
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
    },
  });
}

export type { LogbookSummary };
