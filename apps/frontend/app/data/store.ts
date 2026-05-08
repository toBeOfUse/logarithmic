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
  /** Rank among siblings; lower comes first. */
  order: number;
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

    const walk = (
      seed: DemoSeedEntry,
      parentId: string | null,
      parentCol: number | null,
      order: number,
    ) => {
      // Spec invariant: a child's column is exactly one less than its parent's.
      if (parentCol !== null && seed.col !== parentCol - 1) {
        throw new Error(
          `Demo seed invariant violated for ${lb.name}: entry ${seed.id} (col ${seed.col}) under parent at col ${parentCol} — must be ${parentCol - 1}.`,
        );
      }
      // Spec invariant: all siblings share a column. Enforced via the
      // parent-col check above plus this check across the children array.
      if (seed.children && seed.children.length > 0) {
        const first = seed.children[0]!;
        const firstCol = first.col;
        for (const c of seed.children) {
          if (c.col !== firstCol) {
            throw new Error(
              `Demo seed invariant violated for ${lb.name}: siblings under ${seed.id} have mixed columns (${firstCol} vs ${c.col}).`,
            );
          }
        }
      }
      const rec: EntryRecord = {
        id: seed.id,
        logbookId: lb.id,
        parentId,
        name: seed.name,
        col: seed.col,
        order,
        content: seed.content ?? null,
        metadata: seed.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };
      stores.demo.entries.set(rec.id, rec);
      seed.children?.forEach((c, i) => walk(c, rec.id, seed.col, i));
    };
    // Roots are intentionally allowed to span different columns — the
    // sibling-share-a-column invariant only applies inside a parent.
    demo.tree.forEach((root, i) => walk(root, null, null, i));
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
  const recs: EntryRecord[] = [];
  for (const e of store.entries.values()) {
    if (e.logbookId === logbookId) recs.push(e);
  }
  // Per spec/2-backend.md, responses arrive sorted such that within each
  // parent's children list, siblings appear in their assigned order.
  recs.sort((a, b) => {
    const pa = a.parentId ?? "";
    const pb = b.parentId ?? "";
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.order - b.order;
  });
  return { logbook: recToDetail(lb), entries: recs.map(recToNode) };
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
    .sort((a, b) => a.order - b.order)
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
  const siblings = siblingsOf(store, input.logbookId, parent?.id ?? null);
  const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1;
  const rec: EntryRecord = {
    id: uid(),
    logbookId: input.logbookId,
    parentId: parent?.id ?? null,
    name: input.name ?? "",
    col,
    order,
    content: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
  store.entries.set(rec.id, rec);
  touchLogbook(store, input.logbookId, now);
  return getEntry(demo, rec.id);
}

/**
 * Move an entry to a new position. The target is one of:
 *   - { kind: "before"|"after", refId } — place adjacent to refId, taking on its parent.
 *   - { kind: "child", parentId }       — append as last child of parentId (or root if null).
 *   - { kind: "rootInCol", col }        — append as last root in the given column.
 *
 * The entry's column is updated to match its new parent (parent.col - 1) when given
 * a new parent; for "rootInCol" the column is set explicitly.
 */
export type MoveTarget =
  | { kind: "before"; refId: string }
  | { kind: "after"; refId: string }
  | { kind: "child"; parentId: string }
  | { kind: "rootInCol"; col: number };

