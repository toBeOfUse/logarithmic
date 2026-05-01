/**
 * In-memory store powering both the demo logbook and any user-created
 * logbooks. The intent is to mirror the shape of the eventual API responses
 * so that the data-fetching hooks need only swap their backing call.
 *
 * There are two stores:
 *  - the `demo` store, seeded from DEMO_TREE
 *  - the `user` store, initially empty
 *
 * Each store is a flat record of entries plus a list of logbooks; the tree
 * shape is reconstructed via parentId at read time.
 */
import type {
  EntryDetail,
  EntryNode,
  LogbookDetail,
  LogbookOverview,
  LogbookSummary,
  Metadata,
} from "logarithmic-backend/api-types";

import { DEMO_LOGBOOKS, type DemoSeedEntry } from "./demo-tree.ts";

type EntryRecord = {
  id: string;
  logbookId: string;
  parentId: string | null;
  name: string;
  col: number;
  content: string | null;
  metadata: Metadata | null;
  createdAt: Date;
  updatedAt: Date;
};

type LogbookRecord = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
};

type Bucket = "demo" | "user";

type Store = {
  logbooks: Map<string, LogbookRecord>;
  entries: Map<string, EntryRecord>;
};

const DEMO_OWNER_ID = "00000000-0000-0000-0000-00000000demo";
const USER_OWNER_ID = "00000000-0000-0000-0000-000000000user";

function emptyStore(): Store {
  return { logbooks: new Map(), entries: new Map() };
}

const stores: Record<Bucket, Store> = {
  demo: emptyStore(),
  user: emptyStore(),
};

function seedDemo() {
  const now = new Date("2026-04-28T12:00:00Z");
  for (const demo of DEMO_LOGBOOKS) {
    const lb: LogbookRecord = {
      id: demo.id,
      name: demo.name,
      ownerId: DEMO_OWNER_ID,
      createdAt: now,
      updatedAt: now,
    };
    stores.demo.logbooks.set(lb.id, lb);

    const walk = (seed: DemoSeedEntry, parentId: string | null) => {
      const rec: EntryRecord = {
        id: seed.id,
        logbookId: lb.id,
        parentId,
        name: seed.name,
        col: seed.col,
        content: seed.content ?? null,
        metadata: seed.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };
      stores.demo.entries.set(rec.id, rec);
      seed.children?.forEach((c) => walk(c, rec.id));
    };
    for (const root of demo.tree) walk(root, null);
  }
}

seedDemo();

// ── helpers ────────────────────────────────────────────────────────────

function pickStore(demo: boolean): Store {
  return demo ? stores.demo : stores.user;
}

function uid(): string {
  // crypto.randomUUID exists in modern browsers and Node.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2, 12)}`;
}

function recToSummary(store: Store, lb: LogbookRecord): LogbookSummary {
  let count = 0;
  for (const e of store.entries.values()) if (e.logbookId === lb.id) count++;
  return {
    id: lb.id,
    name: lb.name,
    updatedAt: lb.updatedAt,
    entryCount: count,
  };
}

function recToDetail(lb: LogbookRecord): LogbookDetail {
  return {
    id: lb.id,
    name: lb.name,
    ownerId: lb.ownerId,
    createdAt: lb.createdAt,
    updatedAt: lb.updatedAt,
  };
}

function recToNode(e: EntryRecord): EntryNode {
  return {
    id: e.id,
    name: e.name,
    col: e.col,
    parentId: e.parentId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    hasContent: e.content != null && e.content.length > 0,
    metadataKeys: e.metadata ? Object.keys(e.metadata) : [],
  };
}

// ── reads ──────────────────────────────────────────────────────────────

