#!/usr/bin/env node
/**
 * Collapse the card-grid / media-prose / prose-block families onto a single
 * parametric content component.
 *
 * The migrator emits one component per section it detects, and a section's
 * *length* is part of what it detects. The same WordPress layout captured with
 * three headings and captured with twenty becomes two components, and no fixed
 * prop list can ever unify them — which is how the Taylor Dental Care migration
 * produced `media-prose-b` through `-i`, `card-grid-home-botox` through
 * `-teeth`, and `prose-block-home-cerec` through `-success`: forty files for
 * one design at forty lengths.
 *
 * This pass reads each family component's markup to recover the ordered block
 * spec it encodes, then rewrites every page that uses it into a `blocks:` array
 * the one parametric component renders.
 *
 *   node bin/collapse-families.mjs           # report what would change
 *   node bin/collapse-families.mjs --apply   # write
 *
 * ## What it refuses to touch
 *
 * An earlier version matched components by directory-name prefix and deleted
 * every match. That is wrong in four ways this version checks for, each of
 * which would have destroyed real design on this site:
 *
 *   1. **Hand-edited components.** The `by wp-migrator` marker is the same
 *      signal `dev-refix` uses. A component someone has rewritten is theirs.
 *   2. **Components with a repeat block.** A `.map()` is a gallery, a team
 *      grid, an hours table, a sitemap — a real widget, not a run of prose at
 *      some length. Generic cards would flatten all four into the same thing.
 *   3. **Components that paint their own band.** A background or a `::before`
 *      overlay on the root means the section is a design in its own right (the
 *      green "Why choose us" band and its counter-numbered list).
 *   4. **Anything still referenced after the rewrite.** Deletion is driven by
 *      what the pages actually point at once they are converted, never by the
 *      list of what was converted. The old version deleted the homepage's
 *      components while deliberately not rewriting the homepage.
 *
 * It also refuses to run at all if the target component does not exist — the
 * previous version would happily rewrite 97 sections onto a component that was
 * never written, which builds and renders nothing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(HERE, "..", "..");
const SECTIONS = path.join(TARGET, "src/components/page-sections");
const PAGES = path.join(TARGET, "src/content/pages");
const NEW_REF = "page-sections/shared-blocks/content-section";
const apply = process.argv.includes("--apply");

// Every migrator-written component is a candidate; what it *is* decides,
// not what it is called.
//
// This used to filter on the `card-grid` / `media-prose` / `prose-block` name
// prefixes, which is the name `nameFromShape` gives a section it recognises.
// A section it does not recognise is named from its words instead — so a plain
// run of prose and a photo on two doctor-profile pages was called
// `home-dr-glenn-taylor` and never even considered, while the identical shape
// next to it was called `media-prose-e` and collapsed. The refusal rules below
// are the real filter and they read the file, so the name can stop mattering.

// The homepage is a bespoke, hand-designed layout rather than a run of
// interchangeable interior sections. Its components are never rewritten.
const KEEP_BESPOKE_PAGES = new Set(["index.md"]);

/** Locate every family component dir, wherever placement put it. */
function findFamilyComponents() {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const astro = fs.readdirSync(full).find((f) => f.endsWith(".astro"));

      if (!astro) {
        walk(full);
        continue;
      }
      // The starter's own components are not this pass's business and would
      // otherwise fill the report with "hand-edited" lines.
      const file = path.join(full, astro);

      if (fs.readFileSync(file, "utf8").includes("by wp-migrator")) {
        found.push({ name: e.name, dir: full, astro: file });
      }
    }
  };
  walk(SECTIONS);
  return found;
}

/**
 * Why a component is not safe to collapse, or null if it is.
 *
 * Each of these is a property of the file, so the decision does not depend on
 * anyone keeping a list up to date as a migration goes along.
 */
