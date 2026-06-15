/**
 * Round-trip between the Markdown stored on disk (per spec/1-core-data-model.md)
 * and the ProseMirror document JSON that TipTap consumes and produces.
 *
 * The pivot is a **Markdown AST (mdast)**, not an HTML string: `remark` owns
 * markdown in both directions and footnotes are real mdast nodes (via
 * `remark-gfm`), so there is no regex-over-HTML parsing and no second markdown
 * engine to keep in agreement. We walk between mdast and TipTap's typed node
 * tree (`editor.getJSON()` / `setContent(json)`) with one visitor per node type.
 *
 * Two custom constructs:
 * - Inline comments — a `comment` mark on a run of text, serialised to a GFM
 *   HTML comment `<!-- … -->` (an mdast `html` node). `CommentMark` agrees with
 *   this file on the data attribute via `COMMENT_DATA_ATTR`.
 * - Footnotes — the `tiptap-footnotes` extension's `footnoteReference` (an inline
 *   atom tying to a body by `data-id`) and the `footnotes`/`footnote` section at
 *   the document end. These map onto mdast `footnoteReference` / `footnoteDefinition`,
 *   which serialise to `[^n]` markers and `[^n]: …` definition lines. Numbering
 *   is positional (first reference appearance); the stored identifiers are the
 *   1-based numbers, and `data-id`s (uuids) are regenerated on load.
 */
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import type { JSONContent } from "@tiptap/core";
import type {
  BlockContent,
  Blockquote,
  Code,
  FootnoteDefinition,
  Heading,
  List,
  ListItem,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";

/** Shared with `components/CommentMark.ts` — the only contract between the
 *  serializer and the TipTap mark. */
export const COMMENT_DATA_ATTR = "data-comment";

// A run of text whose only "mark" is a comment serialises to `<!-- text -->`.
const COMMENT_RE = /^<!--([\s\S]*?)-->$/;

const mdParser = unified().use(remarkParse).use(remarkGfm);
const mdStringifier = unified().use(remarkGfm).use(remarkStringify, {
  bullet: "-",
  emphasis: "*",
  strong: "*",
  fences: true,
  rule: "-",
  ruleSpaces: false,
  listItemIndent: "one",
});

// Editor headings are restricted to H2/H3 (see StarterKit config); clamp any
// out-of-range depth from imported markdown into that window so it stays a
// heading rather than silently collapsing to a paragraph.
function clampHeadingLevel(level: number): 2 | 3 {
  return level <= 2 ? 2 : 3;
}

// ---------------------------------------------------------------------------
// Marks: a TipTap inline run carries a set of marks; mdast nests phrasing nodes.
// ---------------------------------------------------------------------------

type Mark = { type: string; attrs?: Record<string, unknown> };

function markNames(marks: Mark[] | undefined): { names: Set<string>; href: string | null } {
  const names = new Set<string>();
  let href: string | null = null;
  for (const m of marks ?? []) {
    names.add(m.type);
    if (m.type === "link") href = typeof m.attrs?.href === "string" ? m.attrs.href : "";
  }
  return { names, href };
}

function addMark(marks: Mark[], type: string, attrs?: Record<string, unknown>): Mark[] {
  return [...marks, attrs ? { type, attrs } : { type }];
}

// ===========================================================================
// Markdown → TipTap doc JSON
// ===========================================================================

type RefInfo = { num: number; uuid: string };

/** Walk any mdast subtree in document order, invoking `cb` for each footnote
 *  reference identifier as it appears. */
function eachRefIdentifier(nodes: readonly Nodes[], cb: (identifier: string) => void): void {
  for (const node of nodes) {
    if (node.type === "footnoteReference") cb(node.identifier);
    else if ("children" in node) eachRefIdentifier(node.children, cb);
  }
}

function newUuid(): string {
  return crypto.randomUUID();
}

function mdInlineToPM(
  nodes: readonly PhrasingContent[],
  marks: Mark[],
  refs: Map<string, RefInfo>,
): JSONContent[] {
  const out: JSONContent[] = [];
  const pushText = (value: string, m: Mark[]) => {
    if (value === "") return;
    out.push(m.length ? { type: "text", text: value, marks: m } : { type: "text", text: value });
  };
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        pushText(node.value, marks);
        break;
      case "emphasis":
        out.push(...mdInlineToPM(node.children, addMark(marks, "italic"), refs));
        break;
      case "strong":
        out.push(...mdInlineToPM(node.children, addMark(marks, "bold"), refs));
        break;
      case "delete":
        out.push(...mdInlineToPM(node.children, addMark(marks, "strike"), refs));
        break;
      case "inlineCode":
        pushText(node.value, addMark(marks, "code"));
        break;
      case "link":
        out.push(...mdInlineToPM(node.children, addMark(marks, "link", { href: node.url }), refs));
        break;
      case "break":
        // Hard breaks are disabled in the editor; fall back to a space-equivalent
        // newline inside the run rather than dropping the boundary entirely.
        pushText("\n", marks);
        break;
      case "image":
        // No image node in the editor yet (see spec TODO); keep the alt text.
        pushText(node.alt ?? "", marks);
        break;
      case "html": {
        const comment = COMMENT_RE.exec(node.value.trim());
        if (comment) pushText(comment[1]!.trim(), addMark(marks, "comment"));
        else pushText(node.value, marks);
        break;
      }
      case "footnoteReference": {
        const info = refs.get(node.identifier);
        if (info) {
          out.push({
            type: "footnoteReference",
            attrs: { "data-id": info.uuid, referenceNumber: String(info.num) },
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function mdBlockToPM(node: RootContent, refs: Map<string, RefInfo>): JSONContent | null {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", content: mdInlineToPM(node.children, [], refs) };
    case "heading":
      return {
        type: "heading",
        attrs: { level: clampHeadingLevel(node.depth) },
        content: mdInlineToPM(node.children, [], refs),
      };
    case "blockquote":
      return { type: "blockquote", content: mdBlocksToPM(node.children, refs) };
    case "list": {
      const items = node.children
        .map((item) => mdBlockToPM(item, refs))
        .filter((n): n is JSONContent => n != null);
      return node.ordered
        ? { type: "orderedList", attrs: { start: node.start ?? 1 }, content: items }
        : { type: "bulletList", content: items };
    }
    case "listItem": {
      const content = mdBlocksToPM(node.children, refs);
      // A list item must hold at least a paragraph.
      return { type: "listItem", content: content.length ? content : [{ type: "paragraph" }] };
    }
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null },
        content: node.value ? [{ type: "text", text: node.value }] : [],
      };
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "html": {
      const comment = COMMENT_RE.exec(node.value.trim());
      const text = comment ? comment[1]!.trim() : node.value;
      const marks: Mark[] = comment ? [{ type: "comment" }] : [];
      return { type: "paragraph", content: text ? [{ type: "text", text, marks }] : [] };
    }
    default:
      // footnoteDefinition is handled separately; anything else (tables, etc.)
      // has no editor representation and is dropped.
      return null;
  }
}

function mdBlocksToPM(nodes: readonly RootContent[], refs: Map<string, RefInfo>): JSONContent[] {
  return nodes.map((n) => mdBlockToPM(n, refs)).filter((n): n is JSONContent => n != null);
}

export function markdownToDoc(md: string): JSONContent {
  const tree = mdParser.parse(md);

  const definitions = new Map<string, FootnoteDefinition>();
  for (const node of tree.children) {
    if (node.type === "footnoteDefinition") definitions.set(node.identifier, node);
  }
  const bodyNodes = tree.children.filter(
    (n): n is Exclude<RootContent, FootnoteDefinition> => n.type !== "footnoteDefinition",
  );

  // Number references by first appearance in the body, then extend into the
  // bodies of already-numbered definitions (a footnote may reference another).
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const see = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  };
  eachRefIdentifier(bodyNodes, see);
  for (let i = 0; i < orderedIds.length; i++) {
    const def = definitions.get(orderedIds[i]!);
    if (def) eachRefIdentifier(def.children, see);
  }

  const refs = new Map<string, RefInfo>();
  orderedIds.forEach((id, i) => refs.set(id, { num: i + 1, uuid: newUuid() }));

  const content = mdBlocksToPM(bodyNodes, refs);

  if (orderedIds.length > 0) {
    const items: JSONContent[] = orderedIds.map((id) => {
      const info = refs.get(id)!;
      const def = definitions.get(id);
      const body = def ? mdBlocksToPM(def.children, refs) : [];
      return {
        type: "footnote",
        attrs: { "data-id": info.uuid, id: `fn:${info.num}` },
        content: body.length ? body : [{ type: "paragraph" }],
      };
    });
    content.push({ type: "footnotes", content: items });
  }

  return { type: "doc", content };
}

// ===========================================================================
// TipTap doc JSON → Markdown
// ===========================================================================

/** Walk TipTap inline/block JSON in document order, invoking `cb` for each
 *  footnote reference's `data-id` as it appears. */
function eachPMRefId(nodes: readonly JSONContent[], cb: (dataId: string) => void): void {
  for (const node of nodes) {
    if (node.type === "footnoteReference") {
      const id = node.attrs?.["data-id"];
      if (typeof id === "string") cb(id);
    } else if (node.content) {
      eachPMRefId(node.content, cb);
    }
  }
}

type InlineRun =
  | { kind: "text"; text: string; names: Set<string>; href: string | null }
  | { kind: "footnoteRef"; dataId: string }
  | { kind: "break" };

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((v) => b.has(v));
}

/** Flatten a TipTap inline run into mdast phrasing, merging adjacent text with
 *  identical marks so a bold word becomes one `**…**` rather than several. */
function pmInlineToMd(nodes: readonly JSONContent[], ids: Map<string, number>): PhrasingContent[] {
  const runs: InlineRun[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const { names, href } = markNames(node.marks);
      const text = node.text ?? "";
      const last = runs[runs.length - 1];
      if (last?.kind === "text" && setsEqual(last.names, names) && last.href === href) {
        last.text += text;
      } else {
        runs.push({ kind: "text", text, names, href });
      }
    } else if (node.type === "footnoteReference") {
      const dataId = node.attrs?.["data-id"];
      if (typeof dataId === "string") runs.push({ kind: "footnoteRef", dataId });
    } else if (node.type === "hardBreak") {
      runs.push({ kind: "break" });
    }
  }
  return buildPhrasing(runs, WRAPPING_MARKS, ids);
}

