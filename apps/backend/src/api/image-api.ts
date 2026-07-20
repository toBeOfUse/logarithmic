/**
 * Image upload tRPC procedures (spec/2-backend.md → "Images").
 *
 * `image.upload` takes a user-picked file as multipart form data; because a
 * `FormData` can't ride the JSON `logbookProcedure` gate, it reproduces that gate
 * inline (read `logbookId` from the form, resolve the bearer token, require a
 * match). `image.uploadFromUrl` takes a URL the server fetches itself — a
 * cross-origin `<img>` pasted from a web page — so those bytes never round-trip
 * through the browser; it rides the ordinary JSON `logbookProcedure`.
 *
 * Both independently confirm the target entry lives in the authorized logbook,
 * then funnel into `storeImageBytes`: the one place type and dimensions are
 * detected from the bytes with `image-meta` (not the client's claim), only
 * JPEG/PNG/GIF/WEBP up to 10 MB are accepted, and a row is created and returned so
 * the frontend can reference the image in the entry's content.
 */
import { TRPCError } from "@trpc/server";
import slugify from "@sindresorhus/slugify";
import type { EntityManager } from "@mikro-orm/sqlite";
import { imageMeta } from "image-meta";
import { z } from "zod";
import { zfd } from "zod-form-data";

import type { ImageDetail } from "./api-types.ts";
import { Entry } from "../entities/Entry.ts";
import { Image } from "../entities/Image.ts";
import { fetchRemoteImage, RemoteImageError } from "../images/fetch-remote-image.ts";
import { getImageBox } from "../images/image-box.ts";
import { logbookProcedure, publicProcedure, router } from "../trpc.ts";
import { resolveLogbookForToken } from "../tokens.ts";
import path from "node:path";

/** 10 MB, per spec. Enforced on the decoded bytes, not a client-declared size.
 *  A request body big enough to hold more than this is refused while it streams,
 *  before it is ever buffered — see the multipart parser in `../app.ts`. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FILENAME_MAX = 256;

/**
 * The formats we accept, keyed by `image-meta`'s detected type — the MIME type
 * we store and serve, plus the canonical extension for the served URL.
 * `image-meta` reports JPEG as `jpg` and detects from the actual bytes, so this
 * is the authoritative type, not the upload's declared content type.
 *
 * A `Map` rather than an object literal because the lookup key comes from
 * `image-meta` and can be anything: `get` is honestly typed `| undefined`,
 * whereas indexing a `Record<string, string>` claims a hit for every key and
 * quietly makes the rejection below look dead.
 */
const ACCEPTED_FORMATS = new Map<string, { mimeType: string; extension: string }>([
  ["jpg", { mimeType: "image/jpeg", extension: "jpg" }],
  ["png", { mimeType: "image/png", extension: "png" }],
  ["gif", { mimeType: "image/gif", extension: "gif" }],
  ["webp", { mimeType: "image/webp", extension: "webp" }],
]);

const uploadInput = zfd.formData({
  image: zfd.file(),
  logbookId: zfd.text(z.string().min(1)),
  entryId: zfd.numeric(z.number().int().positive()),
  // The user's original filename. Optional — we fall back to the File's own
  // name, then to a generic slug, so a nameless blob still gets a usable URL.
  originalFilename: zfd.text(z.string().max(FILENAME_MAX).optional()),
});

/** Characters we will accept in a URL: alphanumerics, plus periods,
 * underscores, dashes */
const URL_SAFE_STEM = /^[A-Za-z0-9._-]+$/;

/**
 * The decorative filename segment of the serving URL, built from the name the
 * user uploaded and falling back to `image` when there's nothing usable.
 *
 * Two things it deliberately does not do. It doesn't slugify a name that was
 * already URL-safe — `report_v2` should stay `report_v2` rather than becoming
 * `report-v2`, since the whole point of the segment is that the user recognises
 * their own file. And it doesn't drop the extension: browsers derive the "Save
 * image as…" filename from the last path segment, so an extensionless name gives
 * the user a file their OS can't type-associate.
 *
 * The extension comes from the type `image-meta` detected in the bytes, never
 * from the uploaded name — the server knows the real type, and the client's
 * claim about it has already been discarded by this point.
 */
function toUrlSafeName(filename: string, extension: string): string {
  const stem = path.parse(filename).name;
  // A stem of only punctuation (`.`, `..`) is technically URL-safe but reads as
  // a broken filename, so it falls back like an empty one.
  const usable = URL_SAFE_STEM.test(stem) && /[A-Za-z0-9]/.test(stem) ? stem : slugify(stem);
  return `${usable || "image"}.${extension}`;
}

function toImageDetail(image: Image): ImageDetail {
  return {
    id: image.id,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    originalFilename: image.originalFilename,
    urlSafeName: image.urlSafeName,
    createdAt: image.createdAt,
    entryId: image.entry?.id ?? null,
  };
}

/** The entry the image is being attached to, confirmed to live in the authorized
 *  logbook — a token for logbook A must not attach images to an entry in B. */
async function requireEntry(em: EntityManager, entryId: number, logbookId: string): Promise<Entry> {
  const entry = await em.findOne(Entry, { id: entryId, logbook: logbookId });
  if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });
  return entry;
}

