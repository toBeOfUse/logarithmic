import { randomUUID } from "node:crypto";
import { defineEntity, p } from "@mikro-orm/core";
import { Leaflet } from "./Leaflet.js";
import { MetadataTemplate } from "./MetadataTemplate.js";
import { User } from "./User.js";

const WorkspaceSchema = defineEntity({
  name: "Workspace",
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    name: p.string(),
    owner: () => p.manyToOne(User).ref(),
    leaflets: () => p.oneToMany(Leaflet).mappedBy("workspace"),
    metadataTemplates: () => p.oneToMany(MetadataTemplate).mappedBy("workspace"),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
});

export class Workspace extends WorkspaceSchema.class {}
WorkspaceSchema.setClass(Workspace);
