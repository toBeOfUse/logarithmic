import { defineConfig } from "@mikro-orm/sqlite";
import { ColumnSetting, Logbook } from "./entities/Logbook.ts";
import { LogbookToken } from "./entities/LogbookToken.ts";
import { Entry } from "./entities/Entry.ts";
import { Image } from "./entities/Image.ts";

export default defineConfig({
  dbName: process.env.DB_PATH ?? "./data/logarithmic.db",
  entities: [Logbook, ColumnSetting, LogbookToken, Entry, Image],
  // SQL query logging: on in local dev, off in production and during tests
  // (where it would flood the test reporter).
  debug: process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test",
});
