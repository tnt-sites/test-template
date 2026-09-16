/**
 * Accordion recognition and routing.
 *
 * Two halves, tested two ways. The pure transforms — splitting a section around
 * its accordions, mapping panel segments onto the target's building blocks,
 * snapping a measured colour onto a brand token — are plain functions. The
 * capture half is not: whether a *closed* panel's content survives is a
 * question about how a browser renders `<details>`, and no stub has an answer,
 * so those cases drive real Chromium against fixtures the way
 * `segment.test.mjs` does.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import {
  accordionBlock,
  accordionTheme,
  normalizeMediaUrl,
  pullUpHeading,
  segmentsToSections,
  splitByAccordions,
  splitByAnchors,
} from "../src/generate/accordion.mjs";
import { captureSection } from "../src/capture/section.mjs";
import { expandDisclosures } from "../src/browser/disclose.mjs";

const BRANDING = { colorBrand: "#3db5fb", colorBrandSecondary: "#6fc1e4" };

/** A section: heading, paragraph, then an accordion of two panels. */
const node = (n, kind, extra = {}) => ({ n, tag: "div", kind, children: [], ...extra });
const SECTION = {
  n: 0,
  tag: "section",
  kind: "container",
  children: [
    node(1, "heading", { tag: "h2", text: "FAQs", html: "FAQs" }),
    node(2, "text", { tag: "p", text: "Intro", html: "<p>Intro</p>" }),
    node(3, "container", {
      children: [node(4, "text", { text: "Panel one" }), node(5, "text", { text: "Panel two" })],
    }),
  ],
};
const ACCORDION = {
  nodes: [3, 4, 5],
  minN: 3,
  maxN: 5,
  openFirst: true,
  theme: null,
  items: [
    { title: "One", segments: [{ type: "html", html: "<p>Panel one</p>" }] },
    { title: "Two", segments: [{ type: "html", html: "<p>Panel two</p>" }] },
  ],
};

test("a section splits into the content around its accordion, in order", () => {
  const parts = splitByAccordions(SECTION, [ACCORDION]);

  assert.deepEqual(
    parts.map((p) => p.kind),
    ["run", "accordion"]
  );
  const kept = [];
  (function walk(t) {
    kept.push(t.n);
    for (const c of t.children) walk(c);
  })(parts[0].tree);
  // The lead run keeps the heading and prose and nothing of the accordion —
  // including the container the panels hung from, which is left childless.
  assert.deepEqual(kept, [0, 1, 2]);
});

test("a section that is only an accordion produces no empty lead run", () => {
  const bare = { n: 0, tag: "section", kind: "container", children: [SECTION.children[2]] };
  const parts = splitByAccordions(bare, [ACCORDION]);

  assert.deepEqual(
    parts.map((p) => p.kind),
    ["accordion"]
  );
});

test("with no accordion the tree passes through untouched", () => {
  const parts = splitByAccordions(SECTION, []);

  assert.equal(parts.length, 1);
  assert.equal(parts[0].tree, SECTION);
});

test("a heading is pulled onto the accordion only when it sits directly against it", () => {
  const adjacent = pullUpHeading({
    n: 0,
    tag: "section",
    kind: "container",
    children: [node(1, "text", { html: "<p>Intro</p>" }), node(2, "heading", { html: "FAQs" })],
  });
  assert.equal(adjacent.heading, "FAQs");
  assert.ok(adjacent.tree, "the prose above it stays behind as a run");

  // Prose between the heading and the accordion means hoisting would reorder
  // the page, so the heading stays where the source put it.
  const separated = pullUpHeading(splitByAccordions(SECTION, [ACCORDION])[0].tree);
  assert.equal(separated.heading, "");
});

test("a media URL gets a scheme however the mirror mangled it", () => {
  assert.equal(
    normalizeMediaUrl("https://video.prosites.com/a.mp4"),
    "https://video.prosites.com/a.mp4"
  );
  assert.equal(normalizeMediaUrl("//video.prosites.com/a.mp4"), "https://video.prosites.com/a.mp4");
  // The one that fails silently: relative to the page, so it 404s behind the
  // poster rather than not rendering.
  assert.equal(normalizeMediaUrl("video.prosites.com/a.mp4"), "https://video.prosites.com/a.mp4");
  assert.equal(normalizeMediaUrl("/wp-content/uploads/a.mp4"), "/wp-content/uploads/a.mp4");
  assert.equal(normalizeMediaUrl(""), "");
});

