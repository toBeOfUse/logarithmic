/**
 * Data-fetching hooks for the frontend. Per spec/3-frontend.md, every hook
 * accepts a `demo` flag — when true, it serves in-memory data; when false,
 * it would (eventually) hit the tRPC backend. For now, the non-demo path
 * also uses the in-memory store, since the API isn't wired up yet.
 *
 * Reads are wrapped in setTimeout to simulate latency; mutations resolve
 * synchronously so UI updates feel immediate while the demo store is the
 * authoritative source.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EntryDetail,
  LogbookDetail,
  LogbookOverview,
  LogbookSummary,
  Metadata,
} from "logarithmic-backend/api-types";

import { DEMO_LOGBOOK_IDS } from "./demo-tree.ts";
import * as store from "./store.ts";

const READ_LATENCY_MS = 200;

function delay<T>(ms: number, getValue: () => T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(getValue()), ms));
}

export function isDemoLogbook(logbookId: string | undefined): boolean {
  return logbookId !== undefined && DEMO_LOGBOOK_IDS.has(logbookId);
}

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
    queryFn: () => delay(READ_LATENCY_MS, () => store.listLogbooks(demo)),
  });
}

export function useLogbookOverview(
  logbookId: string | undefined,
  { demo = false }: { demo?: boolean } = {},
) {
  return useQuery<LogbookOverview | null>({
    enabled: !!logbookId,
    queryKey: keys.logbookOverview(demo, logbookId ?? ""),
    queryFn: () =>
      delay(READ_LATENCY_MS, () => (logbookId ? store.getLogbookOverview(demo, logbookId) : null)),
  });
}

export function useEntry(entryId: string | undefined, { demo = false }: { demo?: boolean } = {}) {
  return useQuery<EntryDetail | null>({
    enabled: !!entryId,
    queryKey: keys.entry(demo, entryId ?? ""),
    queryFn: () => delay(READ_LATENCY_MS, () => (entryId ? store.getEntry(demo, entryId) : null)),
  });
}

// ── Mutations ──────────────────────────────────────────────────────────

export function useCreateLogbook({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<LogbookDetail, Error, { name: string }>({
    mutationFn: (input) => Promise.resolve(store.createLogbook(demo, input)),
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
    mutationFn: (input) => Promise.resolve(store.createEntry(demo, input)),
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
    mutationFn: (input) => Promise.resolve(store.renameEntry(demo, input)),
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
    mutationFn: (input) => Promise.resolve(store.updateEntryContent(demo, input)),
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
    mutationFn: (input) => Promise.resolve(store.updateEntryMetadata(demo, input)),
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
  return useMutation<
    EntryDetail | null,
    Error,
    { id: string; logbookId: string; target: store.MoveTarget }
  >({
    mutationFn: (input) =>
      Promise.resolve(store.moveEntry(demo, { id: input.id, target: input.target })),
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
      mutationFn: (input) => Promise.resolve(store.reorderSiblings(demo, input)),
      onSuccess: (_ok, vars) => {
        void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
      },
    },
  );
}

export function useDeleteEntry({ demo = false }: { demo?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<boolean, Error, { id: string; logbookId: string }>({
    mutationFn: (input) => Promise.resolve(store.deleteEntry(demo, { id: input.id })),
    onSuccess: (_ok, vars) => {
      void qc.invalidateQueries({ queryKey: keys.logbookOverview(demo, vars.logbookId) });
      void qc.invalidateQueries({ queryKey: keys.entry(demo, vars.id) });
    },
  });
}

export type { LogbookSummary };
