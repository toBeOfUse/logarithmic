/**
 * Anonymous-user cookie auth.
 *
 * Per spec/2-backend.md, an anonymous account is created for a user the first
 * time they create a logbook. The session is purely cookie-driven: the cookie
 * carries the user ID alongside an HMAC signature so it can't be forged. The
 * eventual Better Auth integration will overlay email/password login on top
 * of the same User row by flipping `isAnonymous` and setting an email.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import type { EntityManager } from "@mikro-orm/sqlite";
import { User } from "./entities/User.ts";

const COOKIE_NAME = "lg-uid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function getSecret(): string {
  // Fixed dev fallback keeps cookies stable across restarts during local work.
  // Production deploys must set SESSION_SECRET to a high-entropy value.
  return process.env.SESSION_SECRET ?? "dev-only-not-secret";
}

function sign(userId: string): string {
  return createHmac("sha256", getSecret()).update(userId).digest("base64url");
}

function verify(userId: string, sig: string): boolean {
  const expected = Buffer.from(sign(userId));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function readUserIdFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = parseCookie(cookieHeader);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  const sep = raw.lastIndexOf(".");
  if (sep === -1) return null;
  const userId = raw.slice(0, sep);
  const sig = raw.slice(sep + 1);
  if (!verify(userId, sig)) return null;
  return userId;
}

export function buildSessionCookie(userId: string): string {
  return serializeCookie(COOKIE_NAME, `${userId}.${sign(userId)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

/**
 * Resolve the authenticated user for a request. Returns null when the cookie
 * is absent or points at a user that no longer exists (e.g. after a dev DB
 * wipe) — callers that need a user must mint one via `ensureAnonymousUser`.
 */
export async function loadUserFromCookie(
  em: EntityManager,
  cookieHeader: string | undefined,
): Promise<User | null> {
  const id = readUserIdFromCookie(cookieHeader);
  if (!id) return null;
  return em.findOne(User, { id });
}

/**
 * Create an anonymous user. The caller is responsible for sending the
 * resulting cookie back to the client via the response.
 */
export async function createAnonymousUser(em: EntityManager): Promise<User> {
  const user = em.create(User, { isAnonymous: true });
  em.persist(user);
  await em.flush();
  return user;
}
