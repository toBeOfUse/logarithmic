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
 * container moves.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import { $patchStyleText, $setBlocksType } from "@lexical/selection";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $isListNode,
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
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type TextFormatType,
} from "lexical";

import { cn } from "~/lib/cn.ts";

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

const INLINE_CLEARABLE: TextFormatType[] = ["bold", "italic", "underline", "strikethrough", "code"];

// --z-toolbar keeps the toolbar/link form below the TopBar (--z-header) so it
// tucks behind the bar when a selection near the top of the editor is toolbar-ed.
const POPOVER =
  "absolute z-(--z-toolbar) flex items-center gap-0.5 rounded-md border border-stark-border bg-stark p-1 shadow-lg";
const TOOL_BTN =
  "inline-flex size-7 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-base text-muted transition-colors hover:bg-stark-hover hover:text-primary";
const TOOL_SEP = "mx-1 my-0.5 w-px self-stretch bg-stark-hover";

export function FloatingToolbarPlugin({ inlineOnly = false }: { inlineOnly?: boolean } = {}) {
  const [editor] = useLexicalComposerContext();
  const popupRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"hidden" | "toolbar" | "link">("hidden");
  const [state, setState] = useState<InlineState>(EMPTY_STATE);
  const [linkDraft, setLinkDraft] = useState("");
  // The selection rect captured when the toolbar first appears; frozen in link
  // mode so focusing the URL input (which blurs the editor) doesn't move it.
  const rectRef = useRef<DOMRect | null>(null);

  const readSelectionState = useCallback((): InlineState | null => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    const anchorNode = selection.anchor.getNode();
    const element =
      anchorNode.getKey() === "root" ? anchorNode : (anchorNode.getTopLevelElement() ?? anchorNode);

    let block: BlockType = "paragraph";
    if ($isListNode(element)) {
      block = element.getListType() === "number" ? "number" : "bullet";
    } else {
      const listParent = $getNearestNodeOfType(anchorNode, ListNode);
      if (listParent) {
        block = listParent.getListType() === "number" ? "number" : "bullet";
      } else if ($isHeadingNode(element)) {
        const tag = element.getTag();
        block = tag === "h2" ? "h2" : tag === "h3" ? "h3" : "paragraph";
      } else if ($isQuoteNode(element)) {
        block = "quote";
      }
    }

    const linkNode = $findMatchingParent(anchorNode, (n) => $isLinkNode(n));
    return {
      bold: selection.hasFormat("bold"),
      italic: selection.hasFormat("italic"),
      underline: selection.hasFormat("underline"),
      strikethrough: selection.hasFormat("strikethrough"),
      isLink: $isLinkNode(linkNode) ? true : false,
      linkUrl: $isLinkNode(linkNode) ? linkNode.getURL() : "",
      block,
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

  // Position the popover at the captured rect, flipping below when there's no
  // room above and clamping into the viewport.
  const position = useCallback(() => {
    const el = popupRef.current;
    const rect = rectRef.current;
    if (!el || !rect) return;
    const elRect = el.getBoundingClientRect();
    let top = rect.top - elRect.height - 8;
    if (top < 8) top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - elRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - elRect.width - 8));
    el.style.position = "fixed";
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, []);

  useLayoutEffect(() => {
    if (mode === "hidden") return;
    position();
  }, [mode, state, position]);

  useEffect(() => {
    if (mode === "hidden") return;
    // In toolbar mode, re-read the live selection rect on scroll/resize; in link
    // mode the rect is frozen, so just keep the element pinned to it.
    const onScrollOrResize = () => {
      if (mode === "toolbar") {
        const rect = captureRect();
        if (rect) rectRef.current = rect;
      }
      position();
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [mode, position, captureRect]);

  // Dismiss the link form when the user clicks anywhere outside it (e.g. back
  // into the editor), so it doesn't linger after they've moved on.
  useEffect(() => {
    if (mode !== "link") return;
    const onPointerDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setMode("hidden");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [mode]);

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
    const active = editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return [] as TextFormatType[];
      return INLINE_CLEARABLE.filter((f) => selection.hasFormat(f));
    });
    for (const f of active) editor.dispatchCommand(FORMAT_TEXT_COMMAND, f);
    // Remove links only across the highlighted range (Lexical splits partial
    // links), matching the spec.
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { color: null, "background-color": null, "font-size": null });
      }
    });
  };

  if (mode === "hidden") return null;

  const body =
    mode === "link" ? (
      <div className={cn(POPOVER, "gap-1.5 p-1.5")} ref={popupRef} role="dialog">
        <input
          className="w-[220px] rounded-sm border border-stark-border bg-stark-hover px-2 py-1 text-sm text-primary outline-none focus:border-accent"
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
      </div>
    ) : (
      <div
        className={POPOVER}
        ref={popupRef}
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
      </div>
    );

  return createPortal(body, document.body);
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
