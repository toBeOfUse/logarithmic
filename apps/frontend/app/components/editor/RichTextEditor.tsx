/**
 * The Lexical rich text editor for an entry's body (spec/3-frontend.md → "Text
 * Editor"). Formatting is surfaced on demand — a floating toolbar when text is
 * highlighted and a "/" slash menu for block options — and via the standard
 * Markdown shortcuts for the formats we support (see `markdown-shortcuts.ts`).
 * There's no syntax highlighting (language selection isn't a feature yet).
 *
 * The component is uncontrolled: it initializes once from `initialContent` (the
 * stored Lexical JSON string) and reports edits back through `onSave`
 * (debounced autosave + explicit save) and `onDirtyChange`. The parent gets an
 * imperative `EditorHandle` for Ctrl/Cmd-S, type-to-focus, and Copy-as-Markdown.
 */
import { forwardRef, useMemo, useRef } from "react";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { defineExtension, HorizontalRuleExtension } from "@lexical/extension";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { $createParagraphNode, $getRoot } from "lexical";
import { DOCUMENT_NODES } from "logarithmic-content/schema";

import type { ImageUploadResult } from "~/data/image-upload.ts";
import { cn } from "~/lib/cn.ts";
import styles from "./editor.module.css";
import { MARKDOWN_SHORTCUTS } from "./markdown-shortcuts.ts";
import { editorTheme } from "./theme.ts";
import { FootnoteNode } from "./nodes/FootnoteNode.tsx";
import { DataUriImageNode, ImageNode } from "./nodes/ImageNode.tsx";
import { AutoLinkOnPastePlugin } from "./plugins/AutoLinkOnPastePlugin.tsx";
import { ClearFormattingPlugin } from "./plugins/ClearFormattingPlugin.tsx";
import { EditorControllerPlugin } from "./plugins/EditorControllerPlugin.tsx";
import { FloatingToolbarPlugin } from "./plugins/FloatingToolbarPlugin.tsx";
import { FootnoteCopyPlugin } from "./plugins/FootnoteCopyPlugin.tsx";
import { FootnotePlugin } from "./plugins/FootnotePlugin.tsx";
import { ImageDndController, ImageDndProvider } from "./plugins/ImageDndProvider.tsx";
import { ImagePlugin } from "./plugins/ImagePlugin.tsx";
import { MultiParagraphBlockQuotePlugin } from "./plugins/MultiParagraphBlockQuotePlugin.tsx";
import { SlashMenuPlugin } from "./plugins/SlashMenuPlugin.tsx";
import { TrailingParagraphPlugin } from "./plugins/TrailingParagraphPlugin.tsx";

/**
 * Imperative actions the page can trigger on the editor. Deliberately narrow —
 * these are genuine escape-hatch operations (focus, on-demand query) that don't
 * fit the props-down/events-up flow. Everything else (autosave, Ctrl/Cmd-S,
 * dirty tracking) is owned by the editor itself.
 */
export type EditorHandle = {
  /** Focus the editor at the end of its content, optionally typing a character
   *  (used when the user starts typing with nothing else focused). */
  focusEnd: (insertText?: string) => void;
  /** Serialize the current content to Markdown. */
  getMarkdown: () => Promise<string>;
};

