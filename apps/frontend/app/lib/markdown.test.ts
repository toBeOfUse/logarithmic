import { describe, expect, test } from "vite-plus/test";

import { docToMarkdown, markdownToDoc } from "~/lib/markdown.ts";
import { essay } from "~/lib/markdown.essay.fixture.ts";

/** Markdown → doc → Markdown, the round-trip that storage relies on. */
function roundTrip(md: string): string {
  return docToMarkdown(markdownToDoc(md));
}

describe("basic formatting", () => {
  test("inline marks survive the round-trip", () => {
    const md =
      "A paragraph with **bold**, *italic*, ~~strike~~, `code`, and a [link](https://example.com).";
    expect(roundTrip(md)).toBe(md);
  });

  test("headings, lists, quotes, and code blocks round-trip", () => {
    const md = [
      "## Heading two",
      "",
      "### Heading three",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "> a quote",
      "",
      "```js",
      "const x = 1;",
      "```",
    ].join("\n");
    expect(roundTrip(md)).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// Headings, escapes, and inline code edge cases.
// ---------------------------------------------------------------------------

describe("headings, escapes, and inline code", () => {
  test("a struck-through heading round-trips", () => {
    const md = "## ~~How to Ruin Music~~";
    expect(roundTrip(md)).toBe(md);
  });

  test("out-of-range heading levels clamp into the editor's H2/H3 window", () => {
    // The editor only offers H2 and H3 (StarterKit `heading.levels`); imported
    // H1 collapses up to H2 and anything deeper than H3 collapses to H3, rather
    // than silently degrading to a paragraph.
    expect(roundTrip("# Title one")).toBe("## Title one");
    expect(roundTrip("#### Deep heading")).toBe("### Deep heading");
  });

  test("an escaped bracket stays escaped so it is not read back as a link", () => {
    const md = "Suno is a platform that hosts... \\[overview of what Suno does]";
    expect(roundTrip(md)).toBe(md);
  });

  test("inline code preserves angle brackets and ampersands verbatim", () => {
    const md = "Use `a < b && c` carefully.";
    expect(roundTrip(md)).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// Block containers: quotes and lists holding richer content.
// ---------------------------------------------------------------------------

describe("block containers", () => {
  test("a multi-paragraph blockquote round-trips", () => {
    const md = "> First paragraph of the quote.\n>\n> Second paragraph of the quote.";
    expect(roundTrip(md)).toBe(md);
  });

  test("a blockquote containing a list round-trips", () => {
    const md = "> - quoted item one\n> - quoted item two";
    expect(roundTrip(md)).toBe(md);
  });

  test("a nested bullet list round-trips", () => {
    const md = "- outer\n  - inner one\n  - inner two\n- outer two";
    expect(roundTrip(md)).toBe(md);
  });

  test("an ordered list preserves a non-default start number", () => {
    const md = "3. third\n4. fourth";
    expect(roundTrip(md)).toBe(md);
  });

  test("list items carry inline formatting", () => {
    const md = "- a **bold** item\n- a [link](https://example.com) item";
    expect(roundTrip(md)).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// Comments — carried as a `comment` mark, serialised to `<!-- … -->`.
// ---------------------------------------------------------------------------

describe("comments", () => {
  test("an inline comment round-trips as an HTML comment", () => {
    const md = "Visible text <!-- a hidden note --> more text.";
    const doc = markdownToDoc(md);
    // The comment is carried as a `comment` mark, not literal text.
    const para = doc.content?.[0];
    const commented = para?.content?.find((n) => n.marks?.some((m) => m.type === "comment"));
    expect(commented?.text).toBe("a hidden note");
    expect(roundTrip(md)).toBe(md);
  });

  test("a standalone comment is its own block and round-trips", () => {
    const md = "<!-- a note to self, on its own line -->";
    expect(roundTrip(md)).toBe(md);
  });

  test("formatting applied to a comment is dropped (the comment is invisible)", () => {
    // A bold mark on an HTML comment has no rendered effect, so it is not carried
    // back out — the comment serialises plainly.
    const md = "A **<!-- styled comment -->** here.";
    expect(roundTrip(md)).toBe("A <!-- styled comment --> here.");
  });

  test("multiple comments on one line each round-trip independently", () => {
    const md = "One <!-- first --> two <!-- second --> three.";
    expect(roundTrip(md)).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// Footnotes — references are inline atoms; bodies live in a footnotes section at
// the document end. Numbering is positional (first reference appearance).
// ---------------------------------------------------------------------------

describe("footnotes", () => {
  test("a footnote reference and its definition round-trip", () => {
    const md = "Here is a claim.[^1]\n\n[^1]: The supporting detail.";
    const doc = markdownToDoc(md);
    // The reference is an inline atom in the body…
    const ref = doc.content?.[0]?.content?.find((n) => n.type === "footnoteReference");
    expect(ref?.attrs?.referenceNumber).toBe("1");
    // …and the body lives in a footnotes section at the document end.
    const footnotes = doc.content?.find((n) => n.type === "footnotes");
    expect(footnotes?.content?.length).toBe(1);
    expect(roundTrip(md)).toBe(md);
  });

  test("a footnote body can hold rich content like a link", () => {
    const md = "Claim.[^1]\n\n[^1]: See the [docs](https://example.com) for more.";
    expect(roundTrip(md)).toBe(md);
  });

  test("multiple footnotes are renumbered positionally in document order", () => {
    // Source ids are arbitrary and out of order; serialising normalises them to
    // 1, 2 in the order the references appear in the text.
    const md = "First.[^a] Second.[^b]\n\n[^b]: note b\n\n[^a]: note a";
    expect(roundTrip(md)).toBe("First.[^1] Second.[^2]\n\n[^1]: note a\n\n[^2]: note b");
  });

  test("a footnote whose body references another footnote numbers transitively", () => {
    // [^2] only appears inside [^1]'s body; it must still be discovered, numbered
    // after [^1], and given its own definition.
    const md = "Body.[^1]\n\n[^1]: see also[^2]\n\n[^2]: the second";
    const doc = markdownToDoc(md);
    const section = doc.content?.find((n) => n.type === "footnotes");
    expect(section?.content?.length).toBe(2);
    expect(roundTrip(md)).toBe(md);
  });

  test("a multi-paragraph footnote body round-trips (regression: single-line truncation)", () => {
    const md = "Claim.[^1]\n\n[^1]: First paragraph.\n\n    Second paragraph.";
    const out = roundTrip(md);
    // Both paragraphs survive (the old HTML pipeline dropped the continuation).
    expect(out).toContain("First paragraph.");
    expect(out).toContain("Second paragraph.");
    // And it is stable on a second pass.
    expect(roundTrip(out)).toBe(out);
  });

  test("a footnote-definition-shaped line inside a code block is not stripped (regression)", () => {
    const md = "```\n[^1]: not a footnote, just code\n```\n\nReal text.";
    const out = roundTrip(md);
    expect(out).toContain("[^1]: not a footnote, just code");
    expect(out).toContain("Real text.");
  });

  test("plain numbers in the body are not turned into footnote references", () => {
    const md = "Released in 1977.[^1]\n\n[^1]: A classic from 1977.";
    expect(roundTrip(md)).toBe(md);
  });

  test("footnote text with quotes and ampersands survives the round-trip", () => {
    const md = 'Quote.[^1]\n\n[^1]: She said "hi" & left.';
    expect(roundTrip(md)).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// Mark nesting: a TipTap text node carries a flat *set* of marks, but Markdown
// needs them *nested*. When one mark spans a run that another mark (or a link,
// or a footnote) subdivides, the serializer must emit a single `**…**`/`*…*`
// rather than several adjacent ones — adjacent emphases force `remark` to wedge
// `&#x20;` escapes between them, producing valid-but-mangled Markdown.
// ---------------------------------------------------------------------------

describe("mark nesting", () => {
  test("a nested mark does not split its outer mark into escaped fragments", () => {
    // The italic word sits inside the bold span; the bold must stay one run.
    const md = "This is **bold and *italic* together**.";
    const out = roundTrip(md);
    expect(out).toBe(md);
    // Specifically, no entity-escaped boundary leaked in.
    expect(out).not.toContain("&#x20;");
  });

  test("a mark spanning a link stays a single span", () => {
    const md = "*before [link](https://example.com) after*";
    const out = roundTrip(md);
    expect(out).toBe(md);
    expect(out).not.toContain("&#x20;");
  });

  test("strike spanning a link stays a single span", () => {
    const md = "~~struck [and linked](https://example.com) here~~";
    expect(roundTrip(md)).toBe(md);
  });

  test("bold, italic, and a link nest into one clean span", () => {
    const md = "[***everything***](https://example.com)";
    expect(roundTrip(md)).toBe(md);
  });

  test("a footnote inside a bold span keeps the bold as one run", () => {
    // The reference subdivides the text run but carries no mark of its own; the
    // bold must close after, not before, it.
    const md = "Some **bold[^1] text**.\n\n[^1]: note";
    const out = roundTrip(md);
    expect(out).toBe(md);
    expect(out).not.toContain("&#x20;");
  });

  test("a footnote trailing a link's text serialises after the link", () => {
    // Footnote references hold no marks, so one at the tail of link text can't be
    // reconstructed *inside* the link — it attaches just after it, still valid.
    const md = "See [the docs[^1]](https://example.com).\n\n[^1]: note";
    const out = roundTrip(md);
    expect(out).toBe("See [the docs](https://example.com)[^1].\n\n[^1]: note");
    expect(roundTrip(out)).toBe(out);
  });
});

// ---------------------------------------------------------------------------
// Integration: a full messy draft exercising every construct at once —
// strikethrough across links, comments, escaped brackets, a footnote, blockquotes,
// H2/H3 headings, and ordinary prose — round-trips byte-for-byte and is stable.
// ---------------------------------------------------------------------------

describe("a complete draft", () => {
  test("round-trips byte-for-byte and is idempotent", () => {
    const input = essay.trimEnd();
    const out = roundTrip(input);
    expect(out).toBe(input);
    expect(roundTrip(out)).toBe(out);
    // No mangled emphasis boundaries anywhere in a document this dense.
    expect(out).not.toContain("&#x20;");
  });
});
