/**
 * Round-trip between the Markdown stored on disk (per spec/1-core-data-model.md)
 * and the HTML that TipTap consumes and produces. Owned outside of the Editor
 * component so the translation layer can be reasoned about and tested
 * independently of the editor UI.
 *
 * Inline comments are the one custom node in the format: they appear in the
 * editor as `<span data-comment>…</span>` and serialise to the standard
 * `<!-- … -->` syntax. The `CommentMark` TipTap extension agrees with this
 * file on the data attribute via `COMMENT_DATA_ATTR`.
 */
import { Marked } from "marked";
import TurndownService from "turndown";

/** Shared with `components/CommentMark.ts` — the only contract between the
 *  serializer and the TipTap mark. */
export const COMMENT_DATA_ATTR = "data-comment";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Matches a raw HTML token that is *only* an HTML comment, with optional
// trailing whitespace (marked's block-level html token preserves the trailing
// newline).
const COMMENT_TOKEN_RE = /^<!--([\s\S]*?)-->\s*$/;

const marked = new Marked({
  renderer: {
    html({ text }) {
      const inner = COMMENT_TOKEN_RE.exec(text)?.[1];
      if (inner != null) {
        return `<span ${COMMENT_DATA_ATTR}="true">${escapeHtml(inner.trim())}</span>`;
      }
      // Treat any other raw HTML in stored markdown as literal text rather
      // than passing it through to the DOM. Without this, typing something
      // like `<script>` into the editor would round-trip through markdown
      // and be re-parsed as a real tag on load.
      return escapeHtml(text);
    },
  },
});

function buildTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  td.addRule("strikethrough", {
    filter: ["s", "strike"] as TurndownService.Filter,
    replacement: (content) => `~~${content}~~`,
  });
  td.addRule("comment", {
    filter: (node) =>
      node.nodeName === "SPAN" && (node as HTMLElement).hasAttribute(COMMENT_DATA_ATTR),
    replacement: (_content, node) => {
      const text = (node as HTMLElement).textContent ?? "";
      return `<!-- ${text.trim()} -->`;
    },
  });
  // Backslash-escape `<` in text so the stored markdown is unambiguous on its
  // own — any other CommonMark renderer will also treat it as literal text.
  // Turndown already escapes `>`; `<` is the missing half.
  const baseEscape = td.escape.bind(td);
  td.escape = (s: string) => baseEscape(s).replace(/</g, "\\<");
  return td;
}

const turndown = buildTurndown();

export function markdownToHtml(md: string): string {
  if (!md) return "";
  const out = marked.parse(md, { async: false });
  return typeof out === "string" ? out : "";
}

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