export function moveEntry(
  demo: boolean,
  input: { id: string; target: MoveTarget },
): EntryDetail | null {
  const store = pickStore(demo);
  const e = store.entries.get(input.id);
  if (!e) return null;

  let newParentId: string | null;
  let newCol: number;
  let insertIndex: number;

  if (input.target.kind === "before" || input.target.kind === "after") {
    const ref = store.entries.get(input.target.refId);
    if (!ref) return null;
    if (ref.id === e.id) return getEntry(demo, e.id);
    // Don't allow making an entry a sibling of its own descendant.
    if (isAncestor(store, e.id, ref.id)) return getEntry(demo, e.id);
    newParentId = ref.parentId;
    const parent = ref.parentId ? store.entries.get(ref.parentId) : null;
    newCol = parent ? parent.col - 1 : ref.col;
    const sibs = siblingsOf(store, e.logbookId, newParentId)
      .filter((s) => s.id !== e.id)
      .sort((a, b) => a.order - b.order);
    const refIdx = sibs.findIndex((s) => s.id === ref.id);
    insertIndex = input.target.kind === "before" ? refIdx : refIdx + 1;
    rebalanceWithInsert(store, e, newParentId, newCol, sibs, insertIndex);
  } else if (input.target.kind === "child") {
    const parent = store.entries.get(input.target.parentId);
    if (!parent) return null;
    if (parent.id === e.id) return getEntry(demo, e.id);
    if (isAncestor(store, e.id, parent.id)) return getEntry(demo, e.id);
    newParentId = parent.id;
    newCol = parent.col - 1;
    const sibs = siblingsOf(store, e.logbookId, newParentId)
      .filter((s) => s.id !== e.id)
      .sort((a, b) => a.order - b.order);
    insertIndex = sibs.length;
    rebalanceWithInsert(store, e, newParentId, newCol, sibs, insertIndex);
  } else {
    newParentId = null;
    newCol = input.target.col;
    const sibs = siblingsOf(store, e.logbookId, null)
      .filter((s) => s.id !== e.id)
      .sort((a, b) => a.order - b.order);
    insertIndex = sibs.length;
    rebalanceWithInsert(store, e, newParentId, newCol, sibs, insertIndex);
  }

  // Re-cascade column to all descendants based on parent's col.
  cascadeCols(store, e.id);

  const now = new Date();
  e.updatedAt = now;
  touchLogbook(store, e.logbookId, now);
  return getEntry(demo, e.id);
}

export function reorderSiblings(
  demo: boolean,
  input: { parentId: string | null; logbookId: string; ids: string[] },
): boolean {
  const store = pickStore(demo);
  if (!store.logbooks.has(input.logbookId)) return false;
  const sibs = siblingsOf(store, input.logbookId, input.parentId);
  const set = new Set(sibs.map((s) => s.id));
  for (const id of input.ids) if (!set.has(id)) return false;
  if (input.ids.length !== sibs.length) return false;
  input.ids.forEach((id, i) => {
    const s = store.entries.get(id);
    if (s) s.order = i;
  });
  touchLogbook(store, input.logbookId, new Date());
  return true;
}

function siblingsOf(store: Store, logbookId: string, parentId: string | null): EntryRecord[] {
  const out: EntryRecord[] = [];
  for (const c of store.entries.values()) {
    if (c.logbookId === logbookId && c.parentId === parentId) out.push(c);
  }
  return out;
}

function isAncestor(store: Store, ancestorId: string, descendantId: string): boolean {
  let cursor: string | null = descendantId;
  while (cursor) {
    if (cursor === ancestorId) return true;
    const node = store.entries.get(cursor);
    cursor = node?.parentId ?? null;
  }
  return false;
}

function rebalanceWithInsert(
  store: Store,
  entry: EntryRecord,
  newParentId: string | null,
  newCol: number,
  otherSiblings: EntryRecord[],
  insertIndex: number,
) {
  entry.parentId = newParentId;
  entry.col = newCol;
  const ordered = [
    ...otherSiblings.slice(0, insertIndex),
    entry,
    ...otherSiblings.slice(insertIndex),
  ];
  ordered.forEach((rec, i) => {
    rec.order = i;
  });
}

function cascadeCols(store: Store, rootId: string) {
  // Walk all descendants of rootId; their col = parent.col - 1.
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = store.entries.get(id);
    if (!node) continue;
    for (const c of store.entries.values()) {
      if (c.parentId === id) {
        c.col = node.col - 1;
        queue.push(c.id);
      }
    }
  }
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
