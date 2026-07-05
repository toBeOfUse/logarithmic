/**
 * The document schema — the node types a stored content document may contain.
 * This is the shared contract between the two "display layers": the frontend's
 * React editor and the backend's serializers. Both register the same nodes so a
 * document round-trips identically; the frontend simply swaps in a
 * React-rendering `FootnoteNode` subclass over the canonical one here.
 */
import { createHeadlessEditor } from "@lexical/headless";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { HorizontalRuleNode } from "@lexical/extension";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import type { Klass, LexicalEditor, LexicalNode } from "lexical";

import { FootnoteNode } from "./nodes/footnote-node.ts";

/** Standard document nodes, shared verbatim by both display layers. */
export const DOCUMENT_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
  CodeNode,
  CodeHighlightNode,
  HorizontalRuleNode,
];

/** The full schema including the canonical (headless) footnote node. */
export const CONTENT_NODES: ReadonlyArray<Klass<LexicalNode>> = [...DOCUMENT_NODES, FootnoteNode];

/**
 * A headless editor configured with the full document schema — used to parse,
 * inspect, and (later) re-serialize stored content without a browser or React.
 */
export function createContentEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "content",
    nodes: [...CONTENT_NODES],
    onError: (error) => {
      throw error;
    },
  });
}
