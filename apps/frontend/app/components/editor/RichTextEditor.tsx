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

import { cn } from "~/lib/cn.ts";
import styles from "./editor.module.css";
import { MARKDOWN_SHORTCUTS } from "./markdown-shortcuts.ts";
import { editorTheme } from "./theme.ts";
import { FootnoteNode } from "./nodes/FootnoteNode.tsx";
import { AutoLinkOnPastePlugin } from "./plugins/AutoLinkOnPastePlugin.tsx";
import { EditorControllerPlugin } from "./plugins/EditorControllerPlugin.tsx";
import { FloatingToolbarPlugin } from "./plugins/FloatingToolbarPlugin.tsx";
import { FootnoteCopyPlugin } from "./plugins/FootnoteCopyPlugin.tsx";
import { FootnotePlugin } from "./plugins/FootnotePlugin.tsx";
import { SlashMenuPlugin } from "./plugins/SlashMenuPlugin.tsx";

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
  className?: string;
};

export const RichTextEditor = forwardRef<EditorHandle, Props>(function RichTextEditor(
  { initialContent, onSave, onDirtyChange, className },
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
        // The shared document schema, with the React-rendering footnote swapped
        // in for the canonical headless one. HorizontalRuleExtension re-registers
        // HorizontalRuleNode (the same class — harmless) as part of the divider
        // support wired in via `dependencies` below.
        nodes: [...DOCUMENT_NODES, FootnoteNode],
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
      {/* contentEditable={null} — the RichTextPlugin child renders its own
          ContentEditable (below), so the composer must not add a default one. */}
      <LexicalExtensionComposer extension={editorExtension} contentEditable={null}>
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
              Write something. Highlight text and use / for formatting options.
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
        <AutoLinkOnPastePlugin />
        <FloatingToolbarPlugin />
        <SlashMenuPlugin />
        <FootnotePlugin />
        <FootnoteCopyPlugin />
        <EditorControllerPlugin handleRef={ref} onSave={onSave} onDirtyChange={onDirtyChange} />
      </LexicalExtensionComposer>
    </div>
  );
});
