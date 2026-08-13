/**
 * Wires footnotes into the editor: registers the insert command the slash menu
 * dispatches, and renders each footnote's body at the bottom of the document.
 *
 * Each body is a `LexicalNestedComposer` bound to the very editor instance the
 * `FootnoteNode` owns, so edits flow straight back into the node's serialized
 * state. A change in a footnote body marks the owning node dirty on the parent
 * editor (merged into history) so the parent's autosave picks up the new body.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { mergeRegister } from "@lexical/utils";
import {
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  CLICK_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
} from "lexical";

import { $collectFootnotes } from "logarithmic-content/nodes/footnote-node";

import { cn } from "~/lib/cn.ts";
import styles from "../editor.module.css";
import { $createFootnoteNode } from "../nodes/FootnoteNode.tsx";
import { AutoLinkOnPastePlugin } from "./AutoLinkOnPastePlugin.tsx";
import { ClearFormattingPlugin } from "./ClearFormattingPlugin.tsx";
import { FloatingToolbarPlugin } from "./FloatingToolbarPlugin.tsx";

export const INSERT_FOOTNOTE_COMMAND: LexicalCommand<void> = createCommand("INSERT_FOOTNOTE");

export function FootnotePlugin() {
  const [editor] = useLexicalComposerContext();
  // Key of a just-inserted footnote whose body should receive focus once its
  // nested editor mounts (so the user can type the note immediately).
  const [focusKey, setFocusKey] = useState<NodeKey | null>(null);
  const clearFocusKey = useCallback(() => setFocusKey(null), []);

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        INSERT_FOOTNOTE_COMMAND,
        () => {
          // Runs inside the dispatcher's update (the slash menu removes the "/"
          // and dispatches this in one update), so mutate directly rather than
          // opening a nested update — that would be deferred, and the new key
          // wouldn't be available to hand to the focus effect below.
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;

          // Attach to the preceding word: drop a single space right before the
          // caret if there is one (word¹, not word ¹).
          if (selection.isCollapsed()) {
            const anchorNode = selection.anchor.getNode();
            const offset = selection.anchor.offset;
            if (
              $isTextNode(anchorNode) &&
              offset > 0 &&
              anchorNode.getTextContent()[offset - 1] === " "
            ) {
              anchorNode.spliceText(offset - 1, 1, "", true);
            }
          }

          const footnote = $createFootnoteNode();
          $insertNodes([footnote]);

          // Ensure a single trailing space so the reference doesn't fuse with
          // whatever follows and the caret has somewhere to return to.
          const next = footnote.getNextSibling();
          if ($isTextNode(next) && next.getTextContent().startsWith(" ")) {
            next.select(1, 1);
          } else {
            const space = $createTextNode(" ");
            footnote.insertAfter(space);
            space.select(1, 1);
          }

          // Move focus into the new footnote's body; the caret set above is only
          // where it lands if the user clicks back out.
          setFocusKey(footnote.getKey());
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      // A footnote reference that ends its paragraph has no text position after
      // it (it's an inline decorator at block edge), so a mouse click just past
      // it lands the caret *before* it — only the keyboard could get after it.
      // Decide from the click coordinates (available immediately) rather than the
      // post-click selection, which Lexical hasn't synced yet inside this
      // handler — reading it here fires the fix a beat late. Move the caret after
      // any bare trailing reference the click lands to the right of, on its line.

      // TODO: this still acts kind of weird since it doesn't kick in until
      // mouseup. in general, why do we need this? why are inline decorators at
      // block edges weird?
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (event) => {
          const trailing = editor.getEditorState().read(() =>
            $collectFootnotes()
              .filter((fn) => fn.getNextSibling() === null)
              .map((fn) => fn.getKey()),
          );
          for (const key of trailing) {
            const rect = editor.getElementByKey(key)?.getBoundingClientRect();
            if (!rect) continue;
            if (
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom &&
              event.clientX > rect.right
            ) {
              editor.update(() => $placeCaretAfter(key));
              return true;
            }
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  return <FootnotesSection focusKey={focusKey} onFocusHandled={clearFocusKey} />;
}

function sameKeys(a: NodeKey[], b: NodeKey[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** Place a collapsed caret directly after the node `key`. Must run in an update. */
function $placeCaretAfter(key: NodeKey): void {
  const node = $getNodeByKey(key);
  const parent = node?.getParent();
  if (!node || !$isElementNode(parent)) return;
  const after = node.getIndexWithinParent() + 1;
  parent.select(after, after);
}

/** Jump the document caret to a footnote reference and scroll it into view —
 *  the inverse of clicking the reference to reach its body. */
