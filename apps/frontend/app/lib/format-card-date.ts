/**
 * The card "date updated" format, e.g. "Dec 12th, 2026". Shared by the org-view
 * entry cards and the splash-page logbook cards so both read the same way.
 */
export function formatCardDate(d: Date): string {
  const month = d.toLocaleDateString(undefined, { month: "short" });
  return `${month} ${ordinal(d.getDate())}, ${d.getFullYear()}`;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
