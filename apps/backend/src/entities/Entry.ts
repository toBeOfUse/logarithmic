import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import slugify from "@sindresorhus/slugify";
import { countWords } from "logarithmic-content/word-count";

import { Logbook } from "./Logbook.ts";

/**
 * Metadata values per spec/1-core-data-model.md: a string, a sequence of
 * strings, or null.
 */
export type MetadataValue = string | string[] | null;
export type Metadata = Record<string, MetadataValue>;

const EntrySchema = defineEntity({
  name: "Entry",
  properties: {
    /**
     * Auto-increment integer primary key. The frontend embeds the id verbatim
     * into route segments as `${id}-${slug}`, parsed on the first hyphen —
     * sequential integers contain no dashes, so the boundary is unambiguous.
     */
    id: p.integer().primary(),
    name: p.string(),
    /**
     * URL-safe decorative slug derived from `name`. Not unique; only used to
     * prettify route parameters on the frontend. The ID is the source of truth.
     */
    slug: p
      .string()
      .onCreate((e) => slugify(e.name))
      .onUpdate((e) => slugify(e.name)),
    col: p.integer().default(0),
    /**
     * Integer rank among siblings (or among root entries when parent is null).
     * Lower values come first; not exposed via the API since responses already
     * arrive as ordered JSON arrays.
     */
    order: p.integer().default(0),
    /**
     * Legacy Markdown body from the previous editor. Retained so a later step
     * can convert it to `contentJson` on a best-effort basis; no longer read by
     * the app. New content is written to `contentJson`.
     */
    content: p.string().nullable(),
    /**
     * The rich text body as the JSON the frontend editor (Lexical) serializes,
     * stored as a string. The `content` package understands this shape; the
     * backend treats it as opaque apart from deriving `wordCount` below.
     */
    contentJson: p.string().nullable(),
    /**
     * Cached word count of `contentJson`, kept as the source of truth for the
     * frontend so it never recomputes live. Derived here at persist time (same
     * onCreate/onUpdate pattern as `slug`) so it stays in lockstep with whatever
     * the content ends up being — including imports and any other write path.
     */
    wordCount: p
      .integer()
      .default(0)
      .onCreate((e) => countWords(e.contentJson))
      .onUpdate((e) => countWords(e.contentJson)),
    metadata: p.json<Metadata>().nullable(),
    /**
     * User-selectable icon for the entry, stored as two parts so the icon
     * library is explicit rather than baked into the stored string: `iconName`
     * is the icon's identifier within its family (e.g. "star-line") and
     * `iconFamily` names the library it comes from (currently always "remix").
     * Both are null until the user picks an icon; the frontend renders a
     * default icon in that case.
     */
    iconName: p.string().nullable(),
    iconFamily: p.string().nullable(),
    logbook: () => p.manyToOne(Logbook),
    parent: () => p.manyToOne(Entry).nullable(),
    children: () => p.oneToMany(Entry).mappedBy("parent"),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
});

export class Entry extends EntrySchema.class {}
EntrySchema.setClass(Entry);

export type IEntry = InferEntity<typeof Entry>;
