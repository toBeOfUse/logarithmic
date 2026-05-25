/**
 * Organizational view (v2 spec).
 *
 * Each sequence of siblings is a group rendered as a single container. If a
 * sibling has children, those children form their own group nested inside,
 * offset to the right. Every group ends with an "Add" button that creates a
 * new last sibling. Column numbers are shown in a sticky strip at the top;
 * each one has its own "Add" button that creates a new root in that column.
 *
 * Hovering an entry reveals three buttons on the right: "rename", "reorder",
 * and "add child". Renaming reuses the same input-cell shape that adding new
 * entries does. Entries can also be dragged onto each other (top-half →
 * sibling-before, bottom-half → sibling-after), onto an "add child" button
 * (becomes the last child of that entry), or onto a column-strip add button
 * (becomes a new root in that column).
 *
 * Layout/sizing live in OrgView.module.css under custom properties.
 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
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
 * The single input cell that can be live in the org view at a time — either
 * one being added under a parent, or one in place of an existing entry being
 * renamed. Per spec, "input cells only exist while they're focused, and there
 * should never be a need to render two at once."
 */
type PendingInput =
  | { kind: "add"; col: number; parentId: number | null }
  | { kind: "rename"; entryId: number };

type DropData =
  | { kind: "before" | "after"; refId: number }
  | { kind: "child"; parentId: number }
  | { kind: "rootInCol"; col: number };

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
 * Convert a drop target (the dnd-kit concept attached to each drop zone) into
 * the API's `MoveEntryInput`. The drop zones describe intent in terms of
 * relative neighbours; the server expects an absolute `{parentId, col,
 * position}` triple, and we have the forest right here to bridge the two.
 * Returns null for self-drops and other no-ops.
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
    const parent = refParentId ? byId.get(refParentId) : null;
    const col = parent ? parent.col - 1 : ref.col;
    const sibs = siblingsOf(refParentId);
    const refIdx = sibs.findIndex((s) => s.id === ref.id);
    const position = drop.kind === "before" ? refIdx : refIdx + 1;
    return { logbookId, id: draggedId, parentId: refParentId, col, position };
  }
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
  if (drop.kind === "rootInCol") {
    // Append after all existing roots.
    return {
      logbookId,
      id: draggedId,
      parentId: null,
      col: drop.col,
      position: siblingsOf(null).length,
    };
  }
  return null;
}

function runsByCol<T extends { col: number }>(items: T[]): { col: number; kids: T[] }[] {
  const runs: { col: number; kids: T[] }[] = [];
  for (const c of items) {
    const last = runs[runs.length - 1];
    if (last && last.col === c.col) last.kids.push(c);
    else runs.push({ col: c.col, kids: [c] });
  }
  return runs;
}

/**
 * Render specs for the groups belonging to a parent (or null for roots).
 *
 * Start from existing same-col runs of children, then splice in the pending
 * add-input cell at the end if one's targeted at this parent. If the last
 * run's col matches, the input cell rides along inside it; otherwise it gets
 * its own group so a not-yet-existent column can be opened up.
 */
function groupsForParent(
  children: EntryNode[],
  pendingInput: PendingInput | null,
  parentId: number | null,
): { col: number; kids: EntryNode[]; hasPendingInput: boolean }[] {
  const runs = runsByCol(children).map((r) => ({ ...r, hasPendingInput: false }));
  if (pendingInput?.kind === "add" && pendingInput.parentId === parentId) {
    const last = runs[runs.length - 1];
    if (last && last.col === pendingInput.col) last.hasPendingInput = true;
    else runs.push({ col: pendingInput.col, kids: [], hasPendingInput: true });
  }
  return runs;
}

function colVar(idx: number): CSSProperties {
  return { "--org-col-idx": idx } as CSSProperties;
}

function boxColClass(col: number): string | undefined {
  if (col < 0) return styles.isColNeg;
  if (col >= 3) return styles.isCol3plus;
  if (col === 0) return styles.isCol0;
  if (col === 1) return styles.isCol1;
  return styles.isCol2;
}

