/**
 * Logbook export/import as tRPC procedures.
 *
 * `export` returns the logbook as a ZIP (Uint8Array) wrapped in a small object
 * that also carries the suggested download filename. `import` accepts a ZIP
 * as a binary stream (see tRPC's `octetInputParser`) and creates a new logbook
 * from its contents — anonymous callers get a session minted on the fly so the
 * splash-screen import flow works without a prior account.
 *
 * Wire format (spec/1-core-data-model.md "Exports and Imports"):
 *
 *   logbook.yaml              # logbook-level metadata (name)
 *   001-some-entry.md         # leaf entry — Markdown w/ YAML frontmatter
 *   002-other-entry/          # entry with children — folder
 *     index.md                #   its own content + frontmatter
 *     001-child.md            #   children continue the pattern
 *
 * Filenames are prefixed with the zero-padded sibling order so the export
 * round-trips cleanly: a re-import walks the tree in directory-listing order
 * and the prefixes restore the original ordering even on filesystems that
 * don't preserve insertion order.
 */
import { TRPCError } from "@trpc/server";
import { octetInputParser } from "@trpc/server/http";
import JSZip from "jszip";
import slugify from "@sindresorhus/slugify";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { CreatedLogbook } from "./api-types.ts";
import { Entry, type Metadata, type MetadataValue } from "../entities/Entry.ts";
import { Logbook } from "../entities/Logbook.ts";
import { logbookProcedure, publicAuthoringProcedure, router } from "../trpc.ts";
import { issueTokenForLogbook } from "../tokens.ts";
import { toLogbookDetail } from "./utils.ts";

const FILENAME_MAX = 64;

/** Fallback used when a name slugifies to the empty string (e.g. punctuation
 *  only) so filenames in the export ZIP are never bare prefixes. */
function filenameSlug(name: string): string {
  return slugify(name) || "entry";
}

/**
 * Pad sibling indices to at least three digits so a default lexical sort
 * matches numeric order for up to 999 siblings — past that we just keep
 * growing the prefix.
 */
function orderPrefix(index: number, siblingCount: number): string {
  const width = Math.max(3, String(siblingCount).length);
  return String(index + 1).padStart(width, "0");
}

type EntryFrontmatter = {
  name: string;
  col: number;
  icon?: { name: string; family: string };
  metadata?: Metadata;
};

function buildFrontmatter(entry: Entry): EntryFrontmatter {
  const fm: EntryFrontmatter = { name: entry.name, col: entry.col };
  if (entry.iconName && entry.iconFamily) {
    fm.icon = { name: entry.iconName, family: entry.iconFamily };
  }
  if (entry.metadata && Object.keys(entry.metadata).length > 0) {
    fm.metadata = entry.metadata;
  }
  return fm;
}

function entryDocument(entry: Entry): string {
  const yaml = stringifyYaml(buildFrontmatter(entry)).trimEnd();
  const body = entry.content?.trim() ?? "";
  return `---\n${yaml}\n---\n${body ? `\n${body}\n` : ""}`;
}

/**
 * Write `entry` and all its descendants into `zip` under `parentPath`. Leaf
 * entries become a single `.md` file; entries with children become a folder
 * that holds an `index.md` for the entry itself plus one entry per child.
 */
function writeEntryToZip(
  zip: JSZip,
  parentPath: string,
  entry: Entry,
  siblingIndex: number,
  siblingCount: number,
  childrenByParent: Map<number, Entry[]>,
) {
  const prefix = orderPrefix(siblingIndex, siblingCount);
  const base = `${prefix}-${filenameSlug(entry.name)}`.slice(0, FILENAME_MAX);
  const kids = (childrenByParent.get(entry.id) ?? []).sort((a, b) => a.order - b.order);
  const doc = entryDocument(entry);

  if (kids.length === 0) {
    zip.file(`${parentPath}${base}.md`, doc);
    return;
  }
  const folderPath = `${parentPath}${base}/`;
  zip.file(`${folderPath}index.md`, doc);
  kids.forEach((child, i) => {
    writeEntryToZip(zip, folderPath, child, i, kids.length, childrenByParent);
  });
}

