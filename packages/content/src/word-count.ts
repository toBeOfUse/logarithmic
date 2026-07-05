/**
 * Word counting over a stored content document. Part of the shared data layer:
 * the backend derives word counts from an entry's content without touching the
 * editor's React layer, and the frontend reuses the exact same function so its
 * optimistic counts match what the server persists.
 *
 * A stored document is parsed with a headless editor into real nodes, so
 * counting reuses Lexical's own `getTextContent` — including footnote bodies,
 * whose `FootnoteNode.getTextContent` folds their text into the walk.
 */
import { $getRoot } from "lexical";

import { createContentEditor } from "./schema.ts";

// One headless editor, reused across calls. `parseEditorState` returns a fresh
// state without mutating the editor, so a singleton is safe and avoids
// re-registering the whole schema on every count (e.g. once per entity save).
const editor = createContentEditor();

/**
 * Count the words in a stored content document (its serialized JSON string).
 * Returns 0 for anything empty or unparseable, so it's safe to call from entity
 * persist hooks.
 */
export function countWords(json: string | null | undefined): number {
  if (!json) return 0;
  let text = "";
  try {
    text = editor.parseEditorState(json).read(() => $getRoot().getTextContent());
  } catch {
    return 0;
  }
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}
