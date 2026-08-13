/**
 * "Clear formatting" (spec/3-frontend.md → "Text Editor"), as a command so the
 * document surgery lives here rather than in the toolbar that happens to offer
 * the button. Dispatch `CLEAR_FORMATTING_COMMAND` from anywhere the editor is
 * in context; the plugin has to be mounted on that editor (the footnote body is
 * its own nested one) or the command has no handler and nothing happens.
 *
 * What it clears: every inline format, inline style, and link across exactly the
 * highlighted range, plus the block formatting of each block the range covers
 * *whole* — clearing a phrase inside a quote shouldn't un-quote the rest of it.
 */
import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent } from "@lexical/utils";
import { $toggleLink } from "@lexical/link";
import { $isListItemNode, $isListNode, type ListItemNode } from "@lexical/list";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type ElementNode,
  type LexicalCommand,
  type LexicalNode,
  type PointType,
} from "lexical";

export const CLEAR_FORMATTING_COMMAND: LexicalCommand<void> = createCommand(
  "CLEAR_FORMATTING_COMMAND",
);

export function ClearFormattingPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(CLEAR_FORMATTING_COMMAND, $clearFormatting, COMMAND_PRIORITY_EDITOR),
    [editor],
  );

  return null;
}

/** Strip every formatting the selection carries, in one undoable step. (The
 *  original asked `selection.hasFormat(...)` and toggled back what came out
 *  true, which only fires when the WHOLE range carries a format — so a sentence
 *  with a bold word and a code span in it cleared nothing at all.) */
function $clearFormatting(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return true;

  // `extract()` splits the text nodes at both ends, narrowing them to exactly
  // what's highlighted, so a half-selected bold word keeps its bold on the half
  // that isn't.
  const nodes = selection.extract();
  const blocks = new Map<string, ElementNode>();
  for (const node of nodes) {
    if ($isTextNode(node)) {
      node.setFormat(0);
      node.setStyle("");
    }
    const block = $blockOf(node);
    if (block !== null) blocks.set(block.getKey(), block);
  }

  // Links are inline formatting too. Lexical splits a partly-selected one, so
  // only the highlighted part is unlinked (as the spec asks).
  $toggleLink(null);

  // Only a block holding an edge of the selection can fall short of being
  // covered whole. Take those edges from the selection's direction, NOT from
  // `getStartEndPoints()` — despite the name it hands back [anchor, focus]
  // however the selection was made, so a backwards one (dragged bottom to top)
  // tested each end against the opposite edge. Both outer blocks then failed
  // and only the ones in the middle were ever converted.
  const backward = selection.isBackward();
  const start = backward ? selection.focus : selection.anchor;
  const end = backward ? selection.anchor : selection.focus;
  const startBlock = $blockOf(start.getNode());
  const endBlock = $blockOf(end.getNode());
  const covered: ElementNode[] = [];
  for (const block of blocks.values()) {
    if (block.is(startBlock) && !$isAtBlockStart(start, block)) continue;
    if (block.is(endBlock) && !$isAtBlockEnd(end, block)) continue;
    covered.push(block);
  }

  // Collect first, strip after — unwinding a list restructures it around the
  // blocks still to be handled.
  for (const block of covered) {
    if ($isListItemNode(block)) {
      // The item that only wraps a sub-list carries no content of its own; its
      // items are covered on their own account.
      if (!$isListNode(block.getFirstChild())) $unlistItem(block);
    } else if (!$isParagraphNode(block)) {
      block.replace($createParagraphNode(), true);
    }
  }
  return true;
}

/** The block clearing strips a node back to: the list item for list content (a
 *  list is unwound item by item, see `$unlistItem`), otherwise the top-level
 *  block — paragraph, heading, quote, code. */
function $blockOf(node: LexicalNode): ElementNode | null {
  const item = $findMatchingParent(node, $isListItemNode);
  if ($isListItemNode(item)) return item;
  const top = node.getTopLevelElement();
  return $isElementNode(top) ? top : null;
}

/** Lift one list item out of its list as a paragraph, splitting the list around
 *  it. REMOVE_LIST_COMMAND can't do this job: `removeList` unwinds the whole
 *  list whatever the selection covers, so clearing two items of five turned all
 *  five into paragraphs. Outdenting first flattens a nested item, so it splits
 *  the top-level list rather than landing inside a sub-list. */
function $unlistItem(item: ListItemNode): void {
  item.setIndent(0);
  const paragraph = $createParagraphNode();
  paragraph.append(...item.getChildren());
  // ListItemNode.insertAfter is what does the splitting: a non-item node goes
  // after the list, with the items that followed moved into a copy of it.
  item.insertAfter(paragraph);
  item.remove();
}

/** Whether `point` sits at the very start of `block` — nothing of the block's
 *  own content is left in front of it. */
function $isAtBlockStart(point: PointType, block: ElementNode): boolean {
  if (point.offset !== 0) return false;
  for (let node: LexicalNode | null = point.getNode(); node && !node.is(block);) {
    if (node.getPreviousSibling() !== null) return false;
    node = node.getParent();
  }
  return true;
}

/** The mirror of `$isAtBlockStart`: nothing of the block trails the point. */
function $isAtBlockEnd(point: PointType, block: ElementNode): boolean {
  const at = point.getNode();
  const end = $isElementNode(at) ? at.getChildrenSize() : at.getTextContentSize();
  if (point.offset !== end) return false;
  for (let node: LexicalNode | null = at; node && !node.is(block);) {
    if (node.getNextSibling() !== null) return false;
    node = node.getParent();
  }
  return true;
}