type Props = {
  initialContent: string | null;
  onSave: (contentJson: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Upload a picked file or pasted screenshot, returning what to embed. Bound by
   *  the entry route to the current logbook/entry (and whether it's a demo). */
  uploadImage: (file: File, signal: AbortSignal) => Promise<ImageUploadResult>;
  /** Resolve a pasted `<img>`'s src to an embedded image. Also bound by the entry
   *  route: a cross-origin URL is fetched and stored server-side, which needs the
   *  logbook context. */
  uploadPastedImage: (src: string, signal: AbortSignal) => Promise<ImageUploadResult>;
  className?: string;
};

export const RichTextEditor = forwardRef<EditorHandle, Props>(function RichTextEditor(
  { initialContent, onSave, onDirtyChange, uploadImage, uploadPastedImage, className },
  ref,
) {
  // `initialContent` is read exactly once, at mount. The component is
  // uncontrolled (initialize-once): the entry route remounts it per entry via
  // `key={entry.id}`, and autosave feeds the just-saved JSON straight back in as
  // a *new* `initialContent`. Rebuilding the extension on that would rebuild the
  // whole editor — wiping undo history and resetting the toolbar/slash menu — so
  // capture it in a ref and build the extension once (empty deps).
  const initialContentRef = useRef(initialContent);
  const editorExtension = useMemo(
    () =>
      defineExtension({
        name: "[root]",
        namespace: "entry-content",
        theme: editorTheme,
        // The shared document schema, with the React-rendering footnote and image
        // nodes swapped in for the canonical headless ones. The image node also
        // carries the transient upload placeholder as a state of itself, so no
        // separate node type is registered. HorizontalRuleExtension re-registers
        // HorizontalRuleNode (the same class — harmless) as part of the divider
        // support wired in via `dependencies` below.
        nodes: [...DOCUMENT_NODES, FootnoteNode, ImageNode, DataUriImageNode],
        onError: (error) => {
          console.error(error);
        },
        // Load the stored document, or seed an empty paragraph so the caret and
        // placeholder have somewhere to live.
        $initialEditorState: initialContentRef.current
          ? initialContentRef.current
          : () => {
              const root = $getRoot();
              if (root.getFirstChild() === null) root.append($createParagraphNode());
            },
        // The divider, in full: its node, the INSERT_HORIZONTAL_RULE_COMMAND the
        // slash menu dispatches, click-to-select, and the `hrSelected` styling
        // that makes a node-selected rule visible (so Backspace-to-delete reads
        // like any other block). `---`/`***`/`___` is handled by the standard
        // Markdown transformer (see markdown-shortcuts.ts).
        dependencies: [HorizontalRuleExtension],
      }),
    [],
  );

  return (
    <div className={cn("relative flex flex-1 flex-col", className)}>
      {/* The DndContext must sit ABOVE the composer: Lexical's extension provider
          renders the image decorators (the drag sources) as a sibling of the
          composer's children, so a context placed among the children would never
          reach them. `ImageDndController` (below) lives inside the composer, where
          the editor is reachable. */}
      <ImageDndProvider>
        {/* contentEditable={null} — the RichTextPlugin child renders its own
            ContentEditable (below), so the composer must not add a default one. */}
        <LexicalExtensionComposer extension={editorExtension} contentEditable={null}>
          <ImageDndController />
          <RichTextPlugin
            // The editable's *direct* parent must not be a flex container, or
            // Chrome mis-handles focus when clicking outside it (Lexical warns on
            // this). Wrap it in a `grid` that takes over the flex sizing: the
            // editable stretches to fill the grid (so the whole area stays
            // click-to-focus) yet still grows with tall content. A percentage
            // height here would collapse — it can't resolve against the wrapper's
            // flex-derived height — and `grid` (unlike `flex`) doesn't re-trigger
            // the warning.
            contentEditable={
              <div className="grid min-h-50 flex-1">
                <ContentEditable className={cn("prose max-w-none outline-none", styles.content)} />
              </div>
            }
            placeholder={
              <div className="pointer-events-none absolute top-0 left-0 text-muted select-none">
                Write something. Highlight text or use / for formatting options.
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          {/* Tab / Shift-Tab indents list items into sub-lists. */}
          <TabIndentationPlugin />
          <LinkPlugin />
          <MarkdownShortcutPlugin transformers={MARKDOWN_SHORTCUTS} />
          {/* Enter inside a quote stays in the quote, so a block quote can hold
              more than one paragraph. */}
          <MultiParagraphBlockQuotePlugin />
          <AutoLinkOnPastePlugin />
          <ClearFormattingPlugin />
          <FloatingToolbarPlugin />
          <SlashMenuPlugin />
          <FootnotePlugin />
          <FootnoteCopyPlugin />
          <ImagePlugin uploadImage={uploadImage} uploadPastedImage={uploadPastedImage} />
          {/* Must stay ahead of EditorControllerPlugin — see the plugin. */}
          <TrailingParagraphPlugin />
          <EditorControllerPlugin handleRef={ref} onSave={onSave} onDirtyChange={onDirtyChange} />
        </LexicalExtensionComposer>
      </ImageDndProvider>
    </div>
  );
});
