/**
 * Turns a highlighted run of text into a link when the user pastes a bare URL
 * over it (spec/3-frontend.md). A collapsed caret or a non-URL clipboard falls
 * through to Lexical's normal paste handling.
 */
import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $getSelection, $isRangeSelection, COMMAND_PRIORITY_LOW, PASTE_COMMAND } from "lexical";

const URL_RE = /^https?:\/\/\S+$/i;

export function AutoLinkOnPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false;
        const text = event.clipboardData?.getData("text/plain")?.trim();
        if (!text || !URL_RE.test(text)) return false;
        const overText = editor.getEditorState().read(() => {
          const selection = $getSelection();
          return (
            $isRangeSelection(selection) &&
            !selection.isCollapsed() &&
            selection.getTextContent().length > 0
          );
        });
        if (!overText) return false;
        event.preventDefault();
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, text);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);
  return null;
}
