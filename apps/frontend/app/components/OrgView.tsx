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
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

import type { EntryNode, MoveEntryInput } from "logarithmic-backend/api-types";

import { cn } from "~/lib/cn.ts";
import { routeSegment } from "~/lib/route-segment.ts";

import styles from "./OrgView.module.css";
import { RearrangeModal } from "./RearrangeModal.tsx";

type AddInput = { col: number; parentId: number | null };

/**
 * Per-logbook scroll offset for the org view's inner scroll container. The chart
 * scrolls inside this element rather than the window, so React Router's
 * ScrollRestoration doesn't cover it; we stash the offset here so returning from
 * an entry's page restores the position the user left from. Module-level so it
 * survives the route unmount/remount that navigation causes.
 */
const orgScrollByLogbook = new Map<string, { top: number; left: number }>();

/**
 * The single input cell that can be live in the org view at a time — either one
 * being added under a parent, or one in place of an existing entry being
 * renamed. Per spec, "input cells only exist while they're focused, and there
 * should never be a need to render two at once."
 */
type PendingInput =
  | { kind: "add"; col: number; parentId: number | null }
  | { kind: "rename"; entryId: number };

/**
 * A submitted-but-unconfirmed new entry. Creation waits on the server for the
 * real id, so during the round trip we render a loading placeholder in the new
 * entry's slot (a new last child of `parentId`, or a new last root when null).
 */
type PendingCreate = { col: number; parentId: number | null; name: string };

/**
 * What a drop zone means, attached to each dnd-kit droppable. "before"/"after"
 * are relative to an existing entry (drop above it → preceding sibling, below
 * → following sibling); "child" reparents the dragged entry as the last child
 * of `parentId` (the entry's "add child" button).
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
 * Horizontal-position vars for a column header or a tree root at column `c`:
 * its index from the left, and whether it sits right of column 0 (the widened
 * body column) and so must be shifted by the extra width. Pairs with the
 * calc() on .colHead / .tree.
 */
function colStyle(c: number, maxCol: number): CSSProperties {
  return { "--org-col-idx": maxCol - c, "--org-col-shift": c < 0 ? 1 : 0 } as CSSProperties;
}

