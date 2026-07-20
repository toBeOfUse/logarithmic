/**
 * The canonical (headless) image nodes — part of the shared data layer.
 *
 * An image is always a standalone block. Two persisted variants exist:
 *
 *   - `ImageNode` ("image"): references an image uploaded to the backend by its
 *     random id + url-safe filename, from which the serving URL is rebuilt. This
 *     is what real (token-backed) logbooks store.
 *   - `DataUriImageNode` ("data-uri-image"): embeds the image inline as a data
 *     URI. Used by demo logbooks, whose content is never persisted to the
 *     backend, so there's no uploaded file to reference (see spec/3-frontend.md
 *     → "Demo Logbook"). The frontend subclass is the only place it's created.
 *
 * Both carry everything except rendering — serialization, alt text, intrinsic
 * dimensions — and depend only on Lexical's core (never React). The frontend
 * subclasses add `decorate()` (the on-screen <img>, selection, alt-text form)
 * and `exportDOM()` (a plain <img> for copy-as-HTML/Markdown). `createDOM` is
 * required by the abstract base but is never invoked in the headless path.
 *
 * While its file is being uploaded (or if that upload fails), an `ImageNode` is a
 * transient *placeholder* rather than a real reference — `__placeholder` records
 * which. A placeholder is deliberately non-persistable: its `exportJSON` returns a
 * sentinel (see `isPlaceholderImageJSON`) that the frontend's save path strips
 * before any JSON reaches the backend, so a save firing mid-upload never persists
 * a pending/broken reference. The preview URL and the not-yet-uploaded source live
 * only on the frontend subclass (they're browser concerns); the base holds only
 * the flag, since only serialization needs it.
 */
