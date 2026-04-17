import { randomUUID } from "node:crypto";
import { defineEntity, p } from "@mikro-orm/core";
import { MetadataEntry } from "./MetadataEntry.js";
import { Workspace } from "./Workspace.js";

const LeafletSchema = defineEntity({
  name: "Leaflet",
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    name: p.string(),
    position: p.integer().default(0),
    content: p.text().nullable(),
    workspace: () => p.manyToOne(Workspace).ref(),
    parent: () => p.manyToOne(Leaflet).ref().nullable(),
    children: () => p.oneToMany(Leaflet).mappedBy("parent"),
    metadata: () => p.oneToMany(MetadataEntry).mappedBy("leaflet"),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
});

export class Leaflet extends LeafletSchema.class {}
LeafletSchema.setClass(Leaflet);
