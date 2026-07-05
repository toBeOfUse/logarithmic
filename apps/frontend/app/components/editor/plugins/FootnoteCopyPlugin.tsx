/**
 * Turns footnotes into endnotes when a passage is copied out of the editor.
 *
 * By default a copied `FootnoteNode` serializes to just its inline superscript
 * (see `FootnoteNode.exportDOM`) — the number is preserved but the note's body
 * is lost, since the body lives in a separate nested editor that the fragment
 * serializer never reaches. This plugin takes over `COPY_COMMAND` and, whenever
 * the selection contains footnotes, appends the bodies of those footnotes to the
 * end of the copied payload: an `<ol>` for `text/html` and a plain list for
 * `text/plain`. Both are numbered with the footnote's original document position
 * so they line up with the superscripts in the copied text.
 *
 * The internal `application/x-lexical-editor` payload is preserved verbatim, so
 * pasting back into the editor still round-trips footnotes losslessly — only the
 * outward-facing HTML/text is rewritten.
 */
import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $generateHtmlFromNodes } from "@lexical/html";
import { $getLexicalContent } from "@lexical/clipboard";
import {
  $getCharacterOffsets,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  type NodeKey,
  type RangeSelection,
} from "lexical";
import {
  $collectFootnotes,
  $isFootnoteNode,
  type FootnoteNode,
} from "logarithmic-content/nodes/footnote-node";

/** A footnote captured by a copy, paired with its 1-based document position. */
type CopiedFootnote = { node: FootnoteNode; ordinal: number };

export function FootnoteCopyPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      COPY_COMMAND,
      (event) => {
        // Only a real clipboard event gives us a writable payload to rewrite;
        // anything else falls through to Lexical's default copy.
        if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
        const clipboardData = event.clipboardData;

        let html: string | null = null;
        let text = "";
        let lexical: string | null = null;
        // `$generateHtmlFromNodes` needs an *active editor*, which a bare
        // `getEditorState().read(cb)` doesn't set (it only sets the active
        // editor state). The `{ editor }` option supplies it. We can't use
        // `editor.read(...)` here: this listener fires inside an active update
        // cycle, and `editor.read` would try to commit pending updates while
        // one is already in progress.
        editor.getEditorState().read(
          () => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || selection.isCollapsed()) return;

            const selectedKeys = new Set(
              selection
                .getNodes()
                .filter($isFootnoteNode)
                .map((node) => node.getKey()),
            );
            // No footnotes in the selection — let the default copy handle it.
            if (selectedKeys.size === 0) return;

            // Walk footnotes in document order so ordinals match the on-screen
            // numbering, keeping only those inside the selection.
            const notes: CopiedFootnote[] = $collectFootnotes()
              .map((node, i) => ({ node, ordinal: i + 1 }))
              .filter(({ node }) => selectedKeys.has(node.getKey()));
            const ordinalByKey = new Map(
              notes.map(({ node, ordinal }) => [node.getKey(), ordinal]),
            );

            html = $generateHtmlFromNodes(editor, selection) + endnotesHtml(notes);
            text = $selectionTextWithMarkers(selection, ordinalByKey) + endnotesText(notes);
            lexical = $getLexicalContent(editor);
          },
          { editor },
        );

        // `html` stays null when there's nothing to augment (collapsed selection
        // or no footnotes); defer to the built-in copy in that case.
        if (html === null) return false;

        event.preventDefault();
        clipboardData.setData("text/html", html);
        clipboardData.setData("text/plain", text);
        if (lexical) clipboardData.setData("application/x-lexical-editor", lexical);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

/**
 * The selection's plain text, but with each footnote rendered inline as its
 * endnote marker `[n]` rather than its body.
 *
 * `RangeSelection.getTextContent()` appends a decorator node's own
 * `getTextContent()` verbatim, and a `FootnoteNode`'s is its *body* (so word
 * counts include footnotes) — which would drop the whole note where the
 * reference number belongs. This mirrors that walk (offset slicing on the
 * first/last text node, block newlines) but swaps footnotes for their marker,
 * matching the `<sup>` numbers in the HTML and the `[n]` endnotes below.
 */
function $selectionTextWithMarkers(
  selection: RangeSelection,
  ordinalByKey: Map<NodeKey, number>,
): string {
  const nodes = selection.getNodes();
  if (nodes.length === 0) return "";
  const firstNode = nodes[0];
  const lastNode = nodes[nodes.length - 1];
  const { anchor, focus } = selection;
  const isBefore = anchor.isBefore(focus);
  const [anchorOffset, focusOffset] = $getCharacterOffsets(selection);

  let text = "";
  let prevWasElement = true;
  for (const node of nodes) {
    if ($isElementNode(node) && !node.isInline()) {
      if (!prevWasElement) text += "\n";
      prevWasElement = !node.isEmpty();
      continue;
    }
    prevWasElement = false;
    if ($isTextNode(node)) {
      let slice = node.getTextContent();
      if (node === firstNode) {
        if (node === lastNode) {
          if (
            anchor.type !== "element" ||
            focus.type !== "element" ||
            focus.offset === anchor.offset
          ) {
            slice =
              anchorOffset < focusOffset
                ? slice.slice(anchorOffset, focusOffset)
                : slice.slice(focusOffset, anchorOffset);
          }
        } else {
          slice = isBefore ? slice.slice(anchorOffset) : slice.slice(focusOffset);
        }
      } else if (node === lastNode) {
        slice = isBefore ? slice.slice(0, focusOffset) : slice.slice(0, anchorOffset);
      }
      text += slice;
    } else if (node === lastNode && selection.isCollapsed()) {
      // A trailing collapsed decorator/line break contributes nothing (matches
      // Lexical); skip it whether it's a footnote or otherwise.
      continue;
    } else if ($isFootnoteNode(node)) {
      text += `[${ordinalByKey.get(node.getKey()) ?? "?"}]`;
    } else if ($isDecoratorNode(node) || $isLineBreakNode(node)) {
      text += node.getTextContent();
    }
  }
  return text;
}

/** The endnotes block for copied HTML: a rule then an ordered list whose visible
 *  numbers are pinned (via `value`) to each footnote's original position. */
function endnotesHtml(notes: CopiedFootnote[]): string {
  if (notes.length === 0) return "";
  const items = notes
    .map(({ node, ordinal }) => {
      const editor = node.getFootnoteEditor();
      // `editor.read` sets the active editor that `$generateHtmlFromNodes`
      // requires; this nested editor is idle, so committing is a no-op.
      const body = editor.read(() => $generateHtmlFromNodes(editor));
      return `<li value="${ordinal}">${body}</li>`;
    })
    .join("");
  return `<hr /><ol>${items}</ol>`;
}

/** The plain-text mirror of {@link endnotesHtml}: `[n] body` lines after a gap. */
function endnotesText(notes: CopiedFootnote[]): string {
  if (notes.length === 0) return "";
  const lines = notes.map(({ node, ordinal }) => `[${ordinal}] ${node.getTextContent().trim()}`);
  return `\n\n${lines.join("\n")}`;
}
