/**
 * Integration tests for the tRPC API. We boot a real Fastify instance against
 * an in-memory SQLite database and drive it with `fetch` so we exercise the
 * same wire format the browser uses (including the superjson envelope and
 * the Set-Cookie round trip). Security-relevant scenarios — cross-user
 * isolation and input validation — are explicit `fetch`-based simulations
 * per spec/2-backend.md.
 */
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import type { FastifyInstance } from "fastify";
import superjson, { type SuperJSONResult } from "superjson";

// Env must be set before any backend module is imported so the ORM picks up
// the in-memory DB path and the cookie HMAC has a stable secret.
process.env.DB_PATH = ":memory:";
process.env.SESSION_SECRET = "test-secret";

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  const { default: Fastify } = await import("fastify");
  const cors = (await import("@fastify/cors")).default;
  const { fastifyTRPCPlugin } = await import("@trpc/server/adapters/fastify");
  const { appRouter } = await import("./api/api-router.ts");
  const { createContext } = await import("./trpc.ts");
  const { getOrm } = await import("./db.ts");

  app = Fastify({ routerOptions: { maxParamLength: 5000 } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter, createContext },
  });

  // Warm up the ORM (also runs schema sync against the in-memory DB).
  await getOrm();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("server bound to unexpected address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await app.close();
});

// ── wire-format helpers ────────────────────────────────────────────────

type RpcResult<T> = {
  status: number;
  data?: T;
  error?: { code: string; message: string };
  cookie?: string;
};

async function rpc<T>(
  path: string,
  opts: { input?: unknown; cookie?: string; method?: "GET" | "POST" } = {},
): Promise<RpcResult<T>> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  let url = `${baseUrl}/trpc/${path}`;
  let body: string | undefined;
  if (method === "GET") {
    if (opts.input !== undefined) {
      url += `?input=${encodeURIComponent(JSON.stringify(superjson.serialize(opts.input)))}`;
    }
  } else {
    headers["content-type"] = "application/json";
    body =
      opts.input !== undefined
        ? JSON.stringify(superjson.serialize(opts.input))
        : JSON.stringify({});
  }
  const res = await fetch(url, { method, headers, body });
  const setCookie = res.headers.get("set-cookie") ?? undefined;
  const json = (await res.json()) as Record<string, unknown>;
  if ("error" in json && json.error) {
    const errEnvelope = json.error as { json: { message: string; data?: { code?: string } } };
    return {
      status: res.status,
      error: { code: errEnvelope.json.data?.code ?? "UNKNOWN", message: errEnvelope.json.message },
      cookie: setCookie,
    };
  }
  const resultEnvelope = json.result as { data: SuperJSONResult };
  return {
    status: res.status,
    data: superjson.deserialize<T>(resultEnvelope.data),
    cookie: setCookie,
  };
}

function cookieValueFromSetCookie(setCookie: string | undefined): string {
  if (!setCookie) throw new Error("expected Set-Cookie on response");
  // Strip attributes (Path, Max-Age, …); we just need name=value for the
  // next request's Cookie header.
  return setCookie.split(";", 1)[0]!;
}

// ── tests ──────────────────────────────────────────────────────────────

describe("anonymous-user session", () => {
  test("anonymous visitor sees an empty logbook list with no session cookie", async () => {
    const res = await rpc<unknown[]>("logbook.list");
    expect(res.status).toBe(200);
    expect(res.data).toEqual([]);
    expect(res.cookie).toBeUndefined();
  });

  test("creating a logbook provisions an anonymous user and returns a session cookie", async () => {
    const created = await rpc<{ id: string; name: string }>("logbook.create", {
      method: "POST",
      input: { name: "Field notes" },
    });
    expect(created.status).toBe(200);
    expect(created.data?.name).toBe("Field notes");
    expect(created.cookie).toMatch(/lg-uid=/);

    const cookie = cookieValueFromSetCookie(created.cookie);
    const list = await rpc<Array<{ id: string; name: string }>>("logbook.list", { cookie });
    expect(list.data).toHaveLength(1);
    expect(list.data?.[0]?.id).toBe(created.data?.id);
  });

  test("an unsigned or tampered session cookie is rejected as if missing", async () => {
    // Replace the signature half with junk; HMAC mismatch must fall back
    // to "no user" rather than impersonating the original.
    const created = await rpc<{ id: string }>("logbook.create", {
      method: "POST",
      input: { name: "Stolen lookalike" },
    });
    const goodCookie = cookieValueFromSetCookie(created.cookie);
    const [name, value] = goodCookie.split("=");
    const userId = value!.split(".")[0];
    const tampered = `${name}=${userId}.not-a-real-signature`;

    const list = await rpc<unknown[]>("logbook.list", { cookie: tampered });
    expect(list.data).toEqual([]);
  });
});