// Marks that wrap a span of phrasing, outermost first. A TipTap text node
// carries a flat *set* of marks; mdast needs them *nested*. Rebuilding that
// nesting from the flat runs (rather than wrapping each run on its own) is what
// keeps a mark that spans several runs — because a nested mark, a link, or a
// footnote split the text — a single `**…**`/`*…*` instead of several adjacent
// ones, which `remark` would otherwise have to divide with `&#x20;` escapes.
const WRAPPING_MARKS = ["link", "strike", "bold", "italic"] as const;

// `code` and `comment` are leaf marks (mdast `inlineCode`/`html` have no
// children), so a run carrying one is never a candidate for wrapping.
function carries(run: InlineRun, mark: string): boolean {
  return run.kind === "text" && !run.names.has("comment") && run.names.has(mark);
}

// Footnote references and hard breaks hold no marks, so they can sit *inside* a
// wrapping mark without being a reason to open or close it — they ride along
// between two carriers of the same mark rather than splitting the span.
function isPassenger(run: InlineRun): boolean {
  return run.kind === "footnoteRef" || run.kind === "break";
}

function stripMark(run: InlineRun, mark: string): InlineRun {
  if (run.kind !== "text") return run;
  const names = new Set(run.names);
  names.delete(mark);
  return { kind: "text", text: run.text, names, href: mark === "link" ? null : run.href };
}

