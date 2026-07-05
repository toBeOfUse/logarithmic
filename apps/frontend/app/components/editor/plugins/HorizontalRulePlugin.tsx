/**
 * Horizontal rule insertion, using the pure (React-free) `HorizontalRuleNode`
 * from `@lexical/extension` — the non-deprecated replacement for
 * `@lexical/react`'s `HorizontalRulePlugin`. Two ways in:
 *
 *  - INSERT_HORIZONTAL_RULE_COMMAND (the slash menu). When the caret is on an
 *    empty paragraph — e.g. the line left after the "/" query — that block is
 *    replaced by the rule rather than left behind as a blank line.
 *  - Enter on a line that's just "---" / "***" / "___". The Markdown shortcut
 *    only fires on space, so Enter is handled explicitly here.
 *
 * Both paths leave the caret on a fresh paragraph after the rule.
 */
import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHorizontalRuleNode, INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/extension";
import { $insertNodeToNearestRoot, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type LexicalNode,
} from "lexical";

// A line that is only dashes / asterisks / underscores (three or more).
const HR_LINE = /^(-{3,}|\*{3,}|_{3,})$/;

/** Ensure a paragraph follows the rule and drop the caret into it. */
function $caretAfter(hr: LexicalNode): void {
  const next = hr.getNextSibling();
  if ($isParagraphNode(next)) {
    next.select();
    return;
  }
  const para = $createParagraphNode();
  hr.insertAfter(para);
  para.select();
}

export function HorizontalRulePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        INSERT_HORIZONTAL_RULE_COMMAND,
        () => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          const block = selection.anchor.getNode().getTopLevelElement();
          const hr = $createHorizontalRuleNode();
          if ($isParagraphNode(block) && block.getTextContent() === "") {
            block.replace(hr);
          } else {
            $insertNodeToNearestRoot(hr);
          }
          $caretAfter(hr);
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          const block = selection.anchor.getNode().getTopLevelElement();
          if (!$isParagraphNode(block) || !HR_LINE.test(block.getTextContent())) return false;
          event?.preventDefault();
          const hr = $createHorizontalRuleNode();
          block.replace(hr);
          $caretAfter(hr);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor]);
  return null;
}