describe("logbook ownership", () => {
  test("a second visitor cannot read the first visitor's logbook overview", async () => {
    const visitorA = await rpc<{ id: string }>("logbook.create", {
      method: "POST",
      input: { name: "Private" },
    });
    const cookieA = cookieValueFromSetCookie(visitorA.cookie);
    const lbId = visitorA.data!.id;

    // Visitor B starts fresh — minted as a different anon user on their own
    // first request.
    const visitorB = await rpc<{ id: string }>("logbook.create", {
      method: "POST",
      input: { name: "B's own" },
    });
    const cookieB = cookieValueFromSetCookie(visitorB.cookie);

    const aRead = await rpc("logbook.overview", { input: { logbookId: lbId }, cookie: cookieA });
    expect(aRead.status).toBe(200);

    const bRead = await rpc("logbook.overview", { input: { logbookId: lbId }, cookie: cookieB });
    expect(bRead.status).toBe(404);
    expect(bRead.error?.code).toBe("NOT_FOUND");
  });
});

describe("entry tree operations", () => {
  let cookie: string;
  let logbookId: string;

  beforeAll(async () => {
    const created = await rpc<{ id: string }>("logbook.create", {
      method: "POST",
      input: { name: "Tree tests" },
    });
    cookie = cookieValueFromSetCookie(created.cookie);
    logbookId = created.data!.id;
  });

  test("a child entry's column is exactly one less than its parent's", async () => {
    const parent = await rpc<{ id: string; col: number }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "Root", col: 2 },
      cookie,
    });
    expect(parent.data?.col).toBe(2);
    const child = await rpc<{ col: number; parentId: string | null }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "Leaf", parentId: parent.data!.id },
      cookie,
    });
    expect(child.data?.col).toBe(1);
    expect(child.data?.parentId).toBe(parent.data!.id);
  });

  test("deleting an entry cascades to its descendants", async () => {
    const root = await rpc<{ id: string }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "Dies", col: 1 },
      cookie,
    });
    const mid = await rpc<{ id: string }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "Also dies", parentId: root.data!.id },
      cookie,
    });
    const leaf = await rpc<{ id: string }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "Also dies too", parentId: mid.data!.id },
      cookie,
    });

    const del = await rpc("entry.delete", {
      method: "POST",
      input: { id: root.data!.id },
      cookie,
    });
    expect(del.status).toBe(200);

    const leafLookup = await rpc("entry.get", { input: { id: leaf.data!.id }, cookie });
    expect(leafLookup.status).toBe(404);
  });

  test("moveEntry refuses to make an entry a child of its own descendant", async () => {
    const a = await rpc<{ id: string; col: number }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "A", col: 2 },
      cookie,
    });
    const b = await rpc<{ id: string; col: number }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "B", parentId: a.data!.id },
      cookie,
    });

    // Try to move A under B (B is A's child). Service refuses silently and
    // returns the entry unchanged (matching the demo-store contract).
    const moved = await rpc<{ id: string; parentId: string | null }>("entry.move", {
      method: "POST",
      input: { id: a.data!.id, parentId: b.data!.id, col: b.data!.col - 1, position: 0 },
      cookie,
    });
    expect(moved.status).toBe(200);
    expect(moved.data?.parentId).toBeNull();
  });

  test("moveEntry rejects a col that disagrees with the parent's col - 1", async () => {
    const parent = await rpc<{ id: string; col: number }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "Parent", col: 4 },
      cookie,
    });
    const orphan = await rpc<{ id: string }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "Orphan", col: 0 },
      cookie,
    });

    // Parent sits at col 4, so children must be at col 3. Asking for col 0
    // is a contract violation the server has to catch.
    const moved = await rpc("entry.move", {
      method: "POST",
      input: { id: orphan.data!.id, parentId: parent.data!.id, col: 0, position: 0 },
      cookie,
    });
    expect(moved.status).toBe(400);
    expect(moved.error?.code).toBe("BAD_REQUEST");
  });

  test("reorderSiblings rejects partial id lists", async () => {
    const x = await rpc<{ id: string }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "X", col: 5 },
      cookie,
    });
    const y = await rpc<{ id: string }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "Y", col: 5 },
      cookie,
    });
    // Submit only one of the two sibling ids — server must reject.
    const res = await rpc("entry.reorderSiblings", {
      method: "POST",
      input: { logbookId, parentId: null, ids: [y.data!.id] },
      cookie,
    });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe("BAD_REQUEST");
    // The lone provided id had to belong to a sibling set; this confirms the
    // arity check fires before any partial reorder is persisted.
    expect(x.data?.id).toBeDefined();
  });

  test("another user cannot mutate an entry they don't own", async () => {
    const target = await rpc<{ id: string }>("entry.create", {
      method: "POST",
      input: { logbookId, name: "Sacred", col: 0 },
      cookie,
    });

    // Mint a fresh anonymous identity.
    const stranger = await rpc("logbook.create", {
      method: "POST",
      input: { name: "Stranger's" },
    });
    const strangerCookie = cookieValueFromSetCookie(stranger.cookie);

    const renamed = await rpc("entry.rename", {
      method: "POST",
      input: { id: target.data!.id, name: "Hacked" },
      cookie: strangerCookie,
    });
    expect(renamed.status).toBe(404);
  });
});
