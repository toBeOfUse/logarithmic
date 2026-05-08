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
        "flex items-center h-11 px-3.5 border-b flex-shrink-0 gap-3 text-sm",
        isPaper ? "bg-paper border-paper-edge" : "bg-stark border-stark-border",
      )}
    >
      <span className="inline-flex items-center gap-[7px] font-semibold tracking-tight text-primary">
        <i className="ri-book-2-line text-muted" aria-hidden="true" />
        <Link to={`/${logbookId}`} className="ml-1.5 text-primary no-underline font-semibold">
          {logbookName}
        </Link>
      </span>

      {(parents.length > 0 || currentName) && (
        <span className="flex items-center gap-1.5 text-muted min-w-0">
          {parents.map((p) => (
            <span key={p.id} style={{ display: "contents" }}>
              <span className="text-paper-edge">›</span>
              {p.href ? (
                <Link
                  to={p.href}
                  className="whitespace-nowrap overflow-hidden text-ellipsis text-[inherit] no-underline hover:text-primary"
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
              <span className="text-paper-edge">›</span>
              <span className="whitespace-nowrap overflow-hidden text-ellipsis text-primary font-medium">
                {currentName}
              </span>
            </>
          )}
        </span>
      )}

      <span className="flex-1" />

      <button
        type="button"
        className="size-[26px] border-0 bg-transparent text-muted rounded-[5px] cursor-pointer inline-flex items-center justify-center text-base hover:bg-stark-border-soft hover:text-primary"
        aria-label="Search"
      >
        <i className="ri-search-line" />
      </button>
      <Link
        to="/"
        className="size-[26px] border-0 bg-transparent text-muted rounded-[5px] cursor-pointer inline-flex items-center justify-center no-underline text-base hover:bg-warn-soft hover:text-warn"
        aria-label="Close logbook"
      >
        <i className="ri-close-line" />
      </Link>
    </div>
  );
}
