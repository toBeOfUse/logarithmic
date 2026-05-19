/**
 * Logbook tRPC procedures. Defines `logbookProcedure`, a protectedProcedure
 * variant that takes a `logbookId` and resolves it to an owned `Logbook` on
 * `ctx`, throwing NOT_FOUND if the caller doesn't own it. Also exported so
 * entry handlers that key off a logbook (entry.create, entry.reorderSiblings)
 * can reuse the same ownership gate.
 */
import { TRPCError } from "@trpc/server";
import slugify from "@sindresorhus/slugify";
import { z } from "zod";

import type { LogbookDetail, LogbookOverview, LogbookSummary, EntryNode } from "./api-types.ts";
import { Entry } from "../entities/Entry.ts";
import { Logbook } from "../entities/Logbook.ts";
import { anonymousProcedure, protectedProcedure, publicProcedure, router } from "../trpc.ts";
import { ENTRY_NAME_MAX, findOwnedLogbook, toLogbookDetail } from "./utils.ts";

export const logbookProcedure = protectedProcedure
  .input(z.object({ logbookId: z.string() }))
  .use(async ({ ctx, input, next }) => {
    const logbook = await findOwnedLogbook(ctx.em, ctx.user.id, input.logbookId);
    if (!logbook) throw new TRPCError({ code: "NOT_FOUND", message: "Logbook not found" });
    return next({ ctx: { ...ctx, logbook } });
  });

export const logbookRouter = router({
  // Public so the splash screen can call it before the visitor has created
  // anything. Anonymous visitors simply own no logbooks.
  list: publicProcedure.query(async ({ ctx }): Promise<LogbookSummary[]> => {
    if (!ctx.user) return [];
    const logbooks = await ctx.em.find(
      Logbook,
      { owner: ctx.user.id },
      { orderBy: { updatedAt: "desc" } },
    );
    if (logbooks.length === 0) return [];
    // Single GROUP BY query so we get one row per logbook instead of issuing
    // N COUNT queries. Raw SQL keeps the QueryBuilder's strict typing out of
    // the way for this aggregation-with-string-alias shape.
    const ids = logbooks.map((lb) => lb.id);
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await ctx.em
      .getConnection()
      .execute<{ logbook_id: string; count: number | string }[]>(
        `SELECT logbook_id, COUNT(*) AS count FROM entry WHERE logbook_id IN (${placeholders}) GROUP BY logbook_id`,
        ids,
      );
    const counts = new Map<string, number>(rows.map((r) => [r.logbook_id, Number(r.count)]));
    return logbooks.map((lb) => ({
      id: lb.id,
      slug: lb.slug,
      name: lb.name,
      updatedAt: lb.updatedAt,
      entryCount: counts.get(lb.id) ?? 0,
    }));
  }),

  overview: logbookProcedure.query(async ({ ctx }): Promise<LogbookOverview> => {
    const lb = ctx.logbook;
    const entries = await ctx.em.find(Entry, { logbook: lb.id }, { orderBy: { order: "asc" } });
    // Bucket children by parent id (entries already arrived in sibling order).
    const byParent = new Map<number | null, Entry[]>();
    for (const e of entries) {
      const pid = e.parent?.id ?? null;
      const list = byParent.get(pid) ?? [];
      list.push(e);
      byParent.set(pid, list);
    }
    const build = (parentId: number | null): EntryNode[] =>
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
    return { logbook: toLogbookDetail(lb), entries: build(null) };
  }),

  create: anonymousProcedure
    .input(z.object({ name: z.string().max(ENTRY_NAME_MAX) }))
    .mutation(async ({ ctx, input }): Promise<LogbookDetail> => {
      const name = input.name.trim() || "Untitled logbook";
      const lb = ctx.em.create(Logbook, { name, slug: slugify(name), owner: ctx.user.id });
      ctx.em.persist(lb);
      await ctx.em.flush();
      return toLogbookDetail(lb);
    }),
});
