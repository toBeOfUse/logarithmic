/**
 * The frontend's React display layer for footnotes. The data — serialization,
 * the nested body editor, word-count text — lives in the canonical headless
 * `FootnoteNode` in the `content` package. This subclass adds only what the
 * browser needs: the styled superscript element and a React `decorate()` that
 * renders the clickable reference number.
 */
import { type ReactNode, useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { DOMConversionMap, DOMExportOutput, NodeKey } from "lexical";
import {
  $collectFootnotes,
  FOOTNOTE_TYPE,
  FootnoteNode as HeadlessFootnoteNode,
  type SerializedFootnoteNode,
} from "logarithmic-content/nodes/footnote-node";

export class FootnoteNode extends HeadlessFootnoteNode {
  // `getType`, `clone`, and `importJSON` must be (re)declared on the subclass —
  // Lexical checks for them as own static members, and `clone`/`importJSON` must
  // build THIS subclass so the editor registers React-rendering footnotes (the
  // inherited versions would build the headless base, which decorates to
  // nothing).
  static getType(): string {
    return FOOTNOTE_TYPE;
  }

  static clone(node: FootnoteNode): FootnoteNode {
    return new FootnoteNode(node.__footnote, node.__key);
  }

  static importJSON(serialized: SerializedFootnoteNode): FootnoteNode {
    return $createFootnoteNode().setBodyFromJSON(serialized.footnote);
  }

  // Lexical warns when a custom `exportDOM` has no matching `importDOM`. We
  // deliberately opt out of HTML import: a footnote's body isn't recoverable
  // from the bare `<sup>` number `exportDOM` emits, and not every superscript is
  // a footnote. Copy/paste back into the editor round-trips losslessly through
  // the `application/x-lexical-editor` payload (see `FootnoteCopyPlugin`), which
  // never consults `importDOM`, so returning no conversions is correct here.
  static importDOM(): DOMConversionMap | null {
    return null;
  }

  createDOM(): HTMLElement {
    const el = document.createElement("sup");
    el.className =
      "cursor-pointer select-none px-px text-[0.72em] font-semibold leading-flat text-accent";
    return el;
  }

  // Copied/exported HTML: a plain numbered superscript. The on-screen number is
  // React-rendered by `decorate()` and so isn't part of `createDOM`, which would
  // otherwise leave an empty `<sup>` in copied HTML. Use the footnote's position
  // among all footnotes — the same 1-based number the reader sees — so a copied
  // reference matches the document and the endnotes appended by
  // `FootnoteCopyPlugin`. Runs inside the read that generates the HTML, so
  // `$collectFootnotes` sees the live document.
  exportDOM(): DOMExportOutput {
    const el = document.createElement("sup");
    const ordinal = $collectFootnotes().findIndex((n) => n.getKey() === this.getKey()) + 1;
    el.textContent = String(ordinal || 1);
    return { element: el };
  }

  decorate(): ReactNode {
    return <FootnoteRef nodeKey={this.getKey()} />;
  }
}

export function $createFootnoteNode(): FootnoteNode {
  return new FootnoteNode();
}

/**
 * The inline superscript. Its number is this footnote's 1-based position among
 * all footnotes, recomputed whenever the document changes so numbering stays
 * correct as footnotes are added, removed, or reordered. Clicking it scrolls to
 * and focuses the matching body at the bottom.
 */
function FootnoteRef({ nodeKey }: { nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const [ordinal, setOrdinal] = useState(1);

  useEffect(() => {
    const recompute = () => {
      editor.getEditorState().read(() => {
        const idx = $collectFootnotes().findIndex((n) => n.getKey() === nodeKey);
        if (idx >= 0) setOrdinal(idx + 1);
      });
    };
    recompute();
    return editor.registerUpdateListener(recompute);
  }, [editor, nodeKey]);

  return (
    <span
      role="button"
      tabIndex={-1}
      title={`Footnote ${ordinal}`}
      onClick={() => {
        const row = document.getElementById(`footnote-${nodeKey}`);
        row?.scrollIntoView({ block: "center", behavior: "smooth" });
        row?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
      }}
    >
      {ordinal}
    </span>
  );
}
