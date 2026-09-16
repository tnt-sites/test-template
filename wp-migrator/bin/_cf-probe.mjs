#!/usr/bin/env node
/**
 * Collapse the card-grid / media-prose / prose-block families onto a single
 * parametric `content-section` component.
 *
 * The migrator emits one component per detected section, so a run of headings
 * and prose captured at 3 blocks and the same run captured at 20 blocks become
 * two components — `prose-block-reviews` and `prose-block-services` — that a
 * fixed prop list can never unify. They are the same shape at different lengths. This pass
 * reads each family component's markup to recover the ordered block spec it
 * encodes, then rewrites every page that uses it into a `blocks:` array the one
 * parametric component renders.
 *
 *   node bin/collapse-families.mjs           # report
 *   node bin/collapse-families.mjs --apply   # write
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
const apply = false;

// Matched as an exact name or as a `<family>-<qualifier>` prefix, so this
// tracks whatever `nameFromShape` emits. `prose-section` stays listed because
// output generated before the rename still uses it.
const FAMILIES = ["card-grid", "media-prose", "prose-block", "prose-section"];

// Locate every family component dir, wherever placement put it.
function findFamilyComponents() {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const isFamily = FAMILIES.some((f) => e.name === f || e.name.startsWith(f + "-"));
      if (isFamily && fs.existsSync(full)) {
        const astro = fs.readdirSync(full).find((f) => f.endsWith(".astro"));
        if (astro) found.push({ name: e.name, dir: full, astro: path.join(full, astro) });
      } else {
        walk(full);
      }
    }
  };
  walk(SECTIONS);
  return found;
}

/**
 * Recover the ordered block spec a component's markup encodes: for each slot,
 * in DOM order, which prop feeds it and what kind of block it is.
 */
