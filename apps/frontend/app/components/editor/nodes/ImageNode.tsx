/**
 * The frontend's React display layer for images. The data — serialization, alt
 * text, dimensions, the source URL, and the placeholder flag — lives in the
 * canonical headless `ImageNode` / `DataUriImageNode` in the `content` package.
 * These subclasses add only what the browser needs: a block wrapper, a React
 * `decorate()` that renders the actual <img> (with selection, an alt-text form,
 * and drag-to-reorder), and a plain-<img> `exportDOM()` for copy-as-HTML.
 *
 * A ready image renders through `ImageComponent`; a placeholder `ImageNode` (one
 * whose upload is still running, or failed) renders through `PlaceholderImage`
 * instead — a low-opacity preview with a spinner while pending, or a deletable
 * error while failed. The transient preview URL (`__previewSrc`) and the
 * not-yet-fetched source of a pasted `<img>` (`__uploadSrc`) are browser-only, so
 * they live here on the subclass rather than in the shared data node. `exportDOM`
 * (and copy-as-Markdown) emit nothing for a placeholder — there's no real URL yet.
 *
 * `ImageComponent` also serves `DataUriImageNode`; the two ready variants differ
 * only in how `getSrc()` resolves (a served URL vs. an embedded data URI) and what
 * absolute URL `exportDOM()` emits.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { useDraggable } from "@dnd-kit/core";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  HISTORY_MERGE_TAG,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  SKIP_SCROLL_INTO_VIEW_TAG,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import {
  $isAnyImageNode,
  type BaseImageNode,
  DataUriImageNode as HeadlessDataUriImageNode,
  DATA_URI_IMAGE_TYPE,
  type ImagePlaceholder,
  ImageNode as HeadlessImageNode,
  IMAGE_TYPE,
  type SerializedDataUriImageNode,
  type SerializedImageNode,
  shouldSkipImportedImage,
} from "logarithmic-content/nodes/image-node";

import { cn } from "~/lib/cn.ts";
import {
  FloatingPopover,
  POPOVER_INPUT,
  useDismissOnOutsidePointerDown,
} from "../FloatingPopover.tsx";

function pageOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

/**
 * The absolute URL used when an image is copied out of the editor, as HTML or as
 * Markdown (spec/3-frontend.md → "Images"). A served image's path is rooted at the
 * current page origin; a data URI is already self-contained. Single source of
 * truth for both export paths — `exportDOM` here and the Markdown transformer.
 */
export function absoluteImageSrc(node: BaseImageNode): string {
  const src = node.getSrc();
  return src.startsWith("/") ? pageOrigin() + src : src;
}

function plainImgExport(src: string, altText: string): DOMExportOutput {
  const el = document.createElement("img");
  el.setAttribute("src", src);
  el.setAttribute("alt", altText);
  return { element: el };
}

export class ImageNode extends HeadlessImageNode {
  /** Preview shown while pending: an object URL for a local file, or the original
   *  remote URL for one that arrived as pasted HTML. Browser-only, so it lives on
   *  the frontend subclass rather than the shared data node. */
  __previewSrc: string | null;
  /**
   * Set only on a pending node built from a pasted `<img>` (`importDOM`): that
   * element's own `src`, whose bytes still have to be fetched and uploaded.
   * `ImagePlugin` clears it as it takes the upload on, which is what stops the
   * same image being uploaded twice. Null on a node inserted for a local file,
   * whose bytes the plugin already holds, and on any ready image.
   */
  __uploadSrc: string | null;

  // TODO: add __uploadError that is set when the image failed to upload; this
  // stores the error message that needs to be displayed to the user

