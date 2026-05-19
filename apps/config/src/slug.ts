/**
 * Decorative URL-safe slug derived from a name. Slugs are not unique and are
 * only used to prettify route params on the frontend (paired with the
 * authoritative ID). Output is restricted to `[a-z0-9-]` and capped in length
 * so that, combined with the ID, the resulting URL segment stays reasonable.
 */

/** Maximum length, in characters, of a generated slug. */
export const MAX_SLUG_LEN = 32;

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      // Strip combining marks (accents) and anything outside the URL-safe
      // alphabet — both collapse to a single hyphen separator.
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SLUG_LEN)
      .replace(/-+$/g, "")
  );
}