function parseSpec(astroSource) {
  const parts = astroSource.split(/^---$/m);
  const body = (parts.length > 2 ? parts.slice(2).join("---") : astroSource).split("<style")[0];
  const spec = [];
  let cardIndex = 0;
  // A repeat block (`{items.map(it => (…))}`) renders an array prop. Emit one
  // `cards` block for it and skip its body — whose `it.title`/`it.text` slots
  // would otherwise be mis-read as scalar props — until the map closes (`))`).
  let inMap = false;

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (inMap) {
      if (/\)\s*\)/.test(line) || /^\)\s*\}/.test(line)) inMap = false;
      continue;
    }
    if (/(\w+)\.map\(/.test(line)) {
      spec.push({ kind: "cards", index: cardIndex++ });
      inMap = true;
      continue;
    }
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
      spec.push({ kind: "heading", prop: m[2] });
      continue;
    }
    // text slot: p or div with set:html={prop} or >{prop}
    m =
      line.match(/<(p|div)\b[^>]*set:html=\{(\w+)\}/) ||
      line.match(/\{(\w+)\s*&&\s*<(?:p|div)\b[^>]*set:html=\{\1\}/) ||
      line.match(/<(p|div)\b[^>]*>\{(\w+)/);
    if (m) {
      const prop = m[2] ?? m[1];
      spec.push({ prop, kind: prop === "eyebrow" ? "eyebrow" : "prose" });
      continue;
    }
    // bare eyebrow guard: {eyebrow && <p ...>{eyebrow}
    m = line.match(/\{(eyebrow)\s*&&/);
    if (m) spec.push({ kind: "eyebrow", prop: m[1] });
  }
  return { spec };
}

/**
 * Turn a page section's flat props into the `blocks`/`media` shape, following
 * the component's own slot order. The embed (a booking form) and the first
 * image become the side rail; the rest of the content stays in the column.
 */
function normalizeCard(it) {
  const card = {};
  if (it.title != null) card.title = String(it.title);
  else if (it.heading != null) card.title = String(it.heading);
  else if (it.name != null) card.title = String(it.name);
  if (it.text != null) card.text = String(it.text);
  const buttons = [];
  if (it.buttonText) buttons.push({ text: it.buttonText, link: it.buttonLink || "#" });
  if (buttons.length) card.buttons = buttons;
  return card;
}

const isLogo = (src) => typeof src === "string" && /logo/i.test(src);

function toBlocks(spec, props, bgImage) {
  const blocks = [];
  let media = null;
  let pendingButtons = null;
  // Array props feed the repeat blocks in the order they were destructured.
  const arrayProps = ["items", "items2", "images", "list"].filter((k) => Array.isArray(props[k]));
  const flushButtons = () => {
    if (pendingButtons?.buttons.length) blocks.push(pendingButtons);
    pendingButtons = null;
  };

  // The migrator fuses the body content and the booking-form card of a service
  // page into one section. When the section carries an embed, that embed — with
  // the heading and button that label it — is the form card, and belongs in the
  // rail; the prose and images are the real page content and stay in the column.
  const embedSpec = spec.find((s) => s.kind === "embed");
  const hasForm = embedSpec && props[embedSpec.urlProp];
  if (hasForm) {
    // The form card's own heading is a booking prompt ("Need to schedule…?");
    // a real content heading ("Why choose implants?") belongs in the column.
    // Prefer the prompt so the content heading is not pulled into the rail.
    const isFormPrompt = (v) => /schedule|question|appointment|book|contact/i.test(String(v));
    const headingSpec =
      spec.find((s) => s.kind === "heading" && props[s.prop] && isFormPrompt(props[s.prop])) ||
      spec.find((s) => s.kind === "heading" && props[s.prop]);
    const buttonSpec = spec.find((s) => s.kind === "button" && props[s.textProp]);
    const logoSpec = spec.find((s) => s.kind === "image" && isLogo(props[s.srcProp]));
    media = {
      type: "embed",
      url: props[embedSpec.urlProp],
      title: headingSpec ? String(props[headingSpec.prop]) : "",
    };
    if (logoSpec) media.logo = props[logoSpec.srcProp];
    if (buttonSpec)
      media.button = { text: props[buttonSpec.textProp], link: props[buttonSpec.linkProp] ?? "#" };
  }

  for (const s of spec) {
    if (s.kind === "cards") {
      flushButtons();
      const arr = props[arrayProps[s.index]];
      if (Array.isArray(arr) && arr.length) {
        blocks.push({ type: "cards", items: arr.map(normalizeCard) });
      }
      continue;
    }
    if (s.kind === "embed") continue; // handled by the form-card routing above
    if (s.kind === "button") {
      // A form's button is spoken for by the rail; other buttons stay in flow.
      if (hasForm && media.button && props[s.textProp] === media.button.text) continue;
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
      // A logo is chrome, not page content: it belongs to the form card (set
      // above) or is dropped — never inlined into the body as a stray graphic.
      if (isLogo(source)) continue;
      const alt = props[s.altProp] ?? "";
      // With no form card, the first content image becomes the rail; else inline.
      if (!media) media = { type: "image", source, alt };
      else blocks.push({ type: "image", source, alt });
      continue;
    }
    const val = props[s.prop];
    if (val == null || val === "") continue;
    // The form card already carries its heading; don't repeat it in the column.
    if (hasForm && s.kind === "heading" && media.title === String(val)) continue;
    if (s.kind === "eyebrow") blocks.push({ type: "eyebrow", html: String(val) });
    else if (s.kind === "heading") blocks.push({ type: "heading", html: String(val) });
    else blocks.push({ type: "prose", html: String(val) });
  }
  flushButtons();
  // A photo the component baked into its CSS becomes a side image on the
  // column — the reviews strip and the intro sections carry their photo here.
  if (bgImage && !media) media = { type: "image", source: bgImage, alt: "", side: "left" };
  return { blocks, media };
}

/**
 * The decorative photo a component bakes into its scoped CSS as a
 * `background-image`, rather than carrying as a content prop. The reviews strip
 * and several intro sections put their photo here, in a two-column layout — so
 * dropping the CSS would drop the photo. Lifted to a side-image on the column.
 */
function bakedBackgroundImage(astroSource) {
  const style = astroSource.split("<style")[1] ?? "";
  const m = style.match(/background-image:\s*url\(["']?(\/wp-content\/[^"')]+)["']?\)/);
  return m ? m[1] : null;
}

const components = findFamilyComponents();
const specs = new Map();
const bgImages = new Map();
for (const c of components) {
  const src = fs.readFileSync(c.astro, "utf8");
  specs.set(c.name, parseSpec(src).spec);
  const bg = bakedBackgroundImage(src);
  if (bg) bgImages.set(c.name, bg);
}

// Rewrite pages.
let pageCount = 0;
let sectionCount = 0;
const report = [];

// The homepage is a bespoke, hand-designed layout, not a run of interchangeable
// interior-page sections — it keeps its own components and is never collapsed.
const KEEP_BESPOKE = new Set(["index.md"]);

for (const file of fs.readdirSync(PAGES).filter((f) => f.endsWith(".md") && !KEEP_BESPOKE.has(f))) {
  const full = path.join(PAGES, file);
  const rawText = fs.readFileSync(full, "utf8");
  const fmMatch = rawText.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) continue;
  const data = YAML.parse(fmMatch[1]);
  if (!Array.isArray(data.pageSections)) continue;

  let touched = false;
  data.pageSections = data.pageSections.map((section) => {
    const comp = String(section?._component ?? "")
      .split("/")
      .pop();
    if (!specs.has(comp)) return section;

    const { blocks, media } = toBlocks(specs.get(comp), section, bgImages.get(comp));
    const next = {
      _component: NEW_REF,
      id: section.id ?? "",
      blocks,
    };
    if (media) next.media = media;
    for (const k of ["backgroundColor", "eyebrowColor", "headingColor", "textColor"]) {
      if (section[k]) next[k] = section[k];
    }
    touched = true;
    sectionCount++;
    return next;
  });

  if (touched) {
    if (file === (process.env.DUMP_PAGE || "")) console.log(YAML.stringify(data, { lineWidth: 0 }));
    pageCount++;
    report.push(`  ${file}`);
    if (apply) {
      const yamlOut = YAML.stringify(data, { lineWidth: 0 });
      fs.writeFileSync(full, `---\n${yamlOut}---\n${fmMatch[2]}`);
    }
  }
}

console.log(`family components found: ${components.length}`);
console.log(`converted: ${specs.size} family components`);
console.log(`pages rewritten: ${pageCount}, sections: ${sectionCount}`);
report.forEach((r) => console.log(r));

if (apply) {
  for (const c of components) {
    fs.rmSync(c.dir, { recursive: true, force: true });
  }
  console.log(`\nremoved ${specs.size} component dirs`);
} else {
  console.log("\ndry run — pass --apply to write");
}