  // `getType`/`clone`/`importJSON` are re-declared on the subclass so Lexical
  // builds THIS React-rendering class (the inherited versions would build the
  // headless base, which decorates to nothing) — same pattern as `FootnoteNode`.
  static getType(): string {
    return IMAGE_TYPE;
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      {
        imageId: node.__imageId,
        filename: node.__filename,
        altText: node.__altText,
        width: node.__width,
        height: node.__height,
        placeholder: node.__placeholder,
        previewSrc: node.__previewSrc,
        uploadSrc: node.__uploadSrc,
      },
      node.__key,
    );
  }

  static importJSON(serialized: SerializedImageNode): ImageNode {
    // The placeholder sentinel (or a reference with no id) never denotes a real
    // stored image — only a copied/corrupt placeholder reaches here. Import
    // failsafe content rather than a broken reference. See the headless
    // `ImageNode.importJSON`.
    if (serialized.placeholder || !serialized.imageId) {
      return $createFailedImageNode(serialized.altText ?? "");
    }
    return new ImageNode({
      imageId: serialized.imageId,
      filename: serialized.filename,
      altText: serialized.altText ?? "",
      width: serialized.width,
      height: serialized.height,
    });
  }

  constructor(
    props: {
      imageId: string;
      filename: string;
      altText: string;
      width: number;
      height: number;
      placeholder?: ImagePlaceholder | null;
      previewSrc?: string | null;
      uploadSrc?: string | null;
    },
    key?: NodeKey,
  ) {
    super(props, key);
    this.__previewSrc = props.previewSrc ?? null;
    this.__uploadSrc = props.uploadSrc ?? null;
  }

  /** Claim every `<img>` in pasted HTML as a pending upload. The remote URL is
   *  both what to preview and what to fetch, since the bytes aren't on the
   *  clipboard — only a reference to them is. A paste from one of our own
   *  editors never reaches this path: Lexical prefers its own clipboard payload
   *  and restores those image nodes via `importJSON`. Priority 0 so a future
   *  richer conversion can outrank it.
   *
   *  Returning null drops the element with no node created — used for a srcless
   *  `<img>`, and for the junk `shouldSkipImportedImage` recognizes (a source
   *  that names a type the backend can't store), so neither ever becomes a
   *  placeholder or a fetch. */
  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: (element: HTMLElement): DOMConversionOutput | null => {
          const src = element.getAttribute("src");
          if (!src) return null;
          if (shouldSkipImportedImage(src)) return null;
          return { node: $createPendingImageNode(src, src) };
        },
        priority: 0,
      }),
    };
  }

  /** The URL whose bytes still need fetching and uploading, or null once that's
   *  someone's responsibility (or this is a ready image). */
  getUploadSrc(): string | null {
    return this.getLatest().__uploadSrc;
  }

  /** Take ownership of a pasted image's upload, so no later pass starts a second
   *  one for it. */
  clearUploadSrc(): void {
    this.getWritable().__uploadSrc = null;
  }

  createDOM(): HTMLElement {
    return imageBlockDOM();
  }

  exportDOM(): DOMExportOutput {
    // A placeholder has no real URL to point at, so it copies out as nothing.
    if (this.isPlaceholder()) return { element: null };
    // Copy-as-HTML wants an absolute URL rooted at the current page origin.
    return plainImgExport(absoluteImageSrc(this), this.__altText);
  }

  decorate(): ReactNode {
    const placeholder = this.getPlaceholder();
    if (placeholder !== null) {
      return (
        <PlaceholderImage
          nodeKey={this.getKey()}
          variant={placeholder}
          previewSrc={this.__previewSrc}
        />
      );
    }
    return <ImageComponent nodeKey={this.getKey()} src={this.getSrc()} />;
  }
}

export class DataUriImageNode extends HeadlessDataUriImageNode {
  static getType(): string {
    return DATA_URI_IMAGE_TYPE;
  }

  static clone(node: DataUriImageNode): DataUriImageNode {
    return new DataUriImageNode(
      {
        src: node.__src,
        altText: node.__altText,
        width: node.__width,
        height: node.__height,
      },
      node.__key,
    );
  }

  static importJSON(serialized: SerializedDataUriImageNode): DataUriImageNode {
    return new DataUriImageNode({
      src: serialized.src,
      altText: serialized.altText ?? "",
      width: serialized.width,
      height: serialized.height,
    });
  }

  // Same as `ImageNode`: pasted HTML is external, so `ImagePlugin` uploads it
  // rather than adopting the URL.
  static importDOM(): DOMConversionMap | null {
    return null;
  }

  createDOM(): HTMLElement {
    return imageBlockDOM();
  }

  exportDOM(): DOMExportOutput {
    // The data URI is already absolute (self-contained), so it's emitted as-is.
    return plainImgExport(absoluteImageSrc(this), this.__altText);
  }

