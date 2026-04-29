import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import { v4 as uuidv4 } from "uuid";
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
    id: p
      .uuid()
      .primary()
      .onCreate(() => uuidv4()),
    name: p.string(),
    col: p.integer().default(0),
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
