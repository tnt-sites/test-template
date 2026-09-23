import assert from "node:assert/strict";
import test from "node:test";
import { asContentRun } from "../src/generate/content-run.mjs";

const node = (kind, extra = {}) => ({ kind, children: [], ...extra });
const section = (children) => node("container", { n: 0, children });

const H = (text, tag = "h2") => node("heading", { tag, text, html: text });
const P = (text) => node("text", { tag: "p", text, html: text });
const IMG = (src, alt = "") => node("img", { tag: "img", attrs: { src, alt } });
const BTN = (text, href) => node("button", { tag: "a", text, attrs: { href } });
const CARD = (n, children) => node("container", { n, children });
const HR = () => node("divider", { tag: "hr" });

test("a run of headings and prose becomes blocks, not a component", () => {
  const run = asContentRun(section([H("What are implants?"), P("Titanium roots."), P("They fuse.")]));

  assert.deepEqual(
    run.blocks.map((b) => b.type),
    ["heading", "prose", "prose"]
  );
  assert.equal(run.align, "left");
});

test("length is not structure: three slots and ten give the same shape", () => {
  const short = asContentRun(section([H("A"), P("one")]));
  const long = asContentRun(
    section([H("A"), P("one"), H("B"), P("two"), H("C"), P("three"), H("D"), P("four")])
  );

  // The whole point: both are content runs, so neither needs its own component.
  assert.ok(short && long);
  assert.equal(short.blocks.length, 2);
  assert.equal(long.blocks.length, 8);
});

test("headings keep their level, and h3 and below become subheadings", () => {
  const run = asContentRun(section([H("Title", "h1"), H("Section", "h2"), H("Detail", "h3")]));

  assert.deepEqual(run.blocks, [
    { type: "heading", html: "Title", level: 1 },
    { type: "heading", html: "Section" },
    { type: "subheading", html: "Detail" },
  ]);
});

test("consecutive links collapse into one button group", () => {
  const run = asContentRun(
    section([H("A"), P("copy"), BTN("Book", "/book/"), BTN("Call", "tel:+1")])
  );
  const buttons = run.blocks.at(-1);

  assert.equal(buttons.type, "buttons");
  assert.deepEqual(buttons.buttons, [
    { text: "Book", link: "/book/" },
    { text: "Call", link: "tel:+1" },
  ]);
});

test("a photo before the copy floats left; after it, right", () => {
  const before = asContentRun(section([H("A"), IMG("/a.jpg"), P("copy")]));
  const after = asContentRun(section([H("A"), P("copy"), IMG("/a.jpg")]));

  assert.equal(before.blocks.find((b) => b.type === "image").side, "left");
  assert.equal(after.blocks.find((b) => b.type === "image").side, "right");
});

test("a logo is chrome and never becomes a content image", () => {
  const run = asContentRun(section([H("A"), IMG("/wp-content/logo-white.png"), P("copy")]));

  assert.equal(run.blocks.some((b) => b.type === "image"), false);
});

test("a section that paints its own band keeps its component", () => {
  const band = { styles: { backgroundColor: "rgb(70, 166, 175)" } };

  assert.equal(asContentRun(section([H("A"), P("copy")]), { record: band }), null);
});

test("a band painted by a ::before overlay also keeps its component", () => {
  // The interior page banner paints nothing on its root and lays a lime wash
  // over the photo with a pseudo-element.
  const banner = {
    styles: { backgroundColor: "rgba(0, 0, 0, 0)" },
    before: { backgroundColor: "rgb(166, 206, 57)" },
  };

  assert.equal(asContentRun(section([IMG("/banner.jpg"), H("Botox")]), { record: banner }), null);
});

test("a repeat is a widget, not a length", () => {
  assert.equal(asContentRun(section([H("A"), P("copy")]), { hasRepeats: true }), null);
});

test("an embed or a table keeps its component", () => {
  assert.equal(asContentRun(section([H("A"), node("embed"), P("copy")])), null);
  assert.equal(asContentRun(section([H("A"), node("raw"), P("copy")])), null);
});

test("a section with no words is not a content run", () => {
  assert.equal(asContentRun(section([IMG("/a.jpg")])), null);
  assert.equal(asContentRun(section([BTN("Book", "/book/")])), null);
});

test("a painted child card keeps its component (not a flat run)", () => {
  // A transparent-rooted section whose child card carries the colour — the
  // Patient Information / Payment Options case. Needs the per-node style map.
  const card = CARD(1, [H("Office Policies"), P("24 hours notice.")]);
  const styles = { 1: { styles: { backgroundColor: "rgb(61, 181, 251)" } } };

  assert.equal(asContentRun(section([card]), { styles }), null);
});