test("panel segments become the target's own blocks, and a video keeps its poster", () => {
  const sections = segmentsToSections([
    { type: "html", html: "<div>  New Patient Exam  </div>", align: "center" },
    {
      type: "video",
      src: "//video.prosites.com/AFV.mp4",
      poster: "/wp-content/uploads/AFV.png",
      title: "",
    },
    { type: "html", html: "   " },
  ]);

  assert.deepEqual(
    sections.map((s) => s._component),
    ["building-blocks/core-elements/text", "building-blocks/core-elements/video"]
  );
  const video = sections[1];
  // `hosted` is what renders a plain <video>; youtube/vimeo render a lite embed.
  assert.equal(video.type, "hosted");
  assert.equal(video.source, "https://video.prosites.com/AFV.mp4");
  assert.equal(video.thumbnail, "/wp-content/uploads/AFV.png");
  // The caption in its own text widget ahead of the video names it in the editor.
  assert.equal(video.title, "New Patient Exam");
  // Centred by an Elementor class rather than an inline style, so it is only
  // recoverable from the computed style the capture read.
  assert.equal(sections[0].alignX, "center");
});

test("a paragraph before a video is prose, not the video's name", () => {
  const long = `<p>${"a longer answer ".repeat(12)}</p>`;
  const sections = segmentsToSections([
    { type: "html", html: long },
    { type: "video", src: "https://x.test/a.mp4", poster: "", title: "" },
  ]);

  assert.equal(sections[1].title, "");
});

test("measured colours snap to brand tokens and follow a rebrand", () => {
  const theme = accordionTheme(
    {
      titleBackground: "rgb(111, 193, 228)",
      titleColor: "rgb(31, 33, 36)",
      titleBackgroundOpen: "rgb(61, 181, 251)",
      titleColorOpen: "rgb(255, 255, 255)",
      titleFontSize: "18px",
      titleFontWeight: "400",
      titlePadding: "15px",
      itemGap: "10px",
      itemBorder: "0",
      detailBorderTop: "1px solid rgb(213, 216, 220)",
      detailBorderLeft: "1px solid rgb(213, 216, 220)",
    },
    BRANDING
  );

  assert.equal(theme.titleBackgroundOpen, "var(--color-brand)");
  assert.equal(theme.titleBackgroundOpen !== theme.titleBackground, true);
  assert.equal(theme.titleBackground, "var(--color-brand-secondary)");
  assert.equal(theme.titleColorOpen, "#ffffff");
  // Off-palette shades stay literal, but as hex rather than raw `rgb()`.
  assert.equal(theme.titleColor, "#1f2124");
  assert.equal(theme.detailBorderTop, "1px solid #d5d8dc");
  // All four sides travel: the open panel is a bordered card, not two loose
  // rules. And "0" is a measurement too — it is what stops the target drawing
  // the hairline rule under every item that its own design has and this one
  // does not.
  assert.equal(theme.detailBorderLeft, "1px solid #d5d8dc");
  assert.equal(theme.itemBorder, "0");
});

test("an unpainted accordion emits no theme, so the target's own design stands", () => {
  assert.equal(
    accordionTheme(
      {
        titleBackground: "rgba(0, 0, 0, 0)",
        titleBackgroundOpen: "transparent",
        itemGap: "0px",
        detailBorderTop: "0",
        detailBorderBottom: "0",
      },
      BRANDING
    ),
    null
  );
  assert.equal(accordionTheme(null, BRANDING), null);
});

test("the block carries the section's band, and drops its own padding under a lead run", () => {
  const opts = { ref: "page-sections/info-blocks/faq-section", branding: BRANDING };
  const alone = accordionBlock(ACCORDION, { ...opts, bandColor: "rgb(244, 248, 247)" });
  const trailing = accordionBlock(ACCORDION, {
    ...opts,
    bandColor: "rgb(26, 26, 26)",
    hasLeadRun: true,
  });

  assert.equal(alone.paddingVertical, "4xl");
  assert.equal(alone.backgroundColorHex, "#f4f8f7");
  assert.equal(alone.colorScheme, "inherit");
  assert.equal(alone.items.length, 2);
  assert.equal(alone.items[0]._component, "building-blocks/wrappers/accordion/accordion-item");

  // One band in the source: a second helping of section padding would open a
  // gap the source never had.
  assert.equal(trailing.paddingVertical, "none");
  // Dark band, so the section flips to the light-on-dark theme.
  assert.equal(trailing.colorScheme, "contrast");
});

