/**
 * The load-bearing guarantee here is serialization: a placeholder `ImageNode`
 * (its file still uploading, or that upload failed) must never reach stored JSON
 * as a real reference, and a real reference must round-trip unchanged. These run
 * headlessly — the same code path the backend and the editor's save both use.
 */
import { $getRoot, type LexicalNode } from "lexical";
import { expect, test } from "vite-plus/test";

import { createContentEditor } from "../schema.ts";
import {
  $createFailedImageNode,
  $createImageNode,
  ImageNode,
  isPlaceholderImageJSON,
  type SerializedImageNode,
  shouldSkipImportedImage,
} from "./image-node.ts";

/** Serialize a single block node exactly as a saved document would, and hand back
 *  its lone serialized child. */
function serializeChild(makeNode: () => LexicalNode): Record<string, unknown> {
  const editor = createContentEditor();
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      root.append(makeNode());
    },
    { discrete: true },
  );
  const json = editor.getEditorState().toJSON() as {
    root: { children: Record<string, unknown>[] };
  };
  const child = json.root.children[0];
  if (!child) throw new Error("expected one serialized child");
  return child;
}

/** Parse serialized document JSON back through the node classes, the way loading
 *  a stored document does, and run `inspect` on the first block *inside* the read
 *  — node state helpers only work during an editor read/update. */
function withParsedChild<T>(
  child: SerializedSentinelOrImage,
  inspect: (node: LexicalNode) => T,
): T {
  const editor = createContentEditor();
  const state = editor.parseEditorState({
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [child],
    },
  } as never);
  return state.read(() => {
    const node = $getRoot().getFirstChild();
    if (!node) throw new Error("expected one parsed child");
    return inspect(node);
  });
}

/** A serialized image, real or the placeholder sentinel. */
type SerializedSentinelOrImage = SerializedImageNode;

const READY = {
  imageId: "abc123",
  filename: "photo.png",
  altText: "a photo",
  width: 640,
  height: 480,
};

test("a ready image serializes as a real, non-placeholder reference", () => {
  const child = serializeChild(() => $createImageNode(READY));
  expect(child.type).toBe("image");
  expect(child.imageId).toBe("abc123");
  expect(child.filename).toBe("photo.png");
  expect(child.placeholder).toBeUndefined();
  expect(isPlaceholderImageJSON(child)).toBe(false);
});

test("a pending placeholder serializes to a strippable sentinel with no reference", () => {
  const child = serializeChild(
    () =>
      new ImageNode({
        imageId: "",
        filename: "",
        altText: "",
        width: 0,
        height: 0,
        placeholder: "pending",
      }),
  );
  // Still `type: "image"` so it round-trips through the clipboard, but carrying
  // the marker the save path strips and no real id/filename to leak.
  expect(child.type).toBe("image");
  expect(child.placeholder).toBe(true);
  expect(child.imageId).toBe("");
  expect(child.filename).toBe("");
  expect(isPlaceholderImageJSON(child)).toBe(true);
});

test("a failed placeholder is just as non-persistable as a pending one", () => {
  const child = serializeChild(() => $createFailedImageNode("alt survives"));
  expect(child.placeholder).toBe(true);
  expect(isPlaceholderImageJSON(child)).toBe(true);
  // Alt text is kept so a copied/failed image can still describe itself, but the
  // reference fields stay empty.
  expect(child.altText).toBe("alt survives");
  expect(child.imageId).toBe("");
});

test("isPlaceholderImageJSON ignores unrelated nodes and real images", () => {
  expect(isPlaceholderImageJSON({ type: "paragraph" })).toBe(false);
  expect(isPlaceholderImageJSON({ type: "image", placeholder: false })).toBe(false);
  expect(isPlaceholderImageJSON({ type: "image" })).toBe(false);
  // A non-image node can't be mistaken for a placeholder even if it carries the
  // marker property, since the check is keyed on the image type too.
  expect(isPlaceholderImageJSON({ type: "paragraph", placeholder: true })).toBe(false);
});