  decorate(): ReactNode {
    return <ImageComponent nodeKey={this.getKey()} src={this.getSrc()} />;
  }
}

export function $createImageNode(props: {
  imageId: string;
  filename: string;
  altText: string;
  width: number;
  height: number;
}): ImageNode {
  return new ImageNode(props);
}

/** A pending upload placeholder: a non-persistable `ImageNode` that previews
 *  `previewSrc` with a spinner until its upload resolves. `uploadSrc` is the
 *  remote URL still to fetch (pasted-HTML case), or null for a local file whose
 *  bytes the plugin already holds. */
export function $createPendingImageNode(
  previewSrc: string,
  uploadSrc: string | null = null,
): ImageNode {
  return new ImageNode({
    imageId: "",
    filename: "",
    altText: "",
    width: 0,
    height: 0,
    placeholder: "pending",
    previewSrc,
    uploadSrc,
  });
}

/** A failsafe placeholder: a non-persistable `ImageNode` rendered as a deletable
 *  error, for a failed upload or a placeholder restored with no live upload. */
export function $createFailedImageNode(altText = ""): ImageNode {
  return new ImageNode({
    imageId: "",
    filename: "",
    altText,
    width: 0,
    height: 0,
    placeholder: "failed",
  });
}

/** An `ImageNode` currently in its pending-upload state. */
export function $isPendingImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode && node.isPending();
}

export function $createDataUriImageNode(props: {
  src: string;
  altText: string;
  width: number;
  height: number;
}): DataUriImageNode {
  return new DataUriImageNode(props);
}

/**
 * Layout for an image block.
 *
 * `[&_img]:my-0` is the important part: Tailwind Typography gives `.prose img` a
 * 2em vertical margin, and because the `<img>` sits inside this flex container
 * it's a flex item — whose margins never collapse with anything. That silently
 * added ~4em of dead space around every image. Zeroing it here covers both the
 * real image and the upload placeholder from one place.
 *
 * The remaining rhythm matches the paragraph rule in `editor.module.css`
 * (`p:not(:first-child) { margin-top: 1rem }`, no bottom margin), so an image
 * sits in the same vertical cadence as the text around it. There's no horizontal
 * inset: an image runs the full width of the text column. It's still centered,
 * which only matters for an image narrower than the column — `max-w-full` lets
 * one fill the width but never upscales a small image past its natural size.
 */
export const IMAGE_BLOCK_CLASS = "mt-4 mb-0 first:mt-0 flex justify-center [&_img]:my-0";

/** The block wrapper Lexical renders the decorator into. */
function imageBlockDOM(): HTMLElement {
  const div = document.createElement("div");
  div.className = IMAGE_BLOCK_CLASS;
  return div;
}

/**
 * The on-screen image. Shared by both node variants (they differ only in `src`).
 * Clicking selects it (so Backspace/Delete removes it); dragging it (via the
 * `ImageDndProvider` context — long-press on touch, an 8px move on mouse) reorders
 * it; selecting it opens the alt-text form, which reuses the link URL form's
 * floating popover.
 */
