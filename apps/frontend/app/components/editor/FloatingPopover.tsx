/**
 * The shared shell for the editor's floating UI: the selection toolbar, the link
 * URL form, the image alt-text form, and the image upload-failure toast.
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 *   - It portals to `document.body`. A popover rendered *inside* the
 *     contenteditable that contains a focusable control (an `<input>`) breaks the
 *     editor: focusing that control moves the DOM selection out of the editor
 *     root, which clears Lexical's selection. Any popover whose visibility is
 *     derived from that selection would then unmount the moment the user clicked
 *     into it — which is exactly what the image alt-text form used to do.
 *   - It flips below the anchor when there's no room above and clamps into the
 *     viewport, so a popover anchored near a screen edge stays on screen.
 *
 * The anchor is a viewport rect (a selection's bounding box, an image's box). Pass
 * `track` to keep it live — the popover then re-reads it every time it
 * repositions, so it follows the thing it's anchored to through scrolling and
 * through its own contents changing size. Omit it to freeze the popover at the
 * rect it opened with, which is what the link form wants (focusing its input
 * blurs the editor and collapses the selection it was anchored to).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "~/lib/cn.ts";

/** Gap between the anchor rect and the popover, and the minimum inset from the
 *  viewport edge when clamping. */
const OFFSET = 8;

/** these are standard styles for things that are commonly placed inside this component
 * as children: */
export const TOOL_BTN =
  "inline-flex size-7 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-base text-secondary transition-colors hover:bg-paper-soft hover:text-primary";
export const TOOL_SEP = "mx-1 my-0.5 w-px self-stretch bg-stark-border-soft";
/** A single-line text input styled for use inside a popover (the link URL form
 *  and the image alt-text form). */
export const POPOVER_INPUT =
  "rounded-sm border border-stark-border bg-stark-hover px-2 py-1 text-sm text-primary outline-none focus:border-accent";

type FloatingPopoverProps = {
  /** Viewport rect to anchor to; the popover renders nothing when null. */
  rect: DOMRect | null;
  /** Read the anchor's current rect. Omit to freeze at `rect`. */
  track?: () => DOMRect | null;
  /** Receives the popover element, so callers can exclude it from outside-click
   *  dismissal (see `useDismissOnOutsidePointerDown`). */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "className">;

export function FloatingPopover({
  rect,
  track,
  containerRef,
  className,
  children,
  ...rest
}: FloatingPopoverProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const elRef = containerRef ?? ownRef;
  // Latest `track` without making `position` (and the listeners bound to it)
  // change identity every render.
  const trackRef = useRef(track);
  trackRef.current = track;

  // The anchor the popover is currently sitting against. It starts life as the
  // `rect` prop, but `track` then replaces it as the page scrolls — so the prop
  // is adopted only when it actually changes, never re-applied on an incidental
  // re-render. Re-applying it is what made the alt-text form jump: the form
  // freezes `rect` at the moment it opened, so every keystroke re-rendered it
  // back to wherever the image had been before the user scrolled.
  const rectRef = useRef<DOMRect | null>(rect);
  const lastRectProp = useRef<DOMRect | null>(rect);
  if (rect !== lastRectProp.current) {
    lastRectProp.current = rect;
    if (rect) rectRef.current = rect;
  }

  const position = useCallback(() => {
    const el = elRef.current;
    // Re-read the tracked anchor rather than trusting the last stored one: this
    // runs after every content change too (the popover's own size shifts as its
    // contents do), and the anchor may have moved since it was stored.
    const anchor = trackRef.current?.() ?? rectRef.current;
    if (!el || !anchor) return;
    rectRef.current = anchor;
    const elRect = el.getBoundingClientRect();
    let top = anchor.top - elRect.height - OFFSET;
    if (top < OFFSET) top = anchor.bottom + OFFSET;
    let left = anchor.left + anchor.width / 2 - elRect.width / 2;
    left = Math.max(OFFSET, Math.min(left, window.innerWidth - elRect.width - OFFSET));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, []);

  // No dep array: the popover's own size changes with its contents (the toolbar's
  // active states, the alt-text input's value), and every one of those changes
  // moves where it should sit.
  useLayoutEffect(position);

  const anchored = rect !== null;
  useEffect(() => {
    if (!anchored) return;
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [anchored, position]);

  if (!rect) return null;

  return createPortal(
    <div
      ref={elRef}
      className={cn(
        "fixed z-(--z-toolbar) flex items-center gap-0.5 rounded-md border border-stark-border bg-stark p-1 shadow-lg",
        className,
      )}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Dismiss a popover when the user presses down anywhere outside it (and outside
 * whatever it's anchored to). Shared by the link form and the alt-text form so
 * both dismiss the same way.
 */
export function useDismissOnOutsidePointerDown(
  active: boolean,
  onDismiss: () => void,
  ...insideRefs: Array<React.RefObject<HTMLElement | null>>
): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  // Refs are stable across renders; snapshot them so the effect can depend only
  // on `active` rather than re-binding whenever the caller re-renders.
  const refsRef = useRef(insideRefs);
  refsRef.current = insideRefs;

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      for (const ref of refsRef.current) {
        if (ref.current?.contains(target)) return;
      }
      dismissRef.current();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [active]);
}
