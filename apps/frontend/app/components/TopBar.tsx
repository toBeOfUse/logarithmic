import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";

import { cn } from "~/lib/cn";

type Crumb = { id: string | number; name: string; href?: string };

export type KebabMenuItem = {
  id: string;
  label: string;
  icon?: string;
  destructive?: boolean;
  onSelect: () => void;
};

export function TopBar({
  variant = "stark",
  logbookSegment,
  logbookName,
  parents = [],
  currentName,
  menuItems = [],
}: {
  variant?: "stark" | "paper";
  /** Route segment for the current logbook (slug-id). */
  logbookSegment: string;
  logbookName: string;
  parents?: Crumb[];
  currentName?: string;
  menuItems?: KebabMenuItem[];
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
        <i className="ri-home-line text-muted" aria-hidden="true" />
        <Link to={`/${logbookSegment}`} className="text-primary no-underline font-semibold">
          {logbookName}
        </Link>
      </span>

      {(parents.length > 0 || currentName) && (
        <span className="flex items-center gap-1.5 text-muted min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {parents.map((p) => (
            <span key={p.id} style={{ display: "contents" }}>
              <span className="text-paper-edge">›</span>
              {p.href ? (
                <Link
                  to={p.href}
                  className="whitespace-nowrap text-[inherit] no-underline hover:text-primary"
                >
                  {p.name}
                </Link>
              ) : (
                <span className="whitespace-nowrap">{p.name}</span>
              )}
            </span>
          ))}
          {currentName && (
            <>
              <span className="text-paper-edge">›</span>
              <span className="whitespace-nowrap text-primary font-medium">{currentName}</span>
            </>
          )}
        </span>
      )}

      {!(parents.length > 0 || currentName) && <span className="flex-1" />}

      <KebabMenu items={menuItems} />

      <Link
        to="/"
        className="size-6 border-0 bg-transparent text-muted rounded-[5px] cursor-pointer inline-flex items-center justify-center no-underline text-base hover:bg-warn-soft hover:text-warn"
        aria-label="Close logbook"
      >
        <i className="ri-close-line" />
      </Link>
    </div>
  );
}

function KebabMenu({ items }: { items: KebabMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const hasItems = items.length > 0;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        className="size-6 border-0 bg-transparent text-muted rounded-[5px] inline-flex items-center justify-center text-base enabled:cursor-pointer enabled:hover:bg-stark-soft enabled:hover:text-primary disabled:opacity-40 disabled:cursor-default"
        aria-label="Open menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={hasItems ? menuId : undefined}
        disabled={!hasItems}
        onClick={() => setOpen((v) => !v)}
      >
        <i className="ri-more-2-fill" aria-hidden="true" />
      </button>
      {open && hasItems && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[180px] bg-stark border border-stark-border rounded-md shadow-lg p-1"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={cn(
                "w-full text-left bg-transparent border-0 [font:inherit] text-sm px-3 py-1.5 rounded-sm cursor-pointer inline-flex items-center gap-2",
                item.destructive
                  ? "text-warn hover:bg-warn-soft"
                  : "text-primary hover:bg-stark-soft",
              )}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon && <i className={item.icon} aria-hidden="true" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