function ImageComponent({ nodeKey, src }: { nodeKey: NodeKey; src: string }) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  // Registers this image as a drag source; `ImageDndProvider` owns the sensors,
  // the following ghost, and the drop itself. `setNodeRef` measures the ghost, so
  // it goes on the same wrapper the alt-text form anchors to.
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: nodeKey });
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const setWrapperRef = useCallback(
    (element: HTMLDivElement | null) => {
      wrapperRef.current = element;
      setNodeRef(element);
    },
    [setNodeRef],
  );
  const [altText, setAltText] = useState(() =>
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      return $isAnyImageNode(node) ? node.getAltText() : "";
    }),
  );

  // Whether this image is the *entire* selection. `isSelected` is much broader —
  // it's also true whenever a range selection merely spans the image, so Ctrl-A
  // or a drag across several blocks marks every image in the document as
  // selected. Opening the alt-text form on that would put a popover over every
  // image at once, none of which the user asked to edit. Only a node selection
  // of exactly this image counts.
  const [isSoleSelection, setIsSoleSelection] = useState(false);
  useEffect(() => {
    const read = () => {
      const selection = $getSelection();
      if (!$isNodeSelection(selection)) return false;
      const nodes = selection.getNodes();
      return nodes.length === 1 && nodes[0]?.getKey() === nodeKey;
    };
    setIsSoleSelection(editor.getEditorState().read(read));
    return editor.registerUpdateListener(({ editorState }) =>
      setIsSoleSelection(editorState.read(read)),
    );
  }, [editor, nodeKey]);

  // The form's visibility is React-owned rather than derived from the selection.
  // Focusing its input clears Lexical's node selection, so deriving visibility
  // from the selection closed the form the instant the user clicked into it.
  // Selecting the image alone opens it; an explicit close, a click elsewhere, or
  // a selection that moves on shuts it.
  const [altFormOpen, setAltFormOpen] = useState(false);
  useEffect(() => {
    if (isSoleSelection) setAltFormOpen(true);
  }, [isSoleSelection]);

  useEffect(() => {
    if (!altFormOpen || isSoleSelection) return;
    // The form's own input holding focus is why the selection went away — not a
    // signal that the user selected something else.
    if (formRef.current?.contains(document.activeElement)) return;
    setAltFormOpen(false);
  }, [altFormOpen, isSoleSelection]);

  /**
   * Close the alt-text form and let go of the image.
   *
   * `moveCaret` is what separates the two ways out. Enter or Escape leaves focus
   * in an input that's about to unmount — it has to go somewhere, or the next
   * keystroke (Ctrl-A especially) lands on <body> — so the caret moves to just
   * after the image, where the user would carry on typing.
   *
   * Dismissing by pointing somewhere else must do neither. `editor.focus()`
   * there was the cause of a scroll jump: it marks the selection dirty, and
   * reconciling a dirty selection scrolls it back into view — so clicking away
   * after scrolling yanked the page back to wherever the image had been when it
   * was selected. The pointer is already sending focus wherever the user aimed
   * it; the only thing left to do is drop the node selection, quietly.
   */
  const closeAltForm = useCallback(
    (moveCaret: boolean) => {
      setAltFormOpen(false);
      editor.update(
        () => {
          const node = moveCaret ? $getNodeByKey(nodeKey) : null;
          if (node) node.selectNext();
          else if ($isNodeSelection($getSelection())) $setSelection(null);
        },
        { tag: SKIP_SCROLL_INTO_VIEW_TAG },
      );
      if (moveCaret) editor.focus();
    },
    [editor, nodeKey],
  );

  useDismissOnOutsidePointerDown(altFormOpen, () => closeAltForm(false), formRef, wrapperRef);

  // Keep the image visibly active while the form is open, even though clicking
  // into the input has dropped the underlying node selection.
  const active = isSelected || altFormOpen;

  // Delete the image when it's node-selected and the user presses Backspace or
  // Delete — the standard way to remove a selected block decorator.
  useEffect(() => {
    const onDelete = (event: KeyboardEvent) => {
      if (!isSelected) return false;
      const selection = $getSelection();
      if (!$isNodeSelection(selection)) return false;
      event.preventDefault();
      editor.update(() => $getNodeByKey(nodeKey)?.remove());
      return true;
    };
    return mergeRegister(
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (event) => {
          if (event.target !== imgRef.current) return false;
          if (!event.shiftKey) clearSelection();
          setSelected(!isSelected || !event.shiftKey);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
    );
  }, [editor, nodeKey, isSelected, setSelected, clearSelection]);

  const commitAltText = (value: string) => {
    setAltText(value);
    // HISTORY_MERGE_TAG so typing alt text folds into one undo entry instead of
    // one per keystroke.
    editor.update(
      () => {
        const node = $getNodeByKey(nodeKey);
        if ($isAnyImageNode(node)) node.setAltText(value);
      },
      { tag: HISTORY_MERGE_TAG },
    );
  };

  return (
    <div
      ref={setWrapperRef}
      className={cn("relative inline-block max-w-full", isDragging && "opacity-30")}
      {...listeners}
    >
      <img
        ref={imgRef}
        src={src}
        alt={altText}
        draggable={false}
        className={cn(
          "block max-h-[70vh] max-w-full cursor-grab select-none",
          active && "outline-2 outline-offset-2 outline-accent-text",
        )}
      />
      {altFormOpen && (
        <AltTextForm
          containerRef={formRef}
          anchor={imgRef}
          value={altText}
          onChange={commitAltText}
          onClose={() => closeAltForm(true)}
        />
      )}
    </div>
  );
}

