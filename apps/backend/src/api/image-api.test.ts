/**
 * Image upload + serving, driven end-to-end over a real Fastify server with
 * `fetch`/a tRPC client — including the attacker-simulating access-control cases
 * the spec calls for (spec/2-backend.md). Covers the multipart plumbing (tRPC +
 * `zod-form-data`), `image-meta` type/size enforcement, the serving route's
 * headers, and every way an upload should be rejected.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import {
  createTRPCClient,
  httpLink,
  isNonJsonSerializable,
  splitLink,
  TRPCClientError,
  type TRPCClient,
} from "@trpc/client";
import superjson from "superjson";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppRouter } from "./api-router.ts";

// Real 1×1 files in each accepted format — `image-meta` reads the type and the
// dimensions out of each one's header.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG_1x1 = Buffer.from(
  "/9j/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);
const GIF_1x1 = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const WEBP_1x1 = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=", "base64");

// A well-formed file of a real format that is *not* on the allowlist. SVG is the
// one that matters: `image-meta` identifies it happily, and serving one from our
// own origin would be stored XSS if it ever slipped through.
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');

/** A PNG whose IHDR declares 0×0 — an accepted *type* carrying no usable
 *  dimensions (width lives at byte 16 of the header, height at byte 20). */
function zeroDimensionPng(): Buffer {
  const bytes = Buffer.from(PNG_1x1);
  bytes.writeUInt32BE(0, 16);
  bytes.writeUInt32BE(0, 20);
  return bytes;
}

let app: FastifyInstance;
let baseUrl: string;
let imagesDir: string;

/** Stands in for an external website, so `image.uploadFromUrl` has a real host to
 *  fetch from. Reachable over loopback only because the procedure runs its fetch
 *  with the address guard relaxed under `NODE_ENV=test`. */
let upstream: FastifyInstance;
let upstreamUrl: string;

/** A tRPC client that sends a fixed Authorization header, mirroring the frontend
 *  client's binary/JSON split so FormData uploads take the multipart path. */
function makeClient(token?: string): TRPCClient<AppRouter> {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const url = `${baseUrl}/api`;
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => isNonJsonSerializable(op.input),
        true: httpLink({
          url,
          headers: () => headers,
          transformer: { serialize: (d) => d, deserialize: (d) => superjson.deserialize(d) },
        }),
        false: httpLink({ url, headers: () => headers, transformer: superjson }),
      }),
    ],
  });
}

function imageFormData(opts: {
  logbookId: string;
  entryId: number;
  bytes?: Buffer;
  filename?: string;
  mime?: string;
}): FormData {
  const fd = new FormData();
  const bytes = opts.bytes ?? PNG_1x1;
  const filename = opts.filename ?? "photo.png";
  fd.set("image", new File([bytes], filename, { type: opts.mime ?? "image/png" }));
  fd.set("logbookId", opts.logbookId);
  fd.set("entryId", String(opts.entryId));
  fd.set("originalFilename", filename);
  return fd;
}

/**
 * POST at the upload endpoint with a valid token but a hand-rolled body, as an
 * attacker probing the size limit would.
 *
 * Deliberately not `fetch`. Refusing an oversized upload means answering and
 * hanging up while the client is still sending, and a client that is mid-write
 * when that happens gets a connection reset that discards the response it had
 * already received — `fetch` turns that into a thrown transport error, losing
 * the distinction between "refused" and "never answered". Here a reset simply
 * resolves with a null status, which is still a refusal.
 */
