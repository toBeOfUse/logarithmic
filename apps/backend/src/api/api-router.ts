/**
 * Top-level tRPC router. Procedures live in `logbook-api.ts`, `entry-api.ts`,
 * and `image-api.ts`; ownership-enforcing procedure variants are defined
 * alongside the procedures that need them.
 *
 * `image.upload` carries multipart form data rather than JSON, so it runs its
 * own inline auth gate (it can't take the JSON `logbookProcedure` input) — see
 * `image-api.ts`.
 */
import { mergeRouters, router } from "../trpc.ts";
import { entryRouter } from "./entry-api.ts";
import { imageRouter } from "./image-api.ts";
import { logbookRouter } from "./logbook-api.ts";

export const appRouter = router({
  logbook: mergeRouters(logbookRouter),
  entry: entryRouter,
  image: imageRouter,
});

export type AppRouter = typeof appRouter;
