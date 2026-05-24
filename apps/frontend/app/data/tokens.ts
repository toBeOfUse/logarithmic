/**
 * Per-logbook access-token store, persisted in localStorage. The token model
 * is the entire authentication system: every API call that touches a logbook
 * sends `Authorization: Bearer <token>`, and the splash-screen "your
 * logbooks" list is just `listByTokens(getAllTokens())`. There are no users,
 * sessions, or cookies.
 *
 * On first arrival via a bookmarkable share link of the shape
 *   /<logbook-segment>#token=<token>
 * the token is harvested from `location.hash`, saved here, and the fragment
 * is scrubbed from the URL so the credential doesn't linger in browser
 * history. See `extractTokenFromHash` (called once from `root.tsx`).
 */
const STORAGE_KEY = "logarithmic.tokens";

type TokenMap = Record<string, string>;

function read(): TokenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: TokenMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function write(map: TokenMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded or storage unavailable — silently drop. The user can
    // re-add tokens from their bookmarked links.
  }
}

export function getToken(logbookId: string): string | null {
  return read()[logbookId] ?? null;
}

export function getAllTokens(): string[] {
  return Object.values(read());
}

export function saveToken(logbookId: string, token: string) {
  const map = read();
  map[logbookId] = token;
  write(map);
}

/**
 * Build the shareable bookmarkable URL for a logbook + token. The token rides
 * in the URL fragment so it is never sent to the server or logged by proxies.
 */
export function buildBookmarkUrl(logbookSegment: string, token: string): string {
  const base = `${window.location.origin}/${logbookSegment}`;
  return `${base}#token=${encodeURIComponent(token)}`;
}

/**
 * If the current URL carries a `#token=<token>` fragment, return the token
 * after stripping it from the URL bar (via `history.replaceState`, so we
 * don't trigger a navigation). The caller is expected to map this token to a
 * logbook id and persist it via `saveToken`.
 */
export function extractTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash) return null;
  const m = /^#token=([^&]+)/.exec(hash);
  if (!m) return null;
  const token = decodeURIComponent(m[1]!);
  const cleanUrl = window.location.pathname + window.location.search;
  window.history.replaceState(null, "", cleanUrl);
  return token;
}

/**
 * Inspect the current URL once at app boot: if the path is `/<segment>` and
 * the fragment carries `#token=<token>`, harvest the token, save it against
 * the logbook id parsed out of the segment, and scrub the fragment. Returns
 * the logbook id if a token was captured (so the UI can surface confirmation).
 *
 * Idempotent — repeated calls are no-ops once the fragment is gone.
 */
export function bootstrapTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0]!;
  const dash = first.indexOf("-");
  const logbookId = dash === -1 ? first : first.slice(0, dash);
  if (!logbookId) return null;
  const token = extractTokenFromHash();
  if (!token) return null;
  saveToken(logbookId, token);
  return logbookId;
}