/** Pick a cell/card's width: column 0 is the wide body column, the rest aren't. */
function widthVar(c: number): CSSProperties {
  return {
    "--col-width": c === 0 ? "var(--org-card-width-0)" : "var(--org-card-width)",
  } as CSSProperties;
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
  draggedId,
  draggedParentId,
  draggedSubtreeIds,
  onAddChild,
  onRename,
  onReorder,
  onShiftLeft,
  onShiftRight,
}: {
  entry: EntryNode;
  logbookSegment: string;
  sticky: boolean;
  /** The entry currently being dragged, or null if no drag is in progress. */
  draggedId: number | null;
  draggedParentId: number | null;
  /** Ids in the dragged entry's subtree (incl. itself); null when idle. */
  draggedSubtreeIds: Set<number> | null;
  onAddChild: () => void;
  onRename: () => void;
  onReorder: () => void;
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
  const isDragging = draggedId !== null;
  const isSource = entry.id === draggedId;
  const inDraggedSubtree = draggedSubtreeIds?.has(entry.id) ?? false;
  // Per spec: while dragging, emphasize "add child" buttons as drop targets —
  // except the dragged entry's own subtree (can't reparent under itself) and
  // its current parent (it's already a child of that).
  const emphasizeAddChild = isDragging && !inDraggedSubtree && entry.id !== draggedParentId;

  // After a drag, pointerup fires a click that would otherwise follow the
  // card's <Link>. Swallow that one click.
  const justDraggedRef = useRef(false);
  const draggable = useDraggable({ id: `entry:${entry.id}`, data: { entryId: entry.id } });
  useEffect(() => {
    if (draggable.isDragging) justDraggedRef.current = true;
  }, [draggable.isDragging]);

  // Drop targets. before/after are disabled across the dragged subtree (a node
  // can't become a sibling of itself or its own descendant); the child target
  // is only live where the add-child button is emphasized.
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
  const childDrop = useDroppable({
    id: `child:${entry.id}`,
    disabled: !emphasizeAddChild,
    data: { kind: "child", parentId: entry.id } satisfies DropData,
  });

  return (
    <div
      ref={draggable.setNodeRef}
      data-entry-anchor={entry.id}
      className={cn(
        styles.card,
        sticky && styles.sticky,
        titleColClass(entry.col),
        isSource && styles.isSource,
        emphasizeAddChild && styles.childDroppable,
      )}
      onClickCapture={(e) => {
        if (justDraggedRef.current) {
          e.preventDefault();
          e.stopPropagation();
          justDraggedRef.current = false;
        }
      }}
      {...draggable.attributes}
      {...draggable.listeners}
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
            {/* Word count is only meaningful once there's prose to count, so it's
                shown only for entries that have content. */}
            {entry.wordCount > 0 && ` · ${entry.wordCount} words`}
          </span>
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
                <i className="ri-arrow-left-s-line" aria-hidden="true" />
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
              className={styles.cardAction}
              aria-label="Reorder siblings"
              title="Reorder siblings"
              onClick={onReorder}
            >
              <i className="ri-arrow-up-down-line" aria-hidden="true" />
            </button>
            <button
              type="button"
              ref={childDrop.setNodeRef}
              className={cn(
                styles.cardAction,
                styles.cardActionChild,
                childDrop.isOver && styles.isOver,
              )}
              aria-label="Add child"
              title="Add child"
              onClick={onAddChild}
            >
              <i className="ri-corner-down-right-line" aria-hidden="true" />
            </button>
            {canShift && (
              <button
                type="button"
                className={styles.cardAction}
                aria-label="Move one column right"
                title="Move one column right"
                onClick={onShiftRight}
              >
                <i className="ri-arrow-right-s-line" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>

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
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
        <textarea
          ref={inputRef}
          className={styles.cardInput}
          rows={1}
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

/**
 * Placeholder shown in a new entry's slot while its creation is in flight.
 * Entry creation isn't optimistic (the server assigns the id the link needs),
 * so we render the typed name with a spinner here until the server confirms,
 * at which point the real, focusable card replaces it.
 */
function LoadingCard({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <div ref={ref} className={cn(styles.card, "opacity-65")} aria-busy="true">
      <div className={styles.cardBody}>
        <span className={cn(styles.cardTitle, !name && styles.isUntitled)}>
          {name || "Unnamed entry"}
        </span>
        <div className={styles.cardFooter}>
          <span className={cn(styles.cardMeta, "inline-flex items-center gap-1")}>
            <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
            Adding…
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Subtree ────────────────────────────────────────────────────────────

function Subtree({
  node,
  isRoot,
  logbookSegment,
  stickySet,
  pendingInput,
  pendingCreate,
  draggedId,
  draggedParentId,
  draggedSubtreeIds,
  onAdd,
  onRename,
  onReorder,
  onShiftRoot,
  onSubmitPending,
  onCancelPending,
}: {
  node: EntryNode;
  /** True for a tree's root; only roots get the column-shift arrows. */
  isRoot: boolean;
  logbookSegment: string;
  stickySet: Set<number>;
  pendingInput: PendingInput | null;
  pendingCreate: PendingCreate | null;
  draggedId: number | null;
  draggedParentId: number | null;
  draggedSubtreeIds: Set<number> | null;
  onAdd: (input: AddInput) => void;
  onRename: (id: number) => void;
  onReorder: (id: number) => void;
  /** Shift a root's subtree by `delta` columns (+1 = left, -1 = right). */
  onShiftRoot: (id: number, delta: 1 | -1) => void;
  onSubmitPending: (name: string) => void;
  onCancelPending: () => void;
}) {
  const isRenaming = pendingInput?.kind === "rename" && pendingInput.entryId === node.id;
  const addingHere = pendingInput?.kind === "add" && pendingInput.parentId === node.id;
  const creatingHere = pendingCreate?.parentId === node.id;
  const sticky = stickySet.has(node.id);
  const childCol = node.col - 1;
  // The child column exists when there are children, when a child is being
  // added under this node (so the first child's input has somewhere to live),
  // or while a just-submitted child is being confirmed by the server.
  const hasChildCol = node.children.length > 0 || addingHere || creatingHere;

  return (
    <div className={styles.subtree}>
      <div className={styles.cell} style={widthVar(node.col)}>
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
            draggedId={draggedId}
            draggedParentId={draggedParentId}
            draggedSubtreeIds={draggedSubtreeIds}
            onAddChild={() => onAdd({ col: childCol, parentId: node.id })}
            onRename={() => onRename(node.id)}
            onReorder={() => onReorder(node.id)}
            onShiftLeft={isRoot ? () => onShiftRoot(node.id, 1) : undefined}
            onShiftRight={isRoot ? () => onShiftRoot(node.id, -1) : undefined}
          />
        )}
      </div>

      {hasChildCol && (
        <div className={styles.childCol}>
          {node.children.map((child) => (
            <Subtree
              key={child.id}
              node={child}
              isRoot={false}
              logbookSegment={logbookSegment}
              stickySet={stickySet}
              pendingInput={pendingInput}
              pendingCreate={pendingCreate}
              draggedId={draggedId}
              draggedParentId={draggedParentId}
              draggedSubtreeIds={draggedSubtreeIds}
              onAdd={onAdd}
              onRename={onRename}
              onReorder={onReorder}
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
              <div className={styles.cell} style={widthVar(childCol)}>
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
              <div className={styles.cell} style={widthVar(childCol)}>
                <LoadingCard name={pendingCreate.name} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Drag-scroll re-measurement ─────────────────────────────────────────

/**
 * Keep droppable rects aligned with the chart as it auto-scrolls during a drag.
 *
 * dnd-kit measures each droppable once at drag start, then keeps its position
 * "current" by offsetting that cached rect by the scroll container's scroll
 * delta — which is correct only for content that scrolls with the container. A
 * sticky card (and its "Add child" button) stays pinned on screen while the
 * container auto-scrolls, so that offset pushes its droppable rect away from the
 * real button by exactly the scrolled distance, leaving the drop zone above or
 * below where the button actually is.
 *
 * Re-measuring all droppables on each scroll frame (only while a drag is active)
 * re-reads their true on-screen rects, resetting that scroll delta to zero so
 * the sticky drop zones track the buttons. Must live inside `DndContext` so it
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
  pendingInput,
  pendingCreate,
  focusEntryId,
  onAdd,
  onRename,
  onSubmitPending,
  onCancelPending,
  onMove,
  onReorderSiblings,
  onFocused,
}: {
  forest: EntryNode[];
  logbookId: string;
  logbookSlug: string;
  /** The single live input cell — adding a new entry or renaming one. */
  pendingInput: PendingInput | null;
  /** A submitted new entry awaiting the server's id, shown as a placeholder. */
  pendingCreate: PendingCreate | null;
  /** When set, that entry is scrolled into view and its link focused. */
  focusEntryId: number | null;
  onAdd: (input: AddInput) => void;
  onRename: (id: number) => void;
  onSubmitPending: (name: string) => void;
  onCancelPending: () => void;
  /** Commit a drag-and-drop move (re-parent and/or reposition an entry). */
  onMove: (input: MoveEntryInput) => void;
  onReorderSiblings: (parentId: number | null, ids: number[]) => void;
  onFocused: () => void;
}) {
  const logbookSegment = routeSegment(logbookSlug, logbookId);
  const isEmpty = forest.length === 0;
  const { byId, parentOf } = useMemo(() => indexForest(forest), [forest]);
  const { min: dataMin, max: dataMax } = useMemo(() => colRange(forest), [forest]);
  const stickySet = useMemo(() => computeStickySet(forest), [forest]);

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
  const draggedParentId = activeDragId !== null ? (parentOf.get(activeDragId) ?? null) : null;
  const draggedSubtreeIds = useMemo(
    () => (draggedEntry ? subtreeIds(draggedEntry) : null),
    [draggedEntry],
  );

  // pointerWithin resolves card vs add-child drops; prefer the small add-child
  // button when the cursor is inside it. Fall back to rectIntersection so a
  // drag hovering just outside every zone still lands somewhere sensible.
  const collisionDetection: CollisionDetection = (args) => {
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
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith("entry:")) {
      const n = Number(id.slice("entry:".length));
      if (Number.isFinite(n)) setActiveDragId(n);
    }
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;
    const data = over.data.current as DropData | undefined;
    if (!data) return;
    const id = Number(String(active.id).replace(/^entry:/, ""));
    if (!Number.isFinite(id)) return;
    const move = dropToMoveInput(id, data, byId, parentOf, forest, logbookId);
    if (move) onMove(move);
  };
  const onDragCancel = () => setActiveDragId(null);

  // Header columns: the data range, unioned with the default working set
  // [1, 0, -1] (heading / body / aside) so there's always somewhere to add a
  // root even in a sparse or empty logbook. For balanced data this collapses
  // to exactly the columns in use — only the necessary columns are shown.
  const maxCol = Math.max(dataMax, 1);
  const minCol = Math.min(dataMin, -1);
  const cols: number[] = [];
  for (let c = maxCol; c >= minCol; c--) cols.push(c);

  // The chart is centered only when the heading columns (>0, of which there are
  // `maxCol`) and the aside columns (<0, of which there are `-minCol`) balance.
  // When one side has more columns, that side's outer margin collapses to 0 so
  // the chart hugs that edge instead of drifting off-center: more headings →
  // pin left, more asides → pin right. Set as CSS vars consumed by
  // .colStripInner / .canvas; the unset side keeps its `auto` default.
  const alignVars: CSSProperties =
    maxCol > -minCol
      ? ({ "--org-align-left": "0" } as CSSProperties)
      : maxCol < -minCol
        ? ({ "--org-align-right": "0" } as CSSProperties)
        : {};

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
    }
    const onScroll = () => {
      orgScrollByLogbook.set(logbookId, { top: el.scrollTop, left: el.scrollLeft });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [logbookId]);

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

  // Shift a root (and, via the col cascade, its whole subtree) one column over.
  // This is just a move that keeps the root's parent (null) and position but
  // changes its column: the existing move path re-derives every descendant's
  // column (child.col == parent.col - 1), so no dedicated mutation is needed.
  // Higher columns sit further left, so +1 moves left and -1 moves right.
  const handleShiftRoot = (id: number, delta: 1 | -1) => {
    const node = byId.get(id);
    if (!node) return;
    const position = forest.findIndex((r) => r.id === id);
    if (position < 0) return;
    onMove({ logbookId, id, parentId: null, col: node.col + delta, position });
  };

  const addingRoot =
    pendingInput?.kind === "add" && pendingInput.parentId === null ? pendingInput : null;
  const creatingRoot = pendingCreate?.parentId === null ? pendingCreate : null;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden bg-paper"
      style={{ "--org-col-span": maxCol - minCol, ...alignVars } as CSSProperties}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <RemeasureOnScroll scrollRef={scrollRef} />
        <div ref={scrollRef} className={cn(styles.scroll, "flex flex-col overflow-auto bg-paper")}>
          <div className={styles.colStrip}>
            <div className={styles.colStripInner}>
              {cols.map((c) => (
                <div
                  key={c}
                  className={styles.colHead}
                  style={{ ...colStyle(c, maxCol), ...widthVar(c) }}
                >
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

          {isEmpty && !pendingInput && !creatingRoot ? (
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
                  <div className={styles.tree} style={colStyle(root.col, maxCol)}>
                    <Subtree
                      node={root}
                      isRoot
                      logbookSegment={logbookSegment}
                      stickySet={stickySet}
                      pendingInput={pendingInput}
                      pendingCreate={pendingCreate}
                      draggedId={activeDragId}
                      draggedParentId={draggedParentId}
                      draggedSubtreeIds={draggedSubtreeIds}
                      onAdd={onAdd}
                      onRename={onRename}
                      onReorder={(id) => setRearrangeFor(id)}
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
                  <div className={styles.tree} style={colStyle(addingRoot.col, maxCol)}>
                    <div className={styles.subtree}>
                      <div className={styles.cell} style={widthVar(addingRoot.col)}>
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
                  <div className={styles.tree} style={colStyle(creatingRoot.col, maxCol)}>
                    <div className={styles.subtree}>
                      <div className={styles.cell} style={widthVar(creatingRoot.col)}>
                        <LoadingCard name={creatingRoot.name} />
                      </div>
                    </div>
                  </div>
                </Fragment>
              )}
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {draggedEntry ? (
            <div
              className={cn(styles.cardOverlay, !draggedEntry.name && styles.isUntitled)}
              style={widthVar(draggedEntry.col)}
            >
              {draggedEntry.name || "Unnamed entry"}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