function refuseReason(name, source) {
  if (!source.includes("by wp-migrator")) return "hand-edited";
  if (/\.map\(/.test(source)) return "has a repeat block";

  const style = source.split("<style")[1] ?? "";
  // Only the ROOT rule counts. Every component has paint somewhere — the
  // heading's 1px divider, a figure's black backing — and matching any of it
  // refused almost the whole family. The root class is the component's own
  // kebab name; its children all carry the short class prefix instead.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rootRules = [...style.matchAll(new RegExp(`\\.${escaped}(?:::(?:before|after))?\\s*\\{([^}]*)\\}`, "g"))];
  const paints = rootRules.some(([, body]) =>
    /\b(?:background|background-color|background-image)\s*:\s*(?!none|transparent|rgba\(0,\s*0,\s*0,\s*0\))\S/.test(body)
  );

  if (paints) return "paints its own band";
  return null;
}

/**
 * Recover the ordered block spec a component's markup encodes: for each slot,
 * in DOM order, which prop feeds it and what kind of block it is.
 */
function parseSpec(astroSource) {
  const parts = astroSource.split(/^---$/m);
  const body = (parts.length > 2 ? parts.slice(2).join("---") : astroSource).split("<style")[0];
  const spec = [];

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    // image: <img src={prop} alt={altProp}>
    let m = line.match(/<img\b[^>]*\bsrc=\{(\w+)\}[^>]*\balt=\{(\w+)/);
    if (m) {
      spec.push({ kind: "image", srcProp: m[1], altProp: m[2] });
      continue;
    }
    // embed: <iframe src={prop}>
    m = line.match(/<iframe\b[^>]*\bsrc=\{(\w+)\}/);
    if (m) {
      spec.push({ kind: "embed", urlProp: m[1] });
      continue;
    }
    // button: <a href={linkProp}>{textProp}
    m = line.match(/<a\b[^>]*\bhref=\{(\w+)[^>]*>\{(\w+)/);
    if (m) {
      spec.push({ kind: "button", linkProp: m[1], textProp: m[2] });
      continue;
    }
    // heading: <h1..6 ... set:html={prop} /> or >{prop}
    m = line.match(/<(h[1-6])\b[^>]*set:html=\{(\w+)\}/) || line.match(/<(h[1-6])\b[^>]*>\{(\w+)/);
    if (m) {
      spec.push({ kind: "heading", level: Number(m[1][1]), prop: m[2] });
      continue;
    }
    // text slot: p or div with set:html={prop} or >{prop}
    m =
      line.match(/<(p|div)\b[^>]*set:html=\{(\w+)\}/) ||
      line.match(/\{(\w+)\s*&&\s*<(?:p|div)\b[^>]*set:html=\{\1\}/) ||
      line.match(/<(p|div)\b[^>]*>\{(\w+)/);
    if (m) {
      const prop = m[2] ?? m[1];
      spec.push({ prop, kind: "prose" });
    }
  }
  return spec;
}

/**
 * The decorative photo a component bakes into its scoped CSS as a
 * `background-image` rather than carrying as a content prop. Dropping the CSS
 * would drop the photo, so it is lifted to the section's side media.
 */
function bakedBackgroundImage(astroSource) {
  const style = astroSource.split("<style")[1] ?? "";
  const m = style.match(/background-image:\s*url\(["']?(\/wp-content\/[^"')]+)["']?\)/);
  return m ? m[1] : null;
}

/**
 * Which side the figure floats on.
 *
 * DOM order is the honest signal: the source's `.elem-left` puts the figure
 * before the copy it wraps and `.elem-right` puts it after. Guessing from
 * `float`/`text-align` in the emitted CSS read the *heading's* alignment as
 * often as the figure's.
 */
function mediaSide(spec) {
  const image = spec.findIndex((s) => s.kind === "image");
  const prose = spec.findIndex((s) => s.kind === "prose");

  if (image === -1) return "right";
  return prose === -1 || image < prose ? "left" : "right";
}

/**
 * Is this section centred (a page intro) rather than left-aligned (a body)?
 *
 * Read off the *prose* rule, never off "is `text-align: center` anywhere in
 * the file". Every one of these components centres its `<h1>` — the source
 * does that to the page title on every page — so the loose test called whole
 * pages of left-aligned body copy centred.
 */
function sectionAlign(astroSource) {
  const style = astroSource.split("<style")[1] ?? "";
  const proseRules = [...style.matchAll(/\.[a-z][\w-]*-(?:text|body)\d*\s*\{([^}]*)\}/g)];

  if (proseRules.length === 0) return "left";
  return proseRules.every(([, body]) => /text-align:\s*center/.test(body)) ? "center" : "left";
}

/**
 * A breadcrumb is chrome the template already renders; carrying the migrated
 * copy across gives every interior page two of them.
 *
 * Matched on the *text*, with tags stripped first. Testing the raw html only
 * caught the trails whose "Home" was not wrapped — `<span><span><a>Home</a>
 * </span> » …` has two closing tags between the word and the separator, so the
 * pattern missed it and four doctor and service pages kept a second trail.
 */
const isBreadcrumb = (html) => {
  if (typeof html !== "string") return false;
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /^home\s*(»|›|&raquo;|>|\/)/i.test(text);
};

/**
 * Turn a page section's flat props into the `blocks` / `media` shape, following
 * the component's own slot order.
 */
function toBlocks(spec, props, { bgImage, side }) {
  const blocks = [];
  let media = null;
  let pendingButtons = null;

  const flushButtons = () => {
    if (pendingButtons?.buttons.length) blocks.push(pendingButtons);
    pendingButtons = null;
  };

  const embedSpec = spec.find((s) => s.kind === "embed");

  if (embedSpec && props[embedSpec.urlProp]) {
    media = { type: "embed", url: props[embedSpec.urlProp], side };
  }

  for (const s of spec) {
    if (s.kind === "embed") continue;

    if (s.kind === "button") {
      const text = props[s.textProp];
      if (text == null || text === "") continue;
      pendingButtons ??= { type: "buttons", buttons: [] };
      pendingButtons.buttons.push({ text, link: props[s.linkProp] ?? "#" });
      continue;
    }

    flushButtons();

    if (s.kind === "image") {
      const source = props[s.srcProp];
      if (!source) continue;
      // A logo is chrome, never body content.
      if (/logo/i.test(String(source))) continue;

      // The image stays at the point in the run where it was, floated. One
      // converted section can hold several of the source's sections, so
      // hoisting the first image to the top put it above headings it belonged
      // under — and the heading after it then cleared the float, dropping the
      // copy that was supposed to wrap beside it below the photo instead.
      blocks.push({ type: "image", source, alt: props[s.altProp] ?? "", side });
      continue;
    }

    const val = props[s.prop];
    if (val == null || val === "") continue;

    if (s.kind === "heading") {
      if (isBreadcrumb(val)) continue;
      const block = { type: "heading", html: String(val) };
      if (s.level === 1) block.level = 1;
      blocks.push(s.level >= 3 ? { type: "subheading", html: String(val) } : block);
      continue;
    }

    if (isBreadcrumb(val)) continue;
    blocks.push({ type: "prose", html: String(val) });
  }
  flushButtons();

  // A photo the component baked into its CSS leads the run.
  if (bgImage) blocks.unshift({ type: "image", source: bgImage, alt: "", side });
  return { blocks, media };
}

// ---------------------------------------------------------------------------

if (!fs.existsSync(path.join(TARGET, "src/components", NEW_REF.replace(/^page-sections/, "page-sections")))) {
  console.error(`target component missing: ${NEW_REF}`);
  console.error("Write it before collapsing — rewriting pages onto a component that does not exist builds a blank site.");
  process.exit(1);
}

const components = findFamilyComponents();
const convertible = new Map();
const refused = [];

for (const c of components) {
  const src = fs.readFileSync(c.astro, "utf8");
  const reason = refuseReason(c.name, src);

  if (reason) {
    refused.push({ name: c.name, reason });
    continue;
  }
  const spec = parseSpec(src);

  if (spec.length === 0) {
    refused.push({ name: c.name, reason: "no readable slots" });
    continue;
  }
  // Prose or a heading is what makes a run *content*. A section that is only a
  // photo is a banner, and one that is only a button is a widget.
  if (!spec.some((slot) => slot.kind === "prose" || slot.kind === "heading")) {
    refused.push({ name: c.name, reason: "no prose — a banner or a widget" });
    continue;
  }
  convertible.set(c.name, {
    spec,
    bgImage: bakedBackgroundImage(src),
    side: mediaSide(spec),
    align: sectionAlign(src),
  });
}

let pageCount = 0;
let sectionCount = 0;
const report = [];
const stillUsed = new Set();

for (const file of fs.readdirSync(PAGES).filter((f) => f.endsWith(".md"))) {
  const full = path.join(PAGES, file);
  const rawText = fs.readFileSync(full, "utf8");
  const fmMatch = rawText.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) continue;
  const data = YAML.parse(fmMatch[1]);
  if (!Array.isArray(data.pageSections)) continue;

  const bespoke = KEEP_BESPOKE_PAGES.has(file);
  let touched = false;

  data.pageSections = data.pageSections.map((section) => {
    const comp = String(section?._component ?? "").split("/").pop();

    if (!convertible.has(comp) || bespoke) {
      if (comp) stillUsed.add(comp);
      return section;
    }

    const { spec, bgImage, side, align } = convertible.get(comp);
    const { blocks, media } = toBlocks(spec, section, { bgImage, side });

    // A section that converts to nothing is a section that would vanish.
    if (blocks.length === 0 && !media) {
      stillUsed.add(comp);
      return section;
    }

    const next = { _component: NEW_REF, id: section.id ?? "", align, blocks };
    if (media) next.media = media;

    // Colours are deliberately NOT carried across. The old per-section props
    // were one colour for the whole component, but the design is not: the page
    // title is navy and the section headings under it are teal with a teal
    // rule. Copying the captured `headingColorHex` onto the parametric
    // component paints all of them — and their dividers — the title's colour.
    // The target already encodes the source's scale; a colour belongs here only
    // when the section is a band, and bands are refused above.
    if (section.backgroundColorHex) next.backgroundColor = section.backgroundColorHex;
    touched = true;
    sectionCount++;
    return next;
  });

  if (touched) {
    pageCount++;
    report.push(`  ${file}`);
    if (apply) {
      const yamlOut = YAML.stringify(data, { lineWidth: 0 });
      fs.writeFileSync(full, `---\n${yamlOut}---\n${fmMatch[2]}`);
    }
  }
}

console.log(`family components found: ${components.length}`);
console.log(`convertible: ${convertible.size}`);
console.log(`refused: ${refused.length}`);
for (const r of refused) console.log(`  ${r.name} — ${r.reason}`);
console.log(`\npages rewritten: ${pageCount}, sections: ${sectionCount}`);
report.forEach((r) => console.log(r));

// Deletion follows what the pages point at now, never the conversion list.
const removable = [...convertible.keys()].filter((n) => !stillUsed.has(n));
const retained = [...convertible.keys()].filter((n) => stillUsed.has(n));

console.log(`\nunreferenced after rewrite: ${removable.length}`);
if (retained.length) console.log(`still referenced, kept: ${retained.join(", ")}`);

if (apply) {
  for (const c of components) {
    if (removable.includes(c.name)) fs.rmSync(c.dir, { recursive: true, force: true });
  }
  console.log(`removed ${removable.length} component dirs`);
} else {
  console.log("\ndry run — pass --apply to write");
}