test("a plain run still flattens when the styles map shows no painted child", () => {
  const styles = { 0: { styles: { backgroundColor: "rgba(0, 0, 0, 0)" } } };
  const run = asContentRun(section([H("A"), P("copy")]), { styles });

  assert.ok(run);
  assert.deepEqual(run.blocks.map((b) => b.type), ["heading", "prose"]);
});

test("an <hr> survives as a divider block", () => {
  const run = asContentRun(section([H("A"), HR(), P("copy")]));

  assert.deepEqual(run.blocks.map((b) => b.type), ["heading", "divider", "prose"]);
});

test("a centred section is recorded as centred", () => {
  const run = asContentRun(section([H("A"), P("copy")]), {
    record: { styles: { textAlign: "center" } },
  });

  assert.equal(run.align, "center");
});

test("a run carries its own measured design so the shared band paints as this site", () => {
  // The heading / button / divider each carry a node number that keys the
  // captured style map — the same shape the emit passes as `captured.styles[bp]`.
  const h = node("heading", { n: 1, tag: "h2", text: "Patient Forms", html: "Patient Forms" });
  const b = node("button", { n: 2, tag: "a", text: "Download Forms", attrs: { href: "/f" } });
  const hr = node("divider", { n: 3, tag: "span" });
  const styles = {
    0: { styles: { backgroundColor: "rgba(0, 0, 0, 0)" } },
    1: { styles: { fontFamily: '"Playfair Display", sans-serif', fontSize: "45px", fontWeight: "700", color: "rgb(61, 181, 251)", textAlign: "center", textTransform: "none" } },
    2: { styles: { backgroundColor: "rgb(88, 194, 255)", color: "rgb(255, 255, 255)", borderTopLeftRadius: "3px", textTransform: "uppercase" } },
    3: { styles: { borderTopColor: "rgb(61, 181, 251)", borderTopWidth: "1px", borderTopStyle: "solid", maxWidth: "700px" } },
  };
  const run = asContentRun(section([h, b, hr]), { styles });

  assert.deepEqual(run.design.heading, {
    fontFamily: '"Playfair Display", sans-serif',
    fontSize: 45,
    fontWeight: "700",
    color: "rgb(61, 181, 251)",
    align: "center",
    textTransform: "none",
  });
  assert.deepEqual(run.design.button, {
    background: "rgb(88, 194, 255)",
    color: "rgb(255, 255, 255)",
    radius: "3px",
    uppercase: true,
  });
  assert.deepEqual(run.design.divider, {
    color: "rgb(61, 181, 251)",
    weight: "1px",
    style: "solid",
    maxWidth: "700px",
  });
});

test("no styles map means no design, and the band renders on its baked defaults", () => {
  const run = asContentRun(section([H("A"), P("copy")]));
  assert.ok(run);
  assert.equal(run.design, undefined);
});

test("a transparent button fill is not recorded as design", () => {
  const b = node("button", { n: 2, tag: "a", text: "Go", attrs: { href: "/f" } });
  const styles = {
    0: { styles: {} },
    2: { styles: { backgroundColor: "rgba(0, 0, 0, 0)", color: "rgb(0, 0, 238)" } },
  };
  const run = asContentRun(section([H("A"), b]), { styles });
  // Colour survives, transparent fill does not.
  assert.equal(run.design.button.background, undefined);
  assert.equal(run.design.button.color, "rgb(0, 0, 238)");
});

test("a run is centred when its own text is, not only when the container says so", () => {
  // Elementor centres the heading and the paragraph and leaves the container
  // they sit in at its `start` default, so reading the root alone reported the
  // New Patients page's centred video band as left-aligned.
  const tree = {
    n: 0,
    tag: "section",
    kind: "container",
    children: [
      { n: 1, tag: "h2", kind: "heading", html: "Educational Dental Videos", children: [] },
      { n: 2, tag: "p", kind: "text", html: "<p>Browse videos by topic below.</p>", children: [] },
    ],
  };
  const styles = {
    0: { styles: { textAlign: "start" } },
    1: { styles: { textAlign: "center" } },
    2: { styles: { textAlign: "center" } },
  };

  assert.equal(asContentRun(tree, { record: styles[0], styles }).align, "center");
  // Left-aligned text still reads left, and a run with no measurement falls
  // back to the container exactly as before.
  const left = { ...styles, 1: { styles: { textAlign: "start" } }, 2: { styles: { textAlign: "start" } } };
  assert.equal(asContentRun(tree, { record: styles[0], styles: left }).align, "left");
  assert.equal(asContentRun(tree, { record: { styles: { textAlign: "center" } } }).align, "center");
});
