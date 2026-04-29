// Server entry point — not yet wired up to handlers.
// The frontend currently mocks all data through its in-memory data layer
// (see apps/frontend/app/data). This file exists so the backend package has a
// runnable shape, and so future tRPC routers + Fastify wiring have a home.

import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