import {
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

export const IMAGE_TYPE = "image";
export const DATA_URI_IMAGE_TYPE = "data-uri-image";

/**
 * The two transient states an `ImageNode` can be in while it is *not* a real,
 * persistable image reference:
 *   - `"pending"`: its file is being uploaded; renders a preview + spinner.
 *   - `"failed"`: the upload failed, or the node was restored (e.g. by redo) into
 *     a state with no upload driving it — renders failsafe content the user can
 *     delete. Never a real reference, so also non-persistable.
 * A `null` placeholder is the normal case: a ready, persistable image.
 */
export type ImagePlaceholder = "pending" | "failed";

/**
 * Whether a serialized node is an upload placeholder to be stripped before a
 * document is persisted. A placeholder `ImageNode` serializes to a sentinel:
 * still `type: "image"` (so it round-trips through Lexical's own clipboard as an
 * `ImageNode`, which `importJSON` turns into failsafe content) but carrying
 * `placeholder: true` and no real `imageId`. Keyed on that marker, so it can't
 * match a real image reference.
 */
export function isPlaceholderImageJSON(node: { type?: unknown; placeholder?: unknown }): boolean {
  return node.type === IMAGE_TYPE && node.placeholder === true;
}

/**
 * The same-origin path that serves an uploaded image. The id + filename pair is
 * all that's needed to address it (see spec/2-backend.md → "Images"). Shared so
 * the editor, copy-as-HTML/Markdown, and any future backend export agree on one
 * URL shape.
 */
export function imagePath(imageId: string, filename: string): string {
  return `/api/images/${imageId}/${encodeURIComponent(filename)}`;
}

type SerializedImageFields = { altText: string; width: number; height: number };

export type SerializedImageNode = Spread<
  // `placeholder` marks the non-persistable sentinel a pending/failed node emits;
  // absent (or false) on a real reference. See `isPlaceholderImageJSON`.
  { imageId: string; filename: string; placeholder?: boolean } & SerializedImageFields,
  SerializedLexicalNode
>;

export type SerializedDataUriImageNode = Spread<
  { src: string } & SerializedImageFields,
  SerializedLexicalNode
>;

/**
 * Shared data + behavior for both image variants: the block-ness, the alt text,
 * and the intrinsic dimensions. Subclasses supply only what differs — the source
 * URL and the (de)serialization of their own extra fields.
 */
export abstract class BaseImageNode extends DecoratorNode<unknown> {
  __altText: string;
  __width: number;
  __height: number;

  constructor(altText: string, width: number, height: number, key?: NodeKey) {
    super(key);
    this.__altText = altText;
    this.__width = width;
    this.__height = height;
  }

  createDOM(): HTMLElement {
    // Frontend subclass overrides this to build the block wrapper it renders the
    // <img> into; never called in the headless path.
    return document.createElement("div");
  }

  updateDOM(): false {
    return false;
  }

  /** Images are standalone block elements (spec/3-frontend.md → "Images"). */
  isInline(): false {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  decorate(): unknown {
    return null;
  }

  /** Images contribute no words to a word count. */
  getTextContent(): string {
    return "";
  }

  /** The URL (or data URI) that renders this image. */
  abstract getSrc(): string;

  getAltText(): string {
    return this.__altText;
  }

  setAltText(altText: string): this {
    const self = this.getWritable();
    self.__altText = altText;
    return self;
  }

  getWidthAndHeight(): { width: number; height: number } {
    return { width: this.__width, height: this.__height };
  }
}

/** A block image that references an uploaded backend image by id + filename, or —
 *  while `__placeholder` is set — a transient upload placeholder that carries no
 *  real reference yet (see the file header). */
export class ImageNode extends BaseImageNode {
  __imageId: string;
  __filename: string;
  __placeholder: ImagePlaceholder | null;

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
      },
      node.__key,
    );
  }

  constructor(
    props: {
      imageId: string;
      filename: string;
      altText: string;
      width: number;
      height: number;
      placeholder?: ImagePlaceholder | null;
    },
    key?: NodeKey,
  ) {
    super(props.altText, props.width, props.height, key);
    this.__imageId = props.imageId;
    this.__filename = props.filename;
    this.__placeholder = props.placeholder ?? null;
  }

  getImageId(): string {
    return this.__imageId;
  }

  getFilename(): string {
    return this.__filename;
  }

  getSrc(): string {
    return imagePath(this.__imageId, this.__filename);
  }

  /** The placeholder state, or null for a ready (persistable) image. */
  getPlaceholder(): ImagePlaceholder | null {
    return this.getLatest().__placeholder;
  }

  isPlaceholder(): boolean {
    return this.getPlaceholder() !== null;
  }

  isPending(): boolean {
    return this.getPlaceholder() === "pending";
  }

  isFailed(): boolean {
    return this.getPlaceholder() === "failed";
  }

  /** Move the node into its failsafe state: a failed/orphaned upload the user can
   *  delete. Still non-persistable, so it never reaches storage. */
  markFailed(): this {
    const self = this.getWritable();
    self.__placeholder = "failed";
    return self;
  }

  exportJSON(): SerializedImageNode {
    if (this.__placeholder !== null) {
      // Non-persistable placeholder (pending or failed). Emit a sentinel the save
      // path strips before persisting, never real image fields — even if a save
      // fires mid-upload. It stays a well-formed `type: "image"` object so it
      // can't throw, and so a copy of a placeholder round-trips through the
      // clipboard as an `ImageNode` that `importJSON` turns into failsafe content.
      return {
        ...super.exportJSON(),
        type: IMAGE_TYPE,
        version: 1,
        imageId: "",
        filename: "",
        altText: this.__altText,
        width: 0,
        height: 0,
        placeholder: true,
      };
    }
    return {
      ...super.exportJSON(),
      type: IMAGE_TYPE,
      version: 1,
      imageId: this.__imageId,
      filename: this.__filename,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
    };
  }

  static importJSON(serialized: SerializedImageNode): ImageNode {
    // A stored document never contains the placeholder sentinel (it's stripped
    // before saving), so this only sees it when a placeholder was copied to the
    // clipboard and pasted back; a corrupt reference with no id lands here too.
    // Either way there's no image to show — import failsafe content, not a broken
    // reference.
    if (serialized.placeholder || !serialized.imageId) {
      return $createFailedImageNode(serialized.altText ?? "");
    }
    return $createImageNode({
      imageId: serialized.imageId,
      filename: serialized.filename,
      altText: serialized.altText ?? "",
      width: serialized.width,
      height: serialized.height,
    });
  }
}

/** A block image whose pixels are embedded inline as a data URI (demo only). */
export class DataUriImageNode extends BaseImageNode {
  __src: string;

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

  constructor(
    props: { src: string; altText: string; width: number; height: number },
    key?: NodeKey,
  ) {
    super(props.altText, props.width, props.height, key);
    this.__src = props.src;
  }

  getSrc(): string {
    return this.__src;
  }