function wrapMark(mark: string, href: string | null, children: PhrasingContent[]): PhrasingContent {
  switch (mark) {
    case "italic":
      return { type: "emphasis", children };
    case "bold":
      return { type: "strong", children };
    case "strike":
      return { type: "delete", children };
    default: // "link"
      return { type: "link", url: href ?? "", children };
  }
}

function leafToPhrasing(run: InlineRun, ids: Map<string, number>): PhrasingContent {
  if (run.kind === "break") return { type: "break" };
  if (run.kind === "footnoteRef") {
    const n = ids.get(run.dataId);
    const identifier = n != null ? String(n) : run.dataId;
    return { type: "footnoteReference", identifier, label: identifier };
  }
  if (run.names.has("comment")) return { type: "html", value: `<!-- ${run.text.trim()} -->` };
  return run.names.has("code")
    ? { type: "inlineCode", value: run.text }
    : { type: "text", value: run.text };
}

/** Recursively nest the flat run list under shared wrapping marks. At each run,
 *  the outermost mark it still carries opens a group spanning every following
 *  run that shares it (links must also share the href); that mark is stripped
 *  and the group recurses on the remaining inner marks. */
function buildPhrasing(
  runs: readonly InlineRun[],
  marks: readonly string[],
  ids: Map<string, number>,
): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let i = 0;
  while (i < runs.length) {
    const run = runs[i]!;
    const mark = marks.find((m) => carries(run, m));
    if (!mark) {
      out.push(leafToPhrasing(run, ids));
      i++;
      continue;
    }
    const href = run.kind === "text" ? run.href : null;
    const sameLink = (r: InlineRun) => mark !== "link" || (r.kind === "text" && r.href === href);
    // Extend over carriers of `mark`, letting passengers ride along; `last`
    // tracks the final genuine carrier so trailing passengers fall back out.
    let last = i;
    for (let j = i + 1; j < runs.length; j++) {
      const r = runs[j]!;
      if (carries(r, mark) && sameLink(r)) last = j;
      else if (!isPassenger(r)) break;
    }
    const group = runs.slice(i, last + 1).map((r) => stripMark(r, mark));
    out.push(
      wrapMark(
        mark,
        href,
        buildPhrasing(
          group,
          marks.filter((m) => m !== mark),
          ids,
        ),
      ),
    );
    i = last + 1;
  }
  return out;
}

