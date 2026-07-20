/**
 * `ImageBox` — the storage boundary for uploaded image files (spec/2-backend.md
 * → "Images"). Everything that stores or serves image bytes goes through this
 * singleton so the persistence mechanism can later be swapped (e.g. for
 * bucket-based object storage) without touching the upload procedure or the
 * serving route.
 *
 * `get` hands back a **stream**, not a fully-read buffer, so the serving route
 * can pipe bytes straight to the client as they arrive. That matters for a
 * future object-store backend: an S3 `GetObject` body is itself a stream, so it
 * flows storage → app → client without the app ever holding the whole object in
 * memory (returning a Buffer would force a full download before the first byte
 * went out). `put` still takes a Buffer — an upload already has the full bytes in
 * memory (they're needed for `image-meta` detection), and images are ≤10 MB.
 *
 * A backend that can hand the client a direct URL (a presigned object-store URL
 * or a CDN edge) could add an optional `redirectUrl(id)` here and the serving
 * route could 302 to it, skipping the byte proxy entirely. Not implemented: this
 * isn't a publishing platform, so image reads don't need to scale that far.
 *
 * The initial implementation keeps files on the local disk, one file per image
 * keyed by the image's random id. The files are fanned out across two levels of
 * subdirectories named for the first two characters of the id
 * (`<root>/<id[0]>/<id[1]>/<id>`) so that no single directory accumulates enough
 * entries to hit file-system performance cliffs (spec/2-backend.md → "Images").
 * Image ids are lowercase alphanumeric (see `Image.id`), so this layout is
 * stable on case-insensitive file systems. No extension is used — the MIME type
 * lives in the database row, and the id is already unique.
 */
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

/** An image's bytes as a stream, plus its length when the backend knows it
 *  cheaply (for a `Content-Length` header). */
export interface StoredImage {
  stream: Readable;
  contentLength?: number;
}

export interface ImageStore {
  /** Persist an image's bytes under its id. Overwrites are not expected — ids
   *  are freshly minted per upload — but would be idempotent. */
  put(id: string, data: Buffer): Promise<void>;
  /** Open an image's bytes for reading, or null if no object exists for the id. */
  get(id: string): Promise<StoredImage | null>;
}

/**
 * Validate an image id and derive its on-disk path. Real ids are lowercase
 * alphanumeric and at least two characters (see `Image.id`); rejecting anything
 * else is defense in depth for the serving route, whose `:id` comes straight off
 * the URL, and the lowercase restriction is what keeps the path stable on
 * case-insensitive file systems.
 *
 * The id is fanned out over two single-character directory levels
 * (`<root>/<id[0]>/<id[1]>/<id>`) so no one directory fills up. `slice` rather
 * than indexing because it always yields a `string` under
 * `noUncheckedIndexedAccess`, and the `{2,}` guard means both slices are
 * non-empty.
 */
function idToPath(dir: string, id: string): string {
  if (!/^[a-z0-9]{2,}$/.test(id)) throw new Error(`Invalid image id: ${id}`);
  return path.join(dir, id.slice(0, 1), id.slice(1, 2), id);
}

export class LocalImageBox implements ImageStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async put(id: string, data: Buffer): Promise<void> {
    const file = idToPath(this.dir, id);
    // The leaf directory depends on the id, so it's created per write; `mkdir`
    // with `recursive` is idempotent and builds both fan-out levels at once.
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async get(id: string): Promise<StoredImage | null> {
    const file = idToPath(this.dir, id);
    try {
      // stat first so a missing file is a clean null rather than a stream that
      // errors mid-flight; the read stream then pipes lazily and self-closes.
      const { size } = await stat(file);
      return { stream: createReadStream(file), contentLength: size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

let instance: ImageStore | null = null;

/**
 * The process-wide image store. Local-disk-backed by default, rooted at
 * `IMAGES_PATH` (defaulting to `./data/images`, alongside the SQLite file).
 */
export function getImageBox(): ImageStore {
  if (!instance) {
    instance = new LocalImageBox(process.env.IMAGES_PATH ?? path.join("./data", "images"));
  }
  return instance;
}
