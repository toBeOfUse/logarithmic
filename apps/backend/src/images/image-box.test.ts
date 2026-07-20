/**
 * `LocalImageBox` storage layout. The spec requires each uploaded file to be
 * fanned out across two levels of directories named for the first characters of
 * its image id, so that no single directory accumulates enough entries to hit
 * file-system performance cliffs (spec/2-backend.md → "Images"). The upload +
 * serve round-trip is covered end-to-end in `../api/image-api.test.ts`; these
 * tests pin the on-disk shape itself and the boundary conditions of the key.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { LocalImageBox } from "./image-box.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "logarithmic-imagebox-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("a stored image lands under two directory levels keyed by its first two id characters", async () => {
  const box = new LocalImageBox(dir);
  const bytes = Buffer.from("fake image bytes");
  await box.put("abcdef123456789012345", bytes);

  // <root>/a/b/<id> — the first id character is the first level and the second
  // the second, so any one directory only holds ids sharing a two-char prefix.
  const onDisk = readFileSync(join(dir, "a", "b", "abcdef123456789012345"));
  expect(onDisk.equals(bytes)).toBe(true);
});

test("a stored image reads back byte-for-byte through get", async () => {
  const box = new LocalImageBox(dir);
  const bytes = Buffer.from([0, 1, 2, 3, 255, 254]);
  await box.put("zy9876543210987654321", bytes);

  const stored = await box.get("zy9876543210987654321");
  if (!stored) throw new Error("expected the stored image to be found");
  expect(stored.contentLength).toBe(bytes.length);
  expect((await buffer(stored.stream)).equals(bytes)).toBe(true);
});

test("reading an id that was never stored yields null rather than throwing", async () => {
  const box = new LocalImageBox(dir);
  expect(await box.get("neverstored0000000000")).toBeNull();
});

test("an id that isn't lowercase alphanumeric is refused, closing traversal and case collisions", async () => {
  const box = new LocalImageBox(dir);
  // A traversal attempt, a bare separator, and an uppercased id (which would
  // collide with its lowercase twin on a case-insensitive file system) are all
  // turned away before they can touch the disk.
  await expect(box.put("../../etc/passwd", Buffer.from("x"))).rejects.toThrow();
  await expect(box.get("has/slash")).rejects.toThrow();
  await expect(box.get("ABCDEF123456789012345")).rejects.toThrow();
});
