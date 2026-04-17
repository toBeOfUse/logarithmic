import { randomUUID } from "node:crypto";
import { defineEntity, p } from "@mikro-orm/core";
import { Leaflet } from "./Leaflet.js";

export type MetadataValue = string | string[] | null;

const MetadataEntrySchema = defineEntity({
  name: "MetadataEntry",
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    leaflet: () => p.manyToOne(Leaflet).ref(),
    key: p.string(),
    value: p.json<MetadataValue>().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
});

export class MetadataEntry extends MetadataEntrySchema.class {}
MetadataEntrySchema.setClass(MetadataEntry);
