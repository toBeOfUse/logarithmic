/**
 * Markdown conversion for "Copy as Markdown" (spec/3-frontend.md). Imported
 * lazily so `@lexical/markdown` and this logic stay out of the main bundle.
 *
 * Footnotes are emitted the Markdown-typical way: an inline `[^n]` reference in
 * the body, with the matching `[^n]: …` definitions appended after it. The body
 * of each footnote (its own nested editor) is converted with the standard
 * transformers and flattened to a single line.
 */
import {
  $convertToMarkdownString,
  TRANSFORMERS,
  type ElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import type { LexicalEditor } from "lexical";

import { $collectFootnotes, $isFootnoteNode } from "logarithmic-content/nodes/footnote-node";
import { $isAnyImageNode } from "logarithmic-content/nodes/image-node";

import { FootnoteNode } from "./nodes/FootnoteNode.tsx";
import { absoluteImageSrc, DataUriImageNode, ImageNode } from "./nodes/ImageNode.tsx";

/** Exports a footnote reference as `[^n]` using the precomputed ordinal map. */
function footnoteTransformer(order: Map<string, number>): TextMatchTransformer {
  return {
    dependencies: [FootnoteNode],
    export: (node) => {
      if (!$isFootnoteNode(node)) return null;
      const n = order.get(node.getKey());
      return n ? `[^${n}]` : null;
    },
    // Import of footnotes isn't supported (copy-out only), so never match.
    regExp: /$^/,
    type: "text-match",
  };
}

/** Exports an image block as a standard Markdown image `![alt](absolute-url)`.
 *  Export-only (copy-out); the never-matching regExp skips import. The URL is
 *  built by the same helper `exportDOM` uses, so copy-as-HTML and
 *  copy-as-Markdown can't drift. A placeholder (pending/failed) has no real URL,
 *  so it's skipped — the same as its `exportDOM`. */
const imageTransformer: ElementTransformer = {
  dependencies: [ImageNode, DataUriImageNode],
  export: (node) => {
    if (!$isAnyImageNode(node)) return null;
    if (node instanceof ImageNode && node.isPlaceholder()) return null;
    return `![${node.getAltText()}](${absoluteImageSrc(node)})`;
  },
  // import is skipped just because importing Markdown just isn't a thing in
  // this app currently, so it isn't worth implementing this
  regExp: /$^/,
  replace: () => {},
  type: "element",
};

/** Convert the editor's document to a Markdown string, footnotes and all. */
export function contentToMarkdown(editor: LexicalEditor): string {
  const notes = editor.getEditorState().read(() => $collectFootnotes());
  const order = new Map(notes.map((n, i) => [n.getKey(), i + 1] as const));
  const transformers: Transformer[] = [
    footnoteTransformer(order),
    imageTransformer,
    ...TRANSFORMERS,
  ];

  // Trimmed because the document always ends in a blank paragraph (see
  // TrailingParagraphPlugin), which would otherwise export as a trailing blank
  // line — and push the footnote definitions an extra line down.
  let md = editor
    .getEditorState()
    .read(() => $convertToMarkdownString(transformers))
    .trimEnd();

  if (notes.length > 0) {
    const defs = notes
      .map((n, i) => {
        const body = n
          .getFootnoteEditor()
          .getEditorState()
          .read(() => $convertToMarkdownString(TRANSFORMERS));
        return `[^${i + 1}]: ${body.replace(/\s*\n\s*/g, " ").trim()}`;
      })
      .join("\n");
    md = `${md}\n\n${defs}`;
  }

  return md;
}
