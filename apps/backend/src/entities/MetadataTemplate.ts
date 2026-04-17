import { randomUUID } from "node:crypto";
import { defineEntity, p } from "@mikro-orm/core";
import { Workspace } from "./Workspace.js";

const MetadataTemplateSchema = defineEntity({
  name: "MetadataTemplate",
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    name: p.string(),
    workspace: () => p.manyToOne(Workspace).ref().nullable(),
    /**
     * Marks whether this is default template that ships with the application
     */
    isSeed: p.boolean().default(false),
    keys: p.json<string[]>(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
});

export class MetadataTemplate extends MetadataTemplateSchema.class {}
MetadataTemplateSchema.setClass(MetadataTemplate);
