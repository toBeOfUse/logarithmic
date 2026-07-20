/**
 * Drag-to-reorder for block images, on both mouse and touch (spec/3-frontend.md →
 * "Images").
 *
 * The drop engine here is input-agnostic: `computeDrop`/`applyDrop`/`updateDropLine`
 * resolve everything from a single vertical coordinate. The HTML5 drag API used to
 * be the sole source of that coordinate, which is why images couldn't be moved on a
 * phone — `dragstart`/`dragover`/`drop` never fire for touch. @dnd-kit drives it
 * instead: a `MouseSensor` (an 8px move activates, so a click still selects) and a
 * `TouchSensor` (a 400ms long-press activates, so a swipe still scrolls the page).
 * Each image registers itself as a draggable in `ImageComponent`; the live
 * pointer position during the drag — read straight from the native mouse/touch
 * events, not @dnd-kit's scroll-adjusted `delta` (see `pointerY`) — becomes the
 * `clientY` the engine already understood.
 *
 * A single `<DragOverlay>` renders the translucent ghost that follows the pointer —
 * identical on desktop and mobile — replacing the browser's native drag image
 * (which only ever existed for mouse). The dragged image dims in place; the accent
 * `FloatingDropLine` still marks where it will land.
 *
 * Split in two because of where Lexical renders decorators. Under the extension
 * system (`LexicalExtensionComposer`), the image decorators are rendered by
 * Lexical's own React provider as a *sibling* of the composer's children, not
 * inside them — so a `DndContext` placed among the children would never be their
 * ancestor, and `useDraggable` would find no context. Hence:
 *   - `ImageDndProvider` (outer) wraps the composer, so its `DndContext` sits above
 *     the decorators. It owns the sensors but can't reach the editor from here.
 *   - `ImageDndController` (inner) is rendered inside the composer, where the editor
 *     is reachable and where it's still within the DndContext (so its `DragOverlay`
 *     and drop line are valid). It owns the drop engine and publishes its handlers
 *     to the provider through a shared ref.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import {
  $getNodeByKey,
  $getRoot,
  $setSelection,
  SKIP_SCROLL_INTO_VIEW_TAG,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
import { $isAnyImageNode } from "logarithmic-content/nodes/image-node";

type DragHandlers = {
  onDragStart?: (event: DragStartEvent) => void;
  onDragMove?: () => void;
  onDragEnd?: () => void;
  onDragCancel?: () => void;
};

/** How the outer `DndContext` reaches the inner controller's handlers. The
 *  controller (inside the composer) fills the ref; the provider (above it) reads
 *  it when @dnd-kit fires. */
const DragHandlersContext = createContext<MutableRefObject<DragHandlers> | null>(null);

export function ImageDndProvider({ children }: { children: ReactNode }) {
  const handlers = useRef<DragHandlers>({});
  // A click (mouse) or a scroll swipe (touch) must not become a drag: the mouse
  // needs a little movement first, and touch a deliberate long-press — which is
  // also what leaves page scrolling intact until the press lands.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
  );
  return (
    <DragHandlersContext.Provider value={handlers}>
      <DndContext
        sensors={sensors}
        onDragStart={(event) => handlers.current.onDragStart?.(event)}
        onDragMove={() => handlers.current.onDragMove?.()}
        onDragEnd={() => handlers.current.onDragEnd?.()}
        onDragCancel={() => handlers.current.onDragCancel?.()}
      >
        {children}
      </DndContext>
    </DragHandlersContext.Provider>
  );
}

