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
import Document from "@tiptap/extension-document";
import Placeholder from "@tiptap/extension-placeholder";
import { Footnote, FootnoteReference, Footnotes } from "tiptap-footnotes";

import { CommentMark } from "~/components/CommentMark.ts";
import { cn } from "~/lib/cn";
import { docToMarkdown, markdownToDoc } from "~/lib/markdown.ts";

// Footnotes live in a `footnotes` section pinned at the end of the document, so
// the top node must allow it after the body. `tiptap-footnotes` requires this
// and that StarterKit's own document node be disabled (below).
const FootnoteDocument = Document.extend({ content: "block+ footnotes?" });

const AUTOSAVE_DEBOUNCE_MS = 800;

export type MarkdownEditorHandle = {
  save: () => void;
  /**
   * Move focus to the end of the content. When `insertText` is given, that text
   * is inserted there too — used by the route's type-to-focus handler, which
   * `preventDefault`s the originating keystroke (the editor wasn't focused when
   * it fired, so the character would otherwise be lost) and hands us the char.
   */
  focusEnd: (insertText?: string) => void;
};

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
  // Mirror the live editor so the unmount cleanup can flush without re-running
  // the effect on every editor identity change.
  const editorInstance = useRef<Editor | null>(null);

  const flush = (editor: Editor) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const md = docToMarkdown(editor.getJSON());
    if (md !== lastSaved.current) {
      lastSaved.current = md;
      onSave(md);
    }
    onDirtyChange?.(false);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Replaced below with a document node that allows the footnotes section.
        document: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        heading: { levels: [2, 3] },
        underline: false,
        horizontalRule: {},
        hardBreak: false,
      }),
      FootnoteDocument,
      Placeholder.configure({
        // Footnote bodies start empty; prompt the user there too. `includeChildren`
        // lets the placeholder reach the paragraphs nested inside footnotes.
        includeChildren: true,
        placeholder: ({ editor, node, pos }) => {
          if (node.type.name === "paragraph") {
            const $pos = editor.state.doc.resolve(pos);
            for (let d = $pos.depth; d >= 0; d--) {
              if ($pos.node(d).type.name === "footnote") return "Footnote text…";
            }
          }
          return placeholder;
        },
      }),
      CommentMark,
      Footnotes,
      Footnote,
      FootnoteReference,
    ],
    content: markdownToDoc(initialMarkdown),
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

  editorInstance.current = editor;

  const focusEnd = (insertText?: string) => {
    if (!editor) return;
    // "End of content" means the end of the body, not the document — the
    // footnotes section is pinned last, and typing should land in the prose, not
    // inside a footnote. Target the end of the final non-footnotes block.
    const { doc } = editor.state;
    let target = doc.content.size;
    doc.forEach((node, offset) => {
      if (node.type.name !== "footnotes") target = offset + node.nodeSize - 1;
    });
    const chain = editor.chain().focus(target);
    // Insert as an explicit text node rather than a string so characters like
    // `<`, `>`, and `&` aren't reinterpreted as HTML by insertContent's parser.
    if (insertText) chain.insertContent({ type: "text", text: insertText });
    chain.run();
  };

  useImperativeHandle(
    ref,
    () => ({
      save: () => {
        if (editor) flush(editor);
      },
      focusEnd,
    }),
    [editor],
  );

  // On unmount (including entry-switch remounts), flush any edit still inside
  // the debounce window so navigating away never silently drops it. `flush` is
  // idempotent via `lastSaved`, so a prior blur-flush won't double-save.
  useEffect(() => {
    return () => {
      if (saveTimer.current && editorInstance.current) {
        flush(editorInstance.current);
      }
    };
  }, []);

  return (
    <div className={cn("relative flex flex-col", className)}>
      {/* Grow the prose element to fill the flex container so clicks in the
          space below the content still land inside the editable area (at the
          nearest position) instead of missing it. `cursor-text` signals that.
          The footnotes section, when present, renders as the last block inside
          the editor — separated from the body by its own top border/margin. */}
      <EditorContent
        editor={editor}
        className="flex-1 flex flex-col [&_.editor]:flex-1 [&_.editor]:pb-12 cursor-text"
      />
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
    const chain = editor.chain().focus();
    // A real selection operates on exactly that range — so a single word can be
    // (re)linked independently of a larger link it sits inside. A collapsed
    // cursor has no range, so extend to the whole link under it.
    if (editor.state.selection.empty) chain.extendMarkRange("link");
    if (!href) {
      chain.unsetLink().run();
    } else {
      chain.setLink({ href }).run();
    }
    setEditing(false);
  };

  const removeLink = () => {
    const chain = editor.chain().focus();
    // Same range semantics as applyLink: with a selection, strip the link from
    // just those characters (freeing a word from a link that over-covers it);
    // with a collapsed cursor, remove the whole link under it.
    if (editor.state.selection.empty) chain.extendMarkRange("link");
    chain.unsetLink().run();
    setEditing(false);
  };

  // Any change to the editor selection (clicking or arrowing elsewhere) closes
  // an open link form. Without this the link editor would ride along with the
  // caret and stay open over text that isn't a link at all. Opening the form
  // doesn't move the selection, so this never fires on open.
  useEffect(() => {
    const close = () => setEditing(false);
    editor.on("selectionUpdate", close);
    return () => {
      editor.off("selectionUpdate", close);
    };
  }, [editor]);

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor, from, to }) => {
        // While the link form is open, keep the bubble only as long as the
        // selection still anchors to something editable (a live selection, or
        // the caret sitting inside the link being edited). A click into
        // unrelated text fails both and dismisses it — the selectionUpdate
        // listener resets the editing state in the same beat.
        if (linkEditingRef.current) return from !== to || editor.isActive("link");
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
      <button
        type="button"
        title="Add footnote"
        className={bubbleBtnBase}
        onClick={() => editor.chain().focus().addFootnote().run()}
      >
        <i className="ri-superscript" />
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
