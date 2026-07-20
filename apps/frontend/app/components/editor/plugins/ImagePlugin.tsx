/**
 * Wires image insertion into the editor (spec/3-frontend.md → "Images").
 *
 * Upload paths, all funneling through one upload lifecycle:
 *   - the slash menu's "Image" option dispatches `OPEN_IMAGE_PICKER_COMMAND`,
 *     which opens the file dialog (image types only);
 *   - pasting raw image pixels (a screenshot, or "copy image");
 *   - pasting HTML that contains `<img>` elements, from a web page or any other
 *     app — the image is fetched and stored (server-side for a cross-origin URL),
 *     since the server has no copy of it yet.
 *
 * That third path is deliberately not handled by reading the clipboard's HTML
 * here. Doing so meant claiming the whole paste, which only works when it is
 * nothing but images; mixed content would have had to be rebuilt from scratch to
 * keep the images in their places among the text. Instead each `<img>` converts
 * to a pending placeholder `ImageNode` during Lexical's own HTML import (see
 * `ImageNode.importDOM`), which positions them correctly for free, and this
 * plugin picks the resulting placeholders up afterwards to run their uploads.
 *
 * A paste that came from one of our own editors never reaches that path at all.
 * Lexical prefers its own `application/x-lexical-editor` clipboard payload over
 * the HTML flavor and restores the image nodes — id and all — from it, so
 * copying an image between entries reuses the existing reference rather than
 * duplicating the stored file (spec/3-frontend.md → "Images").
 *
 * Lifecycle: a non-serializable placeholder `ImageNode` is inserted immediately as
 * a low-opacity preview; when the upload resolves it's replaced with the real
 * content node, and if it fails the placeholder flips to its deletable "failed"
 * state in place. Inserting is a discrete undo step and the resolve is merged into
 * it, so undo removes the image outright without ever landing on the spinner. Any
 * in-flight upload is aborted when the editor unmounts (navigating away); its
 * placeholder is never persisted (the save path strips it) and nothing else is
 * inserted for it.
 *
 * Failsafe: a placeholder can be restored — by redo, or as a pasted copy — with no
 * upload actually behind it. `liveKeys` tracks which pending nodes have a real
 * upload running; an update listener flips any pending node that isn't live (and
 * has no pasted-src left to claim) to its failed state, so a resurrected spinner
 * can't spin forever (spec/3-frontend.md → "Images").
 *
 * Dragging an image to a new position is a separate concern, handled by
 * `ImageDndProvider` (which wraps the editor) rather than here.
 */
