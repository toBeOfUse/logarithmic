import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import { v4 as uuidv4 } from "uuid";
import { Logbook } from "./Logbook.ts";

/**
 * Per spec/1-core-data-model.md: metadata templates may be scoped to a logbook
 * or universal (logbook == null = a seed template, immutable to users).
 * Possible value types match the metadata model: text, multi-text, or empty.
 */
export type MetadataTemplateField =
  | { key: string; type: "text" }
  | { key: string; type: "multi-text" }
  | { key: string; type: "empty" };

const MetadataTemplateSchema = defineEntity({
  name: "MetadataTemplate",
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => uuidv4()),
    name: p.string(),
    logbook: () => p.manyToOne(Logbook).nullable(),
    fields: p.json<MetadataTemplateField[]>(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
});

export class MetadataTemplate extends MetadataTemplateSchema.class {}
MetadataTemplateSchema.setClass(MetadataTemplate);

export type IMetadataTemplate = InferEntity<typeof MetadataTemplate>;
