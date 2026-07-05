/**
 * Markdown ⇄ content-document conversion. Part of the data layer's
 * serialization tools; uses Lexical's standard Markdown transformers so
 * headings, lists, quotes, inline emphasis, links, and code round-trip, while
 * anything unrecognized falls back to paragraph text.
 *
 * `markdownToContent` backs the best-effort migration of legacy Markdown bodies
 * to the JSON the editor now stores.
 */
import { $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { $getRoot } from "lexical";

import { createContentEditor } from "./schema.ts";

/** Convert a Markdown string to a serialized content document (JSON string). */
export function markdownToContent(markdown: string): string {
  const editor = createContentEditor();
  editor.update(
    () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, TRANSFORMERS);
    },
    { discrete: true },
  );
  return JSON.stringify(editor.getEditorState().toJSON());
}
