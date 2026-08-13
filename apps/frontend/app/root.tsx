import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, useRouteError } from "react-router";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { bootstrapTokenFromHash } from "~/data/tokens.ts";
import "./globals.css";

// Harvest any `#token=<token>` fragment off the entry URL before React renders
// child routes, so the very first `listByTokens` / overview query sees the
// freshly-saved token. Runs once at module load; further calls are no-ops.
if (typeof window !== "undefined") {
  bootstrapTokenFromHash();
  // Own scroll restoration outright. The org chart is the one route where the
  // DOCUMENT scrolls (so a mobile browser will dismiss its address bar for it),
  // and it scrolls on BOTH axes; it keeps its own per-history-entry offsets and
  // reapplies them on mount. React Router's <ScrollRestoration> is deliberately
  // absent for the same reason — it restores with `scrollTo(0, y)`, which would
  // reset the chart's horizontal position on every back-navigation. Turning the
  // browser's own restoration off keeps it from racing us as well; every other
  // route scrolls inside a box, which nothing restores automatically anyway.
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
}

export const links = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&family=Lora:ital@0;1&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        {/* `minimum-scale=1` is load-bearing, not a zoom preference. The org
            chart is wider than a phone, and when a document overflows
            horizontally mobile browsers widen the LAYOUT viewport (up to
            1/minimum-scale) so the whole page can be pinched down to fit. That
            widening scales BOTH axes: `innerHeight`, `100vh`, `position: fixed`,
            and the sticky scrollport all grow past the visible area, and the
            page stops scrolling vertically at all. Pinning the minimum scale
            keeps the layout viewport equal to the visual viewport, so the
            document is what scrolls (which is what lets mobile browsers dismiss
            the address bar) and the chart's sticky geometry stays true. Zooming
            IN is still allowed. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1" />
        <title>Logarithmic</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details = error.status === 404 ? "This page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
  }
  return (
    <main className="max-w-2xl mx-auto px-8 py-16">
      <h1 className="font-serif text-5xl mb-3 text-primary">{message}</h1>
      <p className="text-muted">{details}</p>
    </main>
  );
}
