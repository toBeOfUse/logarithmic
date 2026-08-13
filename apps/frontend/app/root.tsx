import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { bootstrapTokenFromHash } from "~/data/tokens.ts";
import "./globals.css";

// Harvest any `#token=<token>` fragment off the entry URL before React renders
// child routes, so the very first `listByTokens` / overview query sees the
// freshly-saved token. Runs once at module load; further calls are no-ops.
if (typeof window !== "undefined") {
  bootstrapTokenFromHash();
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
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Logarithmic</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
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
