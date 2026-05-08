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
      className={cn("rearrange-item", isDragging && "is-dragging")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <i className="ri-draggable rearrange-grip" aria-hidden="true" />
      <span className={cn("rearrange-name", !entry.name && "is-untitled")}>
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
  onConfirm: (ids: string[]) => void;
}) {
  const [order, setOrder] = useState<string[]>(() => siblings.map((s) => s.id));

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
    setOrder((prev) => {
      const oldIdx = prev.indexOf(String(active.id));
      const newIdx = prev.indexOf(String(over.id));
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const byId = new Map(siblings.map((s) => [s.id, s]));
  const ordered = order.map((id) => byId.get(id)).filter((e): e is EntryNode => !!e);

  return (
    <div className="rearrange-backdrop" onClick={onCancel}>
      <div
        className="rearrange-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Rearrange siblings"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="rearrange-title">Rearrange</h3>
        <p className="rearrange-hint">Drag to reorder. The first entry shows at the top.</p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="rearrange-list">
              {ordered.map((s) => (
                <SortableRow key={s.id} entry={s} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <div className="rearrange-actions">
          <button type="button" className="rearrange-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="rearrange-btn is-primary"
            onClick={() => onConfirm(order)}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
