import { expect, test } from "vite-plus/test";

import { emptyContent, plainTextContent } from "./document.ts";
import { countWords } from "./word-count.ts";

/** A serialized node, loose enough to splice a footnote into a built document. */
type DocNode = { type: string; version?: number; children?: DocNode[]; footnote?: unknown };

test("an absent or empty document counts as zero words", () => {
  expect(countWords(null)).toBe(0);
  expect(countWords(undefined)).toBe(0);
  expect(countWords("")).toBe(0);
  expect(countWords(emptyContent())).toBe(0);
});

test("unparseable content counts as zero rather than throwing", () => {
  // Persist hooks call this on whatever is stored; it must never throw.
  expect(() => countWords("not json at all")).not.toThrow();
  expect(countWords("not json at all")).toBe(0);
  expect(countWords("{}")).toBe(0);
});

test("words are counted across a document's paragraphs", () => {
  expect(countWords(plainTextContent("hello world"))).toBe(2);
  expect(countWords(plainTextContent("one two three\n\nfour five"))).toBe(5);
});

test("footnote body text is included in the word count", () => {
  // Build a real document, then splice a footnote (carrying its own body) into
  // the first paragraph. The body's words must count toward the total.
  const outer = JSON.parse(plainTextContent("Hello world")) as { root: DocNode };
  const body: unknown = JSON.parse(plainTextContent("three body words"));
  const firstParagraph = outer.root.children?.[0];
  if (!firstParagraph) throw new Error("expected a paragraph");
  (firstParagraph.children ??= []).push({ type: "footnote", version: 1, footnote: body });

  // "Hello world" (2) + "three body words" (3) = 5.
  expect(countWords(JSON.stringify(outer))).toBe(5);
});
