import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: { tsconfigPaths: true },
  root: __dirname,
  // this is apparently necessary for vite to find index.html when the cwd is
  // not apps/frontend (i.e. when the cwd is the project root instead)
  build: {
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
    },
  },
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