test("a transparent band is not a dark one", () => {
  // `rgba(0, 0, 0, 0)` is how a computed style spells transparent. Read as a
  // colour it is black, which flipped every unpainted accordion to the dark
  // theme — where `var(--color-brand)` remaps to white and the open title bar
  // rendered white-on-white.
  const block = accordionBlock(ACCORDION, {
    ref: "x",
    branding: BRANDING,
    bandColor: "rgba(0, 0, 0, 0)",
  });

  assert.equal(block.colorScheme, "inherit");
  assert.equal(block.backgroundColorHex, "");
});

test("no chevron is invented where the source had none", () => {
  const bare = accordionBlock({ ...ACCORDION, theme: { hasIcon: false } }, { ref: "x" });
  const iconed = accordionBlock({ ...ACCORDION, theme: { hasIcon: true } }, { ref: "x" });

  assert.equal(bare.iconName, "");
  assert.equal(iconed.iconName, "chevron-down");
});

// ---------------------------------------------------------------------------
// Capture, in a real browser: the closed-panel problem this whole change exists
// for cannot be reproduced without one.

const DETAILS_PAGE = `<!doctype html><html><head><style>
  body { margin: 0; font: 16px/1.4 system-ui; }
  .e-n-accordion-item { margin-bottom: 10px; }
  .e-n-accordion-item-title { background: #f4f8f7; color: #1f2124; padding: 15px; display: block; }
  .e-n-accordion-item[open] > .e-n-accordion-item-title { background: #3db5fb; color: #ffffff; }
  .panel { padding: 10px; border: 1px solid #d5d8dc; }
</style></head><body><main><section>
  <div class="e-n-accordion">
    <details class="e-n-accordion-item" open>
      <summary class="e-n-accordion-item-title">Open topic</summary>
      <div class="panel"><div class="widget"><p>The answer everyone can already see.</p></div></div>
    </details>
    <details class="e-n-accordion-item">
      <summary class="e-n-accordion-item-title">Closed topic</summary>
      <div class="panel"><div class="widget">
        <p>The answer nobody can see.</p>
        <ul><li><div>A list item that must survive as a list.</div></li></ul>
        <video src="//video.test/clip.mp4" poster="/wp-content/uploads/clip.png"></video>
      </div></div>
    </details>
  </div>
</section></main></body></html>`;

const LEGACY_PAGE = `<!doctype html><html><head><style>
  .elementor-toggle-title { background: #eeeeee; padding: 12px; }
  .elementor-toggle-title.elementor-active { background: #3db5fb; color: #fff; }
  .elementor-toggle-content { display: none; padding: 8px; }
  .elementor-toggle-content.active { display: block; }
</style></head><body><main><section>
  <div class="elementor-toggle">
    <div class="elementor-toggle-title elementor-active">Shown</div>
    <div class="elementor-toggle-content active"><p>Visible answer.</p></div>
    <div class="elementor-toggle-title">Hidden</div>
    <div class="elementor-toggle-content"><p>Answer behind a display:none.</p></div>
  </div>
</section></main></body></html>`;

async function capture(html, { expand = true } = {}) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 940 } });
    await page.setContent(html, { waitUntil: "load" });
    const disclosed = expand ? await expandDisclosures(page) : { accordions: 0 };
    const captured = await captureSection(page, "section", { breakpoints: [1280] });
    return { disclosed, captured };
  } finally {
    await browser.close();
  }
}

const panelText = (accordion, i) =>
  (accordion.items[i].segments || [])
    .filter((s) => s.type === "html")
    .map((s) => s.html)
    .join(" ");

