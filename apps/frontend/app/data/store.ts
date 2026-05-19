/**
 * In-memory store backing the demo logbooks. Demo data is seeded from
 * `DEMO_LOGBOOKS` at module load and never persisted — refreshing the page
 * resets every demo logbook to its initial state. User-created logbooks live
 * on the backend and reach these hooks via `./trpc.ts` instead.
 *
 * The store mirrors the API response shapes so the same React Query cache
 * entries are valid whether they were produced here or by a real network
 * round trip.
 */
import { newId } from "logarithmic-config/ids";
import { slugify } from "logarithmic-config/slug";
import type {
  EntryDetail,
  EntryNode,
  LogbookDetail,
  LogbookOverview,
  LogbookSummary,
  Metadata,
  MoveEntryInput,
} from "logarithmic-backend/api-types";

import { DEMO_LOGBOOKS } from "./demo-tree.ts";

type EntryRecord = {
  id: string;
  slug: string;
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
  slug: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
};

type Store = {
  logbooks: Map<string, LogbookRecord>;
  entries: Map<string, EntryRecord>;
};

const DEMO_OWNER_ID = "00000000-0000-0000-0000-00000000demo";

const store: Store = { logbooks: new Map(), entries: new Map() };
const demoLogbookIds = new Set<string>();

