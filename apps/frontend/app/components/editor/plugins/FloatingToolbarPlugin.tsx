/**
 * The floating formatting UI shown when the user highlights text
 * (spec/3-frontend.md → "Text Editor"). It renders a horizontal toolbar with
 * the common block options (H2, H3, bulleted/numbered list, blockquote) plus
 * the inline options (bold, italic, underline, strike-through, link) and a
 * clear-formatting button. Selecting "link" replaces the toolbar with a small
 * URL form in the same floating position.
 *
 * Positioning is viewport-fixed at the selection's bounding rect and recomputed
 * on scroll/resize, so it tracks whether the window or an inner scroll
 * container moves. Both the shell and that positioning live in
 * `FloatingPopover`, shared with the image alt-text form and failure toast.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import { $setBlocksType } from "@lexical/selection";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type LexicalNode,
  type RangeSelection,
  type TextFormatType,
} from "lexical";

import { cn } from "~/lib/cn.ts";
import {
  FloatingPopover,
  POPOVER_INPUT,
  TOOL_BTN,
  TOOL_SEP,
  useDismissOnOutsidePointerDown,
} from "../FloatingPopover.tsx";
import { CLEAR_FORMATTING_COMMAND } from "./ClearFormattingPlugin.tsx";

type BlockType = "paragraph" | "h2" | "h3" | "quote" | "bullet" | "number";

type InlineState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  isLink: boolean;
  linkUrl: string;
  block: BlockType;
};

const EMPTY_STATE: InlineState = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  isLink: false,
  linkUrl: "",
  block: "paragraph",
};

/** The block a selected node sits in, or `null` for the things that aren't text
 *  blocks at all (a divider or an image at the top level). */
function $blockTypeOf(node: LexicalNode): BlockType | null {
  const list = $getNearestNodeOfType(node, ListNode);
  if (list !== null) return list.getListType() === "number" ? "number" : "bullet";
  const element = node.getTopLevelElement();
  if (!$isElementNode(element)) return null;
  if ($isHeadingNode(element)) {
    const tag = element.getTag();
    return tag === "h2" ? "h2" : tag === "h3" ? "h3" : "paragraph";
  }
  return $isQuoteNode(element) ? "quote" : "paragraph";
}

/** The block type of the selection as a whole — a type only when *every* block
 *  in it already has that type, otherwise "paragraph". That's what makes a
 *  button light up, and a lit button is the one that reverts to paragraphs, so
 *  reading only the anchor meant a mixed selection (or a backwards one, whose
 *  anchor is its *last* block) toggled off the type the user meant to apply. */
function $selectionBlockType(selection: RangeSelection): BlockType {
  let common: BlockType | null = null;
  for (const node of selection.getNodes()) {
    const type = $blockTypeOf(node);
    if (type === null) continue;
    if (common === null) common = type;
    else if (common !== type) return "paragraph";
  }
  return common ?? "paragraph";
}