test("a closed panel's content survives the capture", async () => {
  const { captured } = await capture(DETAILS_PAGE);
  const [accordion] = captured.accordions;

  assert.equal(accordion.items.length, 2);
  assert.deepEqual(
    accordion.items.map((i) => i.title),
    ["Open topic", "Closed topic"]
  );
  assert.match(panelText(accordion, 1), /nobody can see/);
  // The list is the reason panel markup is read directly rather than rebuilt
  // from the template tree, where an Elementor <li><div> is just a container.
  assert.match(panelText(accordion, 1), /<ul><li>/);
  assert.deepEqual(
    accordion.items[1].segments.map((s) => s.type),
    ["html", "video"]
  );
  assert.equal(accordion.items[1].segments[1].poster, "/wp-content/uploads/clip.png");
});

test("without the expand pass the closed panel is simply absent from the tree", async () => {
  const { captured } = await capture(DETAILS_PAGE, { expand: false });
  const text = [];
  (function walk(node) {
    if (node.text) text.push(node.text);
    for (const c of node.children || []) walk(c);
  })(captured.tree);

  assert.match(text.join(" "), /everyone can already see/);
  assert.doesNotMatch(text.join(" "), /nobody can see/);
  assert.deepEqual(captured.accordions, [], "nothing recognised the accordion either");
});

test("the closed design is read before anything is opened", async () => {
  const { captured } = await capture(DETAILS_PAGE);
  const theme = accordionTheme(captured.accordions[0].theme, BRANDING);

  // Both bars would read brand blue if this had been measured after the expand.
  assert.equal(theme.titleBackground, "#f4f8f7");
  assert.equal(theme.titleBackgroundOpen, "var(--color-brand)");
  assert.equal(theme.itemGap, "10px");
  assert.equal(theme.detailBorderTop, "1px solid #d5d8dc");
  assert.equal(theme.detailBorderRight, "1px solid #d5d8dc");
});

test("the accordion's nodes are bounded, so the rest of its section still routes", async () => {
  const { captured } = await capture(DETAILS_PAGE);
  const [accordion] = captured.accordions;

  assert.ok(accordion.nodes.length > 0);
  assert.equal(accordion.minN, Math.min(...accordion.nodes));
  assert.equal(accordion.maxN, Math.max(...accordion.nodes));
  // Never the section root, or splitting would take the whole section with it.
  assert.ok(!accordion.nodes.includes(captured.tree.n));
});

test("a legacy Elementor toggle is recognised the same way", async () => {
  const { captured } = await capture(LEGACY_PAGE);
  const [accordion] = captured.accordions;

  assert.ok(accordion, "no accordion recognised in legacy toggle markup");
  assert.deepEqual(
    accordion.items.map((i) => i.title),
    ["Shown", "Hidden"]
  );
  assert.match(panelText(accordion, 1), /behind a display:none/);
});

test("splitByAnchors cuts a section at an interior anchor target", () => {
  // Patient Forms (nodes 1–5) and Dental Videos (nodes 6–8) share one
  // container; #dental-videos begins at node 6.
  const combined = {
    n: 0,
    tag: "section",
    kind: "container",
    children: [
      node(1, "heading", { tag: "h2", text: "Patient Forms", html: "Patient Forms" }),
      node(2, "text", { text: "Save time." }),
      node(3, "button", { tag: "a", text: "Download", attrs: { href: "/f" } }),
      node(4, "divider", { tag: "span" }),
      node(6, "heading", {
        tag: "h2",
        text: "Educational Dental Videos",
        html: "Educational Dental Videos",
      }),
      node(7, "text", { text: "We believe." }),
      node(8, "text", { text: "A video panel." }),
    ],
  };
  const parts = splitByAnchors(combined, [6]);
  assert.equal(parts.length, 2);
  const textsOf = (t) => {
    const out = [];
    (function w(x) {
      if (x.text) out.push(x.text);
      (x.children || []).forEach(w);
    })(t);
    return out;
  };
  assert.deepEqual(textsOf(parts[0]), ["Patient Forms", "Save time.", "Download"]);
  assert.deepEqual(textsOf(parts[1]), [
    "Educational Dental Videos",
    "We believe.",
    "A video panel.",
  ]);
});

test("splitByAnchors leaves a section with no interior anchor whole", () => {
  const parts = splitByAnchors(SECTION, []);
  assert.equal(parts.length, 1);
  assert.equal(parts[0], SECTION);
});

test("splitByAnchors ignores a boundary at or before the root", () => {
  const parts = splitByAnchors(SECTION, [0]);
  assert.equal(parts.length, 1);
});
