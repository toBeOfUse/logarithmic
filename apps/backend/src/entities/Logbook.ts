import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import { newId } from "logarithmic-config/ids";
import { slugify } from "logarithmic-config/slug";
import { User } from "./User.ts";
import { Entry } from "./Entry.ts";

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
    slug: p.string().onCreate((lb) => slugify(lb.name)),
    owner: () => p.manyToOne(User),
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
