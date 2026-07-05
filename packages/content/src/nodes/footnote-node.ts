/**
 * The canonical (headless) footnote node — part of the shared data layer.
 *
 * A footnote is an inline node whose rich-text body lives in a nested editor.
 * Because the body is serialized inside the node's own JSON (`exportJSON`), it
 * travels with the reference when cut/copied and is understood by any consumer
 * of a stored document — the backend's serializers as much as the frontend's
 * editor. This class carries everything except rendering: serialization, the
 * nested body, and `getTextContent` (so word counts include footnote bodies).
 *
 * It depends only on Lexical's headless/core packages — never React. The
 * frontend subclasses it to add `decorate()` (the on-screen superscript + body
 * editor); the backend uses it as-is via a headless editor. `createDOM` is
 * required by the abstract base but is never invoked in the headless path.
 */
import { AutoLinkNode, LinkNode } from "@lexical/link";
import {
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  createEditor,
  DecoratorNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedEditorState,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

export const FOOTNOTE_TYPE = "footnote";

export type SerializedFootnoteNode = Spread<
  { footnote: SerializedEditorState },
  SerializedLexicalNode
>;

/** A footnote body is inline-only rich text: paragraphs + links, no blocks. */
function createFootnoteBodyEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: "footnote",
    nodes: [LinkNode, AutoLinkNode],
    onError: (error) => {
      throw error;
    },
  });
  // Seed an empty paragraph so a fresh body is a valid, focusable document — an
  // empty root has no caret position, so the editor can't be focused into it.
  // Loading a stored body (`setBodyFromJSON`) replaces this outright.
  editor.update(
    () => {
      const root = $getRoot();
      if (root.getChildrenSize() === 0) root.append($createParagraphNode());
    },
    { discrete: true },
  );
  return editor;
}

export class FootnoteNode extends DecoratorNode<unknown> {
  __footnote: LexicalEditor;

  static getType(): string {
    return FOOTNOTE_TYPE;
  }

  static clone(node: FootnoteNode): FootnoteNode {
    return new FootnoteNode(node.__footnote, node.__key);
  }

  constructor(footnote?: LexicalEditor, key?: NodeKey) {
    super(key);
    this.__footnote = footnote ?? createFootnoteBodyEditor();
  }

  createDOM(): HTMLElement {
    // Frontend subclass overrides this to style the superscript; never called
    // in the headless path.
    return document.createElement("sup");
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  decorate(): unknown {
    return null;
  }

  getFootnoteEditor(): LexicalEditor {
    return this.__footnote;
  }

  /** Load a serialized body into this node's nested editor. */
  setBodyFromJSON(serialized: SerializedEditorState | undefined): this {
    if (serialized) {
      try {
        this.__footnote.setEditorState(this.__footnote.parseEditorState(serialized));
      } catch {
        // Corrupt or foreign footnote body — leave it empty rather than throw.
      }
    }
    return this;
  }

  /** The body's text, padded with spaces so it never fuses with surrounding
   *  words in a `getTextContent()` walk (e.g. word counting). */
  getTextContent(): string {
    const body = this.__footnote.getEditorState().read(() => $getRoot().getTextContent());
    return body ? ` ${body} ` : "";
  }

  exportJSON(): SerializedFootnoteNode {
    return {
      ...super.exportJSON(),
      type: FOOTNOTE_TYPE,
      version: 1,
      footnote: this.__footnote.getEditorState().toJSON(),
    };
  }

  static importJSON(serialized: SerializedFootnoteNode): FootnoteNode {
    return $createFootnoteNode().setBodyFromJSON(serialized.footnote);
  }
}

export function $createFootnoteNode(): FootnoteNode {
  return new FootnoteNode();
}

export function $isFootnoteNode(node: LexicalNode | null | undefined): node is FootnoteNode {
  return node instanceof FootnoteNode;
}

/** Collect footnote nodes in document (reading) order. Must run in a read. */
export function $collectFootnotes(): FootnoteNode[] {
  const found: FootnoteNode[] = [];
  const visit = (node: LexicalNode) => {
    if ($isFootnoteNode(node)) found.push(node);
    if ($isElementNode(node)) node.getChildren().forEach(visit);
  };
  visit($getRoot());
  return found;
}