export function listLogbooks(demo: boolean): LogbookSummary[] {
  const store = pickStore(demo);
  return [...store.logbooks.values()]
    .map((lb) => recToSummary(store, lb))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function getLogbookOverview(demo: boolean, logbookId: string): LogbookOverview | null {
  const store = pickStore(demo);
  const lb = store.logbooks.get(logbookId);
  if (!lb) return null;
  const entries: EntryNode[] = [];
  for (const e of store.entries.values()) {
    if (e.logbookId === logbookId) entries.push(recToNode(e));
  }
  return { logbook: recToDetail(lb), entries };
}

export function getEntry(demo: boolean, entryId: string): EntryDetail | null {
  const store = pickStore(demo);
  const e = store.entries.get(entryId);
  if (!e) return null;

  const ancestors: { id: string; name: string }[] = [];
  let cursor = e.parentId ? (store.entries.get(e.parentId) ?? null) : null;
  while (cursor) {
    ancestors.unshift({ id: cursor.id, name: cursor.name });
    cursor = cursor.parentId ? (store.entries.get(cursor.parentId) ?? null) : null;
  }

  const children = [...store.entries.values()]
    .filter((c) => c.parentId === e.id)
    .sort((a, b) => b.col - a.col || a.createdAt.getTime() - b.createdAt.getTime())
    .map((c) => ({ id: c.id, name: c.name, col: c.col, metadata: c.metadata }));

  return {
    id: e.id,
    name: e.name,
    col: e.col,
    content: e.content,
    metadata: e.metadata,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    logbookId: e.logbookId,
    parentId: e.parentId,
    ancestors,
    children,
  };
}

// ── writes ─────────────────────────────────────────────────────────────

export function createLogbook(demo: boolean, input: { name: string }): LogbookDetail {
  const store = pickStore(demo);
  const now = new Date();
  const lb: LogbookRecord = {
    id: uid(),
    name: input.name.trim() || "Untitled logbook",
    ownerId: USER_OWNER_ID,
    createdAt: now,
    updatedAt: now,
  };
  store.logbooks.set(lb.id, lb);
  return recToDetail(lb);
}

export function createEntry(
  demo: boolean,
  input: { logbookId: string; name?: string; col?: number; parentId?: string | null },
): EntryDetail | null {
  const store = pickStore(demo);
  if (!store.logbooks.has(input.logbookId)) return null;
  const parent = input.parentId ? (store.entries.get(input.parentId) ?? null) : null;
  const col = input.col ?? (parent ? parent.col - 1 : 0);
  const now = new Date();
  const rec: EntryRecord = {
    id: uid(),
    logbookId: input.logbookId,
    parentId: parent?.id ?? null,
    name: input.name ?? "",
    col,
    content: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
  store.entries.set(rec.id, rec);
  touchLogbook(store, input.logbookId, now);
  return getEntry(demo, rec.id);
}

export function renameEntry(
  demo: boolean,
  input: { id: string; name: string },
): EntryDetail | null {
  const store = pickStore(demo);
  const e = store.entries.get(input.id);
  if (!e) return null;
  e.name = input.name;
  e.updatedAt = new Date();
  touchLogbook(store, e.logbookId, e.updatedAt);
  return getEntry(demo, e.id);
}

export function updateEntryContent(
  demo: boolean,
  input: { id: string; content: string },
): EntryDetail | null {
  const store = pickStore(demo);
  const e = store.entries.get(input.id);
  if (!e) return null;
  e.content = input.content;
  e.updatedAt = new Date();
  touchLogbook(store, e.logbookId, e.updatedAt);
  return getEntry(demo, e.id);
}

export function updateEntryMetadata(
  demo: boolean,
  input: { id: string; metadata: Metadata },
): EntryDetail | null {
  const store = pickStore(demo);
  const e = store.entries.get(input.id);
  if (!e) return null;
  e.metadata = { ...input.metadata };
  e.updatedAt = new Date();
  touchLogbook(store, e.logbookId, e.updatedAt);
  return getEntry(demo, e.id);
}

export function deleteEntry(demo: boolean, input: { id: string }): boolean {
  const store = pickStore(demo);
  const e = store.entries.get(input.id);
  if (!e) return false;
  // Cascade: remove descendants too.
  const toDelete = new Set<string>([e.id]);
  let added = true;
  while (added) {
    added = false;
    for (const cand of store.entries.values()) {
      if (cand.parentId && toDelete.has(cand.parentId) && !toDelete.has(cand.id)) {
        toDelete.add(cand.id);
        added = true;
      }
    }
  }
  for (const id of toDelete) store.entries.delete(id);
  touchLogbook(store, e.logbookId, new Date());
  return true;
}

function touchLogbook(store: Store, logbookId: string, now: Date) {
  const lb = store.logbooks.get(logbookId);
  if (lb) lb.updatedAt = now;
}
