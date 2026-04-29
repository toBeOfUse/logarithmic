import { Link } from "react-router";

import { cn } from "~/lib/cn";

type Crumb = { id: string; name: string; href?: string };

export function TopBar({
  variant = "stark",
  logbookId,
  logbookName,
  parents = [],
  currentName,
}: {
  variant?: "stark" | "paper";
  logbookId: string;
  logbookName: string;
  parents?: Crumb[];
  currentName?: string;
}) {
  const isPaper = variant === "paper";
  return (
    <div
      className={cn(
        "flex items-center h-11 px-3.5 border-b flex-shrink-0 gap-3 text-[12.5px]",
        isPaper ? "bg-paper border-paper-edge" : "bg-stark border-stark-border",
      )}
    >
      <span className="inline-flex items-center gap-[7px] font-semibold tracking-tight text-ink">
        <i className="ri-book-2-line text-ink-3" aria-hidden="true" />
        <Link to={`/${logbookId}`} className="ml-1.5 text-ink no-underline font-semibold">
          {logbookName}
        </Link>
      </span>

      {(parents.length > 0 || currentName) && (
        <span className="flex items-center gap-1.5 text-ink-3 text-[12.5px] min-w-0">
          {parents.map((p) => (
            <span key={p.id} style={{ display: "contents" }}>
              <span className="text-ink-5">›</span>
              {p.href ? (
                <Link
                  to={p.href}
                  className="whitespace-nowrap overflow-hidden text-ellipsis text-[inherit] no-underline hover:text-ink"
                >
                  {p.name}
                </Link>
              ) : (
                <span className="whitespace-nowrap overflow-hidden text-ellipsis">{p.name}</span>
              )}
            </span>
          ))}
          {currentName && (
            <>
              <span className="text-ink-5">›</span>
              <span className="whitespace-nowrap overflow-hidden text-ellipsis text-ink font-medium">
                {currentName}
              </span>
            </>
          )}
        </span>
      )}

      <span className="flex-1" />

      <button
        type="button"
        className="size-[26px] border-0 bg-transparent text-ink-3 rounded-[5px] cursor-pointer inline-flex items-center justify-center text-[14px] hover:bg-[oklch(0.95_0.003_250)] hover:text-ink"
        aria-label="Search"
      >
        <i className="ri-search-line" />
      </button>
      <Link
        to="/"
        className="size-[26px] border-0 bg-transparent text-ink-3 rounded-[5px] cursor-pointer inline-flex items-center justify-center no-underline text-[14px] hover:bg-[oklch(0.92_0.02_30)] hover:text-[oklch(0.4_0.12_30)]"
        aria-label="Close logbook"
      >
        <i className="ri-close-line" />
      </Link>
    </div>
  );
}
