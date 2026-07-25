import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: { tsconfigPaths: true },
  // `root` (not a manual rollup `input`) is what lets Vite find the app when
  // the cwd is the project root instead of apps/frontend. The reactRouter()
  // plugin owns the build inputs in framework mode; overriding them with
  // index.html — which has no module <script> — produces an empty entry chunk.
  root: resolve(__dirname),
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
