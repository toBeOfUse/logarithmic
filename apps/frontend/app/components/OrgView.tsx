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
 * Hovering a card swaps its meta line for actions: rename (pencil), delete
 * (trash), and add child (sticky-note-add); root cards add a column-shift arrow
 * on each end. On touch devices (no hover) a "⋯" button on the meta line reveals
 * that same row.
 *
 * Branching cards additionally show a fold button in place of their icon on
 * hover: folding hides the entry's descendants (a client-only view state),
 * collapsing a big subtree to a single "N collapsed entries" placeholder; the
 * same button (now an expand) unfolds it. The card icon is therefore only
 * editable while the card is in its editing state (see InputCard), not from the
 * resting card. Layout and sizing live in OrgView.module.css under custom
 * properties.
 */
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  type CSSProperties,
  Fragment,
  memo,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

import type { ColumnSetting, EntryNode, MoveEntryInput } from "logarithmic-backend/api-types";

import { cn } from "~/lib/cn.ts";
import { entryIconClass, isDefaultEntryIcon } from "~/lib/entry-icons.ts";
import { routeSegment } from "~/lib/route-segment.ts";

import { IconPicker } from "./IconPicker.tsx";

import styles from "./OrgView.module.css";

export type AddInput = { col: number; parentId: number | null };

/**
 * Per-logbook scroll offset for the org view's inner scroll container. The chart
 * scrolls inside this element rather than the window, so React Router's
 * ScrollRestoration doesn't cover it; we stash the offset here so returning from
 * an entry's page restores the position the user left from. Module-level so it
 * survives the route unmount/remount that navigation causes.
 */
const orgScrollByLogbook = new Map<string, { top: number; left: number }>();

/**
 * Per-logbook set of folded entry ids. Folding is a view concern — it hides an
 * entry's descendants in the chart without touching the data — so it lives only
 * on the client, and is stashed module-level (keyed by logbook, like the scroll
 * offset above) so a fold survives the route unmount/remount that navigating
 * into an entry and back causes.
 */
const orgFoldedByLogbook = new Map<string, Set<number>>();

/**
 * The single input cell that can be live in the org view at a time — either one
 * being added under a parent, or one in place of an existing entry being
 * renamed. Per spec, "input cells only exist while they're focused, and there
 * should never be a need to render two at once."
 */
export type PendingInput =
  | { kind: "add"; col: number; parentId: number | null }
  | { kind: "rename"; entryId: number };

/**
 * A submitted-but-unconfirmed new entry. Creation waits on the server for the
 * real id, so during the round trip we render a loading placeholder in the new
 * entry's slot (a new last child of `parentId`, or a new last root when null).
 */
export type PendingCreate = {
  col: number;
  parentId: number | null;
  name: string;
  /** The icon chosen in the input cell, shown on the loading placeholder so the
   *  pick is visible during the create round trip. */
  iconName: string | null;
  iconFamily: string | null;
};

/**
 * What a drop zone means, attached to each dnd-kit droppable. "before"/"after"
 * are relative to an existing entry (drop above it → preceding sibling, below
 * → following sibling); "child" reparents the dragged entry as the last child
 * of `parentId` (a childless entry's pseudo-card child drop zone).
 */
type DropData = { kind: "before" | "after"; refId: number } | { kind: "child"; parentId: number };

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

/** How many entries sit under `node` (all descendants, excluding `node`). */
function countDescendants(node: EntryNode): number {
  let n = 0;
  for (const c of node.children) n += 1 + countDescendants(c);
  return n;
}

/** The ids in `node`'s subtree, including `node` itself. */
function subtreeIds(node: EntryNode): Set<number> {
  const ids = new Set<number>();
  const walk = (n: EntryNode) => {
    ids.add(n.id);
    n.children.forEach(walk);
  };
  walk(node);
  return ids;
}

/**
 * Convert a drop target into the API's `MoveEntryInput`. Drop zones describe
 * intent relative to a neighbour or parent; the server wants an absolute
 * `{parentId, col, position}` triple, and we have the forest here to bridge
 * the two. Returns null for self-drops and other no-ops. The dragged entry is
 * excluded from sibling lists so positions count the post-removal ordering,
 * matching the server's move semantics.
 */
