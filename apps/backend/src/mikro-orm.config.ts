import { defineConfig } from "@mikro-orm/sqlite";
import { Logbook } from "./entities/Logbook.ts";
import { LogbookToken } from "./entities/LogbookToken.ts";
import { Entry } from "./entities/Entry.ts";

export default defineConfig({
  dbName: process.env.DB_PATH ?? "./data/logarithmic.db",
  entities: [Logbook, LogbookToken, Entry],
  debug: process.env.NODE_ENV !== "production",
});
