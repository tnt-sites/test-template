/**
 * Checks over the emitted components themselves, rather than over a render.
 *
 * Some of the worst defects on this migration were invisible to any DOM
 * comparison, because every page rendered exactly what its own component said.
 * What was wrong was the set of components:
 *
 *   - The site's one closing call-to-action came out as **seven** components
 *     across 36 pages, because the pages around it segmented differently. Six
 *     of them were missing the background photo and the map, and each had to be
 *     found and fixed separately. The interior page banner came out four times.
 *     `collapse-families.mjs` exists to merge these, but nothing reported that
 *     they were there.
 *   - Two components could claim the same class prefix. `initialsOf` truncates
 *     to four letters, so `media-prose-what` and `media-prose-who` were both
 *     `mpw` — 74 colliding class names across 19 components. Astro scopes each
 *     component's styles, so every page still rendered correctly; what broke
 *     was `dev-refix`, which maps a class to one owning file and therefore
 *     corrected one component of each pair using the other's measurements.
 *   - A full-bleed `<a>` overlay is invisible by design (`opacity: 0`), but its
 *     captured `:hover` state carried a background colour. On hover it painted
 *     the whole card flat lime.
 *
 * These are properties of the files, so they are checked by reading the files.
 */

import fs from "node:fs";
import path from "node:path";
import { markupTokens, similarity } from "../generate/structure-hash.mjs";

/** Every migrator-written component under `root`, as {file, name, source}. */
export function migratedComponents(root) {
  const out = [];

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".astro")) continue;
      const source = fs.readFileSync(full, "utf8");

      if (!source.includes("by wp-migrator")) continue;
      out.push({ file: full, name: entry.name, source });
    }
  };

  walk(root);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const PREFIXED =
  /^([a-z]{2,6})-(?:box|heading|text|body|media|btn|link|grid|spacer|decor|embed|item|list|label|title|cta)\d*$/;

/**
 * Class prefixes claimed by more than one component.
 *
 * No DOM detector can see this: scoped styles keep every page rendering.
 */
export function prefixCollisions(components) {
  const byPrefix = new Map();

  for (const { name, source } of components) {
    for (const m of source.matchAll(/\bclass="([^"{]+)"/g)) {
      for (const cls of m[1].trim().split(/\s+/)) {
        const hit = PREFIXED.exec(cls);

        if (!hit) continue;
        if (!byPrefix.has(hit[1])) byPrefix.set(hit[1], new Set());
        byPrefix.get(hit[1]).add(name);
      }
    }
  }

  return [...byPrefix.entries()]
    .filter(([, files]) => files.size > 1)
    .map(([prefix, files]) => ({ prefix, files: [...files].sort() }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/**
 * Groups of components that are the same section wearing different names.
 *
 * Compared on markup shape only (`markupTokens`), for the reason that module
 * documents: the per-instance wall of measured CSS otherwise drowns out the
 * element structure that decides whether two files are the same widget.
 */
export function duplicateFamilies(components, { threshold = 0.9, maxCompare = 400 } = {}) {
  const items = components.slice(0, maxCompare).map((c) => ({ ...c, tokens: markupTokens(c.source) }));
  const groupOf = new Map();
  const groups = [];

  for (let i = 0; i < items.length; i += 1) {
    if (groupOf.has(items[i].name)) continue;
    const group = [items[i].name];

    for (let j = i + 1; j < items.length; j += 1) {
      if (groupOf.has(items[j].name)) continue;
      // A cheap length check first: two token streams that differ in size by
      // more than the threshold allows can never reach it.
      const ceiling =
        (2 * Math.min(items[i].tokens.length, items[j].tokens.length)) /
        (items[i].tokens.length + items[j].tokens.length);

      if (ceiling < threshold) continue;
      if (similarity(items[i].tokens, items[j].tokens) >= threshold) group.push(items[j].name);
    }
    if (group.length > 1) {
      for (const name of group) groupOf.set(name, groups.length);
      groups.push(group);
    }
  }

  return groups;
}

/**
 * Invisible overlays that paint on hover.
 *
 * The source's card links are a full-bleed `<a>` held at `opacity: 0` — a hit
 * target, nothing more. The capture reads its `:hover` state like any other
 * and emits the background colour it found, so hovering the card filled it
 * solid. The signature is a rule whose base state is invisible and whose hover
 * state sets paint.
 */
export function hoverFillOnInvisibleOverlay(components) {
  const found = [];

  for (const { name, source } of components) {
    const rules = new Map();

    for (const m of source.matchAll(/(?:^|\n)\s*(:?global\()?\s*\.([a-z0-9-]+)\)?\s*(:hover)?\s*\{([^}]*)\}/g)) {
      const cls = m[2];
      const hover = Boolean(m[3]);
      const decls = Object.fromEntries(
        [...m[4].matchAll(/([-a-z]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()])
      );

      if (!rules.has(cls)) rules.set(cls, { base: {}, hover: {} });
      Object.assign(rules.get(cls)[hover ? "hover" : "base"], decls);
    }

    for (const [cls, { base, hover }] of rules) {
      const invisible = base.opacity === "0" || base["font-size"] === "0px";
      const paints =
        (hover["background-color"] && hover["background-color"] !== "transparent") ||
        (hover["background"] && !/none/.test(hover["background"]));

      // A hover that only restores opacity is the reveal the source intended;
      // one that fills the box is the artefact.
      if (invisible && paints) found.push({ name, cls, fill: hover["background-color"] || hover.background });
    }
  }

  return found;
}
