/**
 * WYSIWYG editor wrapping TipTap, with a Markdown round-trip via marked +
 * turndown so the content stays as Markdown in the store (per
 * spec/1-core-data-model.md). A floating bubble menu appears for the current
 * text selection.
 */
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Marked } from "marked";
import TurndownService from "turndown";

import { cn } from "~/lib/cn";

const AUTOSAVE_DEBOUNCE_MS = 800;

type BubblePos = { left: number; top: number } | null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Treat any raw HTML in stored markdown as literal text rather than passing it
// through to the DOM. Without this, typing something like `<script>` into the
// editor round-trips through markdown and is re-parsed as a real tag on load.
const marked = new Marked({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

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
  // Backslash-escape `<` in text so the stored markdown is unambiguous on its
  // own — any other CommonMark renderer will also treat it as literal text.
  // Turndown already escapes `>`; `<` is the missing half.
  const baseEscape = td.escape.bind(td);
  td.escape = (s: string) => baseEscape(s).replace(/</g, "\\<");
  return td;
}

export type MarkdownEditorHandle = { save: () => void };

export function MarkdownEditor({
  initialMarkdown,
  placeholder = "Start writing. Highlight text to format it.",
  onSave,
  onDirtyChange,
  className,
  ref,
}: {
  initialMarkdown: string;
  placeholder?: string;
  onSave: (markdown: string) => void;
  /**
   * Fires `true` as soon as the user types, and `false` once the debounced
   * autosave has handed the latest markdown to `onSave`. The route uses this
   * to decide whether unsaved-changes navigation guards apply — it is *not*
   * the "saving" indicator (the indicator is driven by mutation state so it
   * doesn't blink on every keystroke).
   */
  onDirtyChange?: (dirty: boolean) => void;
  className?: string;
  ref?: Ref<MarkdownEditorHandle>;
}) {
  const [bubble, setBubble] = useState<BubblePos>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(initialMarkdown);
  const turndown = useMemo(() => buildTurndown(), []);

  const flush = (editor: Editor) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const md = turndown.turndown(editor.getHTML());
    if (md !== lastSaved.current) {
      lastSaved.current = md;
      onSave(md);
    }
    onDirtyChange?.(false);
  };

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder })],
    content: markdownToHtml(initialMarkdown),
    autofocus: false,
    editorProps: {
      attributes: { class: "prose max-w-none ProseMirror" },
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
    onBlur: ({ editor }) => flush(editor),
    onUpdate: ({ editor }) => {
      onDirtyChange?.(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flush(editor), AUTOSAVE_DEBOUNCE_MS);
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      save: () => {
        if (editor) flush(editor);
      },
    }),
    [editor],
  );

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
    <div ref={wrapperRef} className={cn("relative", className)}>
      <EditorContent editor={editor} className="flex-1 flex flex-col" />
      {editor && bubble && <BubbleMenu editor={editor} pos={bubble} />}
    </div>
  );
}

const bubbleBtnBase =
  "font-[inherit] bg-transparent border-0 text-paper-edge size-7 rounded-sm cursor-pointer inline-flex items-center justify-center font-semibold text-base hover:bg-primary-hover hover:text-stark";

function BubbleMenu({ editor, pos }: { editor: Editor; pos: { left: number; top: number } }) {
  const isActive = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);
  return (
    <div
      className="inline-flex items-center bg-primary text-stark rounded-md p-1 gap-px text-sm shadow-lg"
      style={{ position: "absolute", left: pos.left, top: pos.top, transform: "translateX(-50%)" }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        title="Heading 1"
        className={cn(
          bubbleBtnBase,
          isActive("heading", { level: 1 }) && "bg-primary-hover text-stark",
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
          isActive("heading", { level: 2 }) && "bg-primary-hover text-stark",
        )}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </button>
      <span className="w-px h-4 bg-primary-hover mx-1 flex-shrink-0" />
      <button
        type="button"
        title="Bold"
        className={cn(bubbleBtnBase, isActive("bold") && "bg-primary-hover text-stark")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <i className="ri-bold" />
      </button>
      <button
        type="button"
        title="Italic"
        className={cn(bubbleBtnBase, isActive("italic") && "bg-primary-hover text-stark")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <i className="ri-italic" />
      </button>
      <button
        type="button"
        title="Strike"
        className={cn(bubbleBtnBase, isActive("strike") && "bg-primary-hover text-stark")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <i className="ri-strikethrough" />
      </button>
      <span className="w-px h-4 bg-primary-hover mx-1 flex-shrink-0" />
      <button
        type="button"
        title="Bullet list"
        className={cn(bubbleBtnBase, isActive("bulletList") && "bg-primary-hover text-stark")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <i className="ri-list-unordered" />
      </button>
      <button
        type="button"
        title="Ordered list"
        className={cn(bubbleBtnBase, isActive("orderedList") && "bg-primary-hover text-stark")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <i className="ri-list-ordered" />
      </button>
      <button
        type="button"
        title="Quote"
        className={cn(bubbleBtnBase, isActive("blockquote") && "bg-primary-hover text-stark")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <i className="ri-double-quotes-l" />
      </button>
      <button
        type="button"
        title="Code"
        className={cn(bubbleBtnBase, isActive("code") && "bg-primary-hover text-stark")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <i className="ri-code-line" />
      </button>
    </div>
  );
}
