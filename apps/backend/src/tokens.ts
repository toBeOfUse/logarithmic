/**
 * Bearer-token access control for logbooks.
 *
 * A token is `${rowId}.${secret}` where `rowId` is a LogbookToken primary key
 * and `secret` is 32 random bytes (base64url). The row stores `bcrypt(secret)`,
 * so a database leak does not produce live credentials. Validation looks up
 * the row by id and then runs `bcrypt.compare` against the supplied secret
 * — the rowId is a fast index lookup; bcrypt is the cryptographic gate.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { EntityManager } from "@mikro-orm/sqlite";

import { Logbook } from "./entities/Logbook.ts";
import { LogbookToken } from "./entities/LogbookToken.ts";

const BCRYPT_COST = 10;
const SECRET_BYTES = 32;

/** Generate a fresh token and persist its hash, returning the plaintext token
 *  the caller must hand to the user. The plaintext is never stored anywhere. */
export async function issueTokenForLogbook(em: EntityManager, logbook: Logbook): Promise<string> {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const hash = await bcrypt.hash(secret, BCRYPT_COST);
  const row = em.create(LogbookToken, { logbook, hash });
  em.persist(row);
  await em.flush();
  return `${row.id}.${secret}`;
}

type ParsedToken = { rowId: string; secret: string };

function parseToken(token: string): ParsedToken | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  return { rowId: token.slice(0, dot), secret: token.slice(dot + 1) };
}

/**
 * Resolve the logbook a bearer token grants access to, or null if the token is
 * malformed, references a missing row, or fails secret comparison.
 */
export async function resolveLogbookForToken(
  em: EntityManager,
  token: string,
): Promise<Logbook | null> {
  const parsed = parseToken(token);
  if (!parsed) return null;
  const row = await em.findOne(LogbookToken, { id: parsed.rowId }, { populate: ["logbook"] });
  if (!row) return null;
  const ok = await bcrypt.compare(parsed.secret, row.hash);
  if (!ok) return null;
  return row.logbook;
}

/**
 * Batch variant for the splash-screen "list my logbooks" endpoint: resolves an
 * array of tokens to the set of logbooks they grant access to. Invalid tokens
 * are silently skipped (they may have been revoked or come from a different
 * deployment), so the caller never has to filter the result.
 */
export async function resolveLogbooksForTokens(
  em: EntityManager,
  tokens: string[],
): Promise<Logbook[]> {
  const parsed = tokens.map((t) => parseToken(t)).filter((p): p is ParsedToken => p !== null);
  if (parsed.length === 0) return [];
  const rows = await em.find(
    LogbookToken,
    { id: { $in: parsed.map((p) => p.rowId) } },
    { populate: ["logbook"] },
  );
  const rowById = new Map(rows.map((r) => [r.id, r] as const));
  // Run the bcrypt comparisons in parallel — each is ~tens of ms on cost 10
  // and they are completely independent.
  const checks = await Promise.all(
    parsed.map(async (p) => {
      const row = rowById.get(p.rowId);
      if (!row) return null;
      const ok = await bcrypt.compare(p.secret, row.hash);
      return ok ? row.logbook : null;
    }),
  );
  // De-duplicate by logbook id in case the caller sent multiple tokens for the
  // same logbook (the splash page is supposed to dedupe, but defend anyway).
  const out = new Map<string, Logbook>();
  for (const lb of checks) {
    if (lb) out.set(lb.id, lb);
  }
  return [...out.values()];
}

/** Pull the bearer token out of a standard `Authorization: Bearer <token>`
 *  header. Tolerates extra whitespace and case-insensitive scheme. */
export function readBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(authHeader);
  return m ? (m[1] ?? null) : null;
}
