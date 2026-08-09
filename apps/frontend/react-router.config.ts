import type { Config } from "@react-router/dev/config";

// Pure client-side rendering: `vite build` emits the static SPA to build/client,
// which is what the nginx image serves. React Router still runs a server build to
// prerender index.html — that is internal to the build, not a runtime server.
export default {
  ssr: false,
} satisfies Config;
