import fs from "node:fs";
import path from "node:path";

/**
 * Keep generated content from referencing icons the target cannot resolve.
 *
 * A component's structure-value seeds example props, and those examples can name
 * an icon that is not actually in the icon set — harmless when an editor inserts
 * one block by hand and notices, fatal when a migration copies the same default
 * into every page and the build dies on the first render.
 *
 * Unknown names are swapped for the closest real icon where one is obvious, and
 * cleared otherwise. Emitting content that fails to build is never the better
 * outcome.
 */

const ICON_KEYS = /^(iconName|icon)$/;

export function loadIconSet(iconsDir) {
  if (!fs.existsSync(iconsDir)) return null;
  return new Set(
    fs
      .readdirSync(iconsDir)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.replace(/\.svg$/, ""))
  );
}

/**
 * Find a stand-in for an unresolvable icon name by matching on the meaningful
 * word — `stylised-check` becomes `check` rather than nothing.
 */
export function nearestIcon(name, iconSet) {
  if (!name || iconSet.has(name)) return name;

  const words = name.split(/[-_\s]+/).filter(Boolean);

  for (let i = words.length; i > 0; i--) {
    const candidate = words.slice(-i).join("-");
    if (iconSet.has(candidate)) return candidate;
  }
  for (const word of [...words].reverse()) {
    const match = [...iconSet].find((icon) => icon === word || icon.endsWith(`-${word}`));
    if (match) return match;
  }
  return "";
}

/**
 * Walk generated blocks and repair every icon reference.
 * Returns what was changed so the run can report it rather than fixing silently.
 */
export function validateIcons(blocks, iconSet) {
  if (!iconSet) return { replaced: [], cleared: [] };

  const replaced = [];
  const cleared = [];

  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && ICON_KEYS.test(key)) {
        if (!value || iconSet.has(value)) continue;
        const substitute = nearestIcon(value, iconSet);
        node[key] = substitute;
        if (substitute) replaced.push({ from: value, to: substitute });
        else cleared.push(value);
      } else {
        walk(value);
      }
    }
  };

  walk(blocks);
  return { replaced, cleared };
}

export function iconsDirFor(targetRoot) {
  return path.join(targetRoot, "src/icons");
}
