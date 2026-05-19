/**
 * API model types — derived from MikroORM entity DTOs (see spec/2-backend.md).
 *
 * These are the shapes the frontend consumes through tRPC. They are built from
 * the entity types using `Pick<>` so we maintain a single source of truth for
 * field shapes; only relations are flattened to IDs as appropriate.
 */
import type { IUser } from "../entities/User.ts";
import type { ILogbook } from "../entities/Logbook.ts";
import type { IEntry, Metadata } from "../entities/Entry.ts";

export type { Metadata, MetadataValue } from "../entities/Entry.ts";

// ── Logbooks ─────────────────────────────────────────────────────────────

/**
 * Used by the splash screen's "your logbooks" list. Counts the entries inside
 * the logbook so we can render "142 entries · edited 2m ago" without paying
 * for the full entry list.
 */
export type LogbookSummary = Pick<ILogbook, "id" | "slug" | "name" | "updatedAt"> & {
  entryCount: number;
};

export type LogbookDetail = Pick<ILogbook, "id" | "slug" | "name" | "createdAt" | "updatedAt"> & {
  ownerId: IUser["id"];
};

export type CreateLogbookInput = {
  name: string;
};

// ── Entries (organizational view) ────────────────────────────────────────

/**
 * One node in the organizational-view tree. Children are nested inline so the
 * client can render the forest without separately reconstructing the
 * parent/child relationships from a flat list. Excludes `content` and
 * `metadata` so we never download full bodies for an overview.
 */
export type EntryNode = Pick<IEntry, "id" | "slug" | "name" | "col" | "createdAt" | "updatedAt"> & {
  hasContent: boolean;
  metadataKeys: string[];
  children: EntryNode[];
};

export type LogbookOverview = {
  logbook: LogbookDetail;
  /** The forest of roots in this logbook, each with their descendants nested. */
  entries: EntryNode[];
};

// ── Entries (content view) ───────────────────────────────────────────────

/**
 * The full entry payload for the content view. Includes content + metadata,
 * plus a flattened list of ancestor IDs/names for the breadcrumb and a
 * lightweight list of children for the "Children" section.
 */
export type EntryDetail = Pick<
  IEntry,
  "id" | "slug" | "name" | "col" | "createdAt" | "updatedAt"
> & {
  // Override nullable fields so the API type is exact-shape (non-optional).
  content: string | null;
  metadata: Metadata | null;
  logbookId: ILogbook["id"];
  parentId: IEntry["id"] | null;
  ancestors: ReadonlyArray<Pick<IEntry, "id" | "slug" | "name">>;
  children: ReadonlyArray<EntryChildSummary>;
};

export type EntryChildSummary = Pick<IEntry, "id" | "slug" | "name" | "col"> & {
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

/**
 * Move an entry under a new parent at a specific position. The server treats
 * `position` as an insertion index: any existing siblings at that position or
 * later shift down by one to make room, and the sibling list is then
 * renumbered densely. Spec invariant — a child's column equals its parent's
 * minus one — is enforced server-side when `parentId` is non-null. Root
 * entries (parentId == null) can sit in any column, so callers always supply
 * it explicitly.
 */
export type MoveEntryInput = {
  id: IEntry["id"];
  parentId: IEntry["id"] | null;
  col: number;
  position: number;
};

/**
 * Bulk-reorder all siblings under a single parent (or all roots, when
 * `parentId` is null). `ids` must be a permutation of the existing sibling
 * set — partial reorderings are rejected by the server.
 */
export type ReorderSiblingsInput = {
  logbookId: ILogbook["id"];
  parentId: IEntry["id"] | null;
  ids: IEntry["id"][];
};

export type DeleteEntryInput = {
  id: IEntry["id"];
};
