/**
 * One-off migration: best-effort populate `contentJson` from the legacy
 * Markdown `content` (the step spec/1-core-data-model.md anticipated).
 *
 * - Idempotent: skips entries that already have `contentJson`.
 * - Preserves `updatedAt`: writes via `nativeUpdate`, bypassing entity hooks,
 *   and sets `wordCount` explicitly from the new content.
 *
 * Run from `apps/backend`, pointing DB_PATH at the target database, e.g.:
 *   NODE_ENV=production DB_PATH=./data/logarithmic.slate.db \
 *     vp exec tsx scripts/migrate-markdown-to-content.ts
 */
import { MikroORM } from "@mikro-orm/sqlite";
import { markdownToContent } from "logarithmic-content/markdown";
import { countWords } from "logarithmic-content/word-count";

import { Entry } from "../src/entities/Entry.ts";
import config from "../src/mikro-orm.config.ts";

const orm = await MikroORM.init(config);
try {
  console.log(`Database: ${config.dbName}`);
  // The `content_json` column is added on backend boot; ensure it exists here
  // too so the migration can run before the new server has touched this DB.
  await orm.schema.update();

  const em = orm.em.fork();
  const entries = await em.find(Entry, {});
  let migrated = 0;
  let skipped = 0;
  for (const e of entries) {
    if (e.contentJson != null) {
      skipped++;
      continue;
    }
    const markdown = e.content ?? "";
    if (!markdown.trim()) {
      skipped++;
      continue;
    }
    const contentJson = markdownToContent(markdown);
    const wordCount = countWords(contentJson);
    await em.nativeUpdate(Entry, { id: e.id }, { contentJson, wordCount });
    migrated++;
    console.log(`  #${e.id} ${JSON.stringify(e.name)} → ${wordCount} words`);
  }
  console.log(`\nDone: migrated ${migrated}, skipped ${skipped} (of ${entries.length}).`);
} finally {
  await orm.close(true);
}
