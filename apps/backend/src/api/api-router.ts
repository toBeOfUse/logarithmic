/**
 * Top-level tRPC router. Procedures live in `logbook-api.ts` and
 * `entry-api.ts`; ownership-enforcing procedure variants are defined
 * alongside the procedures that need them.
 */
import { router } from "../trpc.ts";
import { entryRouter } from "./entry-api.ts";
import { logbookRouter } from "./logbook-api.ts";

export const appRouter = router({
  logbook: logbookRouter,
  entry: entryRouter,
});

export type AppRouter = typeof appRouter;
