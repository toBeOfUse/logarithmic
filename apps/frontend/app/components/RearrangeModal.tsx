/**
 * Rearrange modal — sortable list of an entry's siblings (or, for a root,
 * the other roots in the logbook). The user drags rows to reorder them and
 * clicks "Confirm" to persist.
 */
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";

import type { EntryNode } from "logarithmic-backend/api-types";

import { cn } from "~/lib/cn.ts";

function SortableRow({ entry }: { entry: EntryNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  });
  return (
    <li
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2.5 py-2 px-2.5 mb-1 bg-stark-soft border border-stark-border rounded-md cursor-grab text-sm text-primary select-none active:cursor-grabbing",
        isDragging && "opacity-50 shadow-lg",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <i className="ri-draggable text-muted text-lg shrink-0" aria-hidden="true" />
      <span
        className={cn(
          "flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
          !entry.name && "text-muted italic",
        )}
      >
        {entry.name || "Unnamed entry"}
      </span>
    </li>
  );
}

export function RearrangeModal({
  siblings,
  onCancel,
  onConfirm,
}: {
  siblings: EntryNode[];
  onCancel: () => void;
  onConfirm: (ids: number[]) => void;
}) {
  const [order, setOrder] = useState<number[]>(() => siblings.map((s) => s.id));

  // Reset if siblings change underneath us (e.g., concurrent edit).
  useEffect(() => {
    setOrder(siblings.map((s) => s.id));
  }, [siblings]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromId = Number(active.id);
    const toId = Number(over.id);
    if (!Number.isFinite(fromId) || !Number.isFinite(toId)) return;
    setOrder((prev) => {
      const oldIdx = prev.indexOf(fromId);
      const newIdx = prev.indexOf(toId);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const byId = new Map(siblings.map((s) => [s.id, s]));
  const ordered = order.map((id) => byId.get(id)).filter((e): e is EntryNode => !!e);

  return (
    <div
      className="fixed inset-0 z-[100] bg-primary/30 flex items-center justify-center p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md max-h-[80vh] flex flex-col bg-stark border border-stark-border rounded-lg shadow-2xl p-5"
        role="dialog"
        aria-modal="true"
        aria-label="Rearrange siblings"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 mb-1 text-lg font-semibold text-primary">Rearrange</h3>
        <p className="m-0 mb-4 text-sm text-muted">
          Drag to reorder. The first entry shows at the top.
        </p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="list-none m-0 p-0 overflow-auto min-h-0 flex-1">
              {ordered.map((s) => (
                <SortableRow key={s.id} entry={s} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="text-sm font-medium py-2 px-3.5 rounded-md border border-stark-border bg-stark text-primary cursor-pointer transition-colors duration-[120ms] hover:bg-stark-soft"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="text-sm font-medium py-2 px-3.5 rounded-md border border-primary bg-primary text-stark cursor-pointer transition-colors duration-[120ms] hover:bg-primary-hover"
            onClick={() => onConfirm(order)}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
