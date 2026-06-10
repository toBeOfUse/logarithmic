/**
 * Organizational view — chart layout.
 *
 * The forest is drawn as a horizontal tree of cards: a parent sits directly to
 * the LEFT of its children (one column over) and its card stretches downward to
 * span the full vertical extent of its descendants, so each subtree reads as a
 * single block. Higher column numbers sit further left; column 0 is body text,
 * columns > 0 are headings (bold titles), columns < 0 are asides (secondary
 * color). Only the columns the data needs are shown, unioned with a default
 * [1, 0, -1] working set so there's always a heading / body / aside column to
 * seed a root into.
 *
 * Entries whose subtree branches anywhere — i.e. the entry, or any descendant,
 * has more than one child — get a "sticky" card: as you scroll, its content
 * pins near the top of the viewport and its box bottom pins near the bottom, so
 * it stays on screen while any descendant is visible. Single chains never grow
 * tall, so they don't stick.
 *
 * Hovering a card swaps its meta line for three actions: rename (pencil),
 * reorder siblings (↑↓, opens the rearrange modal), and add child (↳). Layout
 * and sizing live in OrgView.module.css under custom properties.
 */
import { type CSSProperties, Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import type { EntryNode } from "logarithmic-backend/api-types";

import { cn } from "~/lib/cn.ts";
import { routeSegment } from "~/lib/route-segment.ts";

import styles from "./OrgView.module.css";
import { RearrangeModal } from "./RearrangeModal.tsx";

type AddInput = { col: number; parentId: number | null };

/**
 * The single input cell that can be live in the org view at a time — either one
 * being added under a parent, or one in place of an existing entry being
 * renamed. Per spec, "input cells only exist while they're focused, and there
 * should never be a need to render two at once."
 */
type PendingInput =
  | { kind: "add"; col: number; parentId: number | null }
  | { kind: "rename"; entryId: number };

// ── Tree helpers ───────────────────────────────────────────────────────

/** Index every node in the forest by id; also record each node's parent id. */
function indexForest(forest: EntryNode[]): {
  byId: Map<number, EntryNode>;
  parentOf: Map<number, number | null>;
} {
  const byId = new Map<number, EntryNode>();
  const parentOf = new Map<number, number | null>();
  const walk = (nodes: EntryNode[], parent: number | null) => {
    for (const n of nodes) {
      byId.set(n.id, n);
      parentOf.set(n.id, parent);
      walk(n.children, n.id);
    }
  };
  walk(forest, null);
  return { byId, parentOf };
}

function colRange(forest: EntryNode[]): { min: number; max: number } {
  let min = Infinity,
    max = -Infinity;
  const walk = (arr: EntryNode[]) => {
    for (const e of arr) {
      if (e.col < min) min = e.col;
      if (e.col > max) max = e.col;
      walk(e.children);
    }
  };
  walk(forest);
  if (min === Infinity) return { min: 0, max: 0 };
  return { min, max };
}

/**
 * The set of entries that should stick while scrolling: those whose subtree
 * branches anywhere (the entry itself, or any descendant, has more than one
 * child). This is exactly the set of entries that ever grow taller than a
 * single card, so it's also the set worth pinning.
 */
function computeStickySet(forest: EntryNode[]): Set<number> {
  const sticky = new Set<number>();
  const visit = (n: EntryNode): boolean => {
    let branchy = n.children.length > 1;
    for (const c of n.children) {
      if (visit(c)) branchy = true;
    }
    if (branchy) sticky.add(n.id);
    return branchy;
  };
  forest.forEach(visit);
  return sticky;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "Dec 12th, 2026" — the card-design "Date Updated". */
function formatCardDate(d: Date): string {
  const month = d.toLocaleDateString(undefined, { month: "short" });
  return `${month} ${ordinal(d.getDate())}, ${d.getFullYear()}`;
}

function colVar(idx: number): CSSProperties {
  return { "--org-col-idx": idx } as CSSProperties;
}

function titleColClass(col: number): string | undefined {
  if (col < 0) return styles.isAside;
  if (col > 0) return styles.isHeading;
  return undefined;
}

// ── Cards ──────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  logbookSegment,
  sticky,
  onAddChild,
  onRename,
  onReorder,
}: {
  entry: EntryNode;
  logbookSegment: string;
  sticky: boolean;
  onAddChild: () => void;
  onRename: () => void;
  onReorder: () => void;
}) {
  return (
    <div
      data-entry-anchor={entry.id}
      className={cn(styles.card, sticky && styles.sticky, titleColClass(entry.col))}
    >
      <div className={styles.cardBody}>
        <Link
          to={`/${logbookSegment}/${routeSegment(entry.slug, entry.id)}`}
          className={styles.cardLink}
          draggable={false}
        >
          <span className={cn(styles.cardTitle, !entry.name && styles.isUntitled)}>
            {entry.name || "Unnamed entry"}
          </span>
        </Link>

        <div className={styles.cardFooter}>
          <span className={styles.cardMeta}>
            {formatCardDate(entry.updatedAt)}
            {/* Word-count placeholder: counting efficiently needs a backend
                field. Append " · {n} words" here once the overview supplies it. */}
          </span>
          <div className={styles.cardActions}>
            <button
              type="button"
              className={styles.cardAction}
              aria-label="Rename"
              title="Rename"
              onClick={onRename}
            >
              <i className="ri-pencil-line" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.cardAction}
              aria-label="Reorder siblings"
              title="Reorder siblings"
              onClick={onReorder}
            >
              <i className="ri-arrow-up-down-line" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.cardAction}
              aria-label="Add child"
              title="Add child"
              onClick={onAddChild}
            >
              <i className="ri-corner-down-right-line" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The shared input card. Used both for adding a new entry (initialValue="") and
 * for renaming an existing one. Submission is single-fire: whichever of blur or
 * Enter happens first commits the value; Escape commits the cancel path. The
 * caller decides whether an empty submission creates/renames or is a no-op (per
 * spec, both flows treat an all-whitespace value as "no change").
 */
