import { defineConfig } from "@mikro-orm/sqlite";
import { User } from "./entities/User.ts";
import { Logbook } from "./entities/Logbook.ts";
import { Entry } from "./entities/Entry.ts";
import { MetadataTemplate } from "./entities/MetadataTemplate.ts";

export default defineConfig({
  dbName: process.env.DB_PATH ?? "./data/logarithmic.db",
  entities: [User, Logbook, Entry, MetadataTemplate],
  debug: process.env.NODE_ENV !== "production",
});
