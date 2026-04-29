/**
 * API model types — derived from MikroORM entity DTOs (see spec/2-backend.md).
 *
 * These are the shapes the frontend consumes through tRPC. They are built from
 * the entity types using `Pick<>` so we maintain a single source of truth for
 * field shapes; only relations are flattened to IDs as appropriate.
 */
import type { IUser } from "./entities/User.ts";
import type { ILogbook } from "./entities/Logbook.ts";
import type { IEntry, Metadata } from "./entities/Entry.ts";

export type { Metadata, MetadataValue } from "./entities/Entry.ts";

// ── Logbooks ─────────────────────────────────────────────────────────────

/**
 * Used by the splash screen's "your logbooks" list. Counts the entries inside
 * the logbook so we can render "142 entries · edited 2m ago" without paying
 * for the full entry list.
 */
export type LogbookSummary = Pick<ILogbook, "id" | "name" | "updatedAt"> & {
  entryCount: number;
};

export type LogbookDetail = Pick<ILogbook, "id" | "name" | "createdAt" | "updatedAt"> & {
  ownerId: IUser["id"];
};

export type CreateLogbookInput = {
  name: string;
};

// ── Entries (organizational view) ────────────────────────────────────────

/**
 * Used by the organizational view, which renders every entry in a logbook as
 * a node in a tree. Excludes `content` and `metadata` so we never download
 * full bodies for an overview.
 */
export type EntryNode = Pick<IEntry, "id" | "name" | "col" | "createdAt" | "updatedAt"> & {
  parentId: IEntry["id"] | null;
  hasContent: boolean;
  metadataKeys: string[];
};

export type LogbookOverview = {
  logbook: LogbookDetail;
  entries: EntryNode[];
};

// ── Entries (content view) ───────────────────────────────────────────────

/**
 * The full entry payload for the content view. Includes content + metadata,
 * plus a flattened list of ancestor IDs/names for the breadcrumb and a
 * lightweight list of children for the "Children" section.
 */
export type EntryDetail = Pick<IEntry, "id" | "name" | "col" | "createdAt" | "updatedAt"> & {
  // Override nullable fields so the API type is exact-shape (non-optional).
  content: string | null;
  metadata: Metadata | null;
  logbookId: ILogbook["id"];
  parentId: IEntry["id"] | null;
  ancestors: ReadonlyArray<Pick<IEntry, "id" | "name">>;
  children: ReadonlyArray<EntryChildSummary>;
};

export type EntryChildSummary = Pick<IEntry, "id" | "name" | "col"> & {
  metadata: Metadata | null;
};

// ── Mutations ────────────────────────────────────────────────────────────

export type CreateEntryInput = {
  logbookId: ILogbook["id"];
  name: string;
  col?: number;
  parentId?: IEntry["id"] | null;
};

export type RenameEntryInput = {
  id: IEntry["id"];
  name: string;
};

/** Update just the rich-text content; common enough to have its own endpoint. */
export type UpdateEntryContentInput = {
  id: IEntry["id"];
  content: string;
};

export type UpdateEntryMetadataInput = {
  id: IEntry["id"];
  metadata: Metadata;
};

export type MoveEntryInput = {
  id: IEntry["id"];
  parentId: IEntry["id"] | null;
  col: number;
};

export type DeleteEntryInput = {
  id: IEntry["id"];
};
