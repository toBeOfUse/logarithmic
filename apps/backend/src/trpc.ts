/**
 * tRPC initialization. The context is built per request: it forks the
 * EntityManager (so each request gets its own identity map) and resolves the
 * authenticated user from the session cookie. `protectedProcedure` rejects
 * unauthenticated callers; `publicProcedure` is open. `createLogbook` is the
 * one mutation that's still public — it transparently creates an anonymous
 * user on demand (see spec/2-backend.md).
 */
import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { EntityManager } from "@mikro-orm/sqlite";
import superjson from "superjson";

import { buildSessionCookie, createAnonymousUser, loadUserFromCookie } from "./auth.ts";
import { getOrm } from "./db.ts";
import type { User } from "./entities/User.ts";

export type Context = {
  em: EntityManager;
  user: User | null;
  /** Set a Set-Cookie header on the outgoing response. */
  setSessionCookie: (userId: string) => void;
};

export async function createContext({ req, res }: CreateFastifyContextOptions): Promise<Context> {
  const orm = await getOrm();
  const em = orm.em.fork();
  const user = await loadUserFromCookie(em, req.headers.cookie);
  return {
    em,
    user,
    setSessionCookie: (userId) => {
      res.header("set-cookie", buildSessionCookie(userId));
    },
  };
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;

/**
 * Procedure that materializes an anonymous user before running. Used by
 * `logbook.create` so the very first request from a brand-new visitor
 * succeeds without a separate sign-up step.
 */
export const anonymousProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (ctx.user) return next({ ctx: { ...ctx, user: ctx.user } });
  const user = await createAnonymousUser(ctx.em);
  ctx.setSessionCookie(user.id);
  return next({ ctx: { ...ctx, user } });
});

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
