import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

/**
 * Propose a component for a cluster the operator has not mapped yet.
 *
 * Every site arrives with its own set of sections, so the toolkit cannot ship a
 * table of known patterns. Instead it reads what the target library can
 * actually hold — the props each component declares — and ranks components by
 * how well they fit what the cluster contains. The operator still decides; this
 * turns "here are eleven unmapped clusters" into a shortlist per cluster.
 */

/** Props that indicate a component can hold a given kind of content. */
const CAPABILITY_PROPS = {
  heading: ["heading", "title", "eyebrowHeading"],
  text: ["subtext", "body", "description", "text", "content"],
  image: ["imageSource", "image", "imageSrc", "media"],
  buttons: ["buttonSections", "buttons"],
  items: ["items", "cards", "links", "listItems", "people", "faqs"],
  embed: ["youtubeId", "embedUrl", "mapEmbedUrl", "videoId"],
};

/**
 * Props that mark a component as built for one job.
 *
 * A component carrying these is specialised: it is a form, a carousel, a map.
 * Matching a plain content block to one produces frontmatter that renders a
 * form action or a slider around ordinary copy, which reads as a deliberate
 * choice rather than a mismatch.
 */
const SPECIALTY_PROPS = {
  form: ["formAction", "fields", "formBlocks", "submitLabel", "recaptchaSiteKey"],
  carousel: ["autoPlay", "autoplayDelay", "slidesPerView", "showDots", "showArrows"],
  map: ["mapEmbedUrl", "mapUrl", "latitude"],
  video: ["youtubeId", "videoId", "videoUrl"],
  accordion: ["faqs", "questions"],
};

/** What a cluster's own markup says it is. */
const SPECIALTY_ROLES = {
  form: (c) => c.features?.hasForm || (c.roleSequence ?? []).includes("FORM"),
  carousel: (c) => c.features?.hasCarousel || (c.roleSequence ?? []).includes("CAROUSEL"),
  map: (c) => c.features?.hasMap,
  video: (c) => c.features?.hasEmbed || (c.roleSequence ?? []).includes("EMBED"),
  accordion: (c) => c.features?.hasAccordion || (c.roleSequence ?? []).includes("ACCORDION"),
};

/** Role tokens mapped onto the capability they need. */
const ROLE_CAPABILITY = {
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  P: "text",
  QUOTE: "text",
  IMG: "image",
  PICTURE: "image",
  BTN: "buttons",
  LIST: "items",
  EMBED: "embed",
  CAROUSEL: "items",
  ACCORDION: "items",
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Read every component the library offers, with the props it declares. */
export function loadComponentCatalog(componentsDir, { include = ["page-sections"] } = {}) {
  const catalog = [];

  for (const file of walk(componentsDir)) {
    if (!file.endsWith(".cloudcannon.structure-value.yml")) continue;

    const rel = path.relative(componentsDir, file);
    if (include.length && !include.some((prefix) => rel.startsWith(prefix))) continue;

    let doc;
    try {
      doc = YAML.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!doc?.value?._component) continue;

    const props = Object.keys(doc.value);
    const capabilities = new Set();
    for (const [capability, names] of Object.entries(CAPABILITY_PROPS)) {
      if (names.some((n) => props.includes(n))) capabilities.add(capability);
    }

    // Detect a repeater from its shape rather than its name. Templates call
    // these `items`, `cards`, `features`, `people`, whatever suits — but they
    // all seed an array of objects, and that is what actually distinguishes a
    // component that renders a list from one that renders a single block.
    for (const [prop, value] of Object.entries(doc.value)) {
      if (prop === "buttonSections") continue; // buttons are their own capability
      // Any array-valued prop is a repeater slot. Checking for objects inside
      // misses the common case of a component seeded with an empty list.
      if (Array.isArray(value)) capabilities.add("items");
    }

    const specialties = new Set();
    for (const [specialty, names] of Object.entries(SPECIALTY_PROPS)) {
      if (names.some((n) => props.includes(n))) specialties.add(specialty);
    }

    catalog.push({
      component: doc.value._component,
      label: doc.label ?? doc.value._component,
      props,
      capabilities,
      specialties,
    });
  }

  return catalog;
}

/** Distinct capabilities a cluster's content needs. */
export function clusterCapabilities(cluster) {
  const needed = new Set();
  for (const token of cluster.roleSequence ?? []) {
    const base = token.replace(/x\{[^}]*\}$/, "").replace(/\([^)]*\)$/, "");
    const capability = ROLE_CAPABILITY[base];
    if (capability) needed.add(capability);
  }
  if (cluster.features?.hasCarousel) needed.add("items");
  if (cluster.features?.hasAccordion) needed.add("items");
  if (cluster.features?.hasEmbed) needed.add("embed");
  return needed;
}

