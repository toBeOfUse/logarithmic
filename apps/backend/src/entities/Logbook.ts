import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import slugify from "@sindresorhus/slugify";
import { customAlphabet } from "nanoid";

import { Entry } from "./Entry.ts";

/**
 * 10-character alphanumeric id. The default nanoid alphabet includes `-` and
 * `_`, but the frontend parses `${id}-${slug}` route segments by splitting on
 * the first `-`, so a dash inside the id would corrupt parsing. Restricting
 * to A–Za–z0–9 keeps the boundary unambiguous.
 */
const newId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 10);

const LogbookSchema = defineEntity({
  name: "Logbook",
  properties: {
    id: p
      .string()
      .primary()
      .onCreate(() => newId()),
    name: p.string(),
    /**
     * URL-safe decorative slug derived from `name`. Not unique; only used to
     * prettify route parameters on the frontend. The ID is the source of truth.
     */
    slug: p
      .string()
      .onCreate((lb) => slugify(lb.name))
      .onUpdate((lb) => slugify(lb.name)),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
    entries: () => p.oneToMany(Entry).mappedBy("logbook"),
  },
});

export class Logbook extends LogbookSchema.class {}
LogbookSchema.setClass(Logbook);

export type ILogbook = InferEntity<typeof Logbook>;