function seed() {
  const now = new Date("2026-04-28T12:00:00Z");
  for (const demo of DEMO_LOGBOOKS) {
    const lb: LogbookRecord = {
      id: newId(),
      slug: slugify(demo.name),
      name: demo.name,
      ownerId: DEMO_OWNER_ID,
      createdAt: now,
      updatedAt: now,
    };
    store.logbooks.set(lb.id, lb);
    demoLogbookIds.add(lb.id);

    type Seed = (typeof demo.tree)[number];
    const walk = (
      entry: Seed,
      parentId: string | null,
      parentCol: number | null,
      order: number,
    ) => {
      // Spec invariant: a child's column is exactly one less than its parent's.
      if (parentCol !== null && entry.col !== parentCol - 1) {
        throw new Error(
          `Demo seed invariant violated for ${lb.name}: entry "${entry.name}" (col ${entry.col}) under parent at col ${parentCol} — must be ${parentCol - 1}.`,
        );
      }
      // Spec invariant: all siblings share a column.
      if (entry.children && entry.children.length > 0) {
        const firstCol = entry.children[0]!.col;
        for (const c of entry.children) {
          if (c.col !== firstCol) {
            throw new Error(
              `Demo seed invariant violated for ${lb.name}: siblings under "${entry.name}" have mixed columns (${firstCol} vs ${c.col}).`,
            );
          }
        }
      }
      const rec: EntryRecord = {
        id: newId(),
        slug: slugify(entry.name),
        logbookId: lb.id,
        parentId,
        name: entry.name,
        col: entry.col,
        order,
        content: entry.content ?? null,
        metadata: entry.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.entries.set(rec.id, rec);
      entry.children?.forEach((c, i) => walk(c, rec.id, entry.col, i));
    };
    // Roots are intentionally allowed to span different columns — the
    // sibling-share-a-column invariant only applies inside a parent.
    demo.tree.forEach((root, i) => walk(root, null, null, i));
  }
}

seed();

export function isDemoLogbookId(id: string | undefined): boolean {
  return id !== undefined && demoLogbookIds.has(id);
}

// ── projections ────────────────────────────────────────────────────────

function recToSummary(lb: LogbookRecord): LogbookSummary {
  let count = 0;
  for (const e of store.entries.values()) if (e.logbookId === lb.id) count++;
  return {
    id: lb.id,
    slug: lb.slug,
    name: lb.name,
    updatedAt: lb.updatedAt,
    entryCount: count,
  };
}

function recToDetail(lb: LogbookRecord): LogbookDetail {
  return {
    id: lb.id,
    slug: lb.slug,
    name: lb.name,
    ownerId: lb.ownerId,
    createdAt: lb.createdAt,
    updatedAt: lb.updatedAt,
  };
}

function buildTree(logbookId: string): EntryNode[] {
  const byParent = new Map<string | null, EntryRecord[]>();
  for (const e of store.entries.values()) {
    if (e.logbookId !== logbookId) continue;
    const list = byParent.get(e.parentId) ?? [];
    list.push(e);
    byParent.set(e.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);
  const build = (parentId: string | null): EntryNode[] =>
    (byParent.get(parentId) ?? []).map((e) => ({
      id: e.id,
      slug: e.slug,
      name: e.name,
      col: e.col,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      hasContent: e.content != null && e.content.length > 0,
      metadataKeys: e.metadata ? Object.keys(e.metadata) : [],
      children: build(e.id),
    }));
  return build(null);
}

// ── reads ──────────────────────────────────────────────────────────────

export function listLogbooks(): LogbookSummary[] {
  return [...store.logbooks.values()]
    .map(recToSummary)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function getLogbookOverview(logbookId: string): LogbookOverview | null {
  const lb = store.logbooks.get(logbookId);
  if (!lb) return null;
  return { logbook: recToDetail(lb), entries: buildTree(lb.id) };
}

export function getEntry(entryId: string): EntryDetail | null {
  const e = store.entries.get(entryId);
  if (!e) return null;

  const ancestors: { id: string; slug: string; name: string }[] = [];
  let cursor = e.parentId ? (store.entries.get(e.parentId) ?? null) : null;
  while (cursor) {
    ancestors.unshift({ id: cursor.id, slug: cursor.slug, name: cursor.name });
    cursor = cursor.parentId ? (store.entries.get(cursor.parentId) ?? null) : null;
  }

  const children = [...store.entries.values()]
    .filter((c) => c.parentId === e.id)
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ id: c.id, slug: c.slug, name: c.name, col: c.col, metadata: c.metadata }));

  return {
    id: e.id,
    slug: e.slug,
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

export function createLogbook(input: { name: string }): LogbookDetail {
  const now = new Date();
  const name = input.name.trim() || "Untitled logbook";
  const lb: LogbookRecord = {
    id: newId(),
    slug: slugify(name),
    name,
    ownerId: DEMO_OWNER_ID,
    createdAt: now,
    updatedAt: now,
  };
  store.logbooks.set(lb.id, lb);
  return recToDetail(lb);
}

export function createEntry(input: {
  logbookId: string;
  name?: string;
  col?: number;
  parentId?: string | null;
}): EntryDetail | null {
  if (!store.logbooks.has(input.logbookId)) return null;
  const parent = input.parentId ? (store.entries.get(input.parentId) ?? null) : null;
  const col = input.col ?? (parent ? parent.col - 1 : 0);
  const now = new Date();
  const siblings = siblingsOf(input.logbookId, parent?.id ?? null);
  const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1;
  const name = input.name ?? "";
  const rec: EntryRecord = {
    id: newId(),
    slug: slugify(name),
    logbookId: input.logbookId,
    parentId: parent?.id ?? null,
    name,
    col,
    order,
    content: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
  store.entries.set(rec.id, rec);
  touchLogbook(input.logbookId, now);
  return getEntry(rec.id);
}

/**
 * Move an entry under a new parent at a specific position. See `MoveEntryInput`
 * in `logarithmic-backend/api-types` for the contract — semantics match the
 * server implementation exactly so the demo logbook responds identically.
 */
export function moveEntry(input: MoveEntryInput): EntryDetail | null {
  const e = store.entries.get(input.id);
  if (!e) return null;
  if (input.parentId === e.id) return getEntry(e.id);
  if (input.parentId !== null) {
    const parent = store.entries.get(input.parentId);
    if (!parent) return null;
    if (isAncestor(e.id, parent.id)) return getEntry(e.id);
    if (input.col !== parent.col - 1) return getEntry(e.id);
  }

  const sibs = siblingsOf(e.logbookId, input.parentId)
    .filter((s) => s.id !== e.id)
    .sort((a, b) => a.order - b.order);
  const clamped = Math.max(0, Math.min(input.position, sibs.length));

  e.parentId = input.parentId;
  e.col = input.col;
  const ordered = [...sibs.slice(0, clamped), e, ...sibs.slice(clamped)];
  ordered.forEach((rec, i) => {
    rec.order = i;
  });

  cascadeCols(e.id);

  const now = new Date();
  e.updatedAt = now;
  touchLogbook(e.logbookId, now);
  return getEntry(e.id);
}

export function reorderSiblings(input: {
  parentId: string | null;
  logbookId: string;
  ids: string[];
}): boolean {
  if (!store.logbooks.has(input.logbookId)) return false;
  const sibs = siblingsOf(input.logbookId, input.parentId);
  const set = new Set(sibs.map((s) => s.id));
  for (const id of input.ids) if (!set.has(id)) return false;
  if (input.ids.length !== sibs.length) return false;
  input.ids.forEach((id, i) => {
    const s = store.entries.get(id);
    if (s) s.order = i;
  });
  touchLogbook(input.logbookId, new Date());
  return true;
}

function siblingsOf(logbookId: string, parentId: string | null): EntryRecord[] {
  const out: EntryRecord[] = [];
  for (const c of store.entries.values()) {
    if (c.logbookId === logbookId && c.parentId === parentId) out.push(c);
  }
  return out;
}

function isAncestor(ancestorId: string, descendantId: string): boolean {
  let cursor: string | null = descendantId;
  while (cursor) {
    if (cursor === ancestorId) return true;
    const node = store.entries.get(cursor);
    cursor = node?.parentId ?? null;
  }
  return false;
}

function cascadeCols(rootId: string) {
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

export function renameEntry(input: { id: string; name: string }): EntryDetail | null {
  const e = store.entries.get(input.id);
  if (!e) return null;
  e.name = input.name;
  e.slug = slugify(input.name);
  e.updatedAt = new Date();
  touchLogbook(e.logbookId, e.updatedAt);
  return getEntry(e.id);
}

export function updateEntryContent(input: { id: string; content: string }): EntryDetail | null {
  const e = store.entries.get(input.id);
  if (!e) return null;
  e.content = input.content;
  e.updatedAt = new Date();
  touchLogbook(e.logbookId, e.updatedAt);
  return getEntry(e.id);
}

export function updateEntryMetadata(input: { id: string; metadata: Metadata }): EntryDetail | null {
  const e = store.entries.get(input.id);
  if (!e) return null;
  e.metadata = { ...input.metadata };
  e.updatedAt = new Date();
  touchLogbook(e.logbookId, e.updatedAt);
  return getEntry(e.id);
}

export function deleteEntry(input: { id: string }): boolean {
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
  touchLogbook(e.logbookId, new Date());
  return true;
}

function touchLogbook(logbookId: string, now: Date) {
  const lb = store.logbooks.get(logbookId);
  if (lb) lb.updatedAt = now;
}
