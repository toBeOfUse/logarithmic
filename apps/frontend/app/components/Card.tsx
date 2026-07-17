import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "~/lib/cn.ts";

/**
 * A simple card, extracted from the OrgView entry cards so the same box — a
 * sharp-cornered, bordered panel with a title and a muted meta line below it —
 * can be reused elsewhere (the splash-page logbook cards) and read as the same
 * family. Its geometry and type come from the shared --card-* tokens, so it
 * stays identical to the chart cards. Only the resting look is shared; the org
 * chart's sticky/drag/fold behavior stays in OrgView.
 *
 * Layout is `icon` (optional, leading) + `title` (+ optional trailing icon) +
 * `meta`. Supplying `href` renders the whole card as a link; `onClick` renders
 * it as a button; neither renders a static `div`.
 */

const base =
  "relative w-full min-h-card-min flex flex-col px-card-x py-card-y bg-stark border border-stark-border rounded-none text-primary text-left no-underline transition-colors";

// Links/buttons light on hover like an entry card and take a grayscale focus
// ring (the palette is monochrome for now).
const interactiveCls =
  "cursor-pointer hover:bg-stark-hover hover:border-stark-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

export function Card({
  icon,
  title,
  untitled,
  strong,
  trailingIcon,
  meta,
  busy,
  href,
  onClick,
  ariaLabel,
  className,
}: {
  /** Leading icon slot (self-sized). Omit for icon-less cards; the meta line
   *  then sits under the title with no indent. */
  icon?: ReactNode;
  title?: ReactNode;
  /** Render the title muted and italic — for an unnamed record. */
  untitled?: boolean;
  /** Use the heavier heading-column title weight (for top-level cards). */
  strong?: boolean;
  /** An icon shown right after the title (e.g. the ⊕ on a "create" card). */
  trailingIcon?: ReactNode;
  /** Secondary line under the title (a date, a count, a call to action). */
  meta?: ReactNode;
  /** Dim the card and mark it busy (e.g. a create-in-flight placeholder). */
  busy?: boolean;
  /** Render the card as a link to this path. */
  href?: string;
  /** Render the card as a button firing this handler. */
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const interactive = href != null || onClick != null;
  const cls = cn(base, interactive && interactiveCls, busy && "opacity-65", className);

  const body = (
    <>
      <div className={cn("flex gap-card-icon-gap", icon != null ? "items-start" : "items-center")}>
        {icon}
        <span
          className={cn(
            "min-w-0 line-clamp-3 break-words text-card-title",
            strong ? "font-card-title-strong" : "font-card-title",
            untitled ? "italic text-muted" : "text-primary",
            trailingIcon == null && "flex-1",
          )}
        >
          {title}
        </span>
        {trailingIcon != null && (
          <span className="shrink-0 inline-flex items-center leading-none text-primary">
            {trailingIcon}
          </span>
        )}
      </div>
      {meta != null && (
        <div className={cn("mt-1", icon != null && "ml-card-indent")}>
          <span className="block truncate text-card-meta text-muted">{meta}</span>
        </div>
      )}
    </>
  );

  if (href != null) {
    return (
      <Link to={href} className={cls} aria-label={ariaLabel}>
        {body}
      </Link>
    );
  }
  if (onClick != null) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-label={ariaLabel}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} aria-label={ariaLabel} aria-busy={busy || undefined}>
      {body}
    </div>
  );
}
