/**
 * Entry tRPC procedures. Every procedure that touches an entry takes a
 * `logbookId` in its input so the `logbookProcedure` auth gate (which
 * validates the Authorization-header bearer token against that logbookId)
 * can run before any entry work happens. `entryProcedure` then layers on top:
 * it loads the entry and rejects with NOT_FOUND if the entry isn't in the
 * authorized logbook — so a valid token for logbook A can't reach an entry
 * that lives under logbook B.
 */
import { TRPCError } from "@trpc/server";
import slugify from "@sindresorhus/slugify";
import { z } from "zod";

import type { EntryDetail } from "./api-types.ts";
import { Entry } from "../entities/Entry.ts";
import { Logbook } from "../entities/Logbook.ts";
import { logbookProcedure, router } from "../trpc.ts";
import {
  buildAllEntryDetails,
  buildEntryDetail,
  cascadeCols,
  CONTENT_MAX,
  ENTRY_NAME_MAX,
  indexChildren,
  isAncestor,
  metadataSchema,
} from "./utils.ts";

const entryIdSchema = z.number().int().positive();

const entryProcedure = logbookProcedure
  .input(z.object({ id: entryIdSchema }))
  .use(async ({ ctx, input, next }) => {
    const entry = await ctx.em.findOne(
      Entry,
      { id: input.id, logbook: ctx.logbook.id },
      { populate: ["logbook"] },
    );
    if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });
    return next({ ctx: { ...ctx, entry } });
  });

