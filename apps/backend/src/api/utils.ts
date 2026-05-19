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

const metadataValueSchema = z.union([z.string(), z.array(z.string()), z.null()]);
export const metadataSchema = z.record(z.string(), metadataValueSchema);

export function toLogbookDetail(lb: Logbook): LogbookDetail {
  return {
    id: lb.id,
    slug: lb.slug,
    name: lb.name,
    ownerId: lb.owner.id,
    createdAt: lb.createdAt,
    updatedAt: lb.updatedAt,
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
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
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
  byId: Map<string, Entry>,
  ancestorId: string,
  descendantId: string,
): boolean {
  let cursor: string | null = descendantId;
  while (cursor) {
    if (cursor === ancestorId) return true;
    const node = byId.get(cursor);
    cursor = node?.parent?.id ?? null;
  }
  return false;
}

/** Re-set every descendant's col so col == parent.col - 1. */
export function cascadeCols(byId: Map<string, Entry>, rootId: string) {
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (!node) continue;
    for (const c of byId.values()) {
      if (c.parent?.id === id) {
        c.col = node.col - 1;
        queue.push(c.id);
      }
    }
  }
}

/**
 * Resolve a logbook by id, asserting the caller owns it. Throws NOT_FOUND
 * (rather than FORBIDDEN) so the existence of someone else's logbook is not
 * leaked through the error code.
 */
export async function findOwnedLogbook(em: EntityManager, userId: string, logbookId: string) {
  return em.findOne(Logbook, { id: logbookId, owner: userId });
}