/**
 * Components built to open a page.
 *
 * Named by convention across component libraries — a hero, a banner, a
 * masthead — and structurally indistinguishable from a mid-page block, so the
 * name is what identifies them.
 */
const LEADING_COMPONENT = /\b(hero|banner|masthead|jumbotron)\b/i;

/** Shared words between a cluster's name and a component's, ignoring noise. */
function nameAffinity(clusterId, component) {
  const stop = new Set(["page", "sections", "section", "block", "blocks", "the", "and"]);
  const words = (text) =>
    new Set(
      String(text)
        .split(/[^a-z0-9]+/i)
        .map((w) => w.toLowerCase())
        .filter((w) => w.length > 2 && !stop.has(w))
    );

  const a = words(clusterId);
  const b = words(component);
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / a.size;
}

/**
 * Rank components for a cluster.
 *
 * Coverage dominates: a component that cannot hold the cluster's images or
 * buttons will silently drop them, which is worse than a less obvious name.
 * Components offering far more than the cluster needs are penalised lightly, so
 * a simple heading block is not matched to an elaborate one.
 */
export function suggestComponents(cluster, catalog, { limit = 3 } = {}) {
  const needed = clusterCapabilities(cluster);
  if (catalog.length === 0) return [];

  const scored = catalog.map((entry) => {
    let covered = 0;
    for (const capability of needed) if (entry.capabilities.has(capability)) covered++;

    const coverage = needed.size ? covered / needed.size : 0;
    const excess = Math.max(0, entry.capabilities.size - needed.size);
    const affinity = nameAffinity(cluster.id, entry.component);

    // A specialised component matched to content that is not that thing is a
    // worse outcome than a plainer component that simply holds less.
    let mismatch = 0;
    for (const specialty of entry.specialties ?? []) {
      const wanted = SPECIALTY_ROLES[specialty]?.(cluster) ?? false;
      if (!wanted) mismatch += 1;
    }

    // A repeater handed a single block renders one item, or an empty list.
    // That is a structural mismatch, not merely an unused prop.
    if (entry.capabilities.has("items") && !needed.has("items")) mismatch += 0.6;

    // Match page-opening content to page-opening components, and keep them away
    // from everything else — a hero used mid-page reads as a mistake.
    //
    // Scaled by how often the cluster's members actually open a page rather
    // than gated on a threshold: a cluster drawn from several page layouts is
    // partly leading, and that is still a strong signal.
    const leadingShare = cluster.leadingShare ?? 0;
    const position = LEADING_COMPONENT.test(entry.component)
      ? (leadingShare - 0.2) * 0.7
      : 0;

    const score =
      coverage * 0.7 + affinity * 0.3 - excess * 0.03 - mismatch * 0.35 + position;

    return {
      component: entry.component,
      label: entry.label,
      score: Number(score.toFixed(3)),
      covers: [...needed].filter((c) => entry.capabilities.has(c)),
      missing: [...needed].filter((c) => !entry.capabilities.has(c)),
    };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** A ready-to-paste `component-map.yml` fragment for unmapped clusters. */
export function renderSuggestions(clusters, catalog) {
  const lines = [];

  for (const cluster of clusters) {
    const suggestions = suggestComponents(cluster, catalog);
    lines.push(`  # ${cluster.id} — ${cluster.members.length} section(s) on ${cluster.pages.length} page(s)`);
    lines.push(`  #   structure: ${(cluster.roleSequence ?? []).join(" ") || "(empty)"}`);

    if (suggestions.length === 0) {
      lines.push(`  #   no component in the library covers this; it may need building`);
      lines.push(`  # ${cluster.id}: { component: ??? }`);
    } else {
      for (const s of suggestions.slice(1)) {
        lines.push(`  #   alternative: ${s.component}${s.missing.length ? ` (cannot hold: ${s.missing.join(", ")})` : ""}`);
      }
      const best = suggestions[0];
      if (best.missing.length) {
        lines.push(`  #   note: cannot hold ${best.missing.join(", ")} — that content is preserved on the page`);
      }

      // Where a cluster's members disagree about having an image, one component
      // cannot serve both: a split layout with no image leaves a gap, a centred
      // one drops the image entirely. Emit the pair and let the feature decide.
      const withoutImage = suggestions.find(
        (s) => s.component !== best.component && !s.covers.includes("image")
      );
      const imageVaries = Object.keys(cluster.variance?.imageCount ?? {}).some((v) => v === "0");

      if (imageVaries && best.covers.includes("image") && withoutImage) {
        lines.push(`  #   image present on some members only — variants chosen per section`);
        lines.push(`  ${cluster.id}:`);
        lines.push(`    variants:`);
        lines.push(`      - when: { imageCount: ["1", "2", "3+"] }`);
        lines.push(`        component: ${best.component}`);
        lines.push(`      - component: ${withoutImage.component}`);
      } else {
        lines.push(`  ${cluster.id}:`);
        lines.push(`    component: ${best.component}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