export function ImageDndController() {
  const [editor] = useLexicalComposerContext();
  const handlersRef = useContext(DragHandlersContext);
  // Node key of the image currently being dragged, if any. The drop indicator
  // reads it to skip the dragged image's own gaps (see `computeDrop`).
  const draggingKey = useRef<NodeKey | null>(null);
  // The pointer's live viewport Y, tracked straight from the native mouse/touch
  // move events for the length of a drag. It must be a true `clientY` — the same
  // frame `getBoundingClientRect` reports in (see `computeDrop`) — which is why
  // it is NOT reconstructed from @dnd-kit's event `delta`: that delta is
  // `scrollAdjustedTranslate`, the pointer movement with the editor's scroll
  // folded in, so the instant the content scrolls it drifts by the scrolled
  // distance and the drop lands where the content used to be.
  const pointerY = useRef<number | null>(null);
  // Tears down the native pointer listeners when a drag ends or is cancelled.
  const pointerListeners = useRef<AbortController | null>(null);
  // The accent line marking where a dragged image will drop; null when idle.
  const [dropLine, setDropLine] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  // Source URL of the dragged image, rendered as the following ghost; null when idle.
  const [overlaySrc, setOverlaySrc] = useState<string | null>(null);

  /** Show (or hide) the indicator for a drag currently at `clientY`. */
  const updateDropLine = useCallback(
    (clientY: number) => {
      const drop = editor
        .getEditorState()
        .read(() => computeDrop(editor, clientY, draggingKey.current), { editor });
      setDropLine(drop ? { top: drop.top, left: drop.left, width: drop.width } : null);
    },
    [editor],
  );

  /** Move the dragged image to wherever `clientY` resolves to. */
  const applyDrop = useCallback(
    (key: NodeKey, clientY: number) => {
      setDropLine(null);
      editor.update(
        () => {
          const node = $getNodeByKey(key);
          if (!$isAnyImageNode(node)) return;
          const drop = computeDrop(editor, clientY, key);
          if (!drop) return;
          // `insertBefore`/`append` move the node themselves; removing it first
          // would detach it and make it collectable within this update.
          if (drop.beforeKey === null) {
            $getRoot().append(node);
          } else {
            const target = $getNodeByKey(drop.beforeKey);
            if (!target) return;
            target.insertBefore(node);
          }
          // Drop the selection rather than leaving a stale one pointing into the
          // moved subtree: Lexical would otherwise reconcile it to a default
          // position (the document end) and scroll there, throwing the
          // just-dropped image off screen.
          $setSelection(null);
        },
        { tag: SKIP_SCROLL_INTO_VIEW_TAG },
      );
    },
    [editor],
  );

  const reset = useCallback(() => {
    pointerListeners.current?.abort();
    pointerListeners.current = null;
    draggingKey.current = null;
    pointerY.current = null;
    setOverlaySrc(null);
    setDropLine(null);
  }, []);

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const key = String(event.active.id);
      draggingKey.current = key;
      // Seed from the activation event so the first move already has a coordinate,
      // then keep it current from the native move events for the rest of the drag
      // (rather than @dnd-kit's scroll-adjusted delta — see `pointerY`). The redraw
      // is left to `onDragMove`, which @dnd-kit runs after every move commits — by
      // which point this listener has already recorded the new position. Capture
      // phase and passive: we only read coordinates, ahead of the library's own
      // handling, and never interfere with it.
      pointerY.current = clientYOf(event.activatorEvent);
      const controller = new AbortController();
      const opts = { signal: controller.signal, capture: true, passive: true };
      const track = (moveEvent: Event) => {
        const y = clientYOf(moveEvent);
        if (y !== null) pointerY.current = y;
      };
      window.addEventListener("mousemove", track, opts);
      window.addEventListener("touchmove", track, opts);
      pointerListeners.current = controller;
      // Read the source once here so the overlay ghost matches the dragged image.
      const src = editor.getEditorState().read(() => {
        const node = $getNodeByKey(key);
        return $isAnyImageNode(node) ? node.getSrc() : null;
      });
      setOverlaySrc(src);
    },
    [editor],
  );

  // The single redraw path. @dnd-kit fires this on scroll as well as on pointer
  // movement (its delta depends on scroll position), so it keeps the drop line
  // correct both as the pointer moves and while the editor auto-scrolls under a
  // stationary pointer — always against the latest pointer Y the tracker holds.
  const onDragMove = useCallback(() => {
    if (pointerY.current !== null) updateDropLine(pointerY.current);
  }, [updateDropLine]);

  const onDragEnd = useCallback(() => {
    const key = draggingKey.current;
    if (key !== null && pointerY.current !== null) applyDrop(key, pointerY.current);
    reset();
  }, [applyDrop, reset]);

  // Publish this controller's handlers to the provider's DndContext.
  useEffect(() => {
    if (!handlersRef) return;
    handlersRef.current = { onDragStart, onDragMove, onDragEnd, onDragCancel: reset };
    return () => {
      handlersRef.current = {};
    };
  }, [handlersRef, onDragStart, onDragMove, onDragEnd, reset]);

  return (
    <>
      {/* A small thumbnail rather than a full-size copy, so it's easy to see the
          drop line and content underneath it. `snapCenterToCursor` keeps that
          thumbnail centered on the pointer (the wrapper is shrunk to the image via
          `width/height: auto`, so "center" is the thumbnail's center, not the
          original image's). No drop animation: the real node has already moved, so
          animating the ghost back to its origin would be a lie. */}
      <DragOverlay
        dropAnimation={null}
        modifiers={[snapCenterToCursor]}
        style={{ width: "auto", height: "auto" }}
      >
        {overlaySrc ? (
          <img
            src={overlaySrc}
            alt=""
            draggable={false}
            className="block max-h-36 max-w-40 opacity-90 shadow-md select-none"
          />
        ) : null}
      </DragOverlay>
      {dropLine && (
        <FloatingDropLine top={dropLine.top} left={dropLine.left} width={dropLine.width} />
      )}
    </>
  );
}

