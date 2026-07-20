/**
 * Builds the Fastify application — routes, tRPC, and a warmed ORM — without
 * listening. `index.ts` calls this and binds a port; tests call it and drive it
 * over an ephemeral port with `fetch`.
 */
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";

import { getOrm } from "./db.ts";
import { appRouter, type AppRouter } from "./api/api-router.ts";
import { MAX_IMAGE_BYTES } from "./api/image-api.ts";
import { createContext } from "./trpc.ts";
import { registerImagesRoute } from "./images/images-route.ts";

/**
 * Hard ceiling on a multipart request body: the image limit plus room for the
 * multipart framing and the three small text fields that ride along with the
 * file. Enforced while the body streams in (see the parser below), so it is the
 * real bound on what a client can make the server hold in memory — the 10 MB
 * check in the upload procedure runs against bytes that are already buffered and
 * can only be the *second* line of defense.
 */
const MAX_UPLOAD_BODY_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;

export async function buildApp({
  logger = true,
}: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    // tRPC's httpBatchLink encodes procedure names into the URL path; the
    // Fastify default of 100 chars is easily blown past.
    routerOptions: { maxParamLength: 5000 },
    // Backstop for JSON request bodies (an entry's content is the big one).
    // Image uploads do *not* ride this limit — they arrive as multipart, which
    // is capped separately below.
    bodyLimit: 15 * 1024 * 1024,
  });

  app.get("/health", async () => ({ ok: true }));

  // Serve uploaded images: GET /api/images/:id/:filename. Registered before the
  // tRPC catch-all; its three path segments are more specific than tRPC's
  // `/api/:path`, so there's no collision with the procedure routes.
  await registerImagesRoute(app);

  // All API routes are prefixed with `/api` (spec/2-backend.md). tRPC procedures
  // live directly under it, e.g. `/api/logbook.overview`, `/api/image.upload`.
  //
  // The tRPC plugin is invoked directly rather than handed to `register` so that
  // its routes and content-type parsers land in *this* scope, where the capped
  // multipart parser below can replace the one it installs. Handed to `register`
  // it would get an encapsulation context of its own that nothing outside can
  // reach into. (The `/api` prefix comes from this wrapper's registration; the
  // plugin ignores its own `prefix` option on the ESM build.)
  await app.register(
    async (api) => {
      await new Promise<void>((resolve, reject) => {
        fastifyTRPCPlugin(
          api,
          {
            trpcOptions: {
              router: appRouter,
              createContext,
              onError({ path, error }) {
                app.log.error({ path, err: error }, "tRPC handler error");
              },
            } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
          },
          (err) => (err ? reject(err) : resolve()),
        );
      });

      // tRPC installs a multipart parser that hands the untouched request stream
      // to its own layer, which buffers all of it before any application code
      // runs — so the upload procedure's 10 MB check only ever saw a body that
      // was already in memory, however big. Fastify's own reader is a real
      // ceiling instead: it rejects an oversized Content-Length outright, and
      // otherwise counts bytes as they arrive and 413s the moment the cap is
      // crossed, without reading the rest.
      api.removeContentTypeParser("multipart/form-data");
      api.addContentTypeParser<Buffer>(
        "multipart/form-data",
        { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BODY_BYTES },
        (_request, body, done) => done(null, asIncomingMessage(body)),
      );
    },
    { prefix: "/api" },
  );

  // Warm up the ORM before listening so the first request doesn't pay the
  // schema-sync cost.
  await getOrm();

  return app;
}

/**
 * Present an already-read body to tRPC as though it were still the request
 * stream.
 *
 * tRPC's node adapter forwards a Fastify-parsed body only when it's a string or
 * an `IncomingMessage`; anything else it JSON-stringifies, which would mangle
 * binary image bytes. Reading the body ourselves is what buys the streaming size
 * cap above, so it has to be handed back in one of those two shapes.
 *
 * The detached socket is deliberate. `IncomingMessage` treats destruction before
 * `complete` as an aborted request and tears its socket down with it, so wiring
 * this to the live connection would let a consumer that drops the body kill the
 * response along with it.
 */
function asIncomingMessage(body: Buffer): IncomingMessage {
  const message = new IncomingMessage(new Socket());
  message.push(body);
  message.push(null);
  message.complete = true;
  return message;
}
