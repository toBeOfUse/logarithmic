/**
 * Organizational view — nested-containers design ported from
 * design/project/org-view.jsx.
 *
 * Each sibling group is a rounded fill (no border). Group boxes have a fixed
 * width centered on each column's center line; the column stride is smaller
 * than the group width, so child groups visibly overlap their parents (the
 * "stagger" from the sketch). Children are always at parent.col − 1.
 */
import { Fragment, useMemo } from "react";
import { Link } from "react-router";

import type { EntryNode } from "logarithmic-backend/api-types";

import { cn } from "~/lib/cn";

type TreeNode = EntryNode & { children: TreeNode[] };

function isOddCol(col: number): boolean {
  return (col & 1) !== 0;
}

const NEST = {
  GROUP_W: 220,
  COL_STRIDE: 88,
  GROUP_PAD_X: 10,
  TREE_GAP: 22,
};

function childMarginLeft(parentCol: number, childCol: number): number {
  const parentCenterInContent = NEST.GROUP_W / 2 - NEST.GROUP_PAD_X;
  const colDelta = parentCol - childCol;
  return parentCenterInContent + colDelta * NEST.COL_STRIDE - NEST.GROUP_W / 2;
}

function buildForest(entries: EntryNode[]): TreeNode[] {
  const byParent = new Map<string | null, EntryNode[]>();
  for (const e of entries) {
    const list = byParent.get(e.parentId) ?? [];
    list.push(e);
    byParent.set(e.parentId, list);
  }
  const sorter = (a: EntryNode, b: EntryNode) =>
    b.col - a.col || a.createdAt.getTime() - b.createdAt.getTime();
  const build = (parentId: string | null): TreeNode[] =>
    [...(byParent.get(parentId) ?? [])].sort(sorter).map((e) => ({
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

// ── Components ─────────────────────────────────────────────────────────

function NestedRow({
  entry,
  activeId,
  logbookId,
}: {
  entry: TreeNode;
  activeId: string | null;
  logbookId: string;
}) {
  const isActive = entry.id === activeId;
  return (
    <Link to={`/${logbookId}/${entry.id}`} className={cn("nest-row", isActive && "is-active")}>
      <span className="nest-row-name">{entry.name}</span>
    </Link>
  );
}

function NestedAddBtn({ onAdd }: { onAdd?: () => void }) {
  return (
    <button type="button" className="nest-add" onClick={onAdd}>
      <i className="ri-add-line" aria-hidden="true" />
      <span>Add</span>
    </button>
  );
}

function NestedGroup({
  siblings,
  activeId,
  logbookId,
  isTop = false,
  parentCol = null,
  onAdd,
}: {
  siblings: TreeNode[];
  activeId: string | null;
  logbookId: string;
  isTop?: boolean;
  parentCol?: number | null;
  onAdd?: (col: number, parentId: string | null) => void;
}) {
  const first = siblings[0];
  if (!first) return null;
  const col = first.col;
  const ml = parentCol == null ? 0 : childMarginLeft(parentCol, col);

  return (
    <div
      className={cn("nest-box", isTop && "is-top", isOddCol(col) && "is-odd")}
      style={{ marginLeft: ml, width: NEST.GROUP_W }}
    >
      <div className="nest-box-rows">
        {siblings.map((sib) => (
          <Fragment key={sib.id}>
            <NestedRow entry={sib} activeId={activeId} logbookId={logbookId} />
            {sib.children.length > 0 &&
              runsByCol(sib.children).map((run, j) => (
                <NestedGroup
                  key={`${sib.id}-${j}`}
                  siblings={run.kids}
                  activeId={activeId}
                  logbookId={logbookId}
                  parentCol={col}
                  onAdd={onAdd}
                />
              ))}
          </Fragment>
        ))}
      </div>
      <NestedAddBtn
        onAdd={() => {
          // Adds a child to the LAST sibling in this group (matches the
          // "+ Add" affordance position visually under the group).
          const lastSib = siblings[siblings.length - 1];
          if (lastSib) onAdd?.(col - 1, lastSib.id);
        }}
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export function OrgView({
  entries,
  logbookId,
  activeId = null,
  onAdd,
}: {
  entries: EntryNode[];
  logbookId: string;
  activeId?: string | null;
  onAdd?: (input: { col: number; parentId: string | null }) => void;
}) {
  const forest = useMemo(() => buildForest(entries), [entries]);
  const { min: minCol, max: maxCol } = useMemo(() => colRange(forest), [forest]);

  if (forest.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-paper">
        <div className="flex flex-col items-center justify-center h-full text-ink-3 gap-3.5 py-16 px-10 text-center">
          <div className="org-ill" />
          <h3 className="text-[15px] font-semibold text-ink m-0">
            An empty logbook is a fine place to start.
          </h3>
          <p className="text-[13px] text-ink-3 m-0 max-w-xs">
            Press{" "}
            <span className="font-mono text-[10.5px] bg-[oklch(0.96_0.003_250)] border border-stark-border text-ink-3 px-1.5 py-px rounded-sm inline-block">
              N
            </span>{" "}
            to create your first entry. It'll land in column 0.
          </p>
          <button
            type="button"
            className="mt-1 [font:inherit] text-sm font-medium bg-ink border border-ink text-paper px-3 py-1.5 rounded cursor-pointer inline-flex items-center gap-1.5 transition-colors hover:bg-[oklch(0.32_0.01_250)]"
            onClick={() => onAdd?.({ col: 0, parentId: null })}
          >
            <i className="ri-add-line" /> Create first entry
          </button>
        </div>
      </div>
    );
  }

  const cols: number[] = [];
  for (let c = maxCol; c >= minCol; c--) cols.push(c);

  const LEFT_PAD = NEST.GROUP_W / 2;
  const colCenter = (c: number) => LEFT_PAD + (maxCol - c) * NEST.COL_STRIDE;
  const totalW = colCenter(minCol) + NEST.GROUP_W / 2 + 60;
  const rootOffset = (col: number) => {
    const idx = maxCol - col;
    return LEFT_PAD + idx * NEST.COL_STRIDE - NEST.GROUP_W / 2;
  };

  const topRuns: { col: number; roots: TreeNode[] }[] = [];
  for (const t of forest) {
    const last = topRuns[topRuns.length - 1];
    if (last && last.col === t.col) last.roots.push(t);
    else topRuns.push({ col: t.col, roots: [t] });
  }

  const totalEntries = entries.length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-paper">
      <div className="h-9 px-3.5 flex items-center gap-2.5 border-b border-paper-edge bg-paper text-xs text-ink-3 flex-shrink-0">
        <button
          type="button"
          className="[font:inherit] text-sm font-medium bg-transparent border-0 text-ink-2 px-3 py-1.5 rounded cursor-pointer inline-flex items-center gap-1.5 transition-colors hover:bg-[oklch(0.93_0.01_85)]"
          onClick={() => onAdd?.({ col: 0, parentId: null })}
        >
          <i className="ri-add-line" /> New entry
        </button>
        <span className="text-ink-5">·</span>
        <span className="text-xs text-ink-3">
          {totalEntries} {totalEntries === 1 ? "entry" : "entries"}
        </span>
        <span className="flex-1" />
      </div>

      <div className="exp-scroll exp-scroll-paper">
        <div className="nest-canvas-wrap" style={{ width: totalW }}>
          <div className="nest-col-strip" style={{ width: totalW }}>
            {cols.map((c) => (
              <span
                key={c}
                className={cn("nest-col-pill", c === 0 && "is-zero")}
                style={{ left: colCenter(c) }}
              >
                {c > 0 ? `+${c}` : `${c}`}
              </span>
            ))}
          </div>

          <div className="nest-forest">
            {topRuns.map((run, i) => (
              <div
                key={i}
                className="nest-tree"
                style={{
                  marginLeft: rootOffset(run.col),
                  marginBottom: NEST.TREE_GAP,
                }}
              >
                <NestedGroup
                  siblings={run.roots}
                  activeId={activeId}
                  logbookId={logbookId}
                  isTop
                  onAdd={(col, parentId) => onAdd?.({ col, parentId })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
