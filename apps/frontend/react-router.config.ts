import type { Config } from "@react-router/dev/config";

export default {
  ssr: false,
  // Vite+ ships Vite 8, which always drives the build through the Vite
  // Environment API. React Router only configures per-environment build
  // outputs (client → build/client, server → build/server) and its build
  // orchestration/SPA prerender when this flag is on. Without it the server
  // build lands in build/client, clobbering the client bundle with empty
  // entry chunks and skipping index.html generation.
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
