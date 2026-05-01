/**
 * Organizational view — nested-containers design.
 *
 * Layout, sizing, and positioning live in CSS via custom properties on
 * :root and on individual elements (--org-col-idx, --org-col-span). This
 * component just builds the tree structure and labels columns.
 */
import { type CSSProperties, Fragment, useMemo } from "react";
import { Link } from "react-router";

import type { EntryNode } from "logarithmic-backend/api-types";

import { cn } from "~/lib/cn";

type TreeNode = EntryNode & { children: TreeNode[] };

function isOddCol(col: number): boolean {
  return (col & 1) !== 0;
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

function colVar(idx: number): CSSProperties {
  return { "--org-col-idx": idx } as CSSProperties;
}

// ── Components ─────────────────────────────────────────────────────────

function NestedRow({
  entry,
  activeId,
  logbookId,
  hasChildren,
}: {
  entry: TreeNode;
  activeId: string | null;
  logbookId: string;
  hasChildren: boolean;
}) {
  const isActive = entry.id === activeId;
  return (
    <Link
      to={`/${logbookId}/${entry.id}`}
      className={cn("nest-row", isActive && "is-active", hasChildren && "has-children")}
    >
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
  onAdd,
}: {
  siblings: TreeNode[];
  activeId: string | null;
  logbookId: string;
  onAdd?: (col: number, parentId: string | null) => void;
}) {
  const first = siblings[0];
  if (!first) return null;
  const col = first.col;
  const parentId = first.parentId;

  // Each entry with children renders as its own box. Consecutive siblings
  // that have no children share a single box.
  const boxes: TreeNode[][] = [];
  for (const sib of siblings) {
    const last = boxes[boxes.length - 1];
    const lastFirst = last?.[0];
    const canAppend = sib.children.length === 0 && !!lastFirst && lastFirst.children.length === 0;
    if (canAppend && last) last.push(sib);
    else boxes.push([sib]);
  }

  return (
    <>
      {boxes.map((box, i) => (
        <div key={i} className={cn("nest-box", isOddCol(col) && "is-odd")}>
          <div className="nest-box-rows">
            {box.map((sib) => (
              <Fragment key={sib.id}>
                <NestedRow
                  entry={sib}
                  activeId={activeId}
                  logbookId={logbookId}
                  hasChildren={sib.children.length > 0}
                />
                {sib.children.length > 0 &&
                  runsByCol(sib.children).map((run, j) => (
                    <NestedGroup
                      key={`${sib.id}-${j}`}
                      siblings={run.kids}
                      activeId={activeId}
                      logbookId={logbookId}
                      onAdd={onAdd}
                    />
                  ))}
              </Fragment>
            ))}
          </div>
          <NestedAddBtn
            onAdd={() => {
              onAdd?.(col, parentId);
            }}
          />
        </div>
      ))}
    </>
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
  const isEmpty = forest.length === 0;
  const { min: dataMinCol, max: dataMaxCol } = useMemo(() => colRange(forest), [forest]);
  // For an empty logbook, show a default range so the user can pick which
  // column to start in via the column-strip add buttons.
  const minCol = isEmpty ? 0 : dataMinCol;
  const maxCol = isEmpty ? 4 : dataMaxCol;

  const cols: number[] = [];
  for (let c = maxCol; c >= minCol; c--) cols.push(c);

  const topRuns: { col: number; roots: TreeNode[] }[] = [];
  for (const t of forest) {
    const last = topRuns[topRuns.length - 1];
    if (last && last.col === t.col) last.roots.push(t);
    else topRuns.push({ col: t.col, roots: [t] });
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden bg-paper"
      style={{ "--org-col-span": maxCol - minCol } as CSSProperties}
    >
      <div className="nest-col-strip">
        <div className="nest-col-strip-inner">
          {cols.map((c) => (
            <Fragment key={c}>
              <span className="nest-col-pill" style={colVar(maxCol - c)}>
                {c > 0 ? `+${c}` : `${c}`}
              </span>
              <button
                type="button"
                className="nest-col-add"
                style={colVar(maxCol - c)}
                aria-label={`Add entry in column ${c}`}
                onClick={() => onAdd?.({ col: c, parentId: null })}
              >
                <i className="ri-add-line" aria-hidden="true" />
              </button>
            </Fragment>
          ))}
        </div>
      </div>

      <div className="exp-scroll exp-scroll-paper">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-ink-3 gap-3.5 py-16 px-10 text-center">
            <div className="org-ill" />
            <h3 className="text-[length:var(--org-empty-title-font)] font-semibold text-ink m-0">
              An empty logbook is a fine place to start.
            </h3>
            <p className="text-[length:var(--org-row-font)] text-ink-3 m-0 max-w-xs">
              Click the{" "}
              <i
                className="ri-add-line align-middle text-[length:var(--org-row-font)]"
                aria-hidden="true"
              />{" "}
              under any column above to create your first entry there.
            </p>
          </div>
        ) : (
          <div className="nest-canvas-wrap">
            <div className="nest-forest">
              {topRuns.map((run, i) => (
                <div key={i} className="nest-tree" style={colVar(maxCol - run.col)}>
                  <NestedGroup
                    siblings={run.roots}
                    activeId={activeId}
                    logbookId={logbookId}
                    onAdd={(col, parentId) => onAdd?.({ col, parentId })}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
