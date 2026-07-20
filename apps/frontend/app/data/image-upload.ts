/**
 * The editor's image network layer: turning a picked or pasted image into
 * something the editor can embed.
 *
 * Two entry points, one discriminated result so `ImagePlugin` can build the right
 * content node without knowing which path ran:
 *   - `uploadImage` — a file the browser already holds (a picked file, pasted
 *     screenshot pixels, or a pasted image whose bytes were read client-side);
 *   - `uploadPastedImage` — an `<img>` pasted from a web page, which carries a URL
 *     rather than the bytes.
 *
 * Storage mirrors the read/write split the data hooks use: a real logbook uploads
 * to the backend; a demo logbook (which never touches the network) embeds the
 * image inline as a data URI (spec/3-frontend.md → "Demo Logbook").
 *
 * A cross-origin pasted URL is fetched and stored entirely server-side by
 * `image.uploadFromUrl` — the browser can't read a cross-origin image's bytes
 * (CORS withholds them), and there's no reason to route them through it. Only a
 * `data:` URI or a same-origin URL, both of which the browser can read itself,
 * and every demo case, are read client-side and posted the ordinary way.
 */
import { trpc } from "./trpc.ts";

export type ImageUploadResult =
  | { kind: "uploaded"; imageId: string; filename: string; width: number; height: number }
  | { kind: "data-uri"; src: string; width: number; height: number };

export type UploadImageOptions = {
  logbookId: string;
  entryId: number;
  demo: boolean;
  signal: AbortSignal;
};

/** Decode a file's intrinsic pixel dimensions in the browser (demo only — the
 *  backend detects these with `image-meta` for real uploads). */
async function readDimensions(file: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a file the browser already holds — a picked file, pasted screenshot, or a
 * pasted image whose bytes were read client-side. A demo logbook embeds a data URI
 * instead of hitting the network.
 */
export async function uploadImage(
  file: File,
  opts: UploadImageOptions,
): Promise<ImageUploadResult> {
  if (opts.demo) {
    const [src, dims] = await Promise.all([readDataUrl(file), readDimensions(file)]);
    if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
    return { kind: "data-uri", src, width: dims.width, height: dims.height };
  }

  const formData = new FormData();
  formData.set("image", file);
  formData.set("logbookId", opts.logbookId);
  formData.set("entryId", String(opts.entryId));
  formData.set("originalFilename", file.name);

  const detail = await trpc.image.upload.mutate(formData, { signal: opts.signal });
  return {
    kind: "uploaded",
    imageId: detail.id,
    filename: detail.urlSafeName,
    width: detail.width,
    height: detail.height,
  };
}

/** Store a cross-origin image by URL, fetched entirely server-side (SSRF-fenced
 *  and connection-pinned; see the backend's `fetchRemoteImage`). The bytes never
 *  touch the browser. */
async function uploadImageFromUrl(
  url: string,
  opts: UploadImageOptions,
): Promise<ImageUploadResult> {
  const detail = await trpc.image.uploadFromUrl.mutate(
    { logbookId: opts.logbookId, entryId: opts.entryId, url },
    { signal: opts.signal },
  );
  return {
    kind: "uploaded",
    imageId: detail.id,
    filename: detail.urlSafeName,
    width: detail.width,
    height: detail.height,
  };
}

/**
 * Read a pasted `<img>`'s `src` — a `data:` URI or a same-origin URL the browser
 * can read directly — into a `File`. Cross-origin URLs never reach here (they go
 * server-side via `uploadImageFromUrl`), except in a demo logbook, which has no
 * server and so can only try a direct fetch that a CORS-less host refuses.
 */
async function pastedSrcToFile(src: string, signal: AbortSignal): Promise<File> {
  const res = await fetch(src, { signal });
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Pasted content is not an image");
  return new File([blob], filenameFromSrc(src), { type: blob.type });
}

/**
 * Resolve a pasted `<img>`'s `src` to an uploaded image. A cross-origin http(s)
 * URL in a real logbook is fetched and stored server-side (no CORS, no
 * round-trip); a `data:` URI, a same-origin URL, or anything in a demo logbook is
 * read by the browser and posted the ordinary way.
 */
export async function uploadPastedImage(
  src: string,
  opts: UploadImageOptions,
): Promise<ImageUploadResult> {
  if (!opts.demo) {
    let absolute: URL | null = null;
    try {
      absolute = new URL(src, window.location.href);
    } catch {
      absolute = null;
    }
    if (
      absolute &&
      (absolute.protocol === "http:" || absolute.protocol === "https:") &&
      absolute.origin !== window.location.origin
    ) {
      return uploadImageFromUrl(absolute.href, opts);
    }
  }
  const file = await pastedSrcToFile(src, opts.signal);
  return uploadImage(file, opts);
}

/** A usable filename for a pasted image, taken from the last segment of its URL.
 *  Decorative — it only shapes the served URL and the browser's "Save image as…"
 *  name — so anything unpromising falls back to a generic stem. */
function filenameFromSrc(src: string): string {
  // A data URI's "path" is the whole base64 payload — never a usable filename.
  if (src.startsWith("data:")) return "image";
  try {
    const last = new URL(src, window.location.origin).pathname.split("/").filter(Boolean).pop();
    return last && last.length <= 128 ? last : "image";
  } catch {
    return "image";
  }
}
