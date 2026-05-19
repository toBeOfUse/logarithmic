/**
 * Frontend routes embed logbook and entry IDs as `${id}-${slug}` segments so
 * URLs are vaguely readable. The slug is decorative; only the leading ID is
 * load-bearing.
 *
 * Logbook IDs are alphanumeric strings (A–Za–z0–9) and entry IDs are positive
 * integers. Neither contains a hyphen, so the first `-` in a segment is
 * unambiguously the slug delimiter.
 */

/** Build a route segment from a slug + id. Falls back to the bare id when slug is empty. */
export function routeSegment(slug: string, id: string | number): string {
  return slug ? `${id}-${slug}` : String(id);
}

/**
 * Extract the ID portion from a `${id}-${slug}` route segment. Returns the
 * portion before the first hyphen, or the whole segment if there is no
 * hyphen. Callers that expect a numeric entry id should coerce with
 * `Number(...)` themselves.
 */
export function parseRouteSegment(segment: string): string {
  const dash = segment.indexOf("-");
  return dash === -1 ? segment : segment.slice(0, dash);
}

/** Parse an entry-id route segment to a number. Returns null if the segment
 *  does not start with a valid positive integer. */
export function parseEntryId(segment: string): number | null {
  const head = parseRouteSegment(segment);
  if (!/^[0-9]+$/.test(head)) return null;
  const n = Number(head);
  return Number.isFinite(n) && n > 0 ? n : null;
}