  exportJSON(): SerializedDataUriImageNode {
    return {
      ...super.exportJSON(),
      type: DATA_URI_IMAGE_TYPE,
      version: 1,
      src: this.__src,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
    };
  }

  static importJSON(serialized: SerializedDataUriImageNode): DataUriImageNode {
    return $createDataUriImageNode({
      src: serialized.src,
      altText: serialized.altText ?? "",
      width: serialized.width,
      height: serialized.height,
    });
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

/** A ready-to-delete failsafe image: no real reference, so non-persistable, and
 *  rendered as an error the user can remove. Used when a placeholder ends up in an
 *  unrecoverable state (a failed upload, or a copied/redone placeholder with no
 *  live upload behind it). The frontend subclass builds a rendering variant. */
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

export function $createDataUriImageNode(props: {
  src: string;
  altText: string;
  width: number;
  height: number;
}): DataUriImageNode {
  return new DataUriImageNode(props);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}

export function $isDataUriImageNode(
  node: LexicalNode | null | undefined,
): node is DataUriImageNode {
  return node instanceof DataUriImageNode;
}

/** True for any persisted image variant (server-referenced or embedded). */
export function $isAnyImageNode(node: LexicalNode | null | undefined): node is BaseImageNode {
  return node instanceof BaseImageNode;
}

/**
 * The image MIME types the backend stores (JPEG/PNG/GIF/WEBP — see
 * spec/2-backend.md → "Images" and `image-api.ts`'s `ACCEPTED_FORMATS`, which is
 * the authority). Mirrored here so the editor can tell an image it already knows
 * won't be accepted from one worth uploading, and so the file picker and this
 * import filter draw their notion of "accepted" from one place.
 */
export const ACCEPTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** Image file extensions the backend can't store, matched against a URL's path.
 *  Only used to reject a source that positively names an unsupported type — an
 *  extensionless URL is left for the backend to judge. */
const UNSUPPORTED_IMAGE_EXTENSIONS = ["svg", "bmp", "avif", "tif", "tiff", "heic", "heif", "ico"];

/**
 * Whether a pasted `<img>` should be dropped on import instead of uploaded,
 * decided from the markup alone (no network). Skipped only when the source
 * positively names a type the backend can't store — a `data:` URI whose MIME
 * isn't accepted (an SVG, say), or a URL with a clearly-unsupported image
 * extension — so it never becomes an upload placeholder nor a failed-upload
 * error the reader has to clear. A plain URL with no telltale extension is left
 * alone: only the backend can judge it, and it will. (A tracking pixel isn't
 * detectable from the markup — its declared size can't be trusted and its real
 * size isn't known without fetching — so those are left for the backend too.)
 *
 * Pure (no editor state), so it carries no `$` and is unit-tested.
 */
export function shouldSkipImportedImage(src: string): boolean {
  return namesUnsupportedType(src);
}

function namesUnsupportedType(src: string): boolean {
  const trimmed = src.trim();
  if (trimmed.toLowerCase().startsWith("data:")) {
    // A data URI names its own type precisely, so an allowlist is exact here. An
    // unparseable one (null) is left for the fetch/backend to reject.
    const mime = dataUriMimeType(trimmed);
    return mime !== null && !ACCEPTED_IMAGE_MIME_TYPES.includes(mime);
  }
  const ext = urlPathExtension(trimmed);
  return ext !== null && UNSUPPORTED_IMAGE_EXTENSIONS.includes(ext);
}

/** The MIME type of a `data:` URI (`data:image/svg+xml;base64,…` → `image/svg+xml`),
 *  lower-cased, or null when `src` isn't a data URI or names no type. */
function dataUriMimeType(src: string): string | null {
  const mime = /^data:([^;,]+)/i.exec(src)?.[1];
  return mime !== undefined ? mime.toLowerCase() : null;
}

/** The lower-cased file extension of a URL's path — query and hash ignored, no
 *  base URL needed (relative srcs have none) — or null when there isn't one. */
function urlPathExtension(src: string): string | null {
  const path = src.split(/[?#]/, 1)[0] ?? "";
  const lastSegment = path.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  // A leading dot (dotfile) or trailing dot isn't an extension.
  if (dot <= 0 || dot === lastSegment.length - 1) return null;
  return lastSegment.slice(dot + 1).toLowerCase();
}
