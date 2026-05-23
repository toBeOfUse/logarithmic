import Fastify from "fastify";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";

import { getOrm } from "./db.ts";
import { appRouter, type AppRouter } from "./api/api-router.ts";
import { createContext } from "./trpc.ts";

const app = Fastify({
  logger: true,
  // tRPC's httpBatchLink encodes procedure names into the URL path; the
  // Fastify default of 100 chars is easily blown past.
  routerOptions: { maxParamLength: 5000 },
  // 50 MB cap on raw request bodies. The only oversized payload we accept is
  // the `logbook.import` upload (a ZIP); this keeps a malicious client from
  // exhausting server memory.
  bodyLimit: 50 * 1024 * 1024,
});

app.get("/health", async () => ({ ok: true }));

// `octetInputParser` reads the request body as a `ReadableStream`. Hand the
// raw `IncomingMessage` payload through unread as `req.body` — tRPC's
// `incomingMessageToRequest` has a dedicated branch that wraps an
// `IncomingMessage` body into the fetch `Request` stream. Calling `done(null)`
// without a value would leave `req.body` undefined and the procedure would
// receive `null` instead of a stream.
app.addContentTypeParser("application/octet-stream", (_req, payload, done) =>
  done(null, payload),
);

await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext,
    onError({ path, error }) {
      app.log.error({ path, err: error }, "tRPC handler error");
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
});

// Warm up the ORM before listening so the first request doesn't pay the
// schema-sync cost.
await getOrm();

const port = Number(process.env.PORT ?? 3001);
try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
