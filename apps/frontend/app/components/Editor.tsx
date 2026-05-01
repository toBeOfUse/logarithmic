/**
 * WYSIWYG editor wrapping TipTap, with a Markdown round-trip via marked +
 * turndown so the content stays as Markdown in the store (per
 * spec/1-core-data-model.md). A floating bubble menu appears for the current
 * text selection.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { marked } from "marked";
import TurndownService from "turndown";

import { cn } from "~/lib/cn";

const AUTOSAVE_DEBOUNCE_MS = 800;

type BubblePos = { left: number; top: number } | null;

function markdownToHtml(md: string): string {
  if (!md) return "";
  const out = marked.parse(md, { async: false });
  return typeof out === "string" ? out : "";
}

function buildTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  td.addRule("strikethrough", {
    filter: ["s", "strike"] as TurndownService.Filter,
    replacement: (content) => `~~${content}~~`,
  });
  return td;
}

export function MarkdownEditor({
  initialMarkdown,
  placeholder = "Start writing… highlight any text to format it.",
  onSave,
  onSavingChange,
}: {
  initialMarkdown: string;
  placeholder?: string;
  onSave: (markdown: string) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [bubble, setBubble] = useState<BubblePos>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(initialMarkdown);
  const turndown = useMemo(() => buildTurndown(), []);

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder })],
    content: markdownToHtml(initialMarkdown),
    autofocus: false,
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none ProseMirror" },
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to, empty } = editor.state.selection;
      if (empty || from === to) {
        setBubble(null);
        return;
      }
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const wrapRect = wrap.getBoundingClientRect();
      const left = (start.left + end.left) / 2 - wrapRect.left;
      const top = start.top - wrapRect.top - 44;
      setBubble({ left, top });
    },
    onBlur: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const md = turndown.turndown(editor.getHTML());
      if (md !== lastSaved.current) {
        lastSaved.current = md;
        onSave(md);
      }
    },
    onUpdate: ({ editor }) => {
      onSavingChange?.(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const md = turndown.turndown(editor.getHTML());
        if (md !== lastSaved.current) {
          lastSaved.current = md;
          onSave(md);
        } else {
          onSavingChange?.(false);
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
  });

  const getMarkdown = useCallback((): string => {
    if (!editor) return initialMarkdown;
    return turndown.turndown(editor.getHTML());
  }, [editor, initialMarkdown, turndown]);

  void getMarkdown;

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    function close() {
      setBubble(null);
    }
    document.addEventListener("scroll", close, true);
    return () => document.removeEventListener("scroll", close, true);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <EditorContent editor={editor} />
      {editor && bubble && <BubbleMenu editor={editor} pos={bubble} />}
    </div>
  );
}

const bubbleBtnBase =
  "font-[inherit] bg-transparent border-0 text-ink-5 w-[26px] h-[26px] rounded-[4px] cursor-pointer inline-flex items-center justify-center font-semibold text-[14px] hover:bg-[oklch(0.28_0.01_250)] hover:text-white";

function BubbleMenu({ editor, pos }: { editor: Editor; pos: { left: number; top: number } }) {
  const isActive = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);
  return (
    <div
      className="inline-flex items-center bg-[oklch(0.18_0.01_250)] text-white rounded-[7px] p-[3px] gap-px text-[12.5px] shadow-[0_8px_24px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.06)]"
      style={{ position: "absolute", left: pos.left, top: pos.top, transform: "translateX(-50%)" }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        title="Heading 1"
        className={cn(
          bubbleBtnBase,
          isActive("heading", { level: 1 }) && "bg-[oklch(0.28_0.01_250)] text-white",
        )}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        H1
      </button>
      <button
        type="button"
        title="Heading 2"
        className={cn(
          bubbleBtnBase,
          isActive("heading", { level: 2 }) && "bg-[oklch(0.28_0.01_250)] text-white",
        )}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </button>
      <span className="w-px h-4 bg-ink-hover mx-[3px] flex-shrink-0" />
      <button
        type="button"
        title="Bold"
        className={cn(bubbleBtnBase, isActive("bold") && "bg-[oklch(0.28_0.01_250)] text-white")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <i className="ri-bold" />
      </button>
      <button
        type="button"
        title="Italic"
        className={cn(bubbleBtnBase, isActive("italic") && "bg-[oklch(0.28_0.01_250)] text-white")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <i className="ri-italic" />
      </button>
      <button
        type="button"
        title="Strike"
        className={cn(bubbleBtnBase, isActive("strike") && "bg-[oklch(0.28_0.01_250)] text-white")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <i className="ri-strikethrough" />
      </button>
      <span className="w-px h-4 bg-ink-hover mx-[3px] flex-shrink-0" />
      <button
        type="button"
        title="Bullet list"
        className={cn(
          bubbleBtnBase,
          isActive("bulletList") && "bg-[oklch(0.28_0.01_250)] text-white",
        )}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <i className="ri-list-unordered" />
      </button>
      <button
        type="button"
        title="Ordered list"
        className={cn(
          bubbleBtnBase,
          isActive("orderedList") && "bg-[oklch(0.28_0.01_250)] text-white",
        )}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <i className="ri-list-ordered" />
      </button>
      <button
        type="button"
        title="Quote"
        className={cn(
          bubbleBtnBase,
          isActive("blockquote") && "bg-[oklch(0.28_0.01_250)] text-white",
        )}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <i className="ri-double-quotes-l" />
      </button>
      <button
        type="button"
        title="Code"
        className={cn(bubbleBtnBase, isActive("code") && "bg-[oklch(0.28_0.01_250)] text-white")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <i className="ri-code-line" />
      </button>
    </div>
  );
}