test("a real image reference round-trips unchanged through import", () => {
  const child = serializeChild(() => $createImageNode(READY));
  withParsedChild(child as SerializedSentinelOrImage, (node) => {
    expect(node).toBeInstanceOf(ImageNode);
    const image = node as ImageNode;
    expect(image.isPlaceholder()).toBe(false);
    expect(image.getImageId()).toBe("abc123");
    expect(image.getFilename()).toBe("photo.png");
    expect(image.getAltText()).toBe("a photo");
  });
});

test("a placeholder sentinel imports as deletable failsafe content, never a live upload", () => {
  // A stored document never contains the sentinel (it's stripped on save); this
  // is the copy-a-pending-image-and-paste path. It must come back as a failed
  // placeholder the user can delete — not a pending spinner and not a broken ref.
  const sentinel = serializeChild(
    () =>
      new ImageNode({
        imageId: "",
        filename: "",
        altText: "",
        width: 0,
        height: 0,
        placeholder: "pending",
      }),
  );
  withParsedChild(sentinel as SerializedSentinelOrImage, (node) => {
    expect(node).toBeInstanceOf(ImageNode);
    const image = node as ImageNode;
    expect(image.isFailed()).toBe(true);
    expect(image.isPending()).toBe(false);
    expect(image.getImageId()).toBe("");
  });
});

test("a corrupt image reference with no id imports as failsafe content, not a broken image", () => {
  withParsedChild(
    { type: "image", version: 1, imageId: "", filename: "", altText: "", width: 0, height: 0 },
    (node) => expect((node as ImageNode).isFailed()).toBe(true),
  );
});

// `shouldSkipImportedImage` decides which pasted `<img>` elements never become an
// upload at all — the images the backend can't store (SVGs and friends) that an
// HTML paste tends to carry. The invariant: real content is always kept, and
// skipping only happens on a positive signal (a source that names an unsupported
// type), never on a guess. A tracking pixel isn't detectable from the markup, so
// it's deliberately NOT skipped here — it's left for the backend to accept as the
// meaningless dot it is.

test("a source that names an unsupported type is skipped", () => {
  expect(shouldSkipImportedImage("https://ex.com/logo.svg")).toBe(true);
  expect(shouldSkipImportedImage("https://ex.com/pic.bmp")).toBe(true);
  expect(shouldSkipImportedImage("https://ex.com/photo.tiff")).toBe(true);
  expect(shouldSkipImportedImage("https://ex.com/shot.avif")).toBe(true);
  // The extension is read past a query string and case-insensitively.
  expect(shouldSkipImportedImage("https://cdn.ex.com/a/logo.SVG?v=3#x")).toBe(true);
});

test("an SVG data URI is skipped, and an accepted-type data URI is kept", () => {
  expect(shouldSkipImportedImage("data:image/svg+xml;base64,PHN2Zz4=")).toBe(true);
  expect(shouldSkipImportedImage("data:image/bmp;base64,Qk0=")).toBe(true);
  expect(shouldSkipImportedImage("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
  expect(shouldSkipImportedImage("data:image/jpeg;base64,/9j/4AAQ=")).toBe(false);
});

test("a supported image with a normal source is kept", () => {
  expect(shouldSkipImportedImage("https://ex.com/photo.jpg")).toBe(false);
  expect(shouldSkipImportedImage("https://ex.com/pic.png")).toBe(false);
  // An extensionless CDN URL can't be judged from the markup — the backend will,
  // so it's kept rather than guessed at.
  expect(shouldSkipImportedImage("https://cdn.ex.com/i/abc123?w=800")).toBe(false);
  // A tiny declared size is no longer a signal: without fetching the bytes a
  // tracking pixel is indistinguishable from any other supported image, so it's
  // kept here and left for the backend.
  expect(shouldSkipImportedImage("https://ex.com/beacon.gif")).toBe(false);
});
