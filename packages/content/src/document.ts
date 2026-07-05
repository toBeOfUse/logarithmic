/**
 * Content documents and the tools that build them. A document is Lexical's real
 * `SerializedEditorState`, stored as a JSON string — there are no bespoke
 * shape types here; the data layer speaks the editor's own serialization.
 *
 * Documents are constructed through a headless editor so the output is always
 * valid for the editor to load. Used to seed demo content today and as the
 * baseline for the future best-effort Markdown → document conversion.
 */
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import type { SerializedEditorState } from "lexical";

import { createContentEditor } from "./schema.ts";

/** A serialized content document (Lexical's editor state). */
export type ContentDocument = SerializedEditorState;

/** Build a document with a headless editor and return its serialized JSON. */
function buildDocument(build: () => void): string {
  const editor = createContentEditor();
  editor.update(build, { discrete: true });
  return JSON.stringify(editor.getEditorState().toJSON());
}

/** An empty document (a single empty paragraph) — the editor's blank state. */
export function emptyContent(): string {
  return buildDocument(() => {
    const root = $getRoot();
    root.clear();
    root.append($createParagraphNode());
  });
}

/** Build a document from plain text, splitting on blank lines into paragraphs. */
export function plainTextContent(text: string): string {
  return buildDocument(() => {
    const root = $getRoot();
    root.clear();
    const paras = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const para of paras) {
      const p = $createParagraphNode();
      p.append($createTextNode(para));
      root.append(p);
    }
    if (root.getChildrenSize() === 0) root.append($createParagraphNode());
  });
}
