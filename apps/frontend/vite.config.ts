import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  // Resolves the `~/*` alias from tsconfig.json. Native to Vite 8 — no plugin.
  resolve: { tsconfigPaths: true },
  server: {
    proxy: {
      // Proxy the whole API surface (tRPC procedures + `/api/images/...`) to the
      // backend. A regex key anchored to `/api/` — rather than the plain `/api`
      // prefix — so an SPA route whose segment merely starts with "api" (e.g. a
      // logbook slugged `api-docs-…`) isn't swept into the proxy.
      "^/api/": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
