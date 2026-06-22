import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import slugify from "@sindresorhus/slugify";
import { customAlphabet } from "nanoid";

import { Entry } from "./Entry.ts";

/**
 * 10-character alphanumeric id. The default nanoid alphabet includes `-` and
 * `_`, but the frontend parses `${id}-${slug}` route segments by splitting on
 * the first `-`, so a dash inside the id would corrupt parsing. Restricting
 * to A–Za–z0–9 keeps the boundary unambiguous.
 */
const newId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 10);

/**
 * Per-column presentation for the org view, persisted on the logbook so a user's
 * column names and widths survive reloads. `col` is the (possibly negative)
 * column number, `name` its display label (an empty string means "use the
 * default `Column N`", decided on the frontend), and `wide` whether it renders
 * at the wide body width or the narrow column width. Stored as an embedded array
 * (always JSON) rather than its own table — it's a small, always-loaded-together
 * bag of settings, never queried on its own.
 */
const ColumnSettingSchema = defineEntity({
  name: "ColumnSetting",
  embeddable: true,
  properties: {
    col: p.integer(),
    name: p.string(),
    wide: p.boolean(),
  },
});

export class ColumnSetting extends ColumnSettingSchema.class {}
ColumnSettingSchema.setClass(ColumnSetting);

export type IColumnSetting = InferEntity<typeof ColumnSetting>;

const LogbookSchema = defineEntity({
  name: "Logbook",
  properties: {
    id: p
      .string()
      .primary()
      .onCreate(() => newId()),
    name: p.string(),
    /**
     * URL-safe decorative slug derived from `name`. Not unique; only used to
     * prettify route parameters on the frontend. The ID is the source of truth.
     */
    slug: p
      .string()
      .onCreate((lb) => slugify(lb.name))
      .onUpdate((lb) => slugify(lb.name)),
    /** Org-view column presentation (names + widths). Nullable so the column can
     *  be added to logbooks that predate it (SQLite can't add a NOT NULL column
     *  to existing rows); null is read as "no customizations" — see
     *  `toLogbookDetail`, which normalizes it to an empty array. */
    columns: () => p.embedded(ColumnSetting).array().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
    entries: () => p.oneToMany(Entry).mappedBy("logbook"),
  },
});

export class Logbook extends LogbookSchema.class {}
LogbookSchema.setClass(Logbook);

export type ILogbook = InferEntity<typeof Logbook>;
