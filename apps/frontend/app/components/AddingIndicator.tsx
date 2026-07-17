/**
 * The "Adding…" spinner shown as a card's meta line while its creation is in
 * flight. Shared so the OrgView LoadingCard (a new entry) and the splash
 * CreateLogbookCell (a new logbook) read identically.
 */
export function AddingIndicator() {
  return (
    <span className="inline-flex items-center gap-1">
      <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
      Adding…
    </span>
  );
}