function dropToMoveInput(
  draggedId: number,
  drop: DropData,
  byId: Map<number, EntryNode>,
  parentOf: Map<number, number | null>,
  forest: EntryNode[],
  logbookId: string,
): MoveEntryInput | null {
  const siblingsOf = (parentId: number | null): EntryNode[] => {
    const list = parentId === null ? forest : (byId.get(parentId)?.children ?? []);
    return list.filter((n) => n.id !== draggedId);
  };

  if (drop.kind === "before" || drop.kind === "after") {
    if (drop.refId === draggedId) return null;
    const ref = byId.get(drop.refId);
    if (!ref) return null;
    const refParentId = parentOf.get(ref.id) ?? null;
    const parent = refParentId !== null ? byId.get(refParentId) : null;
    // A child's column is its parent's minus one; a root keeps the reference
    // root's column.
    const col = parent ? parent.col - 1 : ref.col;
    const sibs = siblingsOf(refParentId);
    const refIdx = sibs.findIndex((s) => s.id === ref.id);
    if (refIdx < 0) return null;
    const position = drop.kind === "before" ? refIdx : refIdx + 1;
    return { logbookId, id: draggedId, parentId: refParentId, col, position };
  }

  // kind === "child": become the new last child of `parentId`.
  if (drop.kind === "child") {
    if (drop.parentId === draggedId) return null;
    const parent = byId.get(drop.parentId);
    if (!parent) return null;
    return {
      logbookId,
      id: draggedId,
      parentId: parent.id,
      col: parent.col - 1,
      position: siblingsOf(parent.id).length,
    };
  }
  return null;
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

/**
 * A column's editable presentation: its display name (empty → rendered as
 * "Column N") and whether it uses the wide body width or the narrow column
 * width. Held per column in OrgView's ephemeral `columnConfig` map.
 */
export type ColumnConfig = { name: string; wide: boolean };

/** The config a column falls back to when unset: no custom name, and wide only
 *  for column 0 (the body column). `existing` carries over any partial override
 *  already stored, so updating one field leaves the other intact. */
function defaultColumnConfig(c: number, existing?: ColumnConfig): ColumnConfig {
  return existing ?? { name: "", wide: c === 0 };
}

/** The persisted `ColumnSetting[]` (from the logbook) as a by-column map for
 *  local editing. */
function columnsToConfig(columns: ColumnSetting[]): Map<number, ColumnConfig> {
  return new Map(columns.map((c) => [c.col, { name: c.name, wide: c.wide }]));
}

/** The local by-column map back into the `ColumnSetting[]` the API persists. */
function configToColumns(config: Map<number, ColumnConfig>): ColumnSetting[] {
  return [...config].map(([col, c]) => ({ col, name: c.name, wide: c.wide }));
}

/** Pick a cell/card's width: wide columns get the body width, the rest the
 *  narrow column width. Which columns are wide is configurable in the column
 *  edit mode (column 0 wide by default); `wideCols` holds the current set. */
function widthVar(c: number, wideCols: ReadonlySet<number>): CSSProperties {
  return {
    "--col-width": wideCols.has(c) ? "var(--org-card-width-0)" : "var(--org-card-width)",
  } as CSSProperties;
}

function titleColClass(col: number): string | undefined {
  if (col < 0) return styles.isAside;
  if (col > 0) return styles.isHeading;
  return undefined;
}

// ── Cards ──────────────────────────────────────────────────────────────

/**
 * The icon shown at the left of a card's title. A thin wrapper over the shared
 * `IconPicker`, supplying the card-specific button styling. When `onSelect` is
 * given the icon is clickable and opens the icon-choice popover; when omitted
 * the icon is static (e.g. a not-yet-saved new entry that has no id to set an
 * icon on, or a foldable card whose icon slot is given to the fold button on
 * hover). The mousedown default is suppressed so clicking the icon while
 * renaming doesn't blur-commit the focused textarea.
 */
const EntryIcon = memo(function EntryIcon({
  iconName,
  iconFamily,
  onSelect,
}: {
  iconName: string | null;
  iconFamily: string | null;
  onSelect?: (iconName: string, iconFamily: string) => void;
}) {
  const interactive = onSelect !== undefined;
  return (
    <IconPicker
      iconName={iconName}
      iconFamily={iconFamily}
      onSelect={onSelect}
      buttonClassName={cn(styles.cardIcon, interactive && styles.cardIconInteractive)}
      defaultIconClassName={styles.cardIconDefault}
      keepFocusOnMouseDown
    />
  );
});

const EntryCard = memo(function EntryCard({
  entry,
  logbookSegment,
  sticky,
  foldable,
  folded,
  draggedId,
  draggedSubtreeIds,
  onAddChild,
  onRename,
  onDelete,
  onSelectIcon,
  onToggleFold,
  onShiftLeft,
  onShiftRight,
}: {
  entry: EntryNode;
  logbookSegment: string;
  /** Whether this card sticks/pins while scrolling. True only for an unfolded
   *  branching subtree — folding turns it off (a folded card no longer spans
   *  descendants), which also avoids its pinned height feeding back into the
   *  now-short cell. Distinct from `foldable` so a folded card still folds. */
  sticky: boolean;
  /** Whether this entry's subtree branches (so it can be folded). Drives the
   *  fold button, shown in place of the icon on hover — independent of `sticky`
   *  so the button stays available while folded. */
  foldable: boolean;
  /** Whether this entry is currently folded (descendants hidden). Selects the
   *  fold button's direction: expand (unfold) when folded, contract otherwise. */
  folded: boolean;
  /** The entry currently being dragged, or null if no drag is in progress. */
  draggedId: number | null;
  /** Ids in the dragged entry's subtree (incl. itself); null when idle. */
  draggedSubtreeIds: Set<number> | null;
  onAddChild: () => void;
  onRename: () => void;
  /** Delete this entry (and its whole subtree). Opens a confirmation first. */
  onDelete: () => void;
  /** Change this entry's icon from the resting card. Honoured only on
   *  non-foldable cards: a foldable card gives the icon's hover slot to the
   *  fold button, so its icon stays static (editable while renaming instead). */
  onSelectIcon: (iconName: string, iconFamily: string) => void;
  /** Fold this entry — hide its descendants behind a placeholder. Wired to the
   *  fold button, which shows only on sticky (unfolded, branching) cards. */
  onToggleFold: () => void;
  /**
   * Shift this card and its whole subtree one column left / right. Only roots
   * can move freely between columns (a non-root's column is pinned to its
   * parent's minus one), so these are passed for root cards only; when absent,
   * the arrow buttons aren't rendered.
   */
  onShiftLeft?: () => void;
  onShiftRight?: () => void;
}) {
  const canShift = onShiftLeft !== undefined && onShiftRight !== undefined;
  const isSource = entry.id === draggedId;
  const inDraggedSubtree = draggedSubtreeIds?.has(entry.id) ?? false;

  // On touch devices there's no hover to reveal the action row, so a "more"
  // (⋯) button toggles it open instead. Tapping anywhere outside the card
  // dismisses it. Hover-capable devices hide the button entirely (see CSS) and
  // keep using hover.
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menuOpen]);

  // After a drag, pointerup fires a click that would otherwise follow the
  // card's <Link>. Swallow that one click.
  const justDraggedRef = useRef(false);
  const draggable = useDraggable({ id: `entry:${entry.id}`, data: { entryId: entry.id } });
  useEffect(() => {
    if (draggable.isDragging) justDraggedRef.current = true;
  }, [draggable.isDragging]);
  // The draggable node ref doubles as our DOM handle for the outside-click test.
  const setCardRef = (el: HTMLDivElement | null) => {
    cardRef.current = el;
    draggable.setNodeRef(el);
  };

  // Drop targets. before/after are disabled across the dragged subtree (a node
  // can't become a sibling of itself or its own descendant). The "become last
  // child" target now lives on a separate pseudo-card drop zone (ChildDropzone)
  // rendered beside childless entries, not on this card's add-child button.
  const beforeDrop = useDroppable({
    id: `before:${entry.id}`,
    disabled: inDraggedSubtree,
    data: { kind: "before", refId: entry.id } satisfies DropData,
  });
  const afterDrop = useDroppable({
    id: `after:${entry.id}`,
    disabled: inDraggedSubtree,
    data: { kind: "after", refId: entry.id } satisfies DropData,
  });

  // After a drag, pointerup fires a click that would otherwise follow the
  // card's <Link>. Swallow that one click.
  const swallowClick = (e: ReactMouseEvent) => {
    if (justDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      justDraggedRef.current = false;
    }
  };

  const cardBody = (
    <div className={styles.cardBody}>
      <div className={styles.cardHeader}>
        {/* The resting card's icon is clickable to change at any time — except
              on branching (foldable) cards, whose icon slot is taken over by the
              fold button on hover (contract to fold, expand to unfold while
              folded); there the icon stays static and is editable while renaming
              instead (see InputCard). */}
        <EntryIcon
          iconName={entry.iconName}
          iconFamily={entry.iconFamily}
          onSelect={foldable ? undefined : onSelectIcon}
        />
        {foldable && (
          <button
            type="button"
            className={styles.cardFold}
            aria-label={folded ? "Unfold descendants" : "Fold descendants"}
            title={folded ? "Unfold descendants" : "Fold descendants"}
            aria-expanded={!folded}
            // Keep a click on the fold button from starting a drag or
            // following the card link.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFold();
            }}
          >
            <i
              // this seems to be the closest you can get to what i would see as
              // a "standard" accordion expand/collapse icon with remix icons
              className={folded ? "ri-arrow-down-s-line" : "ri-arrow-up-s-line"}
              style={{ transform: "scale(1.5)" }}
              aria-hidden="true"
            />
          </button>
        )}
        <Link
          to={`/${logbookSegment}/${routeSegment(entry.slug, entry.id)}`}
          className={styles.cardLink}
          draggable={false}
        >
          <span className={cn(styles.cardTitle, !entry.name && styles.isUntitled)}>
            {entry.name || "Unnamed entry"}
          </span>
        </Link>
      </div>

      <div className={styles.cardFooter}>
        <span className={styles.cardMeta}>
          {formatCardDate(entry.updatedAt)}
          {/* Word count is only meaningful once there's prose to count, so it's
                shown only for entries that have content. */}
          {entry.wordCount > 0 && ` · ${entry.wordCount} words`}
        </span>
        {/* Touch-only: reveals the action row (which hover would otherwise
              show). Hidden on hover-capable devices via CSS. Stop pointerdown
              AND touchstart so neither drag sensor engages on the tap — the
              TouchSensor would otherwise consume the gesture and swallow the
              click, leaving the menu un-toggled while the tap still focuses the
              button (which alone reveals the actions). */}
        <button
          type="button"
          className={styles.cardMore}
          aria-label="Show actions"
          title="Show actions"
          aria-expanded={menuOpen}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
        >
          <i className="ri-more-line" aria-hidden="true" />
        </button>
        {/* Stop pointerdown so the drag sensor doesn't fire when a button is
              clicked. */}
        <div className={styles.cardActions} onPointerDown={(e) => e.stopPropagation()}>
          {/* Root-only: move the whole subtree one column over. Higher column
                numbers sit further LEFT, so the left arrow raises the column and
                the right arrow lowers it. The left arrow is the first action and
                the right arrow is the last, bracketing the rest. */}
          {canShift && (
            <button
              type="button"
              className={styles.cardAction}
              aria-label="Move one column left"
              title="Move one column left"
              onClick={onShiftLeft}
            >
              <i className="ri-expand-left-line" aria-hidden="true" />
            </button>
          )}
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
            className={cn(styles.cardAction, styles.cardActionDanger)}
            aria-label="Delete"
            title="Delete"
            onClick={onDelete}
          >
            <i className="ri-delete-bin-line" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.cardAction}
            aria-label="Add child"
            title="Add child"
            onClick={onAddChild}
          >
            <i className="ri-sticky-note-add-line" aria-hidden="true" />
          </button>
          {canShift && (
            <button
              type="button"
              className={styles.cardAction}
              aria-label="Move one column right"
              title="Move one column right"
              onClick={onShiftRight}
            >
              <i className="ri-expand-right-line" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const dropHalves = (
    <>
      {/* Drop halves: top → sibling-before, bottom → sibling-after. */}
      <div
        ref={beforeDrop.setNodeRef}
        className={cn(styles.cardDrop, styles.top, beforeDrop.isOver && styles.isOver)}
        aria-hidden="true"
      />
      <div
        ref={afterDrop.setNodeRef}
        className={cn(styles.cardDrop, styles.bottom, afterDrop.isOver && styles.isOver)}
        aria-hidden="true"
      />
    </>
  );

  // Non-sticky cards stay a single element: content at the top, the box filling
  // the (content-height) cell, the drop halves over the whole card.
  if (!sticky) {
    return (
      <div
        ref={setCardRef}
        data-entry-anchor={entry.id}
        className={cn(
          styles.card,
          foldable && styles.foldable,
          menuOpen && styles.menuOpen,
          titleColClass(entry.col),
          isSource && styles.isSource,
        )}
        onClickCapture={swallowClick}
        {...draggable.attributes}
        {...draggable.listeners}
      >
        {cardBody}
        {dropHalves}
      </div>
    );
  }

  // Sticky cards split into two stacked layers so the readable content never
  // rides on the element the scroll effect resizes:
  //   • .cardSpan — side + bottom borders and fill; the ONLY resized element,
  //     and the host for the full-height drop zones.
  //   • .stickyHeader — top border + content, natively `position: sticky` and
  //     never resized, so it stays glued to the compositor (no scroll lag).
  // Both pin to the same line in the same containing block (.cardStack), so
  // their top edges and side borders coincide and they ride up together at the
  // tail — no seams.
  return (
    <div
      ref={(el) => {
        cardRef.current = el;
      }}
      className={cn(styles.cardStack, isSource && styles.isSource)}
    >
      <div className={styles.cardSpan} data-sticky-box="">
        {dropHalves}
      </div>
      <div
        ref={draggable.setNodeRef}
        data-entry-anchor={entry.id}
        data-sticky-floor=""
        className={cn(
          styles.card,
          styles.stickyHeader,
          foldable && styles.foldable,
          menuOpen && styles.menuOpen,
          titleColClass(entry.col),
        )}
        onClickCapture={swallowClick}
        {...draggable.attributes}
        {...draggable.listeners}
      >
        {cardBody}
      </div>
    </div>
  );
});

