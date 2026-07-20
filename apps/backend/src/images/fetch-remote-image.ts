/**
 * Fetch a remote image into a capped, in-memory buffer, safely (spec/2-backend.md
 * → "Images"). This is the server-side half of "paste an `<img>` from a web page":
 * the backend fetches the bytes and stores them itself, so they never round-trip
 * through the browser and CORS never blocks the read.
 *
 * A URL fetcher that will retrieve whatever it is told is a server-side request
 * forgery tool and an open relay, so this one is fenced in:
 *
 *   - only `http:`/`https:` URLs, and a raw-IP host is refused outright (a real
 *     image source is a domain; a bare IP is the shape of a direct SSRF);
 *   - the host is resolved and every answer must be publicly routable;
 *   - **the connection is pinned to the vetted address**: we resolve, validate,
 *     then connect to *that IP* (with the original Host header and TLS SNI). There
 *     is no second name resolution for a rebinding attack to race — the address
 *     we checked is the address the socket uses;
 *   - every redirect hop is re-validated the same way;
 *   - it refuses anything the upstream doesn't label `image/*`;
 *   - it stops reading at `maxBytes`, whether the server lies about the size or
 *     omits it.
 *
 * Nothing here is trusted as validation of the image itself: the caller hands the
 * returned bytes to the same `image-meta` check a picked file gets.
 */
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

/** Upstreams that never answer must not tie up a request indefinitely. */
const FETCH_TIMEOUT_MS = 10_000;
/** Enough for the usual CDN shuffle, few enough to bound the work per request. */
const MAX_REDIRECTS = 3;

/** A refusal carrying the HTTP-ish status it should map to. The caller turns it
 *  into a `TRPCError`; anything else escaping is an unexpected failure. */
export class RemoteImageError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Whether an address is somewhere other than the public internet — loopback,
 * link-local, private, carrier-grade NAT, multicast, or otherwise reserved.
 * Delegated to `ipaddr.js` rather than hand-rolled: only `"unicast"` is a routable
 * public destination, so everything else is refused, as is anything unparseable.
 */
function isPrivateAddress(address: string): boolean {
  let parsed: ReturnType<typeof ipaddr.parse>;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return true;
  }
  // An IPv4-mapped IPv6 address reaches the embedded IPv4 host, so judge it as
  // that host rather than as generic IPv6 unicast.
  const addr =
    parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress() ? parsed.toIPv4Address() : parsed;
  return addr.range() !== "unicast";
}

/**
 * URL-shape policy, no DNS: an `http`/`https` URL whose host is a domain name.
 * A raw-IP host is refused (unless `allowRawIp`, which only tests pass so their
 * loopback upstream is reachable by IP).
 */
function validateUrl(raw: string, allowRawIp: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteImageError(400, "Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteImageError(400, "Only http and https URLs can be fetched");
  }
  // A bracketed IPv6 literal has to lose its brackets before it reads as one.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowRawIp && isIP(host)) {
    throw new RemoteImageError(400, "Image URLs must use a domain name, not a raw IP address");
  }
  return url;
}

/**
 * Resolve the URL's host and return one publicly-routable address to connect to.
 * Every resolved address must be public (a name pointing at both a public and a
 * private address is refused, so `fetch` can't be steered to the private one).
 * The returned IP is what the caller connects to directly — that is the pin that
 * leaves no window for a rebinding attack.
 */
async function resolvePublicAddress(url: URL, allowPrivate: boolean): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(host)) {
    // Only reached when `allowPrivate` — `validateUrl` rejects raw-IP hosts
    // otherwise.
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((entry) => entry.address);
    } catch {
      throw new RemoteImageError(502, "Could not resolve the image's host");
    }
  }
  const [first] = addresses;
  if (first === undefined || (!allowPrivate && addresses.some(isPrivateAddress))) {
    throw new RemoteImageError(403, "That host is not publicly routable");
  }
  return first;
}

/**
 * GET the URL over a socket pinned to `ip`. `host: ip` means Node connects to the
 * vetted address with no fresh DNS lookup; the `Host` header keeps virtual hosting
 * working and `servername` makes TLS validate against the real hostname, not the
 * IP.
 */
function requestToIp(url: URL, ip: string, signal: AbortSignal): Promise<http.IncomingMessage> {
  const isHttps = url.protocol === "https:";
  const agent = isHttps ? https : http;
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  return new Promise((resolve, reject) => {
    const req = agent.request(
      {
        host: ip,
        servername: isHttps ? url.hostname : undefined,
        port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { host: url.host, accept: "image/*" },
        signal,
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

/** Read a response body into a buffer, aborting the moment it exceeds `maxBytes`
 *  — the bound on a server that lies about (or omits) its `Content-Length`. */
async function readCapped(res: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      res.destroy();
      throw new RemoteImageError(413, "Image exceeds the 10 MB limit");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch `rawUrl` into a buffer, refusing anything that isn't a public image under
 * `maxBytes`. Following redirects by hand so each hop is re-validated and
 * re-pinned. `allowPrivateAddresses` exists only so tests can reach a loopback
 * upstream; it is asserted to require `NODE_ENV=test`, so it can never relax the
 * guard in a running server.
 */
export async function fetchRemoteImage(
  rawUrl: string,
  opts: { maxBytes: number; allowPrivateAddresses?: boolean },
): Promise<{ bytes: Buffer; contentType: string }> {
  const allowPrivate = opts.allowPrivateAddresses ?? false;
  if (allowPrivate && process.env.NODE_ENV !== "test") {
    throw new Error(
      "fetchRemoteImage: allowPrivateAddresses is test-only (requires NODE_ENV=test)",
    );
  }

  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = validateUrl(rawUrl, allowPrivate);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ip = await resolvePublicAddress(url, allowPrivate);
    let res: http.IncomingMessage;
    try {
      res = await requestToIp(url, ip, signal);
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new RemoteImageError(504, "The image's host took too long to respond");
      }
      throw new RemoteImageError(502, "Could not fetch that image");
    }

    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location !== undefined) {
      res.resume(); // drain so the socket is freed
      url = validateUrl(new URL(location, url).href, allowPrivate);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new RemoteImageError(502, `The image's host responded ${status}`);
    }
    const contentType = String(res.headers["content-type"] ?? "");
    if (!contentType.startsWith("image/")) {
      res.resume();
      throw new RemoteImageError(415, "That URL is not an image");
    }
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      res.resume();
      throw new RemoteImageError(413, "Image exceeds the 10 MB limit");
    }
    const bytes = await readCapped(res, opts.maxBytes);
    return { bytes, contentType };
  }
  throw new RemoteImageError(502, "Too many redirects");
}