function InputCard({
  initialValue,
  sticky,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  sticky: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  return (
    <div className={cn(styles.card, styles.cardEditing, sticky && styles.sticky)}>
      <div className={styles.cardBody}>
        <input
          ref={inputRef}
          className={styles.cardInput}
          defaultValue={initialValue}
          onBlur={(e) => {
            if (settledRef.current) return;
            settledRef.current = true;
            onSubmit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (settledRef.current) return;
              settledRef.current = true;
              onSubmit(e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (settledRef.current) return;
              settledRef.current = true;
              onCancel();
            }
          }}
        />
      </div>
    </div>
  );
}

// ── Subtree ────────────────────────────────────────────────────────────

function Subtree({
  node,
  logbookSegment,
  stickySet,
  pendingInput,
  onAdd,
  onRename,
  onReorder,
  onSubmitPending,
  onCancelPending,
}: {
  node: EntryNode;
  logbookSegment: string;
  stickySet: Set<number>;
  pendingInput: PendingInput | null;
  onAdd: (input: AddInput) => void;
  onRename: (id: number) => void;
  onReorder: (id: number) => void;
  onSubmitPending: (name: string) => void;
  onCancelPending: () => void;
}) {
  const isRenaming = pendingInput?.kind === "rename" && pendingInput.entryId === node.id;
  const addingHere = pendingInput?.kind === "add" && pendingInput.parentId === node.id;
  const sticky = stickySet.has(node.id);
  const childCol = node.col - 1;
  // The child column exists when there are children, or when a child is being
  // added under this node (so the first child's input has somewhere to live).
  const hasChildCol = node.children.length > 0 || addingHere;

  return (
    <div className={styles.subtree}>
      <div className={styles.cell}>
        {isRenaming ? (
          <InputCard
            initialValue={node.name}
            sticky={sticky}
            onSubmit={onSubmitPending}
            onCancel={onCancelPending}
          />
        ) : (
          <EntryCard
            entry={node}
            logbookSegment={logbookSegment}
            sticky={sticky}
            onAddChild={() => onAdd({ col: childCol, parentId: node.id })}
            onRename={() => onRename(node.id)}
            onReorder={() => onReorder(node.id)}
          />
        )}
      </div>

      {hasChildCol && (
        <div className={styles.childCol}>
          {node.children.map((child) => (
            <Subtree
              key={child.id}
              node={child}
              logbookSegment={logbookSegment}
              stickySet={stickySet}
              pendingInput={pendingInput}
              onAdd={onAdd}
              onRename={onRename}
              onReorder={onReorder}
              onSubmitPending={onSubmitPending}
              onCancelPending={onCancelPending}
            />
          ))}
          {/* Adding a sibling here is the hover "Add child" action's job, so
              the column holds only children plus the live add-input (if any). */}
          {addingHere && (
            <InputCard
              initialValue=""
              sticky={false}
              onSubmit={onSubmitPending}
              onCancel={onCancelPending}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export function OrgView({
  forest,
  logbookId,
  logbookSlug,
  pendingInput,
  focusEntryId,
  onAdd,
  onRename,
  onSubmitPending,
  onCancelPending,
  onReorderSiblings,
  onFocused,
}: {
  forest: EntryNode[];
  logbookId: string;
  logbookSlug: string;
  /** The single live input cell — adding a new entry or renaming one. */
  pendingInput: PendingInput | null;
  /** When set, that entry is scrolled into view and its link focused. */
  focusEntryId: number | null;
  onAdd: (input: AddInput) => void;
  onRename: (id: number) => void;
  onSubmitPending: (name: string) => void;
  onCancelPending: () => void;
  onReorderSiblings: (parentId: number | null, ids: number[]) => void;
  onFocused: () => void;
}) {
  const logbookSegment = routeSegment(logbookSlug, logbookId);
  const isEmpty = forest.length === 0;
  const { byId, parentOf } = useMemo(() => indexForest(forest), [forest]);
  const { min: dataMin, max: dataMax } = useMemo(() => colRange(forest), [forest]);
  const stickySet = useMemo(() => computeStickySet(forest), [forest]);

  // Header columns: the data range, unioned with the default working set
  // [1, 0, -1] (heading / body / aside) so there's always somewhere to add a
  // root even in a sparse or empty logbook. For balanced data this collapses
  // to exactly the columns in use — only the necessary columns are shown.
  const maxCol = Math.max(dataMax, 1);
  const minCol = Math.min(dataMin, -1);
  const cols: number[] = [];
  for (let c = maxCol; c >= minCol; c--) cols.push(c);

  // Drive the height of sticky cards imperatively. A sticky card has to both
  // span its subtree (so the box stretches down past its descendants) and be
  // shorter than its cell (so it has room to travel and pin) — a plain sticky
  // element can't do both. So each frame we set a sticky card's box to span
  // [max(cellTop, pinLine) .. min(cellBottom, viewportBottom − gap)]: its top
  // pins under the header with a gap, its bottom holds a gap above the viewport
  // floor while the subtree runs past it, and it shrinks back to the true
  // subtree bounds near either end. The cell (a sibling of the child column)
  // already stretches to the subtree's full height, so its rect is the span.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    const stickyClass = styles.sticky;
    if (!scrollEl || !stickyClass) return;
    const rootStyle = getComputedStyle(document.documentElement);
    const stripH = parseFloat(rootStyle.getPropertyValue("--org-strip-h")) || 50;
    const gap = parseFloat(rootStyle.getPropertyValue("--org-sticky-gap")) || 14;
    const pinTop = stripH + gap;

    let raf = 0;
    const apply = () => {
      raf = 0;
      const vpBottom = scrollEl.clientHeight - gap;
      const originTop = scrollEl.getBoundingClientRect().top;
      for (const card of scrollEl.querySelectorAll<HTMLElement>(`.${stickyClass}`)) {
        const cell = card.parentElement;
        const body = card.firstElementChild;
        if (!cell || !(body instanceof HTMLElement)) continue;
        const r = cell.getBoundingClientRect();
        const top = Math.max(r.top - originTop, pinTop);
        const bottom = Math.min(r.bottom - originTop, vpBottom);
        // Never shrink below the content; once the box would, the card keeps
        // its content height and `position: sticky` scrolls it up off the top
        // (its bottom held to the cell) so nothing is clipped.
        const contentH = body.offsetHeight + (card.offsetHeight - card.clientHeight);
        card.style.setProperty("--org-sticky-h", `${Math.max(bottom - top, contentH)}px`);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(scrollEl);
    return () => {
      scrollEl.removeEventListener("scroll", schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // Re-measure whenever the rendered cards change (tree edits, or an input
    // cell swapping in for a renamed entry).
  }, [forest, pendingInput]);

  // Focus the freshly-created entry's link (and scroll it into view) once it
  // shows up in the forest. The focus is what lets a second Enter follow the
  // link to the new entry's page; without it the keyboard flow stalls after the
  // input cell submits.
  useLayoutEffect(() => {
    if (focusEntryId === null) return;
    const node = document.querySelector<HTMLElement>(`[data-entry-anchor="${focusEntryId}"]`);
    if (!node) return;
    const link = node.querySelector<HTMLAnchorElement>("a");
    if (!link) return;
    link.focus();
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
    onFocused();
  }, [focusEntryId, onFocused, forest]);

  // Rearrange-modal state.
  const [rearrangeFor, setRearrangeFor] = useState<number | null>(null);
  const rearrangeContext = useMemo(() => {
    if (rearrangeFor === null) return null;
    const target = byId.get(rearrangeFor);
    if (!target) return null;
    const targetParent = parentOf.get(target.id) ?? null;
    const siblings = targetParent === null ? forest : (byId.get(targetParent)?.children ?? []);
    return { parentId: targetParent, siblings };
  }, [rearrangeFor, byId, parentOf, forest]);

  const addingRoot =
    pendingInput?.kind === "add" && pendingInput.parentId === null ? pendingInput : null;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden bg-paper"
      style={{ "--org-col-span": maxCol - minCol } as CSSProperties}
    >
      <div ref={scrollRef} className="flex flex-col overflow-auto bg-paper">
        <div className={styles.colStrip}>
          <div className={styles.colStripInner}>
            {cols.map((c) => (
              <div key={c} className={styles.colHead} style={colVar(maxCol - c)}>
                <span className={styles.colLabel}>Column {c}</span>
                <button
                  type="button"
                  className={styles.colAdd}
                  aria-label={`Add entry in column ${c}`}
                  title={`Add entry in column ${c}`}
                  onClick={() => onAdd({ col: c, parentId: null })}
                >
                  <i className="ri-add-line" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {isEmpty && !pendingInput ? (
          <div className="flex flex-col items-center justify-center flex-1 text-muted gap-3.5 py-16 px-10 text-center">
            <div className={styles.illustration} />
            <h3 className="text-lg font-semibold text-primary m-0">
              An empty logbook is a fine place to start.
            </h3>
            <p className="text-base text-muted m-0 max-w-xs">
              Click the <i className="ri-add-line align-middle text-base" aria-hidden="true" />{" "}
              under any column above to create your first entry there.
            </p>
          </div>
        ) : (
          <div className={styles.canvas}>
            {forest.map((root, i) => (
              <Fragment key={root.id}>
                {i > 0 && <div className={styles.treeDivider} aria-hidden="true" />}
                <div className={styles.tree} style={colVar(maxCol - root.col)}>
                  <Subtree
                    node={root}
                    logbookSegment={logbookSegment}
                    stickySet={stickySet}
                    pendingInput={pendingInput}
                    onAdd={onAdd}
                    onRename={onRename}
                    onReorder={(id) => setRearrangeFor(id)}
                    onSubmitPending={onSubmitPending}
                    onCancelPending={onCancelPending}
                  />
                </div>
              </Fragment>
            ))}
            {addingRoot && (
              <Fragment>
                {forest.length > 0 && <div className={styles.treeDivider} aria-hidden="true" />}
                <div className={styles.tree} style={colVar(maxCol - addingRoot.col)}>
                  <div className={styles.subtree}>
                    <div className={styles.cell}>
                      <InputCard
                        initialValue=""
                        sticky={false}
                        onSubmit={onSubmitPending}
                        onCancel={onCancelPending}
                      />
                    </div>
                  </div>
                </div>
              </Fragment>
            )}
          </div>
        )}
      </div>

      {rearrangeContext && (
        <RearrangeModal
          siblings={rearrangeContext.siblings}
          onCancel={() => setRearrangeFor(null)}
          onConfirm={(ids) => {
            onReorderSiblings(rearrangeContext.parentId, ids);
            setRearrangeFor(null);
          }}
        />
      )}
    </div>
  );
}