/**
 * The shared input card. Used both for adding a new entry (initialValue="") and
 * for renaming an existing one. Submission is single-fire: whichever of blur or
 * Enter happens first commits the value; Escape commits the cancel path. The
 * caller decides whether an empty submission creates/renames or is a no-op (per
 * spec, both flows treat an all-whitespace value as "no change").
 */
const InputCard = memo(function InputCard({
  initialValue,
  sticky,
  iconName = null,
  iconFamily = null,
  onSelectIcon,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  sticky: boolean;
  /** The edited entry's icon. Defaults to none (a brand-new add input). */
  iconName?: string | null;
  iconFamily?: string | null;
  /** Rename of an existing entry: the icon is pickable and committed
   *  immediately via this callback. Omitted for a new entry, which has no id to
   *  set an icon on yet — there the pick is held locally (see `draftIcon`) and
   *  handed back through `onSubmit`. */
  onSelectIcon?: (iconName: string, iconFamily: string) => void;
  /** Commit the entry's name. The chosen icon is passed alongside so a
   *  brand-new entry can be created with it; on rename it's null (the icon was
   *  already committed via `onSelectIcon`). */
  onSubmit: (name: string, icon: { iconName: string; iconFamily: string } | null) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const settledRef = useRef(false);

  // Adding a new entry (no `onSelectIcon`): the picked icon has no saved entry
  // to attach to, so hold it locally and pass it at submit. Renaming
  // (`onSelectIcon` present): the icon commits immediately and the shown icon
  // comes from props.
  const adding = onSelectIcon === undefined;
  const [draftIcon, setDraftIcon] = useState<{ iconName: string; iconFamily: string } | null>(null);
  const shownName = adding ? (draftIcon?.iconName ?? null) : iconName;
  const shownFamily = adding ? (draftIcon?.iconFamily ?? null) : iconFamily;
  const handleSelectIcon = adding
    ? (n: string, f: string) => setDraftIcon({ iconName: n, iconFamily: f })
    : onSelectIcon;

  const submit = (value: string) => {
    if (settledRef.current) return;
    settledRef.current = true;
    onSubmit(value, adding ? draftIcon : null);
  };

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  return (
    <div
      className={cn(styles.card, styles.cardEditing, sticky && styles.cardSticky)}
      data-sticky-box={sticky ? "" : undefined}
    >
      <div className={styles.cardBody} data-sticky-floor="">
        <div className={styles.cardHeader}>
          <EntryIcon iconName={shownName} iconFamily={shownFamily} onSelect={handleSelectIcon} />
          <textarea
            ref={inputRef}
            className={styles.cardInput}
            rows={1}
            defaultValue={initialValue}
            onBlur={(e) => submit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit(e.currentTarget.value);
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
    </div>
  );
});

/**
 * Placeholder shown in a new entry's slot while its creation is in flight.
 * Entry creation isn't optimistic (the server assigns the id the link needs),
 * so we render the typed name with a spinner here until the server confirms,
 * at which point the real, focusable card replaces it.
 */
const LoadingCard = memo(function LoadingCard({
  name,
  iconName = null,
  iconFamily = null,
}: {
  name: string;
  iconName?: string | null;
  iconFamily?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <div ref={ref} className={cn(styles.card, "opacity-65")} aria-busy="true">
      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <EntryIcon iconName={iconName} iconFamily={iconFamily} />
          <span className={cn(styles.cardTitle, !name && styles.isUntitled)}>
            {name || "Unnamed entry"}
          </span>
        </div>
        <div className={styles.cardFooter}>
          <span className={cn(styles.cardMeta, "inline-flex items-center gap-1")}>
            <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
            Adding…
          </span>
        </div>
      </div>
    </div>
  );
});

/**
 * Stand-in shown in place of a folded entry's descendants: a single card in the
 * child column reading "N collapsed entries…", so the parent collapses back to
 * its natural height. Clicking it unfolds the subtree again.
 */
const FoldedPlaceholder = memo(function FoldedPlaceholder({
  count,
  onUnfold,
}: {
  count: number;
  onUnfold: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.foldedCard}
      onClick={onUnfold}
      aria-label={`Unfold ${count} ${count === 1 ? "entry" : "entries"}`}
      title="Unfold"
    >
      <i className={cn(styles.foldedCardIcon, "ri-expand-up-down-fill")} aria-hidden="true" />
      <span className={styles.foldedCardText}>
        {count} collapsed {count === 1 ? "entry" : "entries"}…
      </span>
    </button>
  );
});

/**
 * A dashed pseudo-card shown to the right of a childless entry while a drag is
 * in progress: dropping the dragged entry here makes it that entry's (first)
 * child. It replaces the old "drop on the add-child button" affordance, giving
 * childless entries — which otherwise have no child column to drop into — a
 * visible target.
 *
 * It occupies the would-be child column (`col`), so it's the full width of that
 * column, one column-gap to the right of the entry — except when the entry sits
 * in the lowest visible column, in which case its child column falls past the
 * right edge of the chart; that one is rendered `narrow` (a sixth of a column,
 * closer to its card) so it doesn't blow out the page gutter. See
 * `.childDropzone` in the stylesheet.
 */
const ChildDropzone = memo(function ChildDropzone({
  parentId,
  col,
  narrow,
  wideCols,
}: {
  parentId: number;
  /** The would-be child column, used to size a full-width drop zone. */
  col: number;
  /** Whether this drop zone sits past the lowest visible column (rendered as a
   *  narrow stub instead of a full column-width box). */
  narrow: boolean;
  /** The set of wide columns, so a full-width zone matches its column's width. */
  wideCols: ReadonlySet<number>;
}) {
  const drop = useDroppable({
    id: `child:${parentId}`,
    data: { kind: "child", parentId } satisfies DropData,
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={cn(styles.childDropzone, narrow && styles.narrow, drop.isOver && styles.isOver)}
      style={narrow ? undefined : widthVar(col, wideCols)}
      aria-hidden="true"
    >
      <i className={cn(styles.childDropzoneIcon, "ri-drag-drop-line")} aria-hidden="true" />
    </div>
  );
});

/**
 * Invisible leading placeholders for a tree whose root sits in a lower-numbered
 * (further-right) column: one `.colSpacer` per column between `fromCol` (the
 * leftmost visible column) and the root's column, each sized to that column's
 * width. Rendered as the first flex items of a `.tree` row so the root lands
 * under its column header — the flex replacement for the old computed
 * `margin-left`. Empty for a root already in the leftmost column.
 */
function LeadingSpacers({
  fromCol,
  toCol,
  wideCols,
}: {
  /** The leftmost visible column (`maxCol`). */
  fromCol: number;
  /** The root's column; placeholders fill the columns strictly left of it. */
  toCol: number;
  wideCols: ReadonlySet<number>;
}) {
  const cols: number[] = [];
  for (let c = fromCol; c > toCol; c--) cols.push(c);
  return (
    <>
      {cols.map((c) => (
        <div
          key={c}
          className={styles.colSpacer}
          style={widthVar(c, wideCols)}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

// ── Subtree ────────────────────────────────────────────────────────────

function SubtreeImpl({
  node,
  isRoot,
  minCol,
  logbookSegment,
  wideCols,
  stickySet,
  foldedSet,
  pendingInput,
  pendingCreate,
  draggedId,
  draggedSubtreeIds,
  onAdd,
  onRename,
  onDelete,
  onSetIcon,
  onToggleFold,
  onShiftRoot,
  onSubmitPending,
  onCancelPending,
}: {
  node: EntryNode;
  /** True for a tree's root; only roots get the column-shift arrows. */
  isRoot: boolean;
  /** The lowest visible column. An entry here has its child drop zone fall past
   *  the right edge of the chart, so that zone is rendered narrow. */
  minCol: number;
  logbookSegment: string;
  /** Columns the user has set to wide width (column 0 by default). Threaded down
   *  so every cell, card, and drop zone takes on its column's width. */
  wideCols: ReadonlySet<number>;
  stickySet: Set<number>;
  foldedSet: Set<number>;
  pendingInput: PendingInput | null;
  pendingCreate: PendingCreate | null;
  draggedId: number | null;
  draggedSubtreeIds: Set<number> | null;
  onAdd: (input: AddInput) => void;
  onRename: (id: number) => void;
  /** Delete an entry (and its subtree), after confirming. */
  onDelete: (id: number) => void;
  /** Set an entry's icon (from the card's icon popover). */
  onSetIcon: (id: number, iconName: string, iconFamily: string) => void;
  /** Toggle an entry's folded state. */
  onToggleFold: (id: number) => void;
  /** Shift a root's subtree by `delta` columns (+1 = left, -1 = right). */
  onShiftRoot: (id: number, delta: 1 | -1) => void;
  onSubmitPending: (name: string, icon: { iconName: string; iconFamily: string } | null) => void;
  onCancelPending: () => void;
}) {
  const isRenaming = pendingInput?.kind === "rename" && pendingInput.entryId === node.id;
  const addingHere = pendingInput?.kind === "add" && pendingInput.parentId === node.id;
  const creatingHere = pendingCreate?.parentId === node.id;
  const sticky = stickySet.has(node.id);
  // Only sticky cards can fold; ignore any stale fold on a now-non-sticky entry.
  const folded = sticky && foldedSet.has(node.id);
  const childCol = node.col - 1;
  // When folded, the entry's descendants are replaced by a single "N collapsed
  // entries" placeholder (so the subtree stops taking vertical space) — shown
  // only when there's actually something to collapse.
  const showFoldedPlaceholder = folded && node.children.length > 0;
  // The child column exists when there are unfolded children to show, when the
  // folded placeholder stands in for them, when a child is being added under
  // this node (so the first child's input has somewhere to live), or while a
  // just-submitted child is being confirmed by the server.
  const hasChildCol =
    (!folded && node.children.length > 0) || showFoldedPlaceholder || addingHere || creatingHere;
  // While a drag is in progress, a childless entry shows a dashed pseudo-card to
  // its right as a "drop here to make this entry's first child" target — the
  // affordance childless entries lack, having no child column to drop into.
  // Excluded for the dragged entry's own subtree (an entry can't be reparented
  // under itself or a descendant); that also covers the dragged leaf itself.
  const showChildDropzone =
    draggedId !== null && node.children.length === 0 && !(draggedSubtreeIds?.has(node.id) ?? false);

  // Per-node handlers, memoized so the (memoized) card / input children skip
  // re-rendering when only an unrelated part of the chart changes. They stay
  // stable as long as the upstream callbacks and this node's id / column do.
  const handleAddChild = useCallback(
    () => onAdd({ col: childCol, parentId: node.id }),
    [onAdd, childCol, node.id],
  );
  const handleRename = useCallback(() => onRename(node.id), [onRename, node.id]);
  const handleDelete = useCallback(() => onDelete(node.id), [onDelete, node.id]);
  const handleToggleFold = useCallback(() => onToggleFold(node.id), [onToggleFold, node.id]);
  const handleShiftLeft = useCallback(() => onShiftRoot(node.id, 1), [onShiftRoot, node.id]);
  const handleShiftRight = useCallback(() => onShiftRoot(node.id, -1), [onShiftRoot, node.id]);
  const handleSelectIcon = useCallback(
    (iconName: string, iconFamily: string) => onSetIcon(node.id, iconName, iconFamily),
    [onSetIcon, node.id],
  );

  return (
    <div className={styles.subtree}>
      <div className={styles.cell} style={widthVar(node.col, wideCols)}>
        {isRenaming ? (
          <InputCard
            initialValue={node.name}
            sticky={sticky && !folded}
            iconName={node.iconName}
            iconFamily={node.iconFamily}
            onSelectIcon={handleSelectIcon}
            onSubmit={onSubmitPending}
            onCancel={onCancelPending}
          />
        ) : (
          <EntryCard
            entry={node}
            logbookSegment={logbookSegment}
            // A folded entry no longer spans descendants, so it stops pinning;
            // but it stays foldable so its hover button (now "expand") can
            // unfold it again.
            sticky={sticky && !folded}
            foldable={sticky}
            folded={folded}
            draggedId={draggedId}
            draggedSubtreeIds={draggedSubtreeIds}
            onAddChild={handleAddChild}
            onRename={handleRename}
            onDelete={handleDelete}
            onSelectIcon={handleSelectIcon}
            onToggleFold={handleToggleFold}
            onShiftLeft={isRoot ? handleShiftLeft : undefined}
            onShiftRight={isRoot ? handleShiftRight : undefined}
          />
        )}
      </div>

      {hasChildCol && (
        <div className={styles.childCol}>
          {showFoldedPlaceholder && (
            <div className={styles.subtree}>
              <div className={styles.cell} style={widthVar(childCol, wideCols)}>
                <FoldedPlaceholder count={countDescendants(node)} onUnfold={handleToggleFold} />
              </div>
            </div>
          )}
          {!showFoldedPlaceholder &&
            node.children.map((child) => (
              <Subtree
                key={child.id}
                node={child}
                isRoot={false}
                minCol={minCol}
                logbookSegment={logbookSegment}
                wideCols={wideCols}
                stickySet={stickySet}
                foldedSet={foldedSet}
                pendingInput={pendingInput}
                pendingCreate={pendingCreate}
                draggedId={draggedId}
                draggedSubtreeIds={draggedSubtreeIds}
                onAdd={onAdd}
                onRename={onRename}
                onDelete={onDelete}
                onSetIcon={onSetIcon}
                onToggleFold={onToggleFold}
                onShiftRoot={onShiftRoot}
                onSubmitPending={onSubmitPending}
                onCancelPending={onCancelPending}
              />
            ))}
          {/* Adding a sibling here is the hover "Add child" action's job, so
              the column holds only children plus the live add-input (if any),
              then the loading placeholder once that input is submitted. Both are
              wrapped in a cell sized to the *child* column (like the real child
              rows), so e.g. a column-0 input matches the wide body cards rather
              than inheriting the parent column's narrower width. */}
          {addingHere && (
            <div className={styles.subtree}>
              <div className={styles.cell} style={widthVar(childCol, wideCols)}>
                <InputCard
                  initialValue=""
                  sticky={false}
                  onSubmit={onSubmitPending}
                  onCancel={onCancelPending}
                />
              </div>
            </div>
          )}
          {creatingHere && (
            <div className={styles.subtree}>
              <div className={styles.cell} style={widthVar(childCol, wideCols)}>
                <LoadingCard
                  name={pendingCreate.name}
                  iconName={pendingCreate.iconName}
                  iconFamily={pendingCreate.iconFamily}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {showChildDropzone && (
        <ChildDropzone
          parentId={node.id}
          col={childCol}
          narrow={node.col === minCol}
          wideCols={wideCols}
        />
      )}
    </div>
  );
}

const Subtree = memo(SubtreeImpl);

// ── Drag-scroll re-measurement ─────────────────────────────────────────

/**
 * Keep droppable rects aligned with the chart as it auto-scrolls during a drag.
 *
 * dnd-kit measures each droppable once at drag start, then keeps its position
 * "current" by offsetting that cached rect by the scroll container's scroll
 * delta — which is correct only for content that scrolls with the container. A
 * sticky card's drop halves stay pinned on screen while the container
 * auto-scrolls, so that offset pushes their droppable rects away from the real
 * card by exactly the scrolled distance, leaving the drop zones above or below
 * where the card actually is.
 *
 * Re-measuring all droppables on each scroll frame (only while a drag is active)
 * re-reads their true on-screen rects, resetting that scroll delta to zero so
 * the sticky drop zones track their cards. Must live inside `DndContext` so it
 * can reach `measureDroppableContainers`.
 */
function RemeasureOnScroll({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const dnd = useDndContext();
  const dragging = dnd.active !== null;
  // The context object changes identity on every drag-over update; hold the
  // latest in a ref so the scroll listener subscribes once per drag (keyed only
  // on `dragging`) instead of resubscribing constantly mid-drag.
  const dndRef = useRef(dnd);
  dndRef.current = dnd;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !dragging) return;
    // Empty id list re-measures every droppable. Called as a method (not a
    // destructured reference) to keep its `this` binding.
    const onScroll = () => dndRef.current.measureDroppableContainers([]);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [dragging, scrollRef]);
  return null;
}

// ── Main component ─────────────────────────────────────────────────────

export function OrgView({
  forest,
  logbookId,
  logbookSlug,
  columns,
  editingColumns,
  onSaveColumns,
  onPersistColumns,
  pendingInput,
  pendingCreate,
  focusEntryId,
  onAdd,
  onRename,
  onDelete,
  onSetIcon,
  onSubmitPending,
  onCancelPending,
  onMove,
  onFocused,
}: {
  forest: EntryNode[];
  logbookId: string;
  logbookSlug: string;
  /** The persisted per-column settings (names + widths) for this logbook. The
   *  edit mode seeds its working draft from these, and they drive the resting
   *  chart's column widths and header labels. */
  columns: ColumnSetting[];
  /** Whether the column-edit mode is on: column headers become name inputs with
   *  a wide/narrow width toggle, driven by the top bar's "Edit Columns" button. */
  editingColumns: boolean;
  /** Leave column-edit mode (the same as the top bar's "Save Columns"); fired
   *  when Enter is pressed in a column name input. The actual persistence runs
   *  off the resulting edit-mode-off transition (see `onPersistColumns`). */
  onSaveColumns: () => void;
  /** Persist the edited column settings. Called once when edit mode turns off
   *  (via the button or Enter) with the full draft, so the parent can fire the
   *  optimistic save mutation. */
  onPersistColumns: (columns: ColumnSetting[]) => void;
  /** The single live input cell — adding a new entry or renaming one. */
  pendingInput: PendingInput | null;
  /** A submitted new entry awaiting the server's id, shown as a placeholder. */
  pendingCreate: PendingCreate | null;
  /** When set, that entry is scrolled into view and its link focused. */
  focusEntryId: number | null;
  onAdd: (input: AddInput) => void;
  onRename: (id: number) => void;
  /** Delete an entry (and its subtree). The caller confirms first. */
  onDelete: (id: number) => void;
  /** Set an entry's icon (from the card's icon popover). */
  onSetIcon: (id: number, iconName: string, iconFamily: string) => void;
  /** Commit the live input cell's name, with the icon chosen for a brand-new
   *  entry (null on rename, where the icon commits separately). */
  onSubmitPending: (name: string, icon: { iconName: string; iconFamily: string } | null) => void;
  onCancelPending: () => void;
  /** Commit a drag-and-drop move (re-parent and/or reposition an entry). */
  onMove: (input: MoveEntryInput) => void;
  onFocused: () => void;
}) {
  const logbookSegment = routeSegment(logbookSlug, logbookId);
  const isEmpty = forest.length === 0;
  const { byId, parentOf } = useMemo(() => indexForest(forest), [forest]);
  const { min: dataMin, max: dataMax } = useMemo(() => colRange(forest), [forest]);
  const stickySet = useMemo(() => computeStickySet(forest), [forest]);

  // Folded entries (descendants hidden). Seeded from and written back to the
  // module-level store so a fold survives navigating away and back. Resynced
  // when the logbook changes in case the component is reused across routes.
  const [foldedSet, setFoldedSet] = useState<Set<number>>(
    () => orgFoldedByLogbook.get(logbookId) ?? new Set(),
  );
  useEffect(() => {
    setFoldedSet(orgFoldedByLogbook.get(logbookId) ?? new Set());
  }, [logbookId]);
  const toggleFold = useCallback(
    (id: number) => {
      setFoldedSet((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        orgFoldedByLogbook.set(logbookId, next);
        return next;
      });
    },
    [logbookId],
  );

  // Per-column name and width overrides, keyed by column number, seeded from the
  // persisted `columns` and used as the working draft while editing. A column
  // absent from the map keeps its defaults — an empty name (rendered as
  // "Column N") and the default width (column 0 wide, every other column
  // narrow). Edited in the column-edit mode (see the header strip below) and
  // persisted via `onPersistColumns` when edit mode turns off.
  const [columnConfig, setColumnConfig] = useState<Map<number, ColumnConfig>>(() =>
    columnsToConfig(columns),
  );
  // Mirror the persisted columns into the draft whenever they change while NOT
  // editing — the initial load, the reconciling refetch, and the optimistic
  // update that lands right after a save all flow in here. Keyed on `columns`
  // only (read editing through a ref) so an in-progress edit is never clobbered.
  const editingColumnsRef = useRef(editingColumns);
  editingColumnsRef.current = editingColumns;
  useEffect(() => {
    if (editingColumnsRef.current) return;
    setColumnConfig(columnsToConfig(columns));
  }, [columns]);
  // Persist the draft when edit mode turns off (via the button or Enter). Tracks
  // the previous value so it fires only on the on→off transition, not on every
  // keystroke that re-runs this effect.
  const wasEditingColumnsRef = useRef(editingColumns);
  useEffect(() => {
    const was = wasEditingColumnsRef.current;
    wasEditingColumnsRef.current = editingColumns;
    if (was && !editingColumns) onPersistColumns(configToColumns(columnConfig));
  }, [editingColumns, columnConfig, onPersistColumns]);
  const setColumnName = useCallback((c: number, name: string) => {
    // A name set to the column's default label ("Column N") carries no custom
    // information, so store it as an empty string — which renders as that same
    // default label anyway, and keeps a redundant default out of the persisted
    // settings.
    const stored = name === `Column ${c}` ? "" : name;
    setColumnConfig((prev) => {
      const next = new Map(prev);
      next.set(c, { ...defaultColumnConfig(c, next.get(c)), name: stored });
      return next;
    });
  }, []);
  const toggleColumnWidth = useCallback((c: number) => {
    setColumnConfig((prev) => {
      const cur = defaultColumnConfig(c, prev.get(c));
      const next = new Map(prev);
      next.set(c, { ...cur, wide: !cur.wide });
      return next;
    });
  }, []);

  // Adding a child to a folded entry first unfolds it, so the new input cell is
  // visible instead of hidden behind the "N collapsed entries" placeholder.
  const handleAdd = useCallback(
    (input: AddInput) => {
      const { parentId } = input;
      if (parentId !== null) {
        setFoldedSet((prev) => {
          if (!prev.has(parentId)) return prev;
          const next = new Set(prev);
          next.delete(parentId);
          orgFoldedByLogbook.set(logbookId, next);
          return next;
        });
      }
      onAdd(input);
    },
    [onAdd, logbookId],
  );

  // ── Drag & drop ──────────────────────────────────────────────────────
  // dnd-kit auto-scrolls the scroll container when the cursor nears its top
  // or bottom edge (the spec's "drag near the edge to scroll") out of the box.
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  // Split mouse and touch activation. On a pointer device a 5px move starts a
  // drag immediately; on touch that would hijack scrolling (the chart pans on
  // both axes, and any scroll swipe travels well past 5px). So touch requires a
  // short press-and-hold instead — a quick swipe still scrolls, a long-press
  // starts the drag. `tolerance` lets the finger wobble during the press
  // without cancelling it.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 5 } }),
  );

  const draggedEntry = activeDragId !== null ? (byId.get(activeDragId) ?? null) : null;
  const draggedSubtreeIds = useMemo(
    () => (draggedEntry ? subtreeIds(draggedEntry) : null),
    [draggedEntry],
  );

  // pointerWithin resolves overlapping zones; when the cursor is inside a child
  // drop zone (the pseudo-card beside a childless entry), prefer it over any
  // sibling before/after zone it overlaps. Fall back to rectIntersection so a
  // drag hovering just outside every zone still lands somewhere sensible.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const within = pointerWithin(args);
    if (within.length > 0) {
      const child = within.find((c) => {
        const container = args.droppableContainers.find((d) => d.id === c.id);
        const data = container?.data.current as DropData | undefined;
        return data?.kind === "child";
      });
      return child ? [child] : within;
    }
    return rectIntersection(args);
  }, []);

  const onDragStart = useCallback((e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith("entry:")) {
      const n = Number(id.slice("entry:".length));
      if (Number.isFinite(n)) setActiveDragId(n);
    }
  }, []);
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = e;
      if (!over) return;
      const data = over.data.current as DropData | undefined;
      if (!data) return;
      const id = Number(String(active.id).replace(/^entry:/, ""));
      if (!Number.isFinite(id)) return;
      const move = dropToMoveInput(id, data, byId, parentOf, forest, logbookId);
      if (move) onMove(move);
    },
    [byId, parentOf, forest, logbookId, onMove],
  );
  const onDragCancel = useCallback(() => setActiveDragId(null), []);

  // Header columns: the data range, unioned with the default working set
  // [1, 0, -1] (heading / body / aside) so there's always somewhere to add a
  // root even in a sparse or empty logbook. For balanced data this collapses
  // to exactly the columns in use — only the necessary columns are shown.
  const { maxCol, minCol, cols } = useMemo(() => {
    const maxCol = Math.max(dataMax, 1);
    const minCol = Math.min(dataMin, -1);
    const cols: number[] = [];
    for (let c = maxCol; c >= minCol; c--) cols.push(c);
    return { maxCol, minCol, cols };
  }, [dataMax, dataMin]);

  // The set of wide columns, derived from the config (column 0 wide by default).
  // Threaded down so every cell/card/drop zone, column head, and leading spacer
  // sizes itself to its column's width (--col-width).
  const wideCols = useMemo(() => {
    const s = new Set<number>();
    for (const [c, cfg] of columnConfig) if (cfg.wide) s.add(c);
    if (!columnConfig.has(0)) s.add(0);
    return s;
  }, [columnConfig]);

  // The chart is centered only when the heading columns (>0, of which there are
  // `maxCol`) and the aside columns (<0, of which there are `-minCol`) balance.
  // When one side has more columns, that side's outer margin collapses to 0 so
  // the chart hugs that edge instead of drifting off-center: more headings →
  // pin left, more asides → pin right. Set as CSS vars consumed by
  // .colStripInner / .canvas; the unset side keeps its `auto` default.
  const alignVars: CSSProperties = useMemo(
    () =>
      maxCol > -minCol
        ? ({ "--org-align-left": "0" } as CSSProperties)
        : maxCol < -minCol
          ? ({ "--org-align-right": "0" } as CSSProperties)
          : {},
    [maxCol, minCol],
  );

  // Drive the height of each sticky box imperatively. A sticky box has to both
  // span its subtree (stretch down past its descendants) and be shorter than its
  // cell (so it has room to travel and pin) — a plain sticky element can't do
  // both. So each frame we set the box to span [max(extentTop, pinLine) ..
  // min(extentBottom, viewportBottom − gap)]: its top pins under the header with
  // a gap, its bottom holds a gap above the viewport floor while the subtree runs
  // past it, and it shrinks back to the true subtree bounds near either end. The
  // "box" is the only resized element of a sticky card — for an EntryCard that's
  // the `.cardSpan` (borders + fill; its glued `.stickyHeader` sibling is never
  // touched, which is the whole point of the split), for a renaming InputCard
  // it's the editing box itself. The box's `extent` (its parent: the stack /
  // cell) already stretches to the subtree height, so its rect is the span.
  const scrollRef = useRef<HTMLDivElement>(null);
  // The column-header strip, so entering edit mode can focus its first name input.
  const stripRef = useRef<HTMLDivElement>(null);

  // Entering column-edit mode: seed any unset column names with their default
  // "Column N" so the inputs hold real, editable text (clearing one falls back
  // to the same string as a placeholder), and focus the first input so the user
  // can start typing immediately.
  useEffect(() => {
    if (!editingColumns) return;
    setColumnConfig((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const c of cols) {
        const cur = next.get(c);
        if (!cur || cur.name === "") {
          next.set(c, { ...defaultColumnConfig(c, cur), name: `Column ${c}` });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    const firstInput = stripRef.current?.querySelector<HTMLInputElement>("input");
    firstInput?.focus();
    firstInput?.select();
  }, [editingColumns, cols]);

  // Restore the scroll position the user left this logbook's chart at (e.g.
  // after clicking into an entry and coming back), and keep it current as they
  // scroll. Runs before the sticky-measurement effect below so that pass sees
  // the restored offset. The forest is already present when OrgView mounts (the
  // route gates on load), so the content is laid out and the offset applies.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = orgScrollByLogbook.get(logbookId);
    if (saved) {
      el.scrollTop = saved.top;
      el.scrollLeft = saved.left;
    } else if (window.matchMedia?.("(max-width: 640px)")?.matches) {
      // First visit on a narrow screen (the breakpoint mirrors the stylesheet's
      // `@media (max-width: 640px)`): the chart is wider than the viewport and
      // would otherwise open on the leftmost, highest-numbered heading column.
      // Start scrolled so the body column (0) — the spine most logbooks read
      // from — is centered instead. Measured from rects (not offsetLeft) so it's
      // independent of which ancestor is the offset parent; the browser clamps
      // the result if column 0 sits too near an edge to fully center.
      const head = el.querySelector<HTMLElement>('[data-col="0"]');
      if (head) {
        const headRect = head.getBoundingClientRect();
        const center =
          headRect.left - el.getBoundingClientRect().left + el.scrollLeft + headRect.width / 2;
        el.scrollLeft = center - el.clientWidth / 2;
      }
    }
    const onScroll = () => {
      orgScrollByLogbook.set(logbookId, { top: el.scrollTop, left: el.scrollLeft });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [logbookId]);

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    // Pin line (where sticky cards stop under the header) and the matching bottom
    // gap, read from the CSS tokens so the geometry lives only in the stylesheet:
    // --org-pin-top already folds in the strip height + gap (and is registered via
    // @property, so getComputedStyle resolves it to px rather than a calc string),
    // and --org-sticky-gap is the bottom inset. Fallbacks cover non-browser
    // environments like jsdom, where custom properties read back empty.
    const rootStyle = getComputedStyle(document.documentElement);
    const pinTop = parseFloat(rootStyle.getPropertyValue("--org-pin-top")) || 64;
    const gap = parseFloat(rootStyle.getPropertyValue("--org-sticky-gap")) || 14;

    // Snapshot the sticky boxes once. The set only changes when the forest /
    // pending input / fold state does, which re-runs this effect — so there's no
    // need to re-query the DOM on every scroll frame. `last` caches the height we
    // wrote so steady-state frames can skip redundant writes (see below).
    type Target = {
      /** The resized element (a `.cardSpan`, or a sticky editing box). */
      box: HTMLElement;
      /** The box's parent — the stack / cell — which stretches to the subtree's
       *  full height, so its rect is the span the box clamps within. */
      extent: HTMLElement;
      /** The content the box must never shrink below (the glued header / input
       *  body). A sibling for an EntryCard, a child for the editing box. */
      floor: HTMLElement;
      /** Height computed this frame (read phase) then flushed (write phase). */
      next: number;
      /** Last height written, so a no-op frame skips the write. */
      last: number;
    };
    const targets: Target[] = [];
    for (const box of scrollEl.querySelectorAll<HTMLElement>("[data-sticky-box]")) {
      const extent = box.parentElement;
      const floor = extent?.querySelector<HTMLElement>("[data-sticky-floor]");
      if (!extent || !floor) continue;
      targets.push({ box, extent, floor, next: NaN, last: NaN });
    }

    let raf = 0;
    const apply = () => {
      raf = 0;
      // Phase 1 — read every rect up front. Writing a box's height dirties
      // layout (the var feeds its height), so interleaving reads and writes
      // forced a reflow per box; reading everything first collapses that to a
      // single reflow. Within a pass the writes can't disturb the reads because
      // every box stays no taller than its own subtree — a box at or below its
      // child column's height doesn't feed back into the extent (the column is
      // the taller, stretching sibling). A box left STALE-tall would feed back,
      // which is what the pre-measure reset below guards against.
      const vpBottom = scrollEl.clientHeight - gap;
      const originTop = scrollEl.getBoundingClientRect().top;
      for (const t of targets) {
        const r = t.extent.getBoundingClientRect();
        const top = Math.max(r.top - originTop, pinTop);
        const bottom = Math.min(r.bottom - originTop, vpBottom);
        // Never shrink below the content; once the box would, it keeps its
        // content height and `position: sticky` scrolls it up off the top (its
        // bottom held to the extent) so nothing is clipped.
        const contentH = t.floor.offsetHeight + (t.box.offsetHeight - t.box.clientHeight);
        t.next = Math.max(bottom - top, contentH);
      }
      // Phase 2 — write only the heights that changed. A box pinned in its
      // middle range keeps a constant height (vpBottom − pinTop) frame to
      // frame, so most scroll frames touch few (often zero) boxes and leave
      // layout clean — which also keeps the next frame's reads reflow-free.
      for (const t of targets) {
        if (t.next === t.last) continue;
        t.last = t.next;
        t.box.style.setProperty("--org-sticky-h", `${t.next}px`);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    // Clear any stale heights before the first (structural) measurement. A box
    // left taller than its subtree — e.g. a former parent that just lost
    // descendants to a move — props up its OWN extent through the subtree's
    // `align-items: stretch` (the span is in flow, being `position: sticky`), so
    // the read phase would keep measuring that inflated extent and latch the box
    // tall. Zeroing first (the span's min-height still floors it, and a sticky
    // box's subtree is always taller than that floor) makes the read see the
    // true subtree height. Only needed here: scroll/resize frames never shrink a
    // subtree below its box, and this pass's targets carry `last: NaN` so the
    // write phase still flushes the real heights over these zeros.
    for (const t of targets) t.box.style.setProperty("--org-sticky-h", "0px");
    apply();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(scrollEl);
    return () => {
      scrollEl.removeEventListener("scroll", schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // Re-measure whenever the rendered cards change (tree edits, an input cell
    // swapping in for a renamed entry, a fold hiding/showing descendants, or a
    // column-width change that reflows card text and so card heights).
  }, [forest, pendingInput, foldedSet, wideCols]);

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

  // Shift a root (and, via the col cascade, its whole subtree) one column over.
  // This is just a move that keeps the root's parent (null) and position but
  // changes its column: the existing move path re-derives every descendant's
  // column (child.col == parent.col - 1), so no dedicated mutation is needed.
  // Higher columns sit further left, so +1 moves left and -1 moves right.
  const handleShiftRoot = useCallback(
    (id: number, delta: 1 | -1) => {
      const node = byId.get(id);
      if (!node) return;
      const position = forest.findIndex((r) => r.id === id);
      if (position < 0) return;
      onMove({ logbookId, id, parentId: null, col: node.col + delta, position });
    },
    [byId, forest, logbookId, onMove],
  );

  const addingRoot =
    pendingInput?.kind === "add" && pendingInput.parentId === null ? pendingInput : null;
  const creatingRoot = pendingCreate?.parentId === null ? pendingCreate : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-paper" style={alignVars}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <RemeasureOnScroll scrollRef={scrollRef} />
        <div ref={scrollRef} className={cn(styles.scroll, "flex flex-col overflow-auto bg-paper")}>
          <div className={styles.inner}>
            <div className={styles.colStrip}>
              <div ref={stripRef} className={styles.colStripInner}>
                {cols.map((c) => {
                  const cfg = columnConfig.get(c);
                  const wide = wideCols.has(c);
                  const name = cfg?.name ?? "";
                  return (
                    <div
                      key={c}
                      data-col={c}
                      className={cn(styles.colHead, editingColumns && styles.colHeadEditing)}
                      style={widthVar(c, wideCols)}
                    >
                      {editingColumns ? (
                        <>
                          <input
                            type="text"
                            className={styles.colNameInput}
                            value={name}
                            placeholder={`Column ${c}`}
                            aria-label={`Name for column ${c}`}
                            onChange={(e) => setColumnName(c, e.target.value)}
                            onKeyDown={(e) => {
                              // Enter commits the column edits (names update live as
                              // you type) and leaves edit mode, like "Save Columns".
                              if (e.key === "Enter") {
                                e.preventDefault();
                                onSaveColumns();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className={styles.colWidthToggle}
                            aria-label={wide ? `Make column ${c} narrow` : `Make column ${c} wide`}
                            aria-pressed={wide}
                            title={
                              wide
                                ? "Wide column — click for narrow"
                                : "Narrow column — click for wide"
                            }
                            onClick={() => toggleColumnWidth(c)}
                          >
                            <i
                              className={
                                wide ? "ri-contract-left-right-line" : "ri-expand-left-right-line"
                              }
                              aria-hidden="true"
                            />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className={styles.colLabel}>{name || `Column ${c}`}</span>
                          <button
                            type="button"
                            className={styles.colAdd}
                            aria-label={`Add entry in column ${c}`}
                            title={`Add entry in column ${c}`}
                            onClick={() => handleAdd({ col: c, parentId: null })}
                          >
                            <i className="ri-sticky-note-add-line" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {!(isEmpty && !pendingInput && !creatingRoot) && (
              <div className={styles.canvas}>
                {forest.map((root, i) => (
                  <Fragment key={root.id}>
                    {i > 0 && <div className={styles.treeDivider} aria-hidden="true" />}
                    <div className={styles.tree}>
                      <LeadingSpacers fromCol={maxCol} toCol={root.col} wideCols={wideCols} />
                      <Subtree
                        node={root}
                        isRoot
                        minCol={minCol}
                        logbookSegment={logbookSegment}
                        wideCols={wideCols}
                        stickySet={stickySet}
                        foldedSet={foldedSet}
                        pendingInput={pendingInput}
                        pendingCreate={pendingCreate}
                        draggedId={activeDragId}
                        draggedSubtreeIds={draggedSubtreeIds}
                        onAdd={handleAdd}
                        onRename={onRename}
                        onDelete={onDelete}
                        onSetIcon={onSetIcon}
                        onToggleFold={toggleFold}
                        onShiftRoot={handleShiftRoot}
                        onSubmitPending={onSubmitPending}
                        onCancelPending={onCancelPending}
                      />
                    </div>
                  </Fragment>
                ))}
                {addingRoot && (
                  <Fragment>
                    {forest.length > 0 && <div className={styles.treeDivider} aria-hidden="true" />}
                    <div className={styles.tree}>
                      <LeadingSpacers fromCol={maxCol} toCol={addingRoot.col} wideCols={wideCols} />
                      <div className={styles.subtree}>
                        <div className={styles.cell} style={widthVar(addingRoot.col, wideCols)}>
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
                {creatingRoot && (
                  <Fragment>
                    {forest.length > 0 && <div className={styles.treeDivider} aria-hidden="true" />}
                    <div className={styles.tree}>
                      <LeadingSpacers
                        fromCol={maxCol}
                        toCol={creatingRoot.col}
                        wideCols={wideCols}
                      />
                      <div className={styles.subtree}>
                        <div className={styles.cell} style={widthVar(creatingRoot.col, wideCols)}>
                          <LoadingCard
                            name={creatingRoot.name}
                            iconName={creatingRoot.iconName}
                            iconFamily={creatingRoot.iconFamily}
                          />
                        </div>
                      </div>
                    </div>
                  </Fragment>
                )}
              </div>
            )}
          </div>

          {isEmpty && !pendingInput && !creatingRoot && (
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
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {draggedEntry ? (
            <div
              className={cn(styles.cardOverlay, !draggedEntry.name && styles.isUntitled)}
              style={widthVar(draggedEntry.col, wideCols)}
            >
              <i
                className={cn(
                  styles.cardOverlayIcon,
                  entryIconClass(draggedEntry.iconName, draggedEntry.iconFamily),
                  isDefaultEntryIcon(draggedEntry.iconName, draggedEntry.iconFamily) &&
                    styles.cardIconDefault,
                )}
                aria-hidden="true"
              />
              {draggedEntry.name || "Unnamed entry"}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
