/**
 * Best-effort optimistic cache of the splash screen's "your logbooks" list,
 * persisted in localStorage. The authoritative source is always
 * `logbook.listByTokens` (see `useLogbooks` in `./hooks.ts`); this cache exists
 * only so a cold load can paint the list instantly instead of flashing an
 * empty splash while the network round-trip is in flight. The server response
 * overwrites it on every successful fetch.
 *
 * Only the real (token-backed) list is cached — demo logbooks come from the
 * in-memory store and are cheap to rebuild.
 *
 * `LogbookSummary.updatedAt` is a `Date`, which `JSON.stringify` flattens to an
 * ISO string; `read` revives it so callers get the same shape the network
 * returns.
 */
import type { LogbookSummary } from "logarithmic-backend/api-types";

const STORAGE_KEY = "logarithmic.logbooks";

type StoredSummary = Omit<LogbookSummary, "updatedAt"> & { updatedAt: string };

function isStoredSummary(value: unknown): value is StoredSummary {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.slug === "string" &&
    typeof v.name === "string" &&
    typeof v.updatedAt === "string" &&
    typeof v.entryCount === "number"
  );
}

export function readCachedLogbooks(): LogbookSummary[] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const out: LogbookSummary[] = [];
    for (const item of parsed) {
      if (!isStoredSummary(item)) return undefined;
      const updatedAt = new Date(item.updatedAt);
      if (Number.isNaN(updatedAt.getTime())) return undefined;
      out.push({ ...item, updatedAt });
    }
    return out;
  } catch {
    return undefined;
  }
}

export function saveCachedLogbooks(logbooks: LogbookSummary[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logbooks));
  } catch {
    // Quota exceeded or storage unavailable — silently drop. The list will
    // still load from the network; we just lose the optimistic paint.
  }
}