/** Pull the viewport `clientY` from whichever native event carries the pointer —
 *  the sensor's activation event, or a `mousemove`/`touchmove` during the drag.
 *  A `MouseEvent` (mouse) or a `TouchEvent` (touch); `PointerEvent` extends
 *  `MouseEvent`, so the first branch covers it too. */
function clientYOf(event: Event): number | null {
  if (event instanceof MouseEvent) return event.clientY;
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch?.clientY ?? null;
  }
  return null;
}

/** The accent line showing where a dragged image will land. z-30 matches the rest
 *  of the editor's floating UI, keeping it below the TopBar. */
function FloatingDropLine({ top, left, width }: { top: number; left: number; width: number }) {
  return createPortal(
    <div
      className="pointer-events-none fixed z-30 h-0.5 rounded-full bg-accent-text"
      style={{ top: top - 1, left, width }}
    />,
    document.body,
  );
}

/** Distance the indicator sits outside the first/last block when dropping at the
 *  very top or bottom of the document. */
const EDGE_GAP = 6;

/** Where a dragged image would land: the block to insert it before, or null to
 *  append at the end — plus the geometry of the indicator line. */
type DropPoint = { beforeKey: NodeKey | null; top: number; left: number; width: number };

/**
 * Resolve a drop position from the pointer's vertical position.
 *
 * The model is one insertion point per *gap* between blocks, rather than
 * "after block A" / "before block B". Those two describe the same landing spot
 * but produce indicator lines a few pixels apart (the blocks' margins), so the
 * same gap appeared to be two different drop targets. Picking a gap index makes
 * that impossible: each gap has exactly one line, drawn down its middle.
 *
 * The dragged block stays in the candidate list so the gaps either side of it
 * remain distinct — collapsing them into one would put their shared midpoint in
 * the middle of the image, drawing the indicator across the thing being dragged.
 * Instead those two gaps are the only ones that yield no drop point at all,
 * since landing in either would leave the image exactly where it started.
 *
 * Must run inside an editor read/update (walks the node tree).
 */
function computeDrop(
  editor: LexicalEditor,
  y: number,
  draggingKey: NodeKey | null,
): DropPoint | null {
  const root = editor.getRootElement();
  if (!root) return null;

  const blocks: Array<{ key: NodeKey; rect: DOMRect }> = [];
  for (const child of $getRoot().getChildren()) {
    const key = child.getKey();
    const rect = editor.getElementByKey(key)?.getBoundingClientRect();
    if (rect) blocks.push({ key, rect });
  }
  if (blocks.length === 0) return null;

  // The pointer lands before the first block whose midpoint it's above; past all
  // of them means the end of the document.
  let index = blocks.findIndex(({ rect }) => y < rect.top + rect.height / 2);
  if (index === -1) index = blocks.length;

  // The gap just before the dragged block and the one just after it both put it
  // back where it is — the only case with no indicator.
  const dragIndex = blocks.findIndex(({ key }) => key === draggingKey);
  if (dragIndex !== -1 && (index === dragIndex || index === dragIndex + 1)) return null;

  // The blocks either side of the chosen gap; the first and last gaps have only
  // one neighbour, and the indicator sits just outside it.
  const previous = index > 0 ? blocks[index - 1] : undefined;
  const next = index < blocks.length ? blocks[index] : undefined;
  let top: number;
  if (previous && next) top = (previous.rect.bottom + next.rect.top) / 2;
  else if (next) top = next.rect.top - EDGE_GAP;
  else if (previous) top = previous.rect.bottom + EDGE_GAP;
  else return null;

  // Span the editor's own width rather than the neighbouring block's, so the
  // indicator doesn't change length as it moves between blocks.
  const rootRect = root.getBoundingClientRect();
  return { beforeKey: next?.key ?? null, top, left: rootRect.left, width: rootRect.width };
}
