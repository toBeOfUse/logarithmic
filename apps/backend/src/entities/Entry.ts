import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import slugify from "@sindresorhus/slugify";

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
    content: p.string().nullable(),
    metadata: p.json<Metadata>().nullable(),
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
