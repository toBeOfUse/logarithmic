/**
 * Vanilla tRPC client used by `hooks.ts` for any logbook that isn't a demo.
 * We deliberately keep the React-Query wiring in the hooks themselves rather
 * than using `@trpc/tanstack-react-query` — the per-hook control over query
 * keys and invalidation rules predates the API, and we don't want to rewrite
 * that surface while moving the data source.
 *
 * `superjson` matches the transformer on the server, so Date objects survive
 * the JSON round trip and the existing date-formatting code keeps working.
 *
 * The URL is same-origin: in dev, Vite proxies `/trpc` to the backend (see
 * `vite.config.ts`); in prod, the SPA and API are expected to share an origin
 * behind whatever reverse proxy is fronting them.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "logarithmic-backend/api-router";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/trpc";

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: API_URL, transformer: superjson })],
});
