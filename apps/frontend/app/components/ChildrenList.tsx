import { useState } from "react";
import { Link } from "react-router";

import type { EntryDetail } from "logarithmic-backend/api-types";

import { cn } from "~/lib/cn";

export function ChildrenList({
  logbookId,
  children,
  onAdd,
}: {
  logbookId: string;
  children: EntryDetail["children"];
  onAdd?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const count = children.length;
  if (count === 0 && !onAdd) return null;

  return (
    <div className="border-t border-stark-border-soft py-3.5 first:border-t-0">
      <button
        type="button"
        className="flex items-center gap-2 text-[11.5px] font-medium text-ink-3 tracking-[0.04em] uppercase cursor-pointer select-none bg-transparent border-0 p-0 w-full text-left"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span
          className={cn(
            "inline-flex w-3.5 h-3.5 items-center justify-center text-ink-4 transition-transform",
            collapsed && "-rotate-90",
          )}
        >
          <i className="ri-arrow-down-s-line" />
        </span>
        <span>Children</span>
        {count > 0 && (
          <span className="font-mono text-[11px] text-ink-4 normal-case tracking-normal">
            {count}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="pt-2.5 pb-1">
          {children.map((c) => {
            const dayMeta =
              c.metadata && typeof c.metadata["Day"] === "string"
                ? (c.metadata["Day"] as string)
                : null;
            return (
              <Link
                key={c.id}
                to={`/${logbookId}/${c.id}`}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-[5px] text-[13px] text-ink no-underline hover:bg-stark-soft"
              >
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {c.name || "Untitled entry"}
                </span>
                {dayMeta && (
                  <span className="text-[11.5px] text-ink-4 flex-shrink-0">{dayMeta}</span>
                )}
                <i className="ri-arrow-right-s-line text-ink-4" aria-hidden="true" />
              </Link>
            );
          })}
          {onAdd && (
            <button
              type="button"
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-[5px] text-[13px] text-ink-3 w-full bg-transparent border-0 cursor-pointer hover:bg-stark-soft"
              onClick={onAdd}
            >
              <span className="inline-flex items-center gap-1">
                <i className="ri-add-line" />
                Add child
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