export function FloatingToolbarPlugin({ inlineOnly = false }: { inlineOnly?: boolean } = {}) {
  const [editor] = useLexicalComposerContext();
  const popupRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"hidden" | "toolbar" | "link">("hidden");
  const [state, setState] = useState<InlineState>(EMPTY_STATE);
  const [linkDraft, setLinkDraft] = useState("");
  // The selection rect captured when the toolbar first appears; frozen in link
  // mode so focusing the URL input (which blurs the editor) doesn't move it.
  const rectRef = useRef<DOMRect | null>(null);
  // True while a pointer button is held down, i.e. a drag-select is in progress.
  // The toolbar stays hidden until release so it appears only once the selection
  // is settled (like Notion). Keyboard selection has no pointer down, so it's
  // unaffected.
  const pointerDownRef = useRef(false);

  const readSelectionState = useCallback((): InlineState | null => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    const anchorNode = selection.anchor.getNode();
    const linkNode = $findMatchingParent(anchorNode, (n) => $isLinkNode(n));
    return {
      bold: selection.hasFormat("bold"),
      italic: selection.hasFormat("italic"),
      underline: selection.hasFormat("underline"),
      strikethrough: selection.hasFormat("strikethrough"),
      isLink: $isLinkNode(linkNode) ? true : false,
      linkUrl: $isLinkNode(linkNode) ? linkNode.getURL() : "",
      block: $selectionBlockType(selection),
    };
  }, []);

  const captureRect = useCallback((): DOMRect | null => {
    const domSel = window.getSelection();
    if (!domSel || domSel.rangeCount === 0 || domSel.isCollapsed) return null;
    const rect = domSel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }, []);

  // Recompute visibility + active states whenever the selection changes.
  const syncFromSelection = useCallback(() => {
    // Don't disturb the popover while the user is in the link form.
    if (mode === "link") return;
    // Hold off while the user is still dragging out a selection; the pointer-up
    // handler re-runs this once the selection is settled.
    if (pointerDownRef.current) return;
    const next = editor.getEditorState().read(readSelectionState);
    const rect = captureRect();
    const hasRangeText =
      next != null &&
      rect != null &&
      editor.getRootElement()?.contains(document.activeElement) !== false;
    if (next && rect && hasRangeText) {
      rectRef.current = rect;
      setState(next);
      setMode("toolbar");
    } else {
      setMode("hidden");
    }
  }, [editor, mode, readSelectionState, captureRect]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(() => syncFromSelection()),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          syncFromSelection();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, syncFromSelection]);

  // Reveal the toolbar only once the pointer is released, never mid-drag
  // (Notion-style). A pointer-down anywhere outside the popover begins a drag
  // and hides the toolbar; releasing (or cancelling) re-syncs so it reappears if
  // a range remains. `syncRef` keeps the latest reader without re-binding the
  // document listeners on every render.
  const syncRef = useRef(syncFromSelection);
  syncRef.current = syncFromSelection;
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      // Clicks on the toolbar itself must not hide it or start a "drag".
      if (popupRef.current?.contains(e.target as Node)) return;
      pointerDownRef.current = true;
      setMode((m) => (m === "link" ? m : "hidden"));
    };
    const endDrag = () => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      syncRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", endDrag, true);
    document.addEventListener("pointercancel", endDrag, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", endDrag, true);
      document.removeEventListener("pointercancel", endDrag, true);
    };
  }, []);

  // Dismiss the link form when the user clicks anywhere outside it (e.g. back
  // into the editor), so it doesn't linger after they've moved on.
  useDismissOnOutsidePointerDown(mode === "link", () => setMode("hidden"), popupRef);

  // ── Actions ────────────────────────────────────────────────────────────

  const toggleFormat = (format: TextFormatType) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  };

  const setBlock = (type: BlockType) => {
    const current = state.block;
    if (type === "bullet") {
      editor.dispatchCommand(
        current === "bullet" ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND,
        undefined,
      );
      return;
    }
    if (type === "number") {
      editor.dispatchCommand(
        current === "number" ? REMOVE_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
        undefined,
      );
      return;
    }
    // Selecting the active block type again reverts to a plain paragraph.
    const target: BlockType = current === type ? "paragraph" : type;
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () => {
        if (target === "h2") return $createHeadingNode("h2");
        if (target === "h3") return $createHeadingNode("h3");
        if (target === "quote") return $createQuoteNode();
        return $createParagraphNode();
      });
    });
  };

  const openLinkForm = () => {
    rectRef.current = captureRect() ?? rectRef.current;
    setLinkDraft(state.linkUrl);
    setMode("link");
  };

  const confirmLink = () => {
    const url = linkDraft.trim();
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url === "" ? null : url);
    setMode("hidden");
  };

  const removeLink = () => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    setMode("hidden");
  };

  const clearFormatting = () => {
    editor.dispatchCommand(CLEAR_FORMATTING_COMMAND, undefined);
  };

  if (mode === "hidden") return null;

  // In toolbar mode the anchor tracks the live selection; in link mode it stays
  // frozen, because focusing the URL input blurs the editor and collapses the
  // selection the toolbar was anchored to.
  const body =
    mode === "link" ? (
      <FloatingPopover
        rect={rectRef.current}
        containerRef={popupRef}
        className="gap-1.5 p-1.5"
        role="dialog"
      >
        <input
          className={cn(POPOVER_INPUT, "w-[220px]")}
          autoFocus
          value={linkDraft}
          placeholder="https://example.com"
          onChange={(e) => setLinkDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmLink();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setMode("hidden");
            }
          }}
        />
        <button type="button" className={TOOL_BTN} title="Confirm" onClick={confirmLink}>
          <i className="ri-check-line" />
        </button>
        <button type="button" className={TOOL_BTN} title="Remove link" onClick={removeLink}>
          <i className="ri-link-unlink" />
        </button>
      </FloatingPopover>
    ) : (
      <FloatingPopover
        rect={rectRef.current}
        track={captureRect}
        containerRef={popupRef}
        // Keep the editor's selection intact when clicking a button.
        onMouseDown={(e) => e.preventDefault()}
      >
        {!inlineOnly && (
          <>
            <ToolButton
              icon="ri-h-2"
              title="Heading 2"
              active={state.block === "h2"}
              onClick={() => setBlock("h2")}
            />
            <ToolButton
              icon="ri-h-3"
              title="Heading 3"
              active={state.block === "h3"}
              onClick={() => setBlock("h3")}
            />
            <ToolButton
              icon="ri-list-unordered"
              title="Bulleted list"
              active={state.block === "bullet"}
              onClick={() => setBlock("bullet")}
            />
            <ToolButton
              icon="ri-list-ordered"
              title="Numbered list"
              active={state.block === "number"}
              onClick={() => setBlock("number")}
            />
            <ToolButton
              icon="ri-double-quotes-r"
              title="Quote"
              active={state.block === "quote"}
              onClick={() => setBlock("quote")}
            />
            <span className={TOOL_SEP} />
          </>
        )}
        <ToolButton
          icon="ri-bold"
          title="Bold"
          active={state.bold}
          onClick={() => toggleFormat("bold")}
        />
        <ToolButton
          icon="ri-italic"
          title="Italic"
          active={state.italic}
          onClick={() => toggleFormat("italic")}
        />
        <ToolButton
          icon="ri-underline"
          title="Underline"
          active={state.underline}
          onClick={() => toggleFormat("underline")}
        />
        <ToolButton
          icon="ri-strikethrough"
          title="Strikethrough"
          active={state.strikethrough}
          onClick={() => toggleFormat("strikethrough")}
        />
        <ToolButton icon="ri-link" title="Link" active={state.isLink} onClick={openLinkForm} />
        <span className={TOOL_SEP} />
        <ToolButton icon="ri-format-clear" title="Clear formatting" onClick={clearFormatting} />
      </FloatingPopover>
    );

  return body;
}

function ToolButton({
  icon,
  title,
  active,
  onClick,
}: {
  icon: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(TOOL_BTN, active && "bg-accent-soft text-accent")}
      title={title}
      aria-label={title}
      // Prevent the button from stealing focus / collapsing the selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <i className={icon} />
    </button>
  );
}
