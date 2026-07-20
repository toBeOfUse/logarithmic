/**
 * The public image-serving route: `GET /api/images/:id/:filename`
 * (spec/2-backend.md → "Images").
 *
 * Access control is deliberately just knowing the URL — the id is an unguessable
 * random secret (see `Image.id`). The `:filename` segment is decorative (it only
 * shapes the download name); the id is the source of truth, so a mismatched or
 * stale filename still resolves.
 *
 * `X-Content-Type-Options: nosniff` is sent so a browser can't reinterpret the
 * bytes as a different type than the one `image-meta` detected at upload. The
 * bytes themselves come from `ImageBox`, keeping the storage mechanism opaque to
 * the HTTP layer.
 */
import type { FastifyInstance } from "fastify";

import { getOrm } from "../db.ts";
import { Image } from "../entities/Image.ts";
import { getImageBox } from "./image-box.ts";

// Images are immutable and addressed by an unguessable id, so they're safe to
// cache hard and forever.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function registerImagesRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string; filename: string } }>(
    "/api/images/:id/:filename",
    async (req, reply) => {
      const { id } = req.params;
      const orm = await getOrm();
      const em = orm.em.fork();

      // Sent on every response, not just the hits: a 404 body is JSON we chose,
      // and it should be no more open to reinterpretation than the image bytes.
      reply.header("X-Content-Type-Options", "nosniff");

      const image = await em.findOne(Image, { id });
      if (!image) return reply.code(404).send({ error: "Image not found" });

      const stored = await getImageBox().get(id);
      if (!stored) return reply.code(404).send({ error: "Image not found" });

      reply.header("Cache-Control", CACHE_CONTROL).type(image.mimeType);
      if (stored.contentLength !== undefined) {
        reply.header("Content-Length", String(stored.contentLength));
      }
      // Pipe the bytes straight to the client (Fastify streams a Readable) rather
      // than buffering the whole file first.
      return reply.send(stored.stream);
    },
  );
}
