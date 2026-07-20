/**
 * `fetchRemoteImage` is the SSRF boundary for "paste an `<img>` from a web page":
 * it takes a URL from a client and fetches it. Most of what follows proves what it
 * *won't* fetch — a raw-IP host, a non-public address, a non-image, anything too
 * big, or a redirect into any of those — since that is where the security lives.
 *
 * The relaying cases (bytes come back intact, a redirect is followed, the cap
 * holds) run with `allowPrivateAddresses: true` against a loopback upstream — the
 * one address the guard is otherwise there to refuse. Nothing but a test ever
 * passes that flag, and it is asserted to require `NODE_ENV=test`.
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import Fastify, { type FastifyInstance } from "fastify";

import { fetchRemoteImage, RemoteImageError } from "./fetch-remote-image.ts";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const MEGABYTE = 1024 * 1024;
const TEN_MB = 10 * MEGABYTE;

let upstream: FastifyInstance;
let upstreamUrl: string;

/** Fetch a path off the loopback upstream, with the guard relaxed (the upstream
 *  can only listen on loopback). */
function fetchFromUpstream(
  path: string,
  opts: { maxBytes?: number } = {},
): Promise<{ bytes: Buffer; contentType: string }> {
  return fetchRemoteImage(`${upstreamUrl}${path}`, {
    maxBytes: opts.maxBytes ?? TEN_MB,
    allowPrivateAddresses: true,
  });
}

/** The status a rejected fetch carried, or a thrown assertion if it resolved. */
async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof RemoteImageError) return err.status;
    throw err;
  }
  throw new Error("expected the fetch to be rejected");
}

beforeAll(async () => {
  // `fetchRemoteImage` asserts `allowPrivateAddresses` is test-only.
  process.env.NODE_ENV = "test";

  upstream = Fastify({ logger: false });
  upstream.get("/photo.png", async (_req, reply) => reply.type("image/png").send(PNG_1x1));
  upstream.get("/page.html", async (_req, reply) => reply.type("text/html").send("<p>hi</p>"));
  upstream.get("/missing.png", async (_req, reply) => reply.code(404).send("gone"));
  upstream.get("/declares-huge.png", async (_req, reply) => {
    // Announces far more than the cap without sending it: the Content-Length check
    // should turn this away before a byte is read. Streamed so Fastify doesn't
    // recompute the real length and overwrite the claim.
    reply.type("image/png").header("content-length", String(64 * MEGABYTE));
    return reply.send(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(PNG_1x1));
          controller.close();
        },
      }),
    );
  });
  upstream.get("/endless.png", async (_req, reply) => {
    // No Content-Length, and more bytes than the cap, so only counting them as
    // they arrive can stop it.
    let sent = 0;
    return reply.type("image/png").send(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += 1;
          if (sent > 16) return controller.close();
          controller.enqueue(new Uint8Array(MEGABYTE));
        },
      }),
    );
  });
  upstream.get("/redirected.png", async (_req, reply) =>
    reply.code(302).header("location", `${upstreamUrl}/photo.png`).send(),
  );
  upstream.get("/redirect-to-file.png", async (_req, reply) =>
    // A hop that must be refused however permissive the address guard is — so the
    // test can tell the redirect was put through validation at all.
    reply.code(302).header("location", "file:///etc/passwd").send(),
  );
  await upstream.listen({ port: 0, host: "127.0.0.1" });
  upstreamUrl = `http://127.0.0.1:${(upstream.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await upstream?.close();
});

test("fetches an image and returns its bytes and content type", async () => {
  const { bytes, contentType } = await fetchFromUpstream("/photo.png");
  expect(contentType).toContain("image/png");
  expect(bytes.equals(PNG_1x1)).toBe(true);
});

test("follows a redirect to the real image", async () => {
  const { bytes } = await fetchFromUpstream("/redirected.png");
  expect(bytes.equals(PNG_1x1)).toBe(true);
});

test("refuses a url that isn't an image", async () => {
  expect(await statusOf(fetchFromUpstream("/page.html"))).toBe(415);
});

test("an upstream with no such image is a bad gateway", async () => {
  expect(await statusOf(fetchFromUpstream("/missing.png"))).toBe(502);
});

test("refuses an image that declares more than the cap, before reading it", async () => {
  expect(await statusOf(fetchFromUpstream("/declares-huge.png", { maxBytes: 2 * MEGABYTE }))).toBe(
    413,
  );
});

test("cuts off an image that hides its size once it exceeds the cap", async () => {
  expect(await statusOf(fetchFromUpstream("/endless.png", { maxBytes: 2 * MEGABYTE }))).toBe(413);
});

test("a redirect's destination is validated, not blindly followed", async () => {
  // The URL handed over is fine; only where it leads (a `file:` scheme) is not.
  expect(await statusOf(fetchFromUpstream("/redirect-to-file.png"))).toBe(400);
});

// The SSRF refusals, with the guard in force (no `allowPrivateAddresses`).

test("refuses a raw-IP host, public-looking or not", async () => {
  // A bare IP is the shape of a direct SSRF and nothing a paste legitimately
  // produces — banned outright, before any address resolution, even when public.
  expect(await statusOf(fetchRemoteImage("http://127.0.0.1/x.png", { maxBytes: TEN_MB }))).toBe(
    400,
  );
  expect(await statusOf(fetchRemoteImage("http://169.254.169.254/", { maxBytes: TEN_MB }))).toBe(
    400,
  );
  expect(await statusOf(fetchRemoteImage("http://[::1]/x.png", { maxBytes: TEN_MB }))).toBe(400);
  expect(await statusOf(fetchRemoteImage("http://93.184.216.34/x.png", { maxBytes: TEN_MB }))).toBe(
    400,
  );
});

test("refuses a non-http scheme", async () => {
  expect(await statusOf(fetchRemoteImage("file:///etc/passwd", { maxBytes: TEN_MB }))).toBe(400);
});

test("refuses a hostname that resolves to a private address", async () => {
  // `localhost` names no IP, so it passes the raw-IP ban — but it resolves to
  // loopback, which the resolved-address check catches.
  expect(await statusOf(fetchRemoteImage("http://localhost/x.png", { maxBytes: TEN_MB }))).toBe(
    403,
  );
});

test("allowPrivateAddresses is refused outside a test env", async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await expect(
      fetchRemoteImage("http://127.0.0.1/x.png", { maxBytes: TEN_MB, allowPrivateAddresses: true }),
    ).rejects.toThrow(/test-only/);
  } finally {
    process.env.NODE_ENV = prev;
  }
});