function jumpToReference(editor: LexicalEditor, key: NodeKey): void {
  editor.update(() => $placeCaretAfter(key));
  editor.focus();
  editor.getElementByKey(key)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function FootnotesSection({
  focusKey,
  onFocusHandled,
}: {
  focusKey: NodeKey | null;
  onFocusHandled: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [keys, setKeys] = useState<NodeKey[]>([]);
  // Node key → its owned nested editor, refreshed alongside `keys`.
  const editors = useRef<Map<NodeKey, LexicalEditor>>(new Map());

  useEffect(() => {
    const recompute = () => {
      editor.getEditorState().read(() => {
        const notes = $collectFootnotes();
        editors.current = new Map(notes.map((n) => [n.getKey(), n.getFootnoteEditor()]));
        const next = notes.map((n) => n.getKey());
        setKeys((prev) => (sameKeys(prev, next) ? prev : next));
      });
    };
    recompute();
    return editor.registerUpdateListener(recompute);
  }, [editor]);

  if (keys.length === 0) return null;

  return (
    <div className="mt-10 border-t border-stark-border pt-4" contentEditable={false}>
      <div className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Footnotes</div>
      {keys.map((key, i) => {
        const nested = editors.current.get(key);
        if (!nested) return null;
        return (
          <div
            className="mb-2 flex gap-2.5 text-sm text-muted items-start"
            id={`footnote-${key}`}
            key={key}
          >
            <button
              type="button"
              className="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-semibold text-accent hover:underline"
              title={`Go to reference ${i + 1}`}
              onClick={() => jumpToReference(editor, key)}
            >
              {i + 1}.
            </button>
            <FootnoteBody
              parentEditor={editor}
              nodeKey={key}
              nested={nested}
              autoFocus={key === focusKey}
              onAutoFocused={onFocusHandled}
            />
          </div>
        );
      })}
    </div>
  );
}

function FootnoteBody({
  parentEditor,
  nodeKey,
  nested,
  autoFocus,
  onAutoFocused,
}: {
  parentEditor: LexicalEditor;
  nodeKey: NodeKey;
  nested: LexicalEditor;
  autoFocus: boolean;
  onAutoFocused: () => void;
}) {
  return (
    <LexicalNestedComposer initialEditor={nested}>
      <RichTextPlugin
        // Keep the editable's direct parent non-flex (the row wrapping the
        // number + body is a flex container); otherwise Chrome mishandles focus
        // on outside clicks and Lexical warns. The block takes the flex sizing.
        contentEditable={
          <div className="flex-1">
            <ContentEditable className={cn("outline-none", styles.footnoteBody)} />
          </div>
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <LinkPlugin />
      {/* Only inline formatting is offered inside footnotes (spec) — including
          pasting a URL over selected text to link it. */}
      <AutoLinkOnPastePlugin />
      {/* The toolbar's clear-formatting button dispatches a command, so its
          handler has to be mounted on this nested editor too. */}
      <ClearFormattingPlugin />
      <FloatingToolbarPlugin inlineOnly />
      <FootnoteBodySync parentEditor={parentEditor} nodeKey={nodeKey} />
      {autoFocus && <FootnoteAutoFocus onFocused={onAutoFocused} />}
    </LexicalNestedComposer>
  );
}

/**
 * Drops the caret into this footnote's (freshly-mounted) body editor once, so a
 * footnote inserted from the slash menu is ready to type into. Lives inside the
 * nested composer so its context editor is the body's own editor.
 */
function FootnoteAutoFocus({ onFocused }: { onFocused: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    // Defer past the slash-menu's own focus restoration, which otherwise runs
    // after this effect and pulls focus back to the parent editor. (No
    // once-guard: it would let StrictMode's mount→cleanup→remount cancel the
    // frame and never reschedule it.)
    const id = requestAnimationFrame(() => {
      // The body is seeded with a paragraph at creation, so this is a
      // selection-only change (no dirty nodes). That matters: a dirty change
      // here would trip FootnoteBodySync into a parent update that reconciles
      // the document's selection and yanks focus straight back out.
      editor.update(() => $getRoot().selectStart(), {
        onUpdate: () => editor.getRootElement()?.focus({ preventScroll: true }),
      });
      onFocused();
    });
    return () => cancelAnimationFrame(id);
  }, [editor, onFocused]);
  return null;
}

/** Propagate footnote-body edits to the parent so autosave persists them. */
function FootnoteBodySync({
  parentEditor,
  nodeKey,
}: {
  parentEditor: LexicalEditor;
  nodeKey: NodeKey;
}) {
  const [nested] = useLexicalComposerContext();
  useEffect(() => {
    return nested.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      parentEditor.update(
        () => {
          $getNodeByKey(nodeKey)?.markDirty();
        },
        { tag: "history-merge" },
      );
    });
  }, [nested, parentEditor, nodeKey]);
  return null;
}