// ── Cell ───────────────────────────────────────────────────────────────

function EntryCell({
  entry,
  logbookSegment,
  isEditing,
  isDragging,
  emphasizeAddChild,
  hasChildren,
  onAddChild,
  onRename,
  onReorder,
  onSubmitRename,
  onCancelRename,
}: {
  entry: EntryNode;
  logbookSegment: string;
  isEditing: boolean;
  isDragging: boolean;
  emphasizeAddChild: boolean;
  hasChildren: boolean;
  onAddChild: () => void;
  onRename: () => void;
  onReorder: () => void;
  onSubmitRename: (name: string) => void;
  onCancelRename: () => void;
}) {
  // After a drag, the synthesized click on pointerup would otherwise navigate
  // through the inner <Link>. Track when this cell was the drag source so we
  // can swallow that one click.
  const justDraggedRef = useRef(false);

  const draggable = useDraggable({
    id: `entry:${entry.id}`,
    disabled: isEditing,
    data: { entryId: entry.id },
  });
  useEffect(() => {
    if (draggable.isDragging) justDraggedRef.current = true;
  }, [draggable.isDragging]);
  const topDrop = useDroppable({
    id: `before:${entry.id}`,
    disabled: isEditing,
    data: { kind: "before", refId: entry.id } satisfies DropData,
  });
  const bottomDrop = useDroppable({
    id: `after:${entry.id}`,
    disabled: isEditing,
    data: { kind: "after", refId: entry.id } satisfies DropData,
  });
  const childDrop = useDroppable({
    id: `child:${entry.id}`,
    data: { kind: "child", parentId: entry.id } satisfies DropData,
  });

  const isOver = topDrop.isOver || bottomDrop.isOver ? (topDrop.isOver ? "top" : "bottom") : null;

  if (isEditing) {
    return (
      <PendingInputCell
        initialValue={entry.name}
        onSubmit={onSubmitRename}
        onCancel={onCancelRename}
      />
    );
  }

  return (
    <div
      ref={draggable.setNodeRef}
      data-entry-anchor={entry.id}
      className={cn(
        styles.row,
        hasChildren && styles.hasChildren,
        draggable.isDragging && styles.isSource,
        isDragging && styles.isDragContext,
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
      <Link
        to={`/${logbookSegment}/${routeSegment(entry.slug, entry.id)}`}
        className={cn(styles.rowLink, !entry.name && styles.isUntitled)}
        draggable={false}
      >
        <span className={styles.rowName}>{entry.name || "Unnamed entry"}</span>
      </Link>

      <div className={styles.rowActions} onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={styles.rowAction}
          aria-label="Rename"
          title="Rename"
          onClick={onRename}
        >
          <i className="ri-pencil-line" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.rowAction}
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
            styles.rowAction,
            emphasizeAddChild && styles.isDragContext,
            emphasizeAddChild && childDrop.isOver && styles.isOver,
          )}
          aria-label="Add child"
          title="Add child"
          onClick={onAddChild}
        >
          <i className="ri-corner-down-right-line" aria-hidden="true" />
        </button>
      </div>

      {/* Drop halves cover the row, but sit below the action buttons. */}
      <div
        ref={topDrop.setNodeRef}
        className={cn(styles.rowDrop, styles.top, isOver === "top" && styles.isOver)}
        aria-hidden="true"
      />
      <div
        ref={bottomDrop.setNodeRef}
        className={cn(styles.rowDrop, styles.bottom, isOver === "bottom" && styles.isOver)}
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * The shared input cell. Used both for adding a new entry (initialValue="")
 * and for renaming an existing one. Submission is single-fire: whichever of
 * blur or Enter happens first commits the value; Escape commits the cancel
 * path. The caller decides whether an empty submission should create/rename
 * or be treated as a no-op (per spec, both flows treat an all-whitespace
 * value as "no change").
 */
function PendingInputCell({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Submit and blur both end the cell; the second handler to fire would
  // double-submit without this guard.
  const settledRef = useRef(false);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  return (
    <div className={cn(styles.row, styles.isEditing)}>
      <input
        ref={inputRef}
        className={styles.rowInput}
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
  );
}

// ── Group ──────────────────────────────────────────────────────────────

type GroupSpec = { col: number; kids: EntryNode[]; hasPendingInput: boolean };

function NestedGroup({
  spec,
  parentId,
  logbookSegment,
  pendingInput,
  draggedId,
  draggedParentId,
  onAdd,
  onRename,
  onReorder,
  onSubmitPending,
  onCancelPending,
}: {
  spec: GroupSpec;
  parentId: number | null;
  logbookSegment: string;
  pendingInput: PendingInput | null;
  draggedId: number | null;
  draggedParentId: number | null;
  onAdd: (input: AddInput) => void;
  onRename: (id: number) => void;
  onReorder: (id: number) => void;
  onSubmitPending: (name: string) => void;
  onCancelPending: () => void;
}) {
  const { col, kids, hasPendingInput } = spec;
  if (kids.length === 0 && !hasPendingInput) return null;
  const isDragging = draggedId !== null;

  return (
    <div className={cn(styles.box, boxColClass(col))}>
      <div className="flex flex-col">
        {kids.map((sib) => {
          const childSpecs = groupsForParent(sib.children, pendingInput, sib.id);
          const isEditing = pendingInput?.kind === "rename" && pendingInput.entryId === sib.id;
          return (
            <Fragment key={sib.id}>
              <EntryCell
                entry={sib}
                logbookSegment={logbookSegment}
                isEditing={isEditing}
                isDragging={isDragging}
                emphasizeAddChild={isDragging && sib.id !== draggedId && sib.id !== draggedParentId}
                hasChildren={childSpecs.length > 0}
                onAddChild={() => onAdd({ col: sib.col - 1, parentId: sib.id })}
                onRename={() => onRename(sib.id)}
                onReorder={() => onReorder(sib.id)}
                onSubmitRename={onSubmitPending}
                onCancelRename={onCancelPending}
              />
              {childSpecs.map((s, j) => (
                <NestedGroup
                  key={`${sib.id}-${j}`}
                  spec={s}
                  parentId={sib.id}
                  logbookSegment={logbookSegment}
                  pendingInput={pendingInput}
                  draggedId={draggedId}
                  draggedParentId={draggedParentId}
                  onAdd={onAdd}
                  onRename={onRename}
                  onReorder={onReorder}
                  onSubmitPending={onSubmitPending}
                  onCancelPending={onCancelPending}
                />
              ))}
            </Fragment>
          );
        })}
        {hasPendingInput && (
          <PendingInputCell initialValue="" onSubmit={onSubmitPending} onCancel={onCancelPending} />
        )}
      </div>
      {!hasPendingInput && (
        <button type="button" className={styles.add} onClick={() => onAdd({ col, parentId })}>
          <i className="ri-add-line" aria-hidden="true" />
          <span>Add</span>
        </button>
      )}
    </div>
  );
}

// ── Column strip ───────────────────────────────────────────────────────

function ColAddButton({
  col,
  maxCol,
  isDragging,
  onAdd,
}: {
  col: number;
  maxCol: number;
  isDragging: boolean;
  onAdd: (col: number) => void;
}) {
  const drop = useDroppable({
    id: `rootInCol:${col}`,
    data: { kind: "rootInCol", col } satisfies DropData,
  });
  return (
    <button
      type="button"
      ref={drop.setNodeRef}
      className={cn(
        styles.colAdd,
        isDragging && styles.isDragContext,
        drop.isOver && styles.isOver,
      )}
      style={colVar(maxCol - col)}
      aria-label={`Add entry in column ${col}`}
      onClick={() => onAdd(col)}
    >
      <i className="ri-add-line" aria-hidden="true" />
    </button>
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
  onMove,
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
  onMove: (input: MoveEntryInput) => void;
  onReorderSiblings: (parentId: number | null, ids: number[]) => void;
  onFocused: () => void;
}) {
  const logbookSegment = routeSegment(logbookSlug, logbookId);
  const isEmpty = forest.length === 0;
  const { byId, parentOf } = useMemo(() => indexForest(forest), [forest]);
  const { min: dataMin, max: dataMax } = useMemo(() => colRange(forest), [forest]);
  // Strip always shows cols -1 through 3 by default. When data is present,
  // also pad one extra column past either extreme so it's always possible
  // to add an entry one column lower or higher than what currently exists.
  const minCol = isEmpty ? -1 : Math.min(dataMin - 1, -1);
  const maxCol = isEmpty ? 3 : Math.max(dataMax + 1, 3);

  const cols: number[] = [];
  for (let c = maxCol; c >= minCol; c--) cols.push(c);

  const topSpecs = useMemo(
    () => groupsForParent(forest, pendingInput, null),
    [forest, pendingInput],
  );

  // Drag state.
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // The default rectIntersection picks whichever droppable has the largest
  // overlap with the dragged element's rect. Our small "add child" buttons
  // and column-strip add buttons sit fully inside the row's larger top/bottom
  // half drop zones, so they would never win. Use pointerWithin and prefer
  // the small explicit targets when the cursor is inside them.
  const collisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    if (within.length > 0) {
      const byKind = (kind: DropData["kind"]) =>
        within.find((c) => {
          const container = args.droppableContainers.find((d) => d.id === c.id);
          const data = container?.data.current as DropData | undefined;
          return data?.kind === kind;
        });
      const child = byKind("child");
      if (child) return [child];
      const root = byKind("rootInCol");
      if (root) return [root];
      return within;
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

  const draggedEntry = useMemo(
    () => (activeDragId !== null ? (byId.get(activeDragId) ?? null) : null),
    [activeDragId, byId],
  );
  const draggedParentId = activeDragId !== null ? (parentOf.get(activeDragId) ?? null) : null;

  // Focus the freshly-created entry's link (and scroll it into view) once it
  // shows up in the forest. The focus is what lets a second Enter follow the
  // link to the new entry's page; without it the keyboard flow stalls after
  // the input cell submits.
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

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden bg-paper"
      style={{ "--org-col-span": maxCol - minCol } as CSSProperties}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex-1 flex flex-col overflow-auto min-h-0 bg-paper">
          <div className={styles.colStrip}>
            <div className="relative w-full h-full">
              {cols.map((c) => (
                <Fragment key={c}>
                  <span className={styles.colPill} style={colVar(maxCol - c)}>
                    {c > 0 ? `+${c}` : `${c}`}
                  </span>
                  <ColAddButton
                    col={c}
                    maxCol={maxCol}
                    isDragging={activeDragId !== null}
                    onAdd={(col) => onAdd({ col, parentId: null })}
                  />
                </Fragment>
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
            <div className={styles.canvasWrap}>
              <div className="relative z-[2]">
                {topSpecs.map((spec, i) => (
                  <div key={i} className={styles.tree} style={colVar(maxCol - spec.col)}>
                    <NestedGroup
                      spec={spec}
                      parentId={null}
                      logbookSegment={logbookSegment}
                      pendingInput={pendingInput}
                      draggedId={activeDragId}
                      draggedParentId={draggedParentId}
                      onAdd={onAdd}
                      onRename={onRename}
                      onReorder={(id) => setRearrangeFor(id)}
                      onSubmitPending={onSubmitPending}
                      onCancelPending={onCancelPending}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {draggedEntry ? (
            <div className={cn(styles.row, styles.isOverlay)}>
              <span className={cn(styles.rowName, !draggedEntry.name && styles.isUntitled)}>
                {draggedEntry.name || "Unnamed entry"}
              </span>
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
