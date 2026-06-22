/**
 * Shared helpers for the tRPC API: input schemas, projections to API types,
 * and the in-memory tree helpers used by entry move/delete (sibling-order
 * renumbering and col propagation to descendants).
 */
import type { EntityManager } from "@mikro-orm/sqlite";
import { z } from "zod";

import type { EntryDetail, LogbookDetail } from "./api-types.ts";
import { Entry } from "../entities/Entry.ts";
import { Logbook } from "../entities/Logbook.ts";

/**
 * Soft caps on user-controlled string sizes. The spec doesn't impose limits,
 * but unbounded strings let any authenticated caller park arbitrary blobs in
 * the database. These values are well past anything a human will type.
 */
export const ENTRY_NAME_MAX = 128;
export const LOGBOOK_NAME_MAX = 128;
export const CONTENT_MAX = 2_000_000_000;
/** A column display name; empty is allowed (renders as the default `Column N`). */
export const COLUMN_NAME_MAX = 128;
/** Soft cap on how many columns one logbook can persist settings for — well past
 *  any realistic chart width, but bounded so a caller can't park a huge array. */
export const MAX_COLUMNS = 1_000;
/** Bound on a column number so the persisted set stays sane. */
const COLUMN_INDEX_BOUND = 100_000;
const METADATA_KEY_MAX = 1_024;
const METADATA_VALUE_MAX = 100_000;
const metadataStringSchema = z.string().max(METADATA_VALUE_MAX);
const metadataValueSchema = z.union([
  metadataStringSchema,
  z.array(metadataStringSchema),
  z.null(),
]);
export const metadataSchema = z.record(z.string().max(METADATA_KEY_MAX), metadataValueSchema);

/**
 * Column settings input: a bounded array of {col, name, wide}, with no two
 * entries sharing a column number (a duplicate col would make the persisted set
 * ambiguous — the same logical-validity guard the spec calls for on bulk
 * updates).
 */
export const columnSettingsSchema = z
  .array(
    z.object({
      col: z.number().int().min(-COLUMN_INDEX_BOUND).max(COLUMN_INDEX_BOUND),
      name: z.string().max(COLUMN_NAME_MAX),
      wide: z.boolean(),
    }),
  )
  .max(MAX_COLUMNS)
  .refine((cols) => new Set(cols.map((c) => c.col)).size === cols.length, {
    message: "Duplicate column numbers are not allowed.",
  });

export function toLogbookDetail(lb: Logbook): LogbookDetail {
  return {
    id: lb.id,
    slug: lb.slug,
    name: lb.name,
    createdAt: lb.createdAt,
    updatedAt: lb.updatedAt,
    // Rows predating this column hydrate `columns` as null until first written.
    columns: (lb.columns ?? []).map((c) => ({ col: c.col, name: c.name, wide: c.wide })),
  };
}

/**
 * Build the EntryDetail projection. Caller has already established ownership;
 * this function loads the logbook's entries once and walks the chain in
 * memory rather than issuing one `findOne` per ancestor level.
 */
export async function buildEntryDetail(em: EntityManager, entry: Entry): Promise<EntryDetail> {
  // this is another query that gets every entry for a logbook that would be
  // more efficient with a closure table
  const all = await em.find(Entry, { logbook: entry.logbook.id });
  const byId = new Map(all.map((e) => [e.id, e] as const));

  const ancestors: { id: number; slug: string; name: string }[] = [];
  let cursor: Entry | null = entry.parent ? (byId.get(entry.parent.id) ?? null) : null;
  while (cursor) {
    ancestors.unshift({ id: cursor.id, slug: cursor.slug, name: cursor.name });
    cursor = cursor.parent ? (byId.get(cursor.parent.id) ?? null) : null;
  }

  const children = all.filter((e) => e.parent?.id === entry.id).sort((a, b) => a.order - b.order);

  return {
    id: entry.id,
    slug: entry.slug,
    name: entry.name,
    col: entry.col,
    content: entry.content ?? null,
    metadata: entry.metadata ?? null,
    iconName: entry.iconName ?? null,
    iconFamily: entry.iconFamily ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    wordCount: entry.wordCount,
    logbookId: entry.logbook.id,
    parentId: entry.parent?.id ?? null,
    ancestors,
    children: children.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      col: c.col,
      metadata: c.metadata ?? null,
    })),
  };
}

export function isAncestor(
  byId: Map<number, Entry>,
  ancestorId: number,
  descendantId: number,
): boolean {
  let cursor: number | null = descendantId;
  while (cursor !== null) {
    if (cursor === ancestorId) return true;
    const node = byId.get(cursor);
    cursor = node?.parent?.id ?? null;
  }
  return false;
}

/** Build a parent-id → children map from a flat entry list. Entries with no
 *  parent are keyed under `null`. */
export function indexChildren(entries: Iterable<Entry>): Map<number | null, Entry[]> {
  const out = new Map<number | null, Entry[]>();
  for (const e of entries) {
    const pid = e.parent?.id ?? null;
    const list = out.get(pid);
    if (list) list.push(e);
    else out.set(pid, [e]);
  }
  return out;
}

/** Re-set every descendant's col so col == parent.col - 1. */
export function cascadeCols(byId: Map<number, Entry>, rootId: number) {
  const childIndex = indexChildren(byId.values());
  const queue: number[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (!node) continue;
    const kids = childIndex.get(id);
    if (!kids) continue;
    for (const c of kids) {
      c.col = node.col - 1;
      queue.push(c.id);
    }
  }
}