/**
 * The on-screen placeholder for an `ImageNode` that isn't a real reference yet:
 * a low-opacity preview under a spinner while its upload runs (`"pending"`), or a
 * deletable error once that upload has failed or the node was restored with no
 * upload behind it (`"failed"`, the failsafe from spec/3-frontend.md → "Images").
 *
 * Both are click-to-select and Backspace/Delete-to-remove — a failed upload has
 * to be removable, and cancelling a stuck pending one is harmless (the upload,
 * driven separately, just finds its node gone and no-ops). Unlike a ready image
 * they're not draggable and have no alt-text form: there's nothing to reorder or
 * describe until real bytes exist.
 */
function PlaceholderImage({
  nodeKey,
  variant,
  previewSrc,
}: {
  nodeKey: NodeKey;
  variant: ImagePlaceholder;
  previewSrc: string | null;
}) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDelete = (event: KeyboardEvent) => {
      if (!isSelected) return false;
      if (!$isNodeSelection($getSelection())) return false;
      event.preventDefault();
      editor.update(() => $getNodeByKey(nodeKey)?.remove());
      return true;
    };
    return mergeRegister(
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (event) => {
          const target = event.target;
          if (!(target instanceof Node) || !wrapperRef.current?.contains(target)) return false;
          if (!event.shiftKey) clearSelection();
          setSelected(!isSelected || !event.shiftKey);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
    );
  }, [editor, nodeKey, isSelected, setSelected, clearSelection]);

  const ring = isSelected && "outline outline-2 outline-offset-2 outline-accent-text";

  if (variant === "failed") {
    return (
      <div
        ref={wrapperRef}
        role="img"
        aria-label="Image upload failed"
        className={cn(
          "flex items-center gap-2 rounded-md border border-warn bg-stark px-3 py-2 text-sm text-warn select-none",
          ring,
        )}
      >
        <i className="ri-error-warning-line text-base" aria-hidden />
        <span>Image upload failed. (You can delete this message.)</span>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={cn("relative inline-block select-none", ring)}
      aria-busy="true"
      aria-label="Uploading image"
    >
      {previewSrc ? (
        <img
          src={previewSrc}
          alt=""
          draggable={false}
          className="block max-h-[70vh] max-w-full opacity-40"
        />
      ) : (
        <div className="h-40 w-64 bg-paper-soft" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <i className="ri-loader-4-line animate-spin text-2xl text-primary/70" aria-hidden />
      </span>
    </div>
  );
}

/**
 * The alt-text editor for a selected image (spec/3-frontend.md → "Images"). Built
 * on the same floating popover as the link URL form, so it sits outside the
 * contenteditable, flips below the image when there's no room above it, and stays
 * clamped inside the viewport.
 */
function AltTextForm({
  containerRef,
  anchor,
  value,
  onChange,
  onClose,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  anchor: React.RefObject<HTMLImageElement | null>;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const anchorRect = useCallback(() => anchor.current?.getBoundingClientRect() ?? null, [anchor]);
  const [rect] = useState(anchorRect);

  return (
    <FloatingPopover
      rect={rect}
      // The image doesn't move when the form takes focus, so the anchor can stay
      // live and follow scrolling.
      track={anchorRect}
      containerRef={containerRef}
      className="gap-1.5 p-1.5"
      role="dialog"
    >
      <input
        // Roomy on desktop, never wider than a narrow viewport.
        className={cn(POPOVER_INPUT, "w-80 max-w-full")}
        // Deliberately not autofocused, unlike the link URL form it borrows its
        // look from. A link's URL is the reason that form opened, so typing into
        // it immediately is right; alt text is optional, and selecting an image
        // is usually a step towards moving or deleting it. Taking the caret
        // would turn every image click into an interruption — and would break
        // the keyboard entirely, since focus in the input is focus out of the
        // editor, so Backspace and Ctrl-Z stop reaching the document.
        value={value}
        placeholder="Describe this image (alt text)"
        aria-label="Image alt text"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
    </FloatingPopover>
  );
}
