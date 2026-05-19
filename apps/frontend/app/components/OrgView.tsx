/**
 * Organizational view (v2 spec).
 *
 * Each sequence of siblings is a group rendered as a single container. If a
 * sibling has children, those children form their own group nested inside,
 * offset to the right. Every group ends with an "Add" button that creates a
 * new last sibling. Column numbers are shown in a sticky strip at the top;
 * each one has its own "Add" button that creates a new root in that column.
 *
 * Hovering an entry reveals two buttons on the right: "add child" and
 * "rearrange". Entries can also be dragged onto each other (top-half →
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

type AddInput = { col: number; parentId: string | null };

type DropData =
  | { kind: "before" | "after"; refId: string }
  | { kind: "child"; parentId: string }
  | { kind: "rootInCol"; col: number };

// ── Tree helpers ───────────────────────────────────────────────────────

/** Index every node in the forest by id; also record each node's parent id. */
function indexForest(forest: EntryNode[]): {
  byId: Map<string, EntryNode>;
  parentOf: Map<string, string | null>;
} {
  const byId = new Map<string, EntryNode>();
  const parentOf = new Map<string, string | null>();
  const walk = (nodes: EntryNode[], parent: string | null) => {
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
  draggedId: string,
  drop: DropData,
  byId: Map<string, EntryNode>,
  parentOf: Map<string, string | null>,
  forest: EntryNode[],
): MoveEntryInput | null {
  const siblingsOf = (parentId: string | null): EntryNode[] => {
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
    return { id: draggedId, parentId: refParentId, col, position };
  }
  if (drop.kind === "child") {
    if (drop.parentId === draggedId) return null;
    const parent = byId.get(drop.parentId);
    if (!parent) return null;
    return {
      id: draggedId,
      parentId: parent.id,
      col: parent.col - 1,
      position: siblingsOf(parent.id).length,
    };
  }
  if (drop.kind === "rootInCol") {
    // Append after all existing roots.
    return {
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
  hasChildren,
  onSaveName,
  onAddChild,
  onRearrange,
}: {
  entry: EntryNode;
  logbookSegment: string;
  isEditing: boolean;
  isDragging: boolean;
  hasChildren: boolean;
  onSaveName: (name: string) => void;
  onAddChild: () => void;
  onRearrange: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const wasEditingRef = useRef(isEditing);
  // After a drag, the synthesized click on pointerup would otherwise navigate
  // through the inner <Link>. Track when this cell was the drag source so we
  // can swallow that one click.
  const justDraggedRef = useRef(false);

  // Focus the input when entering edit mode; focus the link when leaving it
  // (so a second Enter follows the link).
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (wasEditingRef.current) {
      linkRef.current?.focus();
    }
    wasEditingRef.current = isEditing;
  }, [isEditing]);

  const draggable = useDraggable({
    id: `entry:${entry.id}`,
    disabled: isEditing,
    data: { entryId: entry.id },
  });
  if (draggable.isDragging) justDraggedRef.current = true;
  const topDrop = useDroppable({
    id: `before:${entry.id}`,
    data: { kind: "before", refId: entry.id } satisfies DropData,
    disabled: isEditing,
  });
  const bottomDrop = useDroppable({
    id: `after:${entry.id}`,
    data: { kind: "after", refId: entry.id } satisfies DropData,
    disabled: isEditing,
  });
  const childDrop = useDroppable({
    id: `child:${entry.id}`,
    data: { kind: "child", parentId: entry.id } satisfies DropData,
  });

  const isOver = topDrop.isOver || bottomDrop.isOver ? (topDrop.isOver ? "top" : "bottom") : null;

  if (isEditing) {
    return (
      <div className={cn(styles.row, styles.isEditing)}>
        <input
          ref={inputRef}
          className={styles.rowInput}
          defaultValue={entry.name}
          placeholder="Unnamed entry"
          onBlur={(e) => onSaveName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSaveName(e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onSaveName(entry.name);
            }
          }}
        />
      </div>
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
        ref={linkRef}
        to={`/${logbookSegment}/${routeSegment(entry.slug, entry.id)}`}
        className={cn(styles.rowLink, !entry.name && styles.isUntitled)}
        draggable={false}
      >
        <span className={styles.rowName}>{entry.name || "Unnamed entry"}</span>
      </Link>

      <div className={styles.rowActions} onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          ref={childDrop.setNodeRef}
          className={cn(
            styles.rowAction,
            isDragging && styles.isDragContext,
            childDrop.isOver && styles.isOver,
          )}
          aria-label="Add child"
          title="Add child"
          onClick={onAddChild}
        >
          <i className="ri-corner-down-right-line" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.rowAction}
          aria-label="Rearrange siblings"
          title="Rearrange siblings"
          onClick={onRearrange}
        >
          <i className="ri-arrow-up-down-line" aria-hidden="true" />
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

// ── Group ──────────────────────────────────────────────────────────────

function NestedGroup({
  siblings,
  parentId,
  logbookSegment,
  editingId,
  isDragging,
  onAdd,
  onSaveName,
  onRearrange,
}: {
  siblings: EntryNode[];
  parentId: string | null;
  logbookSegment: string;
  editingId: string | null;
  isDragging: boolean;
  onAdd: (input: AddInput) => void;
  onSaveName: (id: string, name: string) => void;
  onRearrange: (id: string) => void;
}) {
  const first = siblings[0];
  if (!first) return null;
  const col = first.col;

  return (
    <div className={cn(styles.box, boxColClass(col))}>
      <div className="flex flex-col">
        {siblings.map((sib) => (
          <Fragment key={sib.id}>
            <EntryCell
              entry={sib}
              logbookSegment={logbookSegment}
              isEditing={editingId === sib.id}
              isDragging={isDragging}
              hasChildren={sib.children.length > 0}
              onSaveName={(name) => onSaveName(sib.id, name)}
              onAddChild={() => onAdd({ col: sib.col - 1, parentId: sib.id })}
              onRearrange={() => onRearrange(sib.id)}
            />
            {sib.children.length > 0 &&
              runsByCol(sib.children).map((run, j) => (
                <NestedGroup
                  key={`${sib.id}-${j}`}
                  siblings={run.kids}
                  parentId={sib.id}
                  logbookSegment={logbookSegment}
                  editingId={editingId}
                  isDragging={isDragging}
                  onAdd={onAdd}
                  onSaveName={onSaveName}
                  onRearrange={onRearrange}
                />
              ))}
          </Fragment>
        ))}
      </div>
      <button type="button" className={styles.add} onClick={() => onAdd({ col, parentId })}>
        <i className="ri-add-line" aria-hidden="true" />
        <span>Add</span>
      </button>
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
  editingId,
  scrollTargetId,
  onAdd,
  onRename,
  onMove,
  onReorderSiblings,
  onScrolled,
}: {
  forest: EntryNode[];
  logbookId: string;
  logbookSlug: string;
  /** When set, that entry renders an inline name input instead of a link. */
  editingId: string | null;
  /** When set, that entry is scrolled into view once after it appears. */
  scrollTargetId: string | null;
  onAdd: (input: AddInput) => void;
  onRename: (id: string, name: string) => void;
  onMove: (input: MoveEntryInput) => void;
  onReorderSiblings: (parentId: string | null, ids: string[]) => void;
  onScrolled: () => void;
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

  const topRuns = useMemo(() => runsByCol(forest), [forest]);

  // Drag state.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
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
    if (id.startsWith("entry:")) setActiveDragId(id.slice("entry:".length));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;
    const data = over.data.current as DropData | undefined;
    if (!data) return;
    const id = String(active.id).replace(/^entry:/, "");
    const move = dropToMoveInput(id, data, byId, parentOf, forest);
    if (move) onMove(move);
  };
  const onDragCancel = () => setActiveDragId(null);

  const draggedEntry = useMemo(
    () => (activeDragId ? (byId.get(activeDragId) ?? null) : null),
    [activeDragId, byId],
  );

  // Scroll the scroll-target entry into view once it exists. Use a ref so
  // we don't repeat the scroll on later renders.
  const scrolledRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!scrollTargetId || scrolledRef.current === scrollTargetId) return;
    const node = document.querySelector<HTMLElement>(`[data-entry-anchor="${scrollTargetId}"]`);
    if (node) {
      node.scrollIntoView({ block: "nearest", behavior: "smooth" });
      scrolledRef.current = scrollTargetId;
      onScrolled();
    }
  }, [scrollTargetId, onScrolled, forest]);

  // Rearrange-modal state.
  const [rearrangeFor, setRearrangeFor] = useState<string | null>(null);
  const rearrangeContext = useMemo(() => {
    if (!rearrangeFor) return null;
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

          {isEmpty ? (
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
                {topRuns.map((run, i) => (
                  <div key={i} className={styles.tree} style={colVar(maxCol - run.col)}>
                    <NestedGroup
                      siblings={run.kids}
                      parentId={null}
                      logbookSegment={logbookSegment}
                      editingId={editingId}
                      isDragging={activeDragId !== null}
                      onAdd={onAdd}
                      onSaveName={onRename}
                      onRearrange={(id) => setRearrangeFor(id)}
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
