import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import { customAlphabet } from "nanoid";

import { Entry } from "./Entry.ts";

/**
 * 21-character id drawn from lowercase letters and digits. This id is the
 * unguessable secret that gates access to an image: the serving route is
 * `/api/images/<id>/<filename>` with no further auth (spec/2-backend.md →
 * "Images"), so the id must be long and random enough that it can't be
 * enumerated — 21 characters of a 36-symbol alphabet is ~108 bits.
 *
 * Lowercase-only, unlike the mixed-case alphabet a logbook id uses, so that it
 * can be used in case-insensitive contexts like file paths on certain OSes.
 */
const newImageId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 21);

/**
 * An image uploaded for use in an entry's rich text content. The stored file
 * itself lives behind `ImageBox` (see `../images/image-box.ts`); this row is the
 * metadata the app needs to serve it and to (eventually) garbage-collect it.
 *
 * `entry` records the entry an image was *uploaded for*, not the set of entries
 * using it. Copying an image from one entry to another reuses the same stored
 * file, so any number of entries may reference this row (spec/2-backend.md →
 * "Images"). The link earns its keep as provenance, and because requiring a real
 * entry in an editable logbook makes the upload endpoint awkward to abuse as
 * free image hosting.
 *
 * It is therefore nullable with `ON DELETE SET NULL` rather than a cascade:
 * deleting the uploading entry must not drop the row, both because the stored
 * *file* would have to be tracked down and removed too and because other entries
 * may still be using it.
 *
 * Note for whoever writes the eventual sweep (see the TODO in spec/2-backend.md):
 * `entry = null` does NOT mean collectable. The only safe test is that the image's
 * id appears in no entry's content — plus a grace period, so cutting an image and
 * pasting it later, or undoing a deletion, doesn't race the collector.
 */
const ImageSchema = defineEntity({
  name: "Image",
  properties: {
    id: p
      .string()
      .primary()
      .onCreate(() => newImageId()),
    /** Detected MIME type, e.g. `image/png` (see the allow-list in image-api). */
    mimeType: p.string(),
    /** Intrinsic pixel dimensions, detected with `image-meta` at upload time. */
    width: p.integer(),
    height: p.integer(),
    /** The filename the user's file had when uploaded (may be empty). */
    originalFilename: p.string(),
    /**
     * A url-safe slug of `originalFilename`, falling back to `image` when there's
     * nothing usable. Purely decorative in the serving URL (the id is the source
     * of truth), like an entry's slug.
     */
    urlSafeName: p.string(),
    entry: () => p.manyToOne(Entry).nullable().deleteRule("set null"),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});

export class Image extends ImageSchema.class {}
ImageSchema.setClass(Image);

export type IImage = InferEntity<typeof Image>;
