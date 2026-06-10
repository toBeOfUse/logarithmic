/**
 * Word counting for entry content. This is the single source of truth for how
 * a Markdown body's word count is derived — the backend computes it at persist
 * time (see `Entry.wordCount`) and the frontend demo store / optimistic updates
 * import the same function so a demo logbook counts identically to a real one.
 *
 * The body is Markdown, so we strip the handful of inline syntax characters
 * that would otherwise glue onto adjacent words (e.g. `**bold**`, `# heading`,
 * `- item`) before splitting on whitespace. It's a heuristic, not a parser, but
 * it's stable and good enough for a "1,204 words" readout.
 */
export function countWords(content: string | null | undefined): number {
  if (!content) return 0;
  return content
    .replace(/[`*_>#-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}
