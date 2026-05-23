/**
 * WYSIWYG editor wrapping TipTap. The Markdown ↔ HTML round-trip used to keep
 * content as Markdown in storage (per spec/1-core-data-model.md) lives in
 * `~/lib/markdown.ts`; this component just wires it to the editor lifecycle
 * and renders the floating selection bubble.
 */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

import { CommentMark } from "~/components/CommentMark.ts";
import { cn } from "~/lib/cn";
import { htmlToMarkdown, markdownToHtml } from "~/lib/markdown.ts";

const AUTOSAVE_DEBOUNCE_MS = 800;

type BubblePos = { left: number; top: number } | null;

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

  const flush = (editor: Editor) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const md = htmlToMarkdown(editor.getHTML());
    if (md !== lastSaved.current) {
      lastSaved.current = md;
      onSave(md);
    }
    onDirtyChange?.(false);
  };

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder }), CommentMark],
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
      <EditorContent editor={editor} />
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
        title="Heading 2"
        className={cn(
          bubbleBtnBase,
          isActive("heading", { level: 2 }) && "bg-primary-hover text-stark",
        )}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </button>
      <button
        type="button"
        title="Heading 3"
        className={cn(
          bubbleBtnBase,
          isActive("heading", { level: 3 }) && "bg-primary-hover text-stark",
        )}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
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
      <span className="w-px h-4 bg-primary-hover mx-1 flex-shrink-0" />
      <button
        type="button"
        title="Comment (Ctrl+/)"
        className={cn(bubbleBtnBase, isActive("comment") && "bg-primary-hover text-stark")}
        onClick={() => editor.chain().focus().toggleMark("comment").run()}
      >
        <i className="ri-chat-1-line" />
      </button>
    </div>
  );
}