function textOf(node: JSONContent): string {
  return (node.content ?? []).map((c) => c.text ?? "").join("");
}

// List items are built by `pmListItems`, not here, so a block always maps to
// flow content (`BlockContent`) — which is what blockquote/list-item/footnote
// children require.
function pmBlockToMd(node: JSONContent, ids: Map<string, number>): BlockContent | null {
  switch (node.type) {
    case "paragraph":
      return {
        type: "paragraph",
        children: pmInlineToMd(node.content ?? [], ids),
      } satisfies Paragraph;
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 2;
      return {
        type: "heading",
        depth: clampHeadingLevel(level),
        children: pmInlineToMd(node.content ?? [], ids),
      } satisfies Heading;
    }
    case "blockquote":
      return {
        type: "blockquote",
        children: pmBlocksToMd(node.content ?? [], ids),
      } satisfies Blockquote;
    case "bulletList":
      return {
        type: "list",
        ordered: false,
        spread: false,
        children: pmListItems(node.content ?? [], ids),
      } satisfies List;
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      return {
        type: "list",
        ordered: true,
        start,
        spread: false,
        children: pmListItems(node.content ?? [], ids),
      } satisfies List;
    }
    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : null;
      return { type: "code", lang, value: textOf(node) } satisfies Code;
    }
    case "horizontalRule":
      return { type: "thematicBreak" };
    default:
      return null;
  }
}

function pmBlocksToMd(nodes: readonly JSONContent[], ids: Map<string, number>): BlockContent[] {
  return nodes.map((n) => pmBlockToMd(n, ids)).filter((n): n is BlockContent => n != null);
}

function pmListItems(nodes: readonly JSONContent[], ids: Map<string, number>): ListItem[] {
  const items: ListItem[] = [];
  for (const node of nodes) {
    if (node.type !== "listItem") continue;
    const children = pmBlocksToMd(node.content ?? [], ids);
    items.push({
      type: "listItem",
      spread: false,
      children: children.length ? children : [{ type: "paragraph", children: [] }],
    });
  }
  return items;
}

export function docToMarkdown(doc: JSONContent): string {
  const topLevel = doc.content ?? [];
  const bodyNodes = topLevel.filter((n) => n.type !== "footnotes");
  const footnotesNode = topLevel.find((n) => n.type === "footnotes");

  // Number references by first appearance. `queue` grows as we discover them, so
  // walking footnote bodies (which may reference further footnotes) extends the
  // numbering to any depth in encounter order.
  const ids = new Map<string, number>();
  const queue: string[] = [];
  const see = (dataId: string) => {
    if (!ids.has(dataId)) {
      ids.set(dataId, ids.size + 1);
      queue.push(dataId);
    }
  };
  eachPMRefId(bodyNodes, see);

  // Index footnote items by data-id so definitions follow reference order.
  const footnoteById = new Map<string, JSONContent>();
  for (const item of footnotesNode?.content ?? []) {
    const id = item.attrs?.["data-id"];
    if (typeof id === "string") footnoteById.set(id, item);
  }
  for (let i = 0; i < queue.length; i++) {
    const item = footnoteById.get(queue[i]!);
    if (item?.content) eachPMRefId(item.content, see);
  }

  const bodyMd = pmBlocksToMd(bodyNodes, ids);

  const definitions: FootnoteDefinition[] = [];
  for (const [dataId, num] of [...ids.entries()].sort((a, b) => a[1] - b[1])) {
    const item = footnoteById.get(dataId);
    const children = item ? pmBlocksToMd(item.content ?? [], ids) : [];
    definitions.push({
      type: "footnoteDefinition",
      identifier: String(num),
      label: String(num),
      children: children.length ? children : [{ type: "paragraph", children: [] }],
    });
  }

  const root: Root = { type: "root", children: [...bodyMd, ...definitions] };
  return mdStringifier.stringify(root).replace(/\n+$/, "");
}
