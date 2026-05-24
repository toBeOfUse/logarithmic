/**
 * tRPC initialization. The context is built per request: it forks the
 * EntityManager (so each request gets its own identity map) and lazily
 * resolves the logbook authorized by the incoming `Authorization: Bearer …`
 * header. There are no users or sessions — access is purely per-logbook,
 * keyed off the token (see `./tokens.ts`).
 *
 * Procedures that operate on a specific logbook use `logbookProcedure`, which
 * validates both that a token was supplied and that the token's logbook
 * matches the `logbookId` in the input. Procedures that hand out new tokens
 * (logbook.create, logbook.import) are open via `publicProcedure`, as is the
 * splash-screen `logbook.listByTokens`, which takes tokens in its input.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { EntityManager } from "@mikro-orm/sqlite";
import superjson from "superjson";
import { z } from "zod";

import { getOrm } from "./db.ts";
import type { Logbook } from "./entities/Logbook.ts";
import { readBearerToken, resolveLogbookForToken } from "./tokens.ts";

export type Context = {
  em: EntityManager;
  /** Raw bearer token off the request, if any. Use `resolveAuthorizedLogbook`
   *  rather than reading this directly so the lookup happens lazily. */
  bearerToken: string | null;
};

export async function createContext({ req }: CreateFastifyContextOptions): Promise<Context> {
  const orm = await getOrm();
  const em = orm.em.fork();
  const bearerToken = readBearerToken(req.headers.authorization);
  return { em, bearerToken };
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;

const logbookIdSchema = z.object({ logbookId: z.string() });

/**
 * Procedure for any operation that targets a specific logbook. Requires the
 * caller to present a bearer token whose hashed secret matches one of that
 * logbook's tokens. Returns NOT_FOUND on any failure mode (missing token,
 * invalid token, token for a different logbook) so the API never reveals
 * whether a particular logbook id exists.
 */
export const logbookProcedure = publicProcedure
  .input(logbookIdSchema)
  .use(async ({ ctx, input, next }) => {
    if (!ctx.bearerToken) throw new TRPCError({ code: "NOT_FOUND", message: "Logbook not found" });
    const logbook = await resolveLogbookForToken(ctx.em, ctx.bearerToken);
    if (!logbook || logbook.id !== input.logbookId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Logbook not found" });
    }
    return next({ ctx: { ...ctx, logbook } });
  });

/**
 * Like `logbookProcedure`, but only requires that the caller hold *some* valid
 * token (not necessarily for a particular logbook). Used by import, which
 * doesn't address an existing logbook but still wants to know who's calling.
 * Currently identical to `publicProcedure` — kept as a distinct export so the
 * intent of each procedure is readable at the call site and so a future
 * tightening (e.g. rate limiting per anonymous caller) has somewhere to live.
 */
export const publicAuthoringProcedure = publicProcedure;

/**
 * Resolve the logbook for the current request without binding to a particular
 * `logbookId` input — used by `logbook.listByTokens` (which takes its own
 * token array and doesn't use the Authorization header at all).
 */
export type LogbookContext = Context & { logbook: Logbook };