export const entryRouter = router({
  get: entryProcedure.query(({ ctx }) => buildEntryDetail(ctx.em, ctx.entry)),

  /**
   * Every entry in the logbook as a full EntryDetail, in one round trip. The
   * frontend calls this when a logbook opens to warm the per-entry cache up
   * front, so opening an entry paints instantly while a per-entry refetch
   * revalidates it. Authorized by `logbookProcedure` — no per-entry id, so it
   * loads the whole authorized logbook at once.
   */
  allDetails: logbookProcedure.query(
    ({ ctx }): Promise<EntryDetail[]> => buildAllEntryDetails(ctx.em, ctx.logbook.id),
  ),

  create: logbookProcedure
    .input(
      z.object({
        name: z.string().max(ENTRY_NAME_MAX).optional(),
        col: z.number().int().optional(),
        parentId: entryIdSchema.nullable().optional(),
        iconName: z.string().max(64).nullable().optional(),
        iconFamily: z.string().max(32).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<EntryDetail> => {
      const lb = ctx.logbook;
      const parent =
        input.parentId != null
          ? await ctx.em.findOne(Entry, { id: input.parentId, logbook: lb.id })
          : null;
      if (input.parentId != null && !parent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Parent entry not found" });
      }
      if (parent && input.col !== undefined && input.col !== parent.col - 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "col must equal parent.col - 1 for non-root entries",
        });
      }
      const col = input.col ?? (parent ? parent.col - 1 : 0);
      const siblings = await ctx.em.find(Entry, {
        logbook: lb.id,
        parent: parent?.id ?? null,
      });
      const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1;

      const name = input.name ?? "";
      // Keep the icon pair consistent, like `setIcon`: store both parts or
      // neither, so a half-set request just leaves the entry iconless.
      const hasIcon = input.iconName != null && input.iconFamily != null;
      const entry = ctx.em.create(Entry, {
        name,
        slug: slugify(name),
        col,
        order,
        content: null,
        metadata: null,
        iconName: hasIcon ? input.iconName! : null,
        iconFamily: hasIcon ? input.iconFamily! : null,
        logbook: ctx.em.getReference(Logbook, lb.id),
        parent: parent ? ctx.em.getReference(Entry, parent.id) : null,
      });
      lb.updatedAt = new Date();
      ctx.em.persist(entry);
      await ctx.em.flush();

      return buildEntryDetail(ctx.em, entry);
    }),

  rename: entryProcedure
    .input(z.object({ name: z.string().max(ENTRY_NAME_MAX) }))
    .mutation(async ({ ctx, input }): Promise<EntryDetail> => {
      const entry = ctx.entry;
      entry.name = input.name;
      entry.slug = slugify(input.name);
      entry.logbook.updatedAt = new Date();
      await ctx.em.flush();
      return buildEntryDetail(ctx.em, entry);
    }),

  updateContent: entryProcedure
    .input(z.object({ content: z.string().max(CONTENT_MAX) }))
    .mutation(async ({ ctx, input }): Promise<EntryDetail> => {
      const entry = ctx.entry;
      entry.content = input.content;
      entry.logbook.updatedAt = new Date();
      await ctx.em.flush();
      return buildEntryDetail(ctx.em, entry);
    }),

  setIcon: entryProcedure
    .input(
      z.object({
        iconName: z.string().max(64).nullable(),
        iconFamily: z.string().max(32).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<EntryDetail> => {
      const entry = ctx.entry;
      // Keep the pair consistent: an icon without a family (or vice versa) has
      // no well-defined meaning, so a half-set request clears the icon.
      const hasBoth = input.iconName !== null && input.iconFamily !== null;
      entry.iconName = hasBoth ? input.iconName : null;
      entry.iconFamily = hasBoth ? input.iconFamily : null;
      entry.logbook.updatedAt = new Date();
      await ctx.em.flush();
      return buildEntryDetail(ctx.em, entry);
    }),

  updateMetadata: entryProcedure
    .input(z.object({ metadata: metadataSchema }))
    .mutation(async ({ ctx, input }): Promise<EntryDetail> => {
      const entry = ctx.entry;
      entry.metadata = { ...input.metadata };
      entry.logbook.updatedAt = new Date();
      await ctx.em.flush();
      return buildEntryDetail(ctx.em, entry);
    }),

  move: entryProcedure
    .input(
      z.object({
        parentId: entryIdSchema.nullable(),
        col: z.number().int(),
        position: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<EntryDetail> => {
      const entry = ctx.entry;

      // Self-as-parent and ancestor cycles aren't valid moves; mirror the legacy
      // behavior of returning the entry unchanged rather than 4xx-ing the client,
      // which keeps a stray drop from looking like a failed mutation.
      if (input.parentId === entry.id) return buildEntryDetail(ctx.em, entry);

      // Pull the whole logbook into memory so the sibling renumber + col cascade
      // is a pure in-memory shuffle. SQLite + small logbooks make this cheap; if
      // it stops being cheap, we'll switch to a windowed approach later.
      const all = await ctx.em.find(Entry, { logbook: entry.logbook.id });
      const byId = new Map(all.map((e) => [e.id, e] as const));

      let parent: Entry | null = null;
      if (input.parentId !== null) {
        parent = byId.get(input.parentId) ?? null;
        if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "Parent entry not found" });
        if (isAncestor(byId, entry.id, parent.id)) return buildEntryDetail(ctx.em, entry);
        if (input.col !== parent.col - 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "col must equal parent.col - 1 for non-root entries",
          });
        }
      }

      const sibs = all
        .filter((e) => (e.parent?.id ?? null) === input.parentId && e.id !== entry.id)
        .sort((a, b) => a.order - b.order);
      const clamped = Math.max(0, Math.min(input.position, sibs.length));

      entry.parent = parent ? (ctx.em.getReference(Entry, parent.id) as Entry) : null;
      entry.col = input.col;
      const ordered = [...sibs.slice(0, clamped), entry, ...sibs.slice(clamped)];
      ordered.forEach((rec, i) => {
        rec.order = i;
      });

      cascadeCols(byId, entry.id);
      entry.logbook.updatedAt = new Date();
      await ctx.em.flush();
      return buildEntryDetail(ctx.em, entry);
    }),

  delete: entryProcedure.mutation(async ({ ctx }): Promise<boolean> => {
    const entry = ctx.entry;
    // this gets all entries in the logbook and goes through them to find any
    // children of the entry being deleted (so they can be deleted too); a
    // closure table could make this much more efficient (but for
    // reasonably-sized logbooks, probably wouldn't be worth the overhead...)
    const all = await ctx.em.find(Entry, { logbook: entry.logbook.id });
    const childIndex = indexChildren(all);
    const removed: Entry[] = [];
    const queue: Entry[] = [entry];
    while (queue.length > 0) {
      const node = queue.shift()!;
      removed.push(node);
      const kids = childIndex.get(node.id);
      if (kids) queue.push(...kids);
    }
    entry.logbook.updatedAt = new Date();
    for (const r of removed) ctx.em.remove(r);
    await ctx.em.flush();
    return true;
  }),
});