function attackerUpload(opts: {
  headers?: Record<string, string>;
  body?: Buffer | Readable;
}): Promise<{ status: number | null }> {
  return new Promise((resolve) => {
    const req = httpRequest(
      `${baseUrl}/api/image.upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "content-type": "multipart/form-data; boundary=----attacker",
          ...opts.headers,
        },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? null });
      },
    );
    req.on("error", () => resolve({ status: null }));
    if (opts.body === undefined) req.flushHeaders();
    else if (Buffer.isBuffer(opts.body)) req.end(opts.body);
    else opts.body.pipe(req);
  });
}

/** A chunked (Content-Length–free) body of `count` one-megabyte chunks, which
 *  reports how many of them it actually got to send. */
function megabyteChunks(count: number): { stream: Readable; sent: () => number } {
  let sent = 0;
  const stream = new Readable({
    read() {
      if (sent >= count) return this.push(null);
      sent++;
      this.push(Buffer.alloc(1024 * 1024, 1));
    },
  });
  return { stream, sent: () => sent };
}

/** Run an upload expected to reject, returning the tRPC error for inspection. */
async function uploadError(
  client: TRPCClient<AppRouter>,
  fd: FormData,
): Promise<TRPCClientError<AppRouter>> {
  try {
    await client.image.upload.mutate(fd);
  } catch (err) {
    if (err instanceof TRPCClientError) return err as TRPCClientError<AppRouter>;
    throw err;
  }
  throw new Error("Expected the upload to be rejected");
}

/** Run a `uploadFromUrl` expected to reject, returning the tRPC error. */
async function uploadFromUrlError(
  client: TRPCClient<AppRouter>,
  input: { logbookId: string; entryId: number; url: string },
): Promise<TRPCClientError<AppRouter>> {
  try {
    await client.image.uploadFromUrl.mutate(input);
  } catch (err) {
    if (err instanceof TRPCClientError) return err as TRPCClientError<AppRouter>;
    throw err;
  }
  throw new Error("Expected the upload to be rejected");
}

// Fixtures: two independent logbooks (A and B), each with one entry.
let tokenA: string;
let logbookA: string;
let entryA: number;
let tokenB: string;
let logbookB: string;
let entryB: number;

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  process.env.NODE_ENV = "test"; // ORM SQL debug is off under test (see mikro-orm.config)
  imagesDir = mkdtempSync(join(tmpdir(), "logarithmic-images-"));
  process.env.IMAGES_PATH = imagesDir;

  // Import after env is set so the ORM config + ImageBox pick up the temp paths.
  const { buildApp } = await import("../app.ts");
  app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const anon = makeClient();
  const a = await anon.logbook.create.mutate({ name: "Logbook A" });
  logbookA = a.logbook.id;
  tokenA = a.token;
  entryA = (await makeClient(tokenA).entry.create.mutate({ logbookId: logbookA, name: "Entry A" }))
    .id;

  const b = await anon.logbook.create.mutate({ name: "Logbook B" });
  logbookB = b.logbook.id;
  tokenB = b.token;
  entryB = (await makeClient(tokenB).entry.create.mutate({ logbookId: logbookB, name: "Entry B" }))
    .id;

  upstream = Fastify({ logger: false });
  upstream.get("/photo.png", async (_req, reply) => reply.type("image/png").send(PNG_1x1));
  upstream.get("/page.html", async (_req, reply) => reply.type("text/html").send("<p>hi</p>"));
  await upstream.listen({ port: 0, host: "127.0.0.1" });
  upstreamUrl = `http://127.0.0.1:${(upstream.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app?.close();
  await upstream?.close();
  if (imagesDir) rmSync(imagesDir, { recursive: true, force: true });
});

test("uploads an image and serves it back with the right bytes and headers", async () => {
  const detail = await makeClient(tokenA).image.upload.mutate(
    imageFormData({ logbookId: logbookA, entryId: entryA, filename: "My Photo.png" }),
  );

  // The row the frontend gets back, with type + dimensions detected server-side.
  expect(detail.mimeType).toBe("image/png");
  expect(detail.width).toBe(1);
  expect(detail.height).toBe(1);
  expect(detail.entryId).toBe(entryA);
  // A url-safe slug of the original filename, carrying the extension for the
  // type the server detected.
  expect(detail.urlSafeName).toBe("my-photo.png");

  const res = await fetch(`${baseUrl}/api/images/${detail.id}/${detail.urlSafeName}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("image/png");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("cache-control")).toContain("max-age");
  expect(res.headers.get("content-length")).toBe(String(PNG_1x1.length));
  const served = Buffer.from(await res.arrayBuffer());
  expect(served.equals(PNG_1x1)).toBe(true);
});

// Every accepted format, end to end: the type and dimensions are read from the
// bytes, and the URL carries that type's extension.
for (const format of [
  { label: "JPEG", bytes: JPEG_1x1, uploadedAs: "holiday.jpg", mimeType: "image/jpeg" },
  { label: "GIF", bytes: GIF_1x1, uploadedAs: "reaction.gif", mimeType: "image/gif" },
  { label: "WEBP", bytes: WEBP_1x1, uploadedAs: "banner.webp", mimeType: "image/webp" },
]) {
  test(`a ${format.label} upload is stored and served as ${format.mimeType}`, async () => {
    const detail = await makeClient(tokenA).image.upload.mutate(
      imageFormData({
        logbookId: logbookA,
        entryId: entryA,
        bytes: format.bytes,
        filename: format.uploadedAs,
        mime: format.mimeType,
      }),
    );
    expect(detail.mimeType).toBe(format.mimeType);
    expect(detail.width).toBe(1);
    expect(detail.height).toBe(1);
    expect(detail.urlSafeName).toBe(format.uploadedAs);

    const res = await fetch(`${baseUrl}/api/images/${detail.id}/${detail.urlSafeName}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(format.mimeType);
    expect(Buffer.from(await res.arrayBuffer()).equals(format.bytes)).toBe(true);
  });
}

test("a filename that is already url-safe is left exactly as the user had it", async () => {
  const detail = await makeClient(tokenA).image.upload.mutate(
    imageFormData({ logbookId: logbookA, entryId: entryA, filename: "report_v2.png" }),
  );
  // Not `report-v2`: slugifying a name that needed no slugifying only makes the
  // user's file harder to recognise.
  expect(detail.urlSafeName).toBe("report_v2.png");
  expect(detail.originalFilename).toBe("report_v2.png");
});

test("the served extension follows the detected type, not the name the client claimed", async () => {
  // PNG bytes wearing a JPEG name and content type.
  const detail = await makeClient(tokenA).image.upload.mutate(
    imageFormData({
      logbookId: logbookA,
      entryId: entryA,
      filename: "screenshot.jpg",
      mime: "image/jpeg",
    }),
  );
  expect(detail.mimeType).toBe("image/png");
  expect(detail.urlSafeName).toBe("screenshot.png");
});

test("an upload with no usable filename still gets a servable url", async () => {
  // Nothing survives slugifying, so the spec's `image` fallback has to carry it.
  const detail = await makeClient(tokenA).image.upload.mutate(
    imageFormData({ logbookId: logbookA, entryId: entryA, filename: "「」.png" }),
  );
  expect(detail.originalFilename).toBe("「」.png");
  expect(detail.urlSafeName).toBe("image.png");

  const res = await fetch(`${baseUrl}/api/images/${detail.id}/${detail.urlSafeName}`);
  expect(res.status).toBe(200);
});

test("serving a nonexistent image id 404s, and still refuses content sniffing", async () => {
  const res = await fetch(`${baseUrl}/api/images/doesnotexist123/whatever`);
  expect(res.status).toBe(404);
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
});

test("an upload with no Authorization token is rejected", async () => {
  const err = await uploadError(
    makeClient(),
    imageFormData({ logbookId: logbookA, entryId: entryA }),
  );
  expect(err.data?.code).toBe("NOT_FOUND");
});

test("a token cannot upload against a different logbook's id", async () => {
  // Valid token for A, but claims logbook B in the form.
  const err = await uploadError(
    makeClient(tokenA),
    imageFormData({ logbookId: logbookB, entryId: entryB }),
  );
  expect(err.data?.code).toBe("NOT_FOUND");
});

test("a token cannot attach an image to an entry in another logbook", async () => {
  // Auth passes (token A ↔ logbook A), but the entry belongs to logbook B — the
  // server must independently reject it rather than trust the form.
  const err = await uploadError(
    makeClient(tokenA),
    imageFormData({ logbookId: logbookA, entryId: entryB }),
  );
  expect(err.data?.code).toBe("NOT_FOUND");
});

test("a non-image file is rejected as a bad request", async () => {
  const err = await uploadError(
    makeClient(tokenA),
    imageFormData({
      logbookId: logbookA,
      entryId: entryA,
      bytes: Buffer.from("this is not an image"),
      filename: "notreally.png",
    }),
  );
  expect(err.data?.code).toBe("BAD_REQUEST");
});

test("a valid image in a format that isn't on the allowlist is rejected", async () => {
  // The point of the allowlist, as distinct from the parse-failure path above:
  // `image-meta` reads this file perfectly well. An SVG served from our own
  // origin would be stored XSS, so it must be turned away for being an SVG.
  const err = await uploadError(
    makeClient(tokenA),
    imageFormData({
      logbookId: logbookA,
      entryId: entryA,
      bytes: SVG,
      filename: "diagram.svg",
      mime: "image/svg+xml",
    }),
  );
  expect(err.data?.code).toBe("BAD_REQUEST");
});

test("an image of an accepted type that reports no dimensions is rejected", async () => {
  const err = await uploadError(
    makeClient(tokenA),
    imageFormData({
      logbookId: logbookA,
      entryId: entryA,
      bytes: zeroDimensionPng(),
      filename: "empty.png",
    }),
  );
  expect(err.data?.code).toBe("BAD_REQUEST");
});

test("an image larger than 10 MB is rejected", async () => {
  const err = await uploadError(
    makeClient(tokenA),
    imageFormData({
      logbookId: logbookA,
      entryId: entryA,
      bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 1),
      filename: "huge.png",
    }),
  );
  expect(err.data?.code).toBe("PAYLOAD_TOO_LARGE");
});

test("a request that declares an oversized body is refused before it sends one", async () => {
  // An authenticated attacker announcing a 12 MB upload and sending nothing.
  // Rejecting on the declared size costs the server nothing; the alternative —
  // reading it all in and letting the upload procedure measure it afterwards —
  // is the attack. 12 MB also sits under the app-wide `bodyLimit`, so only the
  // multipart cap can be what turns it away.
  const { status } = await attackerUpload({ headers: { "content-length": "12582912" } });
  expect(status).toBe(413);
});

test("a body that hides its size behind chunked encoding is cut off mid-transfer", async () => {
  // The same attack with no Content-Length to check, so the only thing that can
  // stop it is counting bytes as they arrive. The server should refuse — and,
  // crucially, stop reading — long before the last of the 64 one-megabyte
  // chunks: that gap is the ceiling on what an upload can make it hold.
  const chunks = megabyteChunks(64);
  const { status } = await attackerUpload({ body: chunks.stream });
  expect(status === 413 || status === null).toBe(true);
  // Generously above the ~11 MB cap (some megabytes are in socket buffers by the
  // time the refusal lands) and far below 64: the point is that it stops.
  expect(chunks.sent()).toBeLessThan(24);
});

// ── image.uploadFromUrl ──────────────────────────────────────────────────────
// The server fetches the image itself, so the bytes never round-trip through the
// browser. The SSRF fence around that fetch is unit-tested in
// `../images/fetch-remote-image.test.ts`; here we cover the procedure's own job:
// auth, entry ownership, and that a fetched image is stored and served like any
// other.

test("stores an image fetched from a URL and serves it back", async () => {
  const detail = await makeClient(tokenA).image.uploadFromUrl.mutate({
    logbookId: logbookA,
    entryId: entryA,
    url: `${upstreamUrl}/photo.png`,
  });
  expect(detail.mimeType).toBe("image/png");
  expect(detail.width).toBe(1);
  expect(detail.entryId).toBe(entryA);
  expect(detail.urlSafeName).toBe("photo.png");

  const res = await fetch(`${baseUrl}/api/images/${detail.id}/${detail.urlSafeName}`);
  expect(res.status).toBe(200);
  expect(Buffer.from(await res.arrayBuffer()).equals(PNG_1x1)).toBe(true);
});

test("a token cannot fetch a URL into a different logbook's id", async () => {
  const err = await uploadFromUrlError(makeClient(tokenA), {
    logbookId: logbookB,
    entryId: entryB,
    url: `${upstreamUrl}/photo.png`,
  });
  expect(err.data?.code).toBe("NOT_FOUND");
});

test("a token cannot fetch a URL into an entry in another logbook", async () => {
  // Auth passes (token A ↔ logbook A), but the entry belongs to logbook B.
  const err = await uploadFromUrlError(makeClient(tokenA), {
    logbookId: logbookA,
    entryId: entryB,
    url: `${upstreamUrl}/photo.png`,
  });
  expect(err.data?.code).toBe("NOT_FOUND");
});

test("a URL that isn't an image is rejected", async () => {
  const err = await uploadFromUrlError(makeClient(tokenA), {
    logbookId: logbookA,
    entryId: entryA,
    url: `${upstreamUrl}/page.html`,
  });
  expect(err.data?.code).toBe("UNSUPPORTED_MEDIA_TYPE");
});