async function buildLogbookZip(
  em: import("@mikro-orm/sqlite").EntityManager,
  logbook: Logbook,
): Promise<Uint8Array> {
  const entries = await em.find(Entry, { logbook: logbook.id }, { orderBy: { order: "asc" } });
  const byParent = new Map<number | null, Entry[]>();
  for (const e of entries) {
    const pid = e.parent?.id ?? null;
    const list = byParent.get(pid);
    if (list) list.push(e);
    else byParent.set(pid, [e]);
  }
  const childrenByParent = new Map<number, Entry[]>();
  for (const [pid, list] of byParent) {
    if (pid !== null) childrenByParent.set(pid, list);
  }

  const zip = new JSZip();
  zip.file("logbook.yaml", stringifyYaml({ name: logbook.name }));

  const roots = (byParent.get(null) ?? []).sort((a, b) => a.order - b.order);
  roots.forEach((root, i) => {
    writeEntryToZip(zip, "", root, i, roots.length, childrenByParent);
  });

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

// ── Import ─────────────────────────────────────────────────────────────

/**
 * Split a Markdown document into its YAML frontmatter and body. A document
 * without a leading `---` block is treated as a body with empty frontmatter
 * — that way an export that's been hand-edited still imports.
 */
function parseDocument(text: string): { fm: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { fm: {}, body: text };
  const raw = parseYaml(match[1]!);
  const fm =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { fm, body: match[2] ?? "" };
}

function coerceMetadata(value: unknown): Metadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Metadata = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = coerceMetadataValue(v);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function coerceMetadataValue(v: unknown): MetadataValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (typeof x === "string") return x;
      if (typeof x === "number" || typeof x === "boolean") return String(x);
      return JSON.stringify(x);
    });
  }
  // Objects don't have a sensible flat representation in our metadata model;
  // drop them rather than stringifying to "[object Object]".
  return null;
}

type ParsedNode = {
  name: string;
  col: number | null;
  iconName: string | null;
  iconFamily: string | null;
  content: string;
  metadata: Metadata | null;
  /** Order derived from the numeric filename prefix when present. */
  order: number;
  children: ParsedNode[];
};

/** Read the optional `{ name, family }` icon object from frontmatter, dropping
 *  anything that isn't a well-formed string pair. */
function coerceIcon(value: unknown): { name: string; family: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.name === "string" && typeof obj.family === "string") {
    return { name: obj.name, family: obj.family };
  }
  return null;
}

function parseEntryFromDocument(filename: string, text: string): ParsedNode {
  const { fm, body } = parseDocument(text);
  const name = typeof fm.name === "string" ? fm.name : displayNameFromFilename(filename);
  const col = typeof fm.col === "number" ? Math.trunc(fm.col) : null;
  const icon = coerceIcon(fm.icon);
  const metadata = coerceMetadata(fm.metadata);
  return {
    name,
    col,
    iconName: icon?.name ?? null,
    iconFamily: icon?.family ?? null,
    content: body.trim(),
    metadata,
    order: extractOrderFromName(filename),
    children: [],
  };
}

