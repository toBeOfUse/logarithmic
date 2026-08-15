/**
 * Keeps a blank paragraph at the end of the document, so there's always a line
 * to click into below the last block — you can never end up with, say, an image
 * or a code block as the final node and nowhere to type after it.
 *
 * A root transform runs inside whatever update dirtied the document, so the
 * blank line is restored in the same step that removed it — no second render,
 * and no extra entry in the undo history.
 */
import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $getRoot, $isParagraphNode, RootNode } from "lexical";

function $ensureTrailingParagraph(): void {
  const root = $getRoot();
  const last = root.getLastChild();
  // `isEmpty` (no children at all) rather than "no text": a paragraph holding
  // only a footnote or a line break is a line the user has put something on.
  if ($isParagraphNode(last) && last.isEmpty()) return;
  root.append($createParagraphNode());
}

export function TrailingParagraphPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Seed the line the document loaded without. Transforms only run for nodes
    // an update dirties, and setting the initial state isn't one — so a stored
    // entry needs this pass. It has to land before EditorControllerPlugin takes
    // its "last saved" baseline (hence mounting ahead of it) or every entry
    // would look dirty the moment it was opened and re-save itself; `discrete`
    // commits it synchronously so that ordering holds, and `history-merge`
    // keeps it out of the undo stack.
    editor.update($ensureTrailingParagraph, { discrete: true, tag: "history-merge" });
    return editor.registerNodeTransform(RootNode, $ensureTrailingParagraph);
  }, [editor]);

  return null;
}
