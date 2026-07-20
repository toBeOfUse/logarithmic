/**
 * Vanilla tRPC client used by `hooks.ts` for any logbook that isn't a demo. We
 * deliberately keep the React-Query wiring in the hooks themselves rather than
 * using `@trpc/tanstack-react-query` — the per-hook control over query keys and
 * invalidation rules predates the API, and we don't want to rewrite that
 * surface while moving the data source.
 *
 * `superjson` matches the transformer on the server, so Date objects survive
 * the JSON round trip and the existing date-formatting code keeps working.
 *
 * `splitLink` routes binary inputs through a non-batched `httpLink` configured
 * for binary bodies. JSON-only calls also go through a non-batched `httpLink`
 * (rather than `httpBatchLink`) because each call must carry an `Authorization`
 * header derived from its own input's `logbookId` — batching would force a
 * single header for the whole batch.
 *
 * The URL is same-origin: in dev, Vite proxies `/api` to the backend (see
 * `vite.config.ts`); in prod, the SPA and API are expected to share an origin
 * behind whatever reverse proxy is fronting them.
 */
import { createTRPCClient, httpLink, isNonJsonSerializable, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "logarithmic-backend/api-router";

import { getToken } from "./tokens.ts";

/** Base path for the tRPC endpoint (dev proxies `/api` to the backend; prod
 *  shares an origin). */
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

/** Pull the `logbookId` out of an operation's input, whether it's a plain JSON
 *  object (most procedures) or a `FormData` (the multipart image upload, whose
 *  `logbookId` is a form field). */
function logbookIdOf(input: unknown): string | null {
  if (input instanceof FormData) {
    const id = input.get("logbookId");
    return typeof id === "string" ? id : null;
  }
  if (input && typeof input === "object" && !Array.isArray(input) && "logbookId" in input) {
    const id = (input as { logbookId: unknown }).logbookId;
    if (typeof id === "string") return id;
  }
  return null;
}

/**
 * Derive the Authorization header for a single operation. Mutations and
 * queries that target a particular logbook always carry `logbookId` in their
 * input (see `api-types.ts`) — in the request body for JSON procedures, or as a
 * form field for the multipart `image.upload`. We look up the matching token in
 * localStorage and attach it. Operations without a `logbookId` (e.g.
 * `logbook.listByTokens`, which carries its own tokens in the body) send no
 * Authorization header.
 */
function authHeaders(input: unknown): Record<string, string> {
  const id = logbookIdOf(input);
  if (id) {
    const token = getToken(id);
    if (token) return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => isNonJsonSerializable(op.input),
      // Binary input: don't transform the body (it's a File/Blob/Uint8Array),
      // but still run the response through superjson so server-side Date /
      // Uint8Array values round-trip.
      true: httpLink({
        url: API_URL,
        headers: ({ op }) => authHeaders(op.input),
        transformer: {
          serialize: (data) => data,
          deserialize: (data) => superjson.deserialize(data),
        },
      }),
      false: httpLink({
        url: API_URL,
        headers: ({ op }) => authHeaders(op.input),
        transformer: superjson,
      }),
    }),
  ],
});
