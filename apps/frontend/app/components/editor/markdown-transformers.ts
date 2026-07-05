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
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import type { LexicalEditor } from "lexical";

import { $collectFootnotes, $isFootnoteNode } from "logarithmic-content/nodes/footnote-node";

import { FootnoteNode } from "./nodes/FootnoteNode.tsx";

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

/** Convert the editor's document to a Markdown string, footnotes and all. */
export function contentToMarkdown(editor: LexicalEditor): string {
  const notes = editor.getEditorState().read(() => $collectFootnotes());
  const order = new Map(notes.map((n, i) => [n.getKey(), i + 1] as const));
  const transformers: Transformer[] = [footnoteTransformer(order), ...TRANSFORMERS];

  let md = editor.getEditorState().read(() => $convertToMarkdownString(transformers));

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
