import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mediaGap, proposeSection, unreferencedMedia } from "../src/qa/missing-media.mjs";

/** A mirror with a handful of uploads. */
function mirror(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wpmig-mm-"));
  const up = path.join(root, "wp-content/uploads/2024/11");
  fs.mkdirSync(up, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(up, f), "x");
  return root;
}

/** A stub client returning one canned assistant message. */
const client = (text) => ({
  messages: { create: async () => ({ content: [{ type: "text", text }] }) },
});

test("unreferenced media lists only files no page points at", () => {
  const root = mirror(["gallery-a.jpg", "gallery-b.jpg", "used.jpg"]);

  const out = unreferencedMedia(root, ["/wp-content/uploads/2024/11/used.jpg"]);

  assert.deepEqual(out.sort(), ["gallery-a.jpg", "gallery-b.jpg"]);
});

test("WordPress size variants and chrome assets are not candidates", () => {
  // A variant is the same picture, and listing every one buries the distinct
  // images; a logo is never the missing gallery.
  const root = mirror(["photo.jpg", "photo-300x200.jpg", "photo-1024x768.jpg", "site-logo.png", "favicon.png"]);

  assert.deepEqual(unreferencedMedia(root, []), ["photo.jpg"]);
});

test("a missing uploads directory yields no candidates rather than throwing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wpmig-mm-empty-"));

  assert.deepEqual(unreferencedMedia(root, []), []);
});

test("a proposal keeps only filenames that were actually offered", async () => {
  // A hallucinated path is a broken image on a live site, so the allowlist is
  // enforced rather than trusted.
  const png = path.join(mirror([]), "shot.png");
  fs.writeFileSync(png, "x");
  const c = client(JSON.stringify({
    images: [{ file: "real.jpg", alt: "a" }, { file: "invented.jpg", alt: "b" }],
    heading: "In the News", confidence: "high", note: "",
  }));

  const out = await proposeSection(c, png, ["real.jpg"]);

  assert.deepEqual(out.images, [{ file: "real.jpg", alt: "a" }]);
  assert.equal(out.heading, "In the News");
});

test("a proposal matching nothing offered is no proposal at all", async () => {
  const png = path.join(mirror([]), "shot.png");
  fs.writeFileSync(png, "x");
  const c = client(JSON.stringify({ images: [{ file: "invented.jpg", alt: "b" }] }));

  assert.equal(await proposeSection(c, png, ["real.jpg"]), null);
});

test("no candidate files means no model call and no proposal", async () => {
  let called = false;
  const c = { messages: { create: async () => { called = true; return { content: [] }; } } };

  assert.equal(await proposeSection(c, "/nonexistent.png", []), null);
  assert.equal(called, false);
});

test("unparseable model output degrades to no proposal", async () => {
  const png = path.join(mirror([]), "shot.png");
  fs.writeFileSync(png, "x");

  assert.equal(await proposeSection(client("sorry, I can't tell"), png, ["real.jpg"]), null);
});

test("a page-named file the build never references is the actionable gap", () => {
  // `office-tour-v1.jpg` on `/office-tour/` is not a coincidence — it is the
  // one signal a person can act on without opening anything.
  const root = mirror(["office-tour-v1.jpg", "office-tour-v2.jpg", "unrelated-stock.jpg"]);

  const gap = mediaGap({ staticDir: root, referenced: [], pageSlug: "office-tour" });

  assert.deepEqual(gap.named.sort(), ["office-tour-v1.jpg", "office-tour-v2.jpg"]);
  assert.equal(gap.count, 3);
});

test("a page whose media is all referenced has no gap at all", () => {
  const root = mirror(["shown.jpg"]);

  assert.equal(mediaGap({ staticDir: root, referenced: ["/wp-content/uploads/2024/11/shown.jpg"], pageSlug: "x" }), null);
});

test("unreferenced media with no name match still reports a count, not a false lead", () => {
  // Site-wide leftovers are real but not this page's question.
  const root = mirror(["some-other-photo.jpg"]);

  const gap = mediaGap({ staticDir: root, referenced: [], pageSlug: "office-tour" });

  assert.deepEqual(gap.named, []);
  assert.equal(gap.count, 1);
});
