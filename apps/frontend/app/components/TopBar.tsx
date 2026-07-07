import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";

import { cn } from "~/lib/cn";

type Crumb = { id: string | number; name: string; href?: string };

export type KebabMenuItem = {
  id: string;
  label: string;
  icon?: string;
  /** Tooltip text for action buttons; falls back to `label`. Unused for items
   *  shown inside the kebab menu, which already render their label inline. */
  title?: string;
  destructive?: boolean;
  onSelect: () => void;
};

export function TopBar({
  logbookSegment,
  logbookName,
  parents = [],
  currentName,
  menuItems = [],
  actions = [],
}: {
  /** Route segment for the current logbook (slug-id). */
  logbookSegment: string;
  logbookName: string;
  parents?: Crumb[];
  currentName?: string;
  /** Items tucked inside the kebab (⋯) menu. */
  menuItems?: KebabMenuItem[];
  /** Items shown as buttons beside the kebab, so they're a single click away.
   *  Use for the most reached-for actions on a route (e.g. "Focus"). */
  actions?: KebabMenuItem[];
}) {
  return (
    <div
      className={cn(
        // `relative z-(--z-header)` establishes a stacking layer above the
        // editor's floating toolbar (--z-toolbar) so a selection toolbar near
        // the top slides behind the bar rather than over it.
        "relative z-(--z-header) flex items-center h-11 px-3.5 border-b shrink-0 gap-3 text-md sm:text-sm",
        "bg-stark border-stark-border",
      )}
    >
      <span className="inline-flex items-center gap-1.5 tracking-tight mr-auto whitespace-nowrap overflow-x-auto scrollbar-none">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-primary font-semibold no-underline px-0.5 -mx-0.5"
          aria-label="Go to Logarithmic home"
          title="Go to Logarithmic home"
        >
          <i className="ri-home-line" aria-hidden="true" />
          Logarithmic
        </Link>
        <span className="text-stark-border font-normal">›</span>
        <Link
          to={`/${logbookSegment}`}
          className="inline-flex items-center gap-2 text-muted no-underline hover:text-primary px-0.5 -mx-0.5"
        >
          <i className="ri-book-2-line" aria-hidden="true" /> {logbookName}
        </Link>

        {(parents.length > 0 || currentName) &&
          parents.map((p) => (
            <span key={p.id} style={{ display: "contents" }}>
              <span className="text-stark-border">›</span>
              {p.href ? (
                <Link to={p.href} className="text-muted no-underline hover:text-primary">
                  {p.name}
                </Link>
              ) : (
                <span>{p.name}</span>
              )}
            </span>
          ))}

        {currentName && (
          <>
            <span className="text-stark-border">›</span>
            <span className="whitespace-nowrap text-primary font-medium">{currentName}</span>
          </>
        )}
      </span>

      <div className="flex items-center gap-1.5 shrink-0">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            title={action.title ?? action.label}
            className={cn(
              "text-sm font-medium border rounded-[6px] px-2 py-1 sm:px-3 sm:py-1.5 inline-flex items-center gap-[6px] cursor-pointer transition-colors no-underline whitespace-nowrap bg-stark",
              action.destructive
                ? "border-warn text-warn hover:bg-warn-bg"
                : "border-stark-border text-primary hover:bg-stark-hover",
            )}
            onClick={action.onSelect}
          >
            {action.icon && <i className={action.icon} aria-hidden="true" />}
            {action.label}
          </button>
        ))}
        <KebabMenu items={menuItems} />
      </div>
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
        className="size-10 text-xl sm:text-base border-0 bg-transparent text-muted rounded-[5px] inline-flex items-center justify-center enabled:cursor-pointer enabled:hover:bg-stark-hover enabled:hover:text-primary disabled:opacity-40 disabled:cursor-default"
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
          className="absolute right-0 top-[calc(100%+4px)] z-(--z-menu) min-w-[180px] bg-stark border border-stark-border rounded-md shadow-lg p-1"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={cn(
                "w-full text-left bg-transparent border-0 text-sm px-3 py-1.5 rounded-sm cursor-pointer inline-flex items-center gap-2",
                item.destructive
                  ? "text-warn hover:bg-warn-bg"
                  : "text-primary hover:bg-stark-hover",
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
