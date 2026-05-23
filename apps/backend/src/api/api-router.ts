/**
 * Top-level tRPC router. Procedures live in `logbook-api.ts`,
 * `entry-api.ts`, and `export-import.ts`; ownership-enforcing procedure
 * variants are defined alongside the procedures that need them.
 *
 * `export-import.ts` lives in its own router because it carries non-JSON I/O
 * (a binary ZIP payload), so it stays separate from the JSON-only logbook
 * procedures and gets merged in here under the same `logbook` namespace.
 */
import { mergeRouters, router } from "../trpc.ts";
import { entryRouter } from "./entry-api.ts";
import { exportImportRouter } from "./export-import.ts";
import { logbookRouter } from "./logbook-api.ts";

export const appRouter = router({
  logbook: mergeRouters(logbookRouter, exportImportRouter),
  entry: entryRouter,
});

export type AppRouter = typeof appRouter;