function extractOrderFromName(filename: string): number {
  const m = /^(\d+)[-_]/.exec(filename);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function displayNameFromFilename(filename: string): string {
  // Strip leading order prefix and extension, then turn dashes back into spaces.
  const stripped = filename.replace(/^\d+[-_]/, "").replace(/\.md$/i, "");
  return stripped.replace(/[-_]+/g, " ").trim() || "Untitled entry";
}

/**
 * Walk the zip, assemble a ParsedNode forest, and return it. Async because
 * each file body is fetched via JSZip's promise-based `async("string")`.
 */
async function readForestFromZip(zip: JSZip): Promise<ParsedNode[]> {
  type FolderEntry = {
    /** Set when the folder contains an `index.md` describing the entry itself. */
    selfDoc: { node: ParsedNode } | null;
    /** Leaf child files (Markdown files that aren't `index.md`). */
    childFiles: { name: string; path: string }[];
    /** Child folder names (each becomes a ParsedNode through its own folder entry). */
    childFolders: string[];
  };
  const folders = new Map<string, FolderEntry>();
  const ensure = (path: string): FolderEntry => {
    let f = folders.get(path);
    if (!f) {
      f = { selfDoc: null, childFiles: [], childFolders: [] };
      folders.set(path, f);
    }
    return f;
  };
  ensure("");

  const allPaths: { path: string; isDir: boolean }[] = [];
  zip.forEach((rel, file) => {
    allPaths.push({ path: rel, isDir: file.dir });
  });

  const registerInParent = (segments: string[], lastIsDir: boolean) => {
    // Ensure each folder on the path is known and listed under its parent.
    for (let i = 0; i < segments.length; i++) {
      const isFinalSegment = i === segments.length - 1;
      const isDirSegment = !isFinalSegment || lastIsDir;
      if (!isDirSegment) continue;
      const folderPath = segments.slice(0, i + 1).join("/") + "/";
      ensure(folderPath);
      const parentPath = i === 0 ? "" : segments.slice(0, i).join("/") + "/";
      const parent = ensure(parentPath);
      if (!parent.childFolders.includes(segments[i]!)) {
        parent.childFolders.push(segments[i]!);
      }
    }
  };

  for (const p of allPaths) {
    const segs = p.path.replace(/\/$/, "").split("/").filter(Boolean);
    if (segs.length === 0) continue;
    registerInParent(segs, p.isDir);
    if (!p.isDir && segs[segs.length - 1]!.toLowerCase().endsWith(".md")) {
      const filename = segs[segs.length - 1]!;
      const parentPath = segs.length === 1 ? "" : segs.slice(0, -1).join("/") + "/";
      const parent = ensure(parentPath);
      if (filename.toLowerCase() === "index.md" && parentPath !== "") {
        // Attached to the parent folder itself in the next pass.
        parent.selfDoc = {
          node: {
            name: "",
            col: null,
            iconName: null,
            iconFamily: null,
            content: "",
            metadata: null,
            order: 0,
            children: [],
          },
        };
        parent.selfDoc.node.order = extractOrderFromName(
          parentPath.replace(/\/$/, "").split("/").pop() ?? "",
        );
      } else {
        parent.childFiles.push({ name: filename, path: p.path });
      }
    }
  }

  // Load all .md bodies up front (parallel).
  type Doc = { node: ParsedNode; path: string };
  const docsByPath = new Map<string, Doc>();
  await Promise.all(
    allPaths
      .filter((p) => !p.isDir && p.path.toLowerCase().endsWith(".md"))
      .map(async (p) => {
        const text = await zip.file(p.path)!.async("string");
        const segs = p.path.split("/");
        const filename = segs[segs.length - 1]!;
        const node = parseEntryFromDocument(filename, text);
        docsByPath.set(p.path, { node, path: p.path });
      }),
  );

  const buildNodeForFolder = (folderPath: string, folderName: string): ParsedNode => {
    const folder = ensure(folderPath);
    const indexPath = `${folderPath}index.md`;
    const indexDoc = docsByPath.get(indexPath);
    const order = extractOrderFromName(folderName);
    let node: ParsedNode;
    if (indexDoc) {
      node = indexDoc.node;
      node.order = order;
      if (!node.name) node.name = displayNameFromFilename(folderName);
    } else {
      node = {
        name: displayNameFromFilename(folderName),
        col: null,
        iconName: null,
        iconFamily: null,
        content: "",
        metadata: null,
        order,
        children: [],
      };
    }
    // Children: leaf files (not index.md) + nested folders.
    const childNodes: ParsedNode[] = [];
    for (const f of folder.childFiles) {
      if (f.name.toLowerCase() === "index.md") continue;
      const doc = docsByPath.get(f.path);
      if (doc) childNodes.push(doc.node);
    }
    for (const sub of folder.childFolders) {
      const subPath = `${folderPath}${sub}/`;
      childNodes.push(buildNodeForFolder(subPath, sub));
    }
    childNodes.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    node.children = childNodes;
    return node;
  };

  // Top level: leaf .md files (excluding `logbook.yaml`/non-md) plus top folders.
  const root = ensure("");
  const topNodes: ParsedNode[] = [];
  for (const f of root.childFiles) {
    const doc = docsByPath.get(f.path);
    if (doc) topNodes.push(doc.node);
  }
  for (const sub of root.childFolders) {
    topNodes.push(buildNodeForFolder(`${sub}/`, sub));
  }
  topNodes.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return topNodes;
}

async function readLogbookManifest(zip: JSZip): Promise<{ name: string }> {
  const f = zip.file("logbook.yaml") ?? zip.file("logbook.yml");
  if (!f) return { name: "Imported logbook" };
  const text = await f.async("string");
  const data = parseYaml(text);
  const name =
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    typeof (data as Record<string, unknown>).name === "string"
      ? ((data as Record<string, unknown>).name as string)
      : "Imported logbook";
  return { name };
}

/**
 * Persist a parsed forest as Entry rows under `logbook`, returning nothing.
 * Sibling order is derived from each node's `order` (the numeric filename
 * prefix); we densely renumber so siblings end up at 0..n-1 regardless of
 * the gaps left by the prefixes (and ties fall back to traversal order).
 */
async function persistForest(
  em: import("@mikro-orm/sqlite").EntityManager,
  logbook: Logbook,
  forest: ParsedNode[],
) {
  const walk = async (nodes: ParsedNode[], parent: Entry | null) => {
    nodes.sort((a, b) => a.order - b.order);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const col = parent ? parent.col - 1 : (node.col ?? 0);
      const entry = em.create(Entry, {
        name: node.name,
        slug: slugify(node.name),
        col,
        order: i,
        content: node.content || null,
        metadata: node.metadata,
        iconName: node.iconName,
        iconFamily: node.iconFamily,
        logbook,
        parent: parent ?? null,
      });
      em.persist(entry);
      if (node.children.length > 0) {
        // Flush so the new entry has an id available for child parent refs.
        await em.flush();
        await walk(node.children, entry);
      }
    }
  };
  await walk(forest, null);
  await em.flush();
}