/**
 * Validate decoded image bytes, store them, and return the created row's detail.
 * The single place an image becomes a stored `Image`, whatever the source:
 * `image.upload` (a multipart file) and `image.uploadFromUrl` (bytes the server
 * fetched) both end here, so type/size/dimension enforcement and the store +
 * rollback live in one spot.
 */
async function parseAndPersistImage(
  em: EntityManager,
  args: { bytes: Buffer; entry: Entry; originalFilename: string },
): Promise<ImageDetail> {
  const { bytes, entry } = args;
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Image exceeds 10 MB limit" });
  }

  let meta: ReturnType<typeof imageMeta>;
  try {
    meta = imageMeta(bytes);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unrecognized image file" });
  }
  const format = meta.type ? ACCEPTED_FORMATS.get(meta.type) : undefined;
  if (!format) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unsupported image type — only JPEG, PNG, GIF, and WEBP are allowed",
    });
  }
  // `image-meta` reports 0 for a file whose header it recognises but whose
  // dimensions it can't read, so this has to be `> 0` rather than a mere presence
  // check: a 0×0 image would store fine and then break the layout of every entry
  // embedding it.
  const { width, height } = meta;
  if (!width || !height || width <= 0 || height <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Image has no usable dimensions" });
  }

  const originalFilename = args.originalFilename.slice(0, FILENAME_MAX);
  const image = em.create(Image, {
    mimeType: format.mimeType,
    width,
    height,
    originalFilename,
    urlSafeName: toUrlSafeName(originalFilename, format.extension),
    entry,
  });
  em.persist(image);
  await em.flush();

  // Store the bytes only after the row exists (so the id is assigned). If storage
  // fails, roll the row back so we never keep a row pointing at a file that isn't
  // there.
  try {
    await getImageBox().put(image.id, bytes);
  } catch (err) {
    em.remove(image);
    await em.flush();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to store image",
      cause: err,
    });
  }

  return toImageDetail(image);
}

/** The decorative filename for an image fetched from a URL: its last path
 *  segment, or empty (which `toUrlSafeName` turns into `image`). */
function filenameFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
}

/** Map a `RemoteImageError`'s status onto the nearest tRPC error code. */
function remoteErrorCode(
  status: number,
): "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "BAD_REQUEST" {
  if (status === 413) return "PAYLOAD_TOO_LARGE";
  if (status === 415) return "UNSUPPORTED_MEDIA_TYPE";
  return "BAD_REQUEST";
}

export const imageRouter = router({
  upload: publicProcedure
    .input(uploadInput)
    .use(async ({ ctx, input, next }) => {
      // Same NOT_FOUND-on-any-failure gate as `logbookProcedure`, but keyed off
      // the `logbookId` carried in the form data.
      if (!ctx.bearerToken)
        throw new TRPCError({ code: "NOT_FOUND", message: "Logbook not found" });
      const logbook = await resolveLogbookForToken(ctx.em, ctx.bearerToken);
      if (!logbook || logbook.id !== input.logbookId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Logbook not found" });
      }
      return next({ ctx: { ...ctx, logbook } });
    })
    .mutation(async ({ ctx, input }): Promise<ImageDetail> => {
      const entry = await requireEntry(ctx.em, input.entryId, ctx.logbook.id);
      const bytes = Buffer.from(await input.image.arrayBuffer());
      return parseAndPersistImage(ctx.em, {
        bytes,
        entry,
        originalFilename: input.originalFilename ?? input.image.name ?? "",
      });
    }),

  /**
   * Store an image the server fetches from a URL, for a cross-origin `<img>`
   * pasted from a web page. The bytes are fetched and stored server-side, so they
   * never round-trip through the browser (and CORS never blocks the read). The
   * fetch is SSRF-fenced and connection-pinned — see `fetchRemoteImage`.
   * `allowPrivateAddresses` is only ever true under `NODE_ENV=test`, so a test can
   * point it at a loopback upstream while a real server never can.
   */
  uploadFromUrl: logbookProcedure
    .input(
      z.object({
        logbookId: z.string().min(1),
        entryId: z.number().int().positive(),
        // Prod requires a real domain host (rejects IP-literal/bare-host SSRF
        // targets). Under test we drop only the hostname rule — keeping the
        // http(s) protocol check — so a test can point at the loopback upstream,
        // mirroring the `allowPrivateAddresses` carve-out below.
        url: process.env.NODE_ENV === "test" ? z.url({ protocol: /^https?$/ }) : z.httpUrl(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<ImageDetail> => {
      const entry = await requireEntry(ctx.em, input.entryId, ctx.logbook.id);
      let bytes: Buffer;
      try {
        ({ bytes } = await fetchRemoteImage(input.url, {
          maxBytes: MAX_IMAGE_BYTES,
          allowPrivateAddresses: process.env.NODE_ENV === "test",
        }));
      } catch (err) {
        if (err instanceof RemoteImageError) {
          throw new TRPCError({ code: remoteErrorCode(err.status), message: err.message });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: "Could not fetch that image" });
      }
      return parseAndPersistImage(ctx.em, {
        bytes,
        entry,
        originalFilename: filenameFromUrl(input.url),
      });
    }),
});
