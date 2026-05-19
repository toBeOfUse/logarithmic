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
 * this function only walks ancestors and collects children.
 */
export async function buildEntryDetail(em: EntityManager, entry: Entry): Promise<EntryDetail> {
  const ancestors: { id: string; slug: string; name: string }[] = [];
  let cursor: Entry | null = entry.parent ? await em.findOne(Entry, { id: entry.parent.id }) : null;
  while (cursor) {
    ancestors.unshift({ id: cursor.id, slug: cursor.slug, name: cursor.name });
    cursor = cursor.parent ? await em.findOne(Entry, { id: cursor.parent.id }) : null;
  }

  const children = await em.find(Entry, { parent: entry.id }, { orderBy: { order: "asc" } });

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
