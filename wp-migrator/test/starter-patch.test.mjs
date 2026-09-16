import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { patchStarterComponents } from "../src/generate/starter-patch.mjs";

const ACCORDION = `---
import AccordionItem from "./AccordionItem.astro";

const {
  items,
  openFirst,
  singleOpen = false,
  label,
} = Astro.props;

const hasItems = items?.length > 0;
---

<div class:list={["accordion"]} {...arrayDataAttributes} {...htmlAttributes}>
  <slot />
</div>

<style lang="pcss" is:global>
  @layer components {
    .accordion {
      margin-top: var(--spacing-lg);
    }
  }
</style>
`;

const FAQ = `---
const {
  heading = "Frequently Asked Questions",
  items = [],
  label = "About FAQ",
  backgroundColor,
} = Astro.props;
---
<CustomSection
  backgroundColor={backgroundColor}
>
  <Accordion label={label} singleOpen={true} openFirst={false} items={items} />
</CustomSection>
`;

function target({ accordion = ACCORDION, faq = FAQ } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wpmig-patch-"));
  const acc = path.join(root, "src/components/building-blocks/wrappers/accordion");
  const fq = path.join(root, "src/components/page-sections/info-blocks/faq-section");

  fs.mkdirSync(acc, { recursive: true });
  fs.mkdirSync(fq, { recursive: true });
  if (accordion !== null) fs.writeFileSync(path.join(acc, "Accordion.astro"), accordion);
  if (faq !== null) fs.writeFileSync(path.join(fq, "FaqSection.astro"), faq);

  return {
    root,
    accordion: path.join(acc, "Accordion.astro"),
    faq: path.join(fq, "FaqSection.astro"),
  };
}

test("the starter components learn to accept a measured theme", () => {
  const t = target();
  const { patched } = patchStarterComponents(t.root);

  assert.equal(patched.length, 2);

  const acc = fs.readFileSync(t.accordion, "utf8");
  assert.match(acc, /theme = \{\}/);
  assert.match(acc, /--acc-title-bg/);
  // The open bar is the whole point: it is what the source paints brand blue.
  assert.match(acc, /--acc-title-bg-open/);

  const faq = fs.readFileSync(t.faq, "utf8");
  assert.match(faq, /accordionTheme = \{\}/);
  assert.match(faq, /theme=\{accordionTheme\}/);
});

test("every added prop falls back to what the component rendered before", () => {
  // These are the user's files. A page that supplies no theme must render
  // exactly as it did, so every painted property needs a `revert` fallback.
  const t = target();
  patchStarterComponents(t.root);
  const acc = fs.readFileSync(t.accordion, "utf8");

  for (const v of ["--acc-title-bg", "--acc-title-color", "--acc-detail-padding"]) {
    assert.match(acc, new RegExp(`var\\(${v}, revert\\)`), `${v} has no fallback`);
  }
  assert.match(acc, /theme = \{\}/);
});

test("faq-section stops overriding the open/single behaviour the page asked for", () => {
  const t = target();
  patchStarterComponents(t.root);
  const faq = fs.readFileSync(t.faq, "utf8");

  assert.match(faq, /singleOpen=\{singleOpen\}/);
  assert.match(faq, /openFirst=\{openFirst\}/);
  assert.equal(/singleOpen=\{true\}/.test(faq), false);
});

test("running twice changes nothing the second time", () => {
  const t = target();
  patchStarterComponents(t.root);
  const afterFirst = fs.readFileSync(t.accordion, "utf8");

  const second = patchStarterComponents(t.root);

  assert.deepEqual(second.patched, []);
  assert.equal(
    second.skipped.every((s) => s.reason === "already patched"),
    true
  );
  assert.equal(fs.readFileSync(t.accordion, "utf8"), afterFirst);
});

test("a component customised past recognition is reported, never mangled", () => {
  // Silently doing nothing would leave a theme that is emitted, ignored, and
  // debugged by hand later — saying so is the value.
  const t = target({ accordion: "---\nconst { items } = Astro.props;\n---\n<div>custom</div>\n" });
  const before = fs.readFileSync(t.accordion, "utf8");
  const { patched, skipped } = patchStarterComponents(t.root);

  assert.equal(patched.includes("building-blocks/wrappers/accordion/Accordion.astro"), false);
  assert.match(skipped.find((s) => s.rel.includes("Accordion")).reason, /hand/);
  assert.equal(fs.readFileSync(t.accordion, "utf8"), before);
});

test("a target missing the component is skipped rather than failing the run", () => {
  const t = target({ faq: null });
  const { patched, skipped } = patchStarterComponents(t.root);

  assert.equal(patched.length, 1);
  assert.equal(skipped.find((s) => s.rel.includes("Faq")).reason, "not in target");
});

test("dry run reports what it would do and writes nothing", () => {
  const t = target();
  const before = fs.readFileSync(t.accordion, "utf8");
  const { patched } = patchStarterComponents(t.root, { dryRun: true });

  assert.equal(patched.length, 2);
  assert.equal(fs.readFileSync(t.accordion, "utf8"), before);
});

test("a measured band reaches the section even though it is not a named option", () => {
  // The migrator emits `backgroundColor: "none"` with the real colour in
  // `backgroundColorHex`, because a measured literal is not one of the target's
  // named choices. A component reading only the named prop drops the band — the
  // accordion then renders white beside the grey run it shares a band with.
  const t = target();
  patchStarterComponents(t.root);
  const faq = fs.readFileSync(t.faq, "utf8");

  assert.match(faq, /backgroundColorHex = ""/);
  assert.match(faq, /background-color:\$\{backgroundColorHex\}/);
  // The named prop still wins when no literal was measured.
  assert.match(faq, /backgroundColorHex \? undefined : backgroundColor/);
});
