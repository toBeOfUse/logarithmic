/**
 * Blockquote editing behaviour (spec/3-frontend.md → "Text Editor").
 *
 * Lexical models a quote as a *single-paragraph* block — a `QuoteNode` holds
 * inline content, never paragraphs — so out of the box Enter drops the caret
 * back into a plain paragraph, and pressing it mid-quote drags everything after
 * the caret out of the quote with it.
 *
 * A quote is treated here as a *run* of consecutive `QuoteNode`s instead, drawn
 * as one continuous quote by `editor.module.css`. Enter therefore splits a
 * quote into another quote (the run grows, like paragraphs inside a block quote
 * in a ProseMirror/TipTap/Substack/Tumblr-style editor), and only Enter on an
 * *empty* quote leaves it — the same double-Enter escape that ends a list.
 */
import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent } from "@lexical/utils";
import { $createQuoteNode, $isQuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  INSERT_PARAGRAPH_COMMAND,
} from "lexical";

export function MultiParagraphBlockQuotePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      // Runs ahead of the rich-text default (COMMAND_PRIORITY_EDITOR), which is
      // what would otherwise hand the rest of the quote to a paragraph.
      editor.registerCommand(
        INSERT_PARAGRAPH_COMMAND,
        () => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          const quote = $findMatchingParent(selection.anchor.getNode(), $isQuoteNode);
          if (!$isQuoteNode(quote)) return false;

          // An empty quote is the way out: Enter on it un-quotes that block
          // rather than extending the run. (Children move across too, so a quote
          // holding only a non-text node isn't dropped on the floor.)
          if (quote.getTextContentSize() === 0) {
            const paragraph = $createParagraphNode();
            quote.replace(paragraph, true);
            paragraph.selectStart();
            return true;
          }

          // Split the block as usual — the content after the caret moves into
          // the new one — then make that new block a quote so the run continues.
          // `replace` carries the children and the caret over with it.
          const created = selection.insertParagraph();
          if ($isElementNode(created)) created.replace($createQuoteNode(), true);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );

  return null;
}