/** Consume a `ReadableStream<Uint8Array>` (what `octetInputParser` produces)
 *  into a single Buffer. JSZip wants the whole archive in memory anyway. */
async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// ── Procedures ─────────────────────────────────────────────────────────

/**
 * Result of `export`. The bytes ride through superjson as a typed-array
 * annotation (it has built-in `Uint8Array` support), so the client gets back
 * a real `Uint8Array` and can wrap it in a `Blob` for the download.
 */
export type LogbookExport = {
  filename: string;
  data: Uint8Array;
};

export const exportImportRouter = router({
  export: logbookProcedure.query(async ({ ctx }): Promise<LogbookExport> => {
    const data = await buildLogbookZip(ctx.em, ctx.logbook);
    return {
      filename: `${ctx.logbook.slug || "logbook"}.zip`,
      data,
    };
  }),

  // Open to any visitor — like `logbook.create`, this mints a brand-new logbook
  // and returns the freshly-issued token alongside it. `octetInputParser`
  // accepts `Blob | File | Uint8Array` from the client and hands us a
  // `ReadableStream` on the server.
  import: publicAuthoringProcedure
    .input(octetInputParser)
    .mutation(async ({ ctx, input }): Promise<CreatedLogbook> => {
      const buffer = await streamToBuffer(input);
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(buffer);
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid ZIP archive" });
      }

      const manifest = await readLogbookManifest(zip);
      const forest = await readForestFromZip(zip);

      const name = manifest.name.trim() || "Imported logbook";
      const lb = ctx.em.create(Logbook, {
        name,
        slug: slugify(name),
        columns: [],
      });
      ctx.em.persist(lb);
      await ctx.em.flush();
      await persistForest(ctx.em, lb, forest);
      const token = await issueTokenForLogbook(ctx.em, lb);
      return { logbook: toLogbookDetail(lb), token };
    }),
});
