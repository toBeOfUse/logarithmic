/**
 * The shared entry-icon control: a trigger button showing the current icon,
 * plus a popover of icon choices. Used by the organizational view's cards
 * (resting and while editing) and by the content route's title row, so the
 * popover behaviour — portalled to <body> so a host's `overflow: hidden` can't
 * clip it, viewport-clamped, dismissed on Escape / scroll / resize — lives in
 * one place and the host only supplies the trigger's styling.
 *
 * When `onSelect` is omitted the icon is static (a non-interactive marker, e.g.
 * a not-yet-saved entry that has no id to set an icon on).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "~/lib/cn.ts";
import {
  ENTRY_ICONS,
  REMIX_FAMILY,
  entryIconClass,
  isDefaultEntryIcon,
} from "~/lib/entry-icons.ts";

export function IconPicker({
  iconName,
  iconFamily,
  onSelect,
  buttonClassName,
  defaultIconClassName,
  ariaLabel = "Change icon",
  keepFocusOnMouseDown = false,
}: {
  iconName: string | null;
  iconFamily: string | null;
  /** When omitted, the icon is static (non-interactive). */
  onSelect?: (iconName: string, iconFamily: string) => void;
  /** Class for the trigger button — sizing / colour for the host context. */
  buttonClassName?: string;
  /** Extra class applied to the icon glyph when it resolves to the default
   *  (used to dim the neutral "no distinct icon" marker). */
  defaultIconClassName?: string;
  ariaLabel?: string;
  /** Suppress the trigger's mousedown default so an adjacent focused field (a
   *  rename textarea) keeps focus while the picker is opened/used — otherwise
   *  the blur would commit the edit and unmount the input before a choice can
   *  be made. */
  keepFocusOnMouseDown?: boolean;
}) {
  const interactive = onSelect !== undefined;
  const [open, setOpen] = useState(false);
  // The trigger's on-screen rect, captured at open. The final popover position
  // is derived from it (once the popover is measured) so it can flip above the
  // trigger / clamp sideways to stay on screen — see the layout effect below.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const openPicker = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor(r);
    setPos({ top: r.bottom + 6, left: r.left });
    setOpen(true);
  };

  // Dismiss the popover on Escape, and on any scroll/resize (rather than trying
  // to keep its fixed position glued to a button that's moving with the page).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMove = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    document.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  // Keep the popover fully on screen: once it's measured, clamp its left, and
  // flip it above the trigger when opening below would run it off the bottom
  // (so the lower rows stay reachable without scrolling, e.g. near the bottom
  // edge). Runs in a layout effect (before paint) so the adjustment is applied
  // without a visible jump. Converges in one extra pass — recomputing from the
  // fixed anchor + measured size yields the same result, so no loop.
  useLayoutEffect(() => {
    if (!open || !pos || !anchor) return;
    const el = pickerRef.current;
    if (!el) return;
    const margin = 8;
    const gap = 6;
    const maxLeft = window.innerWidth - el.offsetWidth - margin;
    const left = Math.max(margin, Math.min(anchor.left, maxLeft));

    const below = anchor.bottom + gap;
    let top = below;
    if (below + el.offsetHeight > window.innerHeight - margin) {
      const above = anchor.top - gap - el.offsetHeight;
      top =
        above >= margin ? above : Math.max(margin, window.innerHeight - margin - el.offsetHeight);
    }
    if (top !== pos.top || left !== pos.left) setPos({ top, left });
  }, [open, pos, anchor]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={buttonClassName}
        aria-label={interactive ? ariaLabel : undefined}
        aria-hidden={interactive ? undefined : true}
        title={interactive ? ariaLabel : undefined}
        disabled={!interactive}
        // Keep a click on the icon from starting a drag or following an
        // enclosing link.
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          if (interactive && keepFocusOnMouseDown) e.preventDefault();
        }}
        onClick={(e) => {
          if (!interactive) return;
          e.preventDefault();
          e.stopPropagation();
          if (open) setOpen(false);
          else openPicker();
        }}
      >
        <i
          className={cn(
            "not-italic",
            entryIconClass(iconName, iconFamily),
            isDefaultEntryIcon(iconName, iconFamily) && defaultIconClassName,
          )}
          aria-hidden="true"
        />
      </button>
      {interactive &&
        open &&
        pos &&
        createPortal(
          <>
            {/* mousedown (not pointerdown) so preventDefault keeps an adjacent
                rename textarea focused while dismissing — clicking away here
                closes the picker without committing that edit. */}
            <div
              className="fixed inset-0 z-(--z-popover)"
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
              }}
            />
            <div
              ref={pickerRef}
              className="fixed z-(--z-popover) grid grid-cols-8 gap-[2px] p-[6px] bg-stark border border-stark-border rounded-md shadow-pop"
              style={{ top: pos.top, left: pos.left }}
              role="menu"
              aria-label="Choose an icon"
              // Keep focus where it was so picking an icon doesn't blur-commit
              // an adjacent edit; the choice's onClick still fires.
              onMouseDown={(e) => e.preventDefault()}
            >
              {ENTRY_ICONS.map((opt) => {
                const selected = iconName === opt.name && iconFamily === REMIX_FAMILY;
                return (
                  <button
                    key={opt.name}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    aria-label={opt.label}
                    title={opt.label}
                    className={cn(
                      "inline-flex items-center justify-center w-[30px] h-[30px] p-0 border-0 text-[1.15rem] leading-none cursor-pointer rounded-sm transition-colors",
                      selected
                        ? "bg-accent-soft text-accent ring-1 ring-inset ring-accent"
                        : "bg-transparent text-primary hover:bg-stark-hover hover:text-accent",
                    )}
                    onClick={() => {
                      onSelect?.(opt.name, REMIX_FAMILY);
                      setOpen(false);
                    }}
                  >
                    <i className={`ri-${opt.name} not-italic`} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
