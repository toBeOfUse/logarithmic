import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import { v4 as uuidv4 } from "uuid";
import { User } from "./User.ts";
import { Entry } from "./Entry.ts";

const LogbookSchema = defineEntity({
  name: "Logbook",
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => uuidv4()),
    name: p.string(),
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
