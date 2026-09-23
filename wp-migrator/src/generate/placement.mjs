/**
 * Which folder a consolidated component belongs in.
 *
 * Derived from the pages that actually use it rather than from its name: the
 * page banner and the breadcrumb each appear on 80+ pages including the
 * homepage, so no name-based rule would file them correctly. A component used
 * by more than one page family is shared by definition.
 */

const LANDING = /^(lp\/|lp\.md$|invisalign-littleton-co|dental-implants-littleton-co|littleton-emergency-dentistry)/;

export const FOLDERS = {
  homepage: "homepage-blocks/wp",
  landing: "landing-pages-blocks",
  interior: "interior-pages-blocks",
  shared: "shared-blocks",
};

function familyOf(pagePath) {
  if (pagePath === "index.md") return "homepage";
  if (LANDING.test(pagePath)) return "landing";
  return "interior";
}

/** `usage`: Map of component name -> Set of page paths. */
export function placeComponent(memberNames, usage) {
  const families = new Set();

  for (const name of memberNames) {
    for (const page of usage.get(name) ?? []) families.add(familyOf(page));
  }
  if (families.size === 0) return FOLDERS.interior; // unused; keep it with the bulk
  if (families.size > 1) return FOLDERS.shared;
  return FOLDERS[[...families][0]];
}

/** Scan the content collection for `_component: page-sections/<ns>/<name>` uses. */
export function collectUsage(pagesDir, namespace, fs, path) {
  const usage = new Map();
  const walk = (dir, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.name.endsWith(".md")) {
        const src = fs.readFileSync(path.join(dir, entry.name), "utf8");
        const re = new RegExp(`_component:\\s*page-sections/${namespace}/([a-z0-9-]+)`, "g");

        for (const m of src.matchAll(re)) {
          if (!usage.has(m[1])) usage.set(m[1], new Set());
          usage.get(m[1]).add(rel);
        }
      }
    }
  };

  walk(pagesDir);
  return usage;
}
