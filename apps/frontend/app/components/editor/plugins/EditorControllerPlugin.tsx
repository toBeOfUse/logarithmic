/**
 * Owns the editor's save lifecycle — debounced autosave, Ctrl/Cmd-S, and dirty
 * tracking — plus the small imperative handle the entry route drives
 * (`focusEnd`, `getMarkdown`).
 *
 * Autosave: an update listener serializes the editor state and, when it differs
 * from what was last persisted, marks the editor dirty and schedules a debounced
 * save. `editorState.toJSON()` omits selection, so caret/selection moves
 * serialize identically and never trigger a save. A pending save is flushed
 * synchronously on unmount so in-app navigation never drops edits.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $getSelection, $isRangeSelection } from "lexical";

import { contentToMarkdown } from "../markdown-transformers.ts";
import type { EditorHandle } from "../RichTextEditor.tsx";

const AUTOSAVE_DEBOUNCE_MS = 800;

export function EditorControllerPlugin({
  handleRef,
  onSave,
  onDirtyChange,
}: {
  handleRef: Ref<EditorHandle>;
  onSave: (contentJson: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();

  // Latest props in refs so the callbacks below stay stable while always seeing
  // the current handlers.
  const onSaveRef = useRef(onSave);
  const onDirtyRef = useRef(onDirtyChange);
  onSaveRef.current = onSave;
  onDirtyRef.current = onDirtyChange;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>("");
  const dirty = useRef(false);

  const setDirty = useCallback((next: boolean) => {
    if (dirty.current === next) return;
    dirty.current = next;
    onDirtyRef.current?.(next);
  }, []);

  /** Serialize now and persist if it changed since the last save. */
  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const json = JSON.stringify(editor.getEditorState().toJSON());
    if (json !== lastSaved.current) {
      lastSaved.current = json;
      onSaveRef.current(json);
    }
    setDirty(false);
  }, [editor, setDirty]);

  useEffect(() => {
    // Baseline: whatever loaded in is considered "saved" so a freshly-opened
    // entry isn't immediately marked dirty or re-persisted.
    lastSaved.current = JSON.stringify(editor.getEditorState().toJSON());

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      const json = JSON.stringify(editorState.toJSON());
      if (json === lastSaved.current) {
        setDirty(false);
        return;
      }
      setDirty(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    });

    return () => {
      unregister();
      // Flush any pending edits on unmount (route change / focus-mode toggle).
      if (dirty.current) flush();
    };
  }, [editor, flush, setDirty]);

  // Ctrl/Cmd-S flushes any pending autosave immediately. Saving is intrinsic
  // editing behavior, so the editor owns the shortcut rather than the page; the
  // listener is global so it works regardless of where focus sits.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        flush();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flush]);

  useImperativeHandle(
    handleRef,
    (): EditorHandle => ({
      focusEnd: (insertText?: string) => {
        editor.focus();
        editor.update(() => {
          const root = $getRoot();
          root.selectEnd();
          if (insertText) {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) selection.insertText(insertText);
          }
        });
      },
      getMarkdown: async () => contentToMarkdown(editor),
    }),
    [editor],
  );

  return null;
}
