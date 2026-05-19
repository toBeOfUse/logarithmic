/**
 * Frontend routes embed logbook and entry IDs as `${slug}-${id}` segments so
 * URLs are vaguely readable. The slug is decorative; only the trailing ID is
 * load-bearing. Backend route params accept the raw ID — slug stripping is a
 * frontend concern.
 */
import { ID_LEN } from "logarithmic-config/ids";

/** Build a route segment from a slug + id. Falls back to bare id when slug is empty. */
export function routeSegment(slug: string, id: string): string {
  return slug ? `${slug}-${id}` : id;
}

/** Extract the ID portion from a `${slug}-${id}` route segment. */
export function parseRouteSegment(segment: string): string {
  if (segment.length <= ID_LEN) return segment;
  return segment.slice(-ID_LEN);
}
