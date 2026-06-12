import { useEffect } from "react";

const DEFAULT_TITLE = "Logarithmic";

/**
 * Sets `document.title` for the lifetime of the calling route. Titles are
 * data-driven (logbook/entry names arrive via client-side queries), so a route
 * `meta` export can't produce them — we set the title imperatively instead.
 *
 * Pass the full title to use. Pass `null` (e.g. while loading) to fall back to
 * the bare app name.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ?? DEFAULT_TITLE;
  }, [title]);
}