import { useCallback, useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $insertNodeToNearestRoot, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $nodesOfType,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  HISTORY_MERGE_TAG,
  PASTE_COMMAND,
  type LexicalCommand,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import { ACCEPTED_IMAGE_MIME_TYPES } from "logarithmic-content/nodes/image-node";

import type { ImageUploadResult } from "~/data/image-upload.ts";
import {
  $createDataUriImageNode,
  $createImageNode,
  $createPendingImageNode,
  $isPendingImageNode,
  DataUriImageNode,
  ImageNode,
} from "../nodes/ImageNode.tsx";

/** Opens the OS file picker to insert an image (dispatched by the slash menu). */
export const OPEN_IMAGE_PICKER_COMMAND: LexicalCommand<void> = createCommand("OPEN_IMAGE_PICKER");

/** The image formats the backend accepts, as a file-dialog `accept` filter. Drawn
 *  from the same MIME list the import filter uses, so the two never drift. */
export const ACCEPTED_IMAGE_TYPES = ACCEPTED_IMAGE_MIME_TYPES.join(",");

type UploadImage = (file: File, signal: AbortSignal) => Promise<ImageUploadResult>;
type UploadPastedImage = (src: string, signal: AbortSignal) => Promise<ImageUploadResult>;

export function ImagePlugin({
  uploadImage,
  uploadPastedImage,
}: {
  uploadImage: UploadImage;
  uploadPastedImage: UploadPastedImage;
}) {
  const [editor] = useLexicalComposerContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Where a slash-menu insertion should land — the top-level block the "/" was
  // typed in, captured before the file dialog (which drops the selection) opens.
  const targetBlockKey = useRef<NodeKey | null>(null);
  // Abort controllers for uploads still in flight, aborted en masse on unmount.
  const inFlight = useRef<Set<AbortController>>(new Set());
  // Keys of pending `ImageNode`s that have a real upload running behind them. The
  // failsafe listener treats any pending node NOT in here (with no src left to
  // claim) as an orphan to flip to its failed state — see that listener.
  const liveKeys = useRef<Set<NodeKey>>(new Set());
  // Whether an HTML paste just went through to Lexical, and so may have left
  // placeholders needing uploads. See the update listener that consumes it.
  const pastedHtml = useRef(false);
  // Object URLs minted for upload previews. They're revoked all at once on
  // unmount rather than when each upload settles: undo can bring a replaced
  // placeholder back, and a placeholder pointing at an already-revoked URL renders
  // as a broken image.
  const previewUrls = useRef<Set<string>>(new Set());

  // Latest data-layer callbacks without re-binding the editor listeners each
  // render.
  const uploadRef = useRef(uploadImage);
  uploadRef.current = uploadImage;
  const uploadPastedRef = useRef(uploadPastedImage);
  uploadPastedRef.current = uploadPastedImage;

  /**
   * Run the upload for a pending `ImageNode` that is already in the document. On
   * success it's replaced with the real content node; on failure it flips to its
   * deletable failed state in place (unless the upload was aborted by unmount, in
   * which case the placeholder is being discarded anyway). `produce` runs the
   * upload for this node — a picked/pasted file via `uploadImage`, or a pasted
   * `<img>`'s URL via `uploadPastedImage` — and resolves to what to embed.
   *
   * Takes a key rather than inserting the node itself because the two callers come
   * by their placeholders differently: one inserts its own, the other adopts what
   * Lexical's HTML import already placed. Both register the key in `liveKeys`
   * first; this clears it once the upload settles so the failsafe listener can
   * tell a still-running pending node from an orphaned one.
   */
  const runUpload = useCallback(
    (key: NodeKey, produce: (signal: AbortSignal) => Promise<ImageUploadResult>) => {
      const controller = new AbortController();
      inFlight.current.add(controller);

      produce(controller.signal)
        .then((result) => {
          inFlight.current.delete(controller);
          liveKeys.current.delete(key);
          // A navigate-away abort discards the placeholder anyway, so don't insert.
          if (controller.signal.aborted) return;
          editor.update(
            () => {
              const node = $getNodeByKey(key);
              if ($isPendingImageNode(node)) node.replace(makeImageNode(result));
            },
            // Fold the placeholder swap into the surrounding history entry so
            // undo can't land on the intermediate placeholder state.
            { tag: HISTORY_MERGE_TAG },
          );
        })
        .catch(() => {
          inFlight.current.delete(controller);
          liveKeys.current.delete(key);
          // A navigate-away abort tears down the editor; the placeholder is
          // stripped from the flushed save, so there's nothing to mark.
          if (controller.signal.aborted) return;
          editor.update(
            () => {
              const node = $getNodeByKey(key);
              if ($isPendingImageNode(node)) node.markFailed();
            },
            { tag: HISTORY_MERGE_TAG },
          );
        });
    },
    [editor],
  );

  /**
   * Insert a placeholder for a local file and upload it.
   *
   * The insert is a discrete history step (no merge tag): inserting an image is
   * its own undoable action, so undo removes just the image — and redo restores
   * it — rather than folding into, or reverting, whatever edit came before. The
   * later resolve is what merges into this step (see `runUpload`).
   *
   * The upload is kicked off from the insert's `onUpdate` rather than from code
   * following `editor.update()`. Lexical defers a nested update when one is
   * already running, and command listeners (the paste path) run inside an update —
   * so the placeholder's key is not available synchronously after `update()`
   * returns. Reading it there saw `null` and silently dropped every pasted image.
   */
  const uploadFile = useCallback(
    (file: File, afterKey: NodeKey | null) => {
      const previewSrc = URL.createObjectURL(file);
      previewUrls.current.add(previewSrc);

      let pendingKey: NodeKey | null = null;
      editor.update(
        () => {
          const pending = $createPendingImageNode(previewSrc);
          $insertImageBlock(pending, afterKey);
          pendingKey = pending.getKey();
          // Register as live before the commit's listeners fire, so the failsafe
          // listener doesn't mistake this fresh placeholder for an orphan.
          liveKeys.current.add(pendingKey);
        },
        {
          onUpdate: () => {
            const key = pendingKey;
            if (key !== null) runUpload(key, (signal) => uploadRef.current(file, signal));
          },
        },
      );
    },
    [editor, runUpload],
  );

  /**
   * Adopt the placeholders Lexical's HTML import just created for pasted `<img>`
   * elements and start their uploads. They are already in the right places, so
   * all that's left is to run each one's upload.
   *
   * Claiming is what keeps an image from being uploaded twice: the src is cleared
   * off the node in the same update that captures it, so a later pass sees a
   * placeholder that is already someone's responsibility.
   */
  const claimImportedImages = useCallback(() => {
    const hasImported = editor
      .getEditorState()
      .read(() =>
        $nodesOfType(ImageNode).some((node) => node.isPending() && node.getUploadSrc() !== null),
      );
    if (!hasImported) return;

    const claimed: Array<{ key: NodeKey; src: string }> = [];
    editor.update(
      () => {
        for (const node of $nodesOfType(ImageNode)) {
          if (!node.isPending()) continue;
          const src = node.getUploadSrc();
          if (src === null) continue;
          claimed.push({ key: node.getKey(), src });
          node.clearUploadSrc();
          // Live before the commit's listeners fire (see the failsafe listener);
          // clearing the src alone would otherwise look like an orphan.
          liveKeys.current.add(node.getKey());
        }
      },
      {
        // Clearing the pasted src rides along with the paste's own history entry.
        tag: HISTORY_MERGE_TAG,
        onUpdate: () => {
          for (const { key, src } of claimed) {
            runUpload(key, (signal) => uploadPastedRef.current(src, signal));
          }
        },
      },
    );
  }, [editor, runUpload]);

  // Slash-menu insertion + paste-to-upload.
  useEffect(() => {
    return mergeRegister(
      // A block decorator as the document's last child leaves the caret nowhere
      // to go: you can't type after the image, and clicking below it silently
      // puts the caret in the block *above*. Guarantee a trailing paragraph with
      // a transform rather than only at insert time, so dragging an image to the
      // end (or deleting the paragraph after it) can't recreate the trap. The
      // `ImageNode` transform covers placeholders too — they're `ImageNode`s now.
      editor.registerNodeTransform(ImageNode, $ensureBlockAfter),
      editor.registerNodeTransform(DataUriImageNode, $ensureBlockAfter),
      editor.registerCommand(
        OPEN_IMAGE_PICKER_COMMAND,
        () => {
          // Runs inside the slash menu's update; read the current block so we can
          // land the image there after the (focus-stealing) dialog closes.
          const selection = $getSelection();
          targetBlockKey.current = $isRangeSelection(selection)
            ? (selection.anchor.getNode().getTopLevelElement()?.getKey() ?? null)
            : null;
          fileInputRef.current?.click();
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null;
          if (!clipboardData) return false;

          // Raw image pixels (a screenshot, or "copy image") arrive as files with
          // no markup to place them in, so they're inserted at the caret here.
          const files = Array.from(clipboardData.files).filter((f) => f.type.startsWith("image/"));
          if (files.length > 0) {
            event.preventDefault();
            for (const file of files) uploadFile(file, null);
            return true;
          }

          // Anything else is Lexical's to insert, which is what keeps an `<img>`
          // in its place among the pasted text. Note that the paste happened so
          // the placeholders it may produce get picked up once it lands.
          if (clipboardData.types.includes("text/html")) pastedHtml.current = true;
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor, uploadFile]);

  // Pasted images are inserted by Lexical itself, so their uploads can only
  // start once that paste has landed — which is what this listener waits for.
  //
  // It's gated on the paste flag rather than simply reacting to any placeholder
  // that still has an upload src: those nodes are recreated by undo and redo too,
  // and reacting to their mere existence would re-upload the same image every
  // time the user stepped back and forth over a paste.
  useEffect(() => {
    return editor.registerUpdateListener(() => {
      if (!pastedHtml.current) return;
      pastedHtml.current = false;
      claimImportedImages();
    });
  }, [editor, claimImportedImages]);

  // Failsafe (spec/3-frontend.md → "Images"). A placeholder can be brought back
  // with no upload behind it: redo after an undo removed it mid-upload, or a
  // pasted copy of a still-pending image. Such a node would otherwise spin
  // forever. Any pending node that isn't tracked as live and has no pasted src
  // left to claim is exactly one of these orphans; flip it to its deletable failed
  // state. Merged into history so it adds no undo step, and self-terminating —
  // a failed node no longer matches, so the follow-up update finds nothing.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      const orphans = editorState.read(() =>
        $nodesOfType(ImageNode)
          .filter(
            (node) =>
              node.isPending() &&
              !liveKeys.current.has(node.getKey()) &&
              node.getUploadSrc() === null,
          )
          .map((node) => node.getKey()),
      );
      if (orphans.length === 0) return;
      editor.update(
        () => {
          for (const key of orphans) {
            const node = $getNodeByKey(key);
            if ($isPendingImageNode(node)) node.markFailed();
          }
        },
        { tag: HISTORY_MERGE_TAG },
      );
    });
  }, [editor]);

  // Abort any in-flight uploads when the editor goes away, and only then release
  // the preview object URLs (see `previewUrls`).
  useEffect(() => {
    const controllers = inFlight.current;
    const urls = previewUrls.current;
    return () => {
      for (const controller of controllers) controller.abort();
      controllers.clear();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const onFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const afterKey = targetBlockKey.current;
    targetBlockKey.current = null;
    // Reset so re-picking the same file still fires `change`.
    event.target.value = "";
    if (file) uploadFile(file, afterKey);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        className="hidden"
        onChange={onFilePicked}
      />
    </>
  );
}

function makeImageNode(result: ImageUploadResult): LexicalNode {
  if (result.kind === "uploaded") {
    return $createImageNode({
      imageId: result.imageId,
      filename: result.filename,
      altText: "",
      width: result.width,
      height: result.height,
    });
  }
  return $createDataUriImageNode({
    src: result.src,
    altText: "",
    width: result.width,
    height: result.height,
  });
}

/** Insert a block image node: after the captured slash-menu block if given,
 *  otherwise at the current selection (falling back to the document end). Must
 *  run inside an editor update. */
function $insertImageBlock(node: LexicalNode, afterKey: NodeKey | null): void {
  if (afterKey) {
    const target = $getNodeByKey(afterKey);
    if (target) {
      (target.getTopLevelElement() ?? target).insertAfter(node);
      return;
    }
  }
  const selection = $getSelection();
  if ($isRangeSelection(selection)) $insertNodeToNearestRoot(node);
  else $getRoot().append(node);
}

/** Give a top-level image block something after it, so the caret always has
 *  somewhere to land past the image. Registered as a node transform, so it also
 *  repairs an image dragged (or left) at the document's end. */
function $ensureBlockAfter(node: LexicalNode): void {
  const parent = node.getParent();
  if (parent && $isRootOrShadowRoot(parent) && node.getNextSibling() === null) {
    node.insertAfter($createParagraphNode());
  }
}
