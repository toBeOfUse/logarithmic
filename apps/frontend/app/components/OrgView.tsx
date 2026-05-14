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
 * Layout/sizing live in app.css under custom properties.
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

import type { EntryNode } from "logarithmic-backend/api-types";

import type { MoveTarget } from "~/data/store.ts";
import { cn } from "~/lib/cn.ts";

import { RearrangeModal } from "./RearrangeModal.tsx";

type TreeNode = EntryNode & { children: TreeNode[] };

type AddInput = { col: number; parentId: string | null };

type DropData =
  | { kind: "before" | "after"; refId: string }
  | { kind: "child"; parentId: string }
  | { kind: "rootInCol"; col: number };

// ── Tree helpers ───────────────────────────────────────────────────────

function buildForest(entries: EntryNode[]): TreeNode[] {
  // Entries arrive with each parent's children in sibling-order, per the
  // store contract. Group by parentId without re-sorting.
  const byParent = new Map<string | null, EntryNode[]>();
  for (const e of entries) {
    const list = byParent.get(e.parentId) ?? [];
    list.push(e);
    byParent.set(e.parentId, list);
  }
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((e) => ({
      ...e,
      children: build(e.id),
    }));
  return build(null);
}

function colRange(forest: TreeNode[]): { min: number; max: number } {
  let min = Infinity,
    max = -Infinity;
  const walk = (arr: TreeNode[]) => {
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

function isOddCol(col: number): boolean {
  return (col & 1) !== 0;
}

// ── Cell ───────────────────────────────────────────────────────────────

function EntryCell({
  entry,
  logbookId,
  isEditing,
  isDragging,
  hasChildren,
  onSaveName,
  onAddChild,
  onRearrange,
}: {
  entry: TreeNode;
  logbookId: string;
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
      <div className="nest-row is-editing">
        <input
          ref={inputRef}
          className="nest-row-input"
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
        "nest-row",
        hasChildren && "has-children",
        draggable.isDragging && "is-source",
        isDragging && "is-drag-context",
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
        to={`/${logbookId}/${entry.id}`}
        className={cn("nest-row-link", !entry.name && "is-untitled")}
        draggable={false}
      >
        <span className="nest-row-name">{entry.name || "Unnamed entry"}</span>
      </Link>

      <div className="nest-row-actions" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          ref={childDrop.setNodeRef}
          className={cn(
            "nest-row-action add-child",
            isDragging && "is-drag-context",
            childDrop.isOver && "is-over",
          )}
          aria-label="Add child"
          title="Add child"
          onClick={onAddChild}
        >
          <i className="ri-corner-down-right-line" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="nest-row-action"
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
        className={cn("nest-row-drop top", isOver === "top" && "is-over")}
        aria-hidden="true"
      />
      <div
        ref={bottomDrop.setNodeRef}
        className={cn("nest-row-drop bottom", isOver === "bottom" && "is-over")}
        aria-hidden="true"
      />
    </div>
  );
}

// ── Group ──────────────────────────────────────────────────────────────

function NestedGroup({
  siblings,
  parentId,
  logbookId,
  editingId,
  isDragging,
  onAdd,
  onSaveName,
  onRearrange,
}: {
  siblings: TreeNode[];
  parentId: string | null;
  logbookId: string;
  editingId: string | null;
  isDragging: boolean;
  onAdd: (input: AddInput) => void;
  onSaveName: (id: string, name: string) => void;
  onRearrange: (id: string) => void;
}) {
  const first = siblings[0];
  if (!first) return null;
  const col = first.col;
  // Per-column typography modifiers; styles for each tier live in app.css.
  // See spec/3-frontend.md (Column-Level Emphasis).
  const colClass = col < 0 ? "is-col-neg" : col >= 3 ? "is-col-3plus" : `is-col-${col}`;

  return (
    <div
      className={cn("nest-box", isOddCol(col) && "is-odd", !!parentId && "has-parent", colClass)}
    >
      <div className="nest-box-rows">
        {siblings.map((sib) => (
          <Fragment key={sib.id}>
            <EntryCell
              entry={sib}
              logbookId={logbookId}
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
                  logbookId={logbookId}
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
      <button type="button" className="nest-add" onClick={() => onAdd({ col, parentId })}>
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
      className={cn("nest-col-add", isDragging && "is-drag-context", drop.isOver && "is-over")}
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
  entries,
  logbookId,
  editingId,
  scrollTargetId,
  onAdd,
  onRename,
  onMove,
  onReorderSiblings,
  onScrolled,
}: {
  entries: EntryNode[];
  logbookId: string;
  /** When set, that entry renders an inline name input instead of a link. */
  editingId: string | null;
  /** When set, that entry is scrolled into view once after it appears. */
  scrollTargetId: string | null;
  onAdd: (input: AddInput) => void;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, target: MoveTarget) => void;
  onReorderSiblings: (parentId: string | null, ids: string[]) => void;
  onScrolled: () => void;
}) {
  const forest = useMemo(() => buildForest(entries), [entries]);
  const isEmpty = forest.length === 0;
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
    if (data.kind === "before" || data.kind === "after") {
      if (data.refId === id) return;
      onMove(id, { kind: data.kind, refId: data.refId });
    } else if (data.kind === "child") {
      if (data.parentId === id) return;
      onMove(id, { kind: "child", parentId: data.parentId });
    } else if (data.kind === "rootInCol") {
      onMove(id, { kind: "rootInCol", col: data.col });
    }
  };
  const onDragCancel = () => setActiveDragId(null);

  const draggedEntry = useMemo(
    () => (activeDragId ? (entries.find((e) => e.id === activeDragId) ?? null) : null),
    [activeDragId, entries],
  );

  // Scroll the scroll-target entry into view once it exists. Use a ref so
  // we don't repeat the scroll on later renders.
  const scrolledRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!scrollTargetId || scrolledRef.current === scrollTargetId) return;
    const node = document.querySelector<HTMLElement>(`[data-entry-anchor="${scrollTargetId}"]`);
    if (node) {
      node.scrollIntoView({ block: "nearest", behavior: "smooth" });
      scrolledRef.current = scrollTargetId;
      onScrolled();
    }
  }, [scrollTargetId, onScrolled, entries]);

  // Rearrange-modal state.
  const [rearrangeFor, setRearrangeFor] = useState<string | null>(null);
  const rearrangeContext = useMemo(() => {
    if (!rearrangeFor) return null;
    const target = entries.find((e) => e.id === rearrangeFor);
    if (!target) return null;
    const sibs = entries.filter((e) => e.parentId === target.parentId);
    return { parentId: target.parentId, siblings: sibs };
  }, [rearrangeFor, entries]);

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
        <div
          className="flex-1 flex flex-col overflow-auto min-h-0 bg-paper"
          ref={scrollContainerRef}
        >
          <div className="nest-col-strip">
            <div className="nest-col-strip-inner">
              {cols.map((c) => (
                <Fragment key={c}>
                  <span className="nest-col-pill" style={colVar(maxCol - c)}>
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
              <div className="org-ill" />
              <h3 className="text-lg font-semibold text-primary m-0">
                An empty logbook is a fine place to start.
              </h3>
              <p className="text-base text-muted m-0 max-w-xs">
                Click the <i className="ri-add-line align-middle text-base" aria-hidden="true" />{" "}
                under any column above to create your first entry there.
              </p>
            </div>
          ) : (
            <div className="nest-canvas-wrap">
              <div className="nest-forest">
                {topRuns.map((run, i) => (
                  <div key={i} className="nest-tree" style={colVar(maxCol - run.col)}>
                    <NestedGroup
                      siblings={run.kids}
                      parentId={null}
                      logbookId={logbookId}
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
            <div className="nest-row is-overlay">
              <span className={cn("nest-row-name", !draggedEntry.name && "is-untitled")}>
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
