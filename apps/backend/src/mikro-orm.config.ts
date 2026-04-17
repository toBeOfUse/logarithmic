import { defineConfig } from "@mikro-orm/sqlite";
import { Leaflet } from "./entities/Leaflet.js";
import { MetadataEntry } from "./entities/MetadataEntry.js";
import { MetadataTemplate } from "./entities/MetadataTemplate.js";
import { User } from "./entities/User.js";
import { Workspace } from "./entities/Workspace.js";

export default defineConfig({
  dbName: "./data/downdraft.db",
  entities: [Leaflet, MetadataEntry, MetadataTemplate, User, Workspace],
  debug: process.env["NODE_ENV"] === "development",
});
