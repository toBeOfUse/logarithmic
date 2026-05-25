/**
 * WYSIWYG editor wrapping TipTap. The Markdown ↔ HTML round-trip used to keep
 * content as Markdown in storage (per spec/1-core-data-model.md) lives in
 * `~/lib/markdown.ts`; this component just wires it to the editor lifecycle
 * and renders the floating selection bubble.
 */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

import { CommentMark } from "~/components/CommentMark.ts";
import { cn } from "~/lib/cn";
import { htmlToMarkdown, markdownToHtml } from "~/lib/markdown.ts";

const AUTOSAVE_DEBOUNCE_MS = 800;

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
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        heading: { levels: [2, 3] },
        underline: false,
        horizontalRule: false,
        hardBreak: false,
      }),
      Placeholder.configure({ placeholder }),
      CommentMark,
    ],
    content: markdownToHtml(initialMarkdown),
    autofocus: false,
    editorProps: {
      attributes: { class: "prose max-w-none editor" },
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

  return (
    <div className={cn("relative", className)}>
      <EditorContent editor={editor} />
      {editor && <SelectionBubble editor={editor} />}
    </div>
  );
}

const bubbleBtnBase =
  "font-[inherit] bg-transparent border-0 text-paper-edge size-7 rounded-sm cursor-pointer inline-flex items-center justify-center font-semibold text-base hover:bg-primary-hover hover:text-stark";

function SelectionBubble({ editor }: { editor: Editor }) {
  const [linkEditing, setLinkEditing] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  // shouldShow is registered once with the ProseMirror plugin, so it closes
  // over the *initial* state value. A ref lets the callback see live updates
  // without re-mounting the menu plugin.
  const linkEditingRef = useRef(false);

  const setEditing = (next: boolean) => {
    linkEditingRef.current = next;
    setLinkEditing(next);
  };

  const openLinkEditor = () => {
    const href = (editor.getAttributes("link").href as string | undefined) ?? "";
    setLinkValue(href);
    setEditing(true);
  };

  const applyLink = (raw: string) => {
    const href = normalizeHref(raw);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) {
      chain.unsetLink().run();
    } else {
      chain.setLink({ href }).run();
    }
    setEditing(false);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setEditing(false);
  };

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor, from, to }) => {
        if (linkEditingRef.current) return true;
        if (from !== to) return true;
        return editor.isActive("link");
      }}
    >
      <div className="inline-flex items-center bg-primary text-stark rounded-md p-1 gap-px text-sm shadow-lg">
        {linkEditing ? (
          <LinkForm
            initialValue={linkValue}
            showRemove={editor.isActive("link")}
            onApply={applyLink}
            onRemove={removeLink}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Toolbar editor={editor} onOpenLink={openLinkEditor} />
        )}
      </div>
    </BubbleMenu>
  );
}

function Toolbar({ editor, onOpenLink }: { editor: Editor; onOpenLink: () => void }) {
  const isActive = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);
  return (
    <div className="inline-flex items-center gap-px" onMouseDown={(e) => e.preventDefault()}>
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
      <button
        type="button"
        title="Link"
        className={cn(bubbleBtnBase, isActive("link") && "bg-primary-hover text-stark")}
        onClick={onOpenLink}
      >
        <i className="ri-link" />
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
      <button
        type="button"
        title="Code block"
        className={cn(bubbleBtnBase, isActive("codeBlock") && "bg-primary-hover text-stark")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <i className="ri-code-box-line" />
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

function LinkForm({
  initialValue,
  showRemove,
  onApply,
  onRemove,
  onCancel,
}: {
  initialValue: string;
  showRemove: boolean;
  onApply: (href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <form
      className="inline-flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(value);
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder="https://example.com"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="bg-primary-hover text-stark placeholder:text-paper-edge px-2 h-7 rounded-sm outline-none w-64 text-sm border-0"
      />
      <button
        type="submit"
        title="Apply link"
        className={bubbleBtnBase}
        onMouseDown={(e) => e.preventDefault()}
      >
        <i className="ri-check-line" />
      </button>
      {showRemove && (
        <button
          type="button"
          title="Remove link"
          className={bubbleBtnBase}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onRemove}
        >
          <i className="ri-link-unlink" />
        </button>
      )}
      <button
        type="button"
        title="Cancel"
        className={bubbleBtnBase}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
      >
        <i className="ri-close-line" />
      </button>
    </form>
  );
}

function normalizeHref(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return `https://${trimmed}`;
}
