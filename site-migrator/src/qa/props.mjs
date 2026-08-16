import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

/**
 * Static checks over the frontmatter `mig content` wrote.
 *
 * Everything else in `qa` renders both sides and measures them. These two
 * faults are visible in the content alone, need no build, and are cheap enough
 * to run on every page of the site rather than the one page being compared —
 * which matters, because both of them reproduce identically across every page
 * that shares a section pattern, and the operator only ever compares one.
 *
 * Both come from the same place: `map-to-component` fills a target component's
 * props from a source section's measured features, and neither of these is a
 * feature it can sanity-check on its own.
 */

/** Every `*.md` under the content dir, with its parsed frontmatter. */
function readPages(contentDir) {
  const pages = [];

  const walk = (dir) => {
    let entries;

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
        const raw = fs.readFileSync(full, "utf8");
        const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);

        if (!match) continue;
        try {
          const data = YAML.parse(match[1]);

          if (data && typeof data === "object") pages.push({ file: full, data });
        } catch {
          /* a page that will not parse is the build's problem, not this pass's */
        }
      }
    }
  };

  walk(contentDir);
  return pages;
}

/** Section entries on a page, from whichever array key the preset uses. */
function sectionsOf(data, key = "pageSections") {
  const list = data?.[key];

  return Array.isArray(list) ? list.filter((s) => s && typeof s === "object") : [];
}

/**
 * Ids that a component in the template *owns* — its styles are scoped under
 * them, so the id is load-bearing rather than an anchor name.
 *
 * A hand-ported bespoke section keeps the source's own id precisely so the
 * source's CSS applies to it unchanged, and every rule in the component's style
 * block is written `#interior-banner …`. That makes the id a reliable marker of
 * "this component exists to reproduce that source section".
 */
export function readOwnedIds(componentsDir) {
  const owned = new Map();

  const walk = (dir) => {
    let entries;

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".astro")) {
        const raw = fs.readFileSync(full, "utf8");
        const styles = [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
          .map((m) => m[1])
          .join("\n");

        if (!styles) continue;

        // Count distinct rules per id: a single `#foo` on one rule is an anchor
        // target or a one-off nudge. A component that *owns* an id styles many
        // things under it.
        const counts = new Map();

        for (const [, id] of styles.matchAll(/#([a-zA-Z][\w-]*)\b(?=[^{}]*\{)/g)) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        for (const [id, count] of counts) {
          if (count < 3) continue;
          if (!owned.has(id)) owned.set(id, []);
          owned.get(id).push(full);
        }
      }
    }
  };

  walk(componentsDir);
  return owned;
}

/**
 * A page setting a bespoke component's id on some *other* component.
 *
 * This is what a generic mapping looks like after the fact. `mig content`
 * carries the source section's id into the target component's `id` prop, so a
 * source `<div id="interior-banner">` mapped onto the library's `hero-center`
 * produces `_component: heroes/hero-center` with `id: interior-banner`. The
 * page then renders an element carrying that id which is *not* the component
 * whose stylesheet is scoped under it, so none of the ported CSS applies and
 * the section falls back to the template's own look — with the id sitting there
 * making it look intentional.
 *
 * The real one: a banner whose source has no image paints a solid #9ECAE1 band
 * (`body.banner-no-img`, set by the source's own JS when it finds no
 * `#main-img`). The ported `InteriorBanner.astro` implements that branch. The
 * page used `hero-center` with `backgroundColor: surface` instead and shipped
 * white — on three pages, because they all share the pattern.
 *
 * The fix is always the same: point `component-map.yml` at the ported component
 * for that cluster and re-run `mig content`.
 */
export function findBorrowedIds(pages, ownedIds, { sectionKey = "pageSections" } = {}) {
  const findings = [];

  for (const page of pages) {
    for (const section of sectionsOf(page.data, sectionKey)) {
      const id = typeof section.id === "string" ? section.id.trim() : "";

      if (!id || !ownedIds.has(id)) continue;

      const owners = ownedIds.get(id);
      const component = String(section._component ?? "");
      const isOwner = owners.some((file) =>
        // `page-sections/heroes/interior-banner` ↔ `…/heroes/interior-banner/InteriorBanner.astro`
        file.replace(/\\/g, "/").includes(`/${component}/`)
      );

      if (isOwner) continue;

      findings.push({
        file: page.file,
        id,
        usedBy: component,
        ownedBy: owners.map((file) => path.dirname(file)),
      });
    }
  }

  return findings;
}

/**
 * A section using one of its own content images as its background.
 *
 * `map-to-component` fills `backgroundImage` from the first image it finds on
 * the source section when the section's rule mentions a background, and fills
 * the component's image array from the same pool. When the source's background
 * was a colour, or the rule was matched loosely, the two collide: the section
 * gets its own first slide as wallpaper, stretched and cropped behind the very
 * carousel that is already showing it.
 *
 * That is never a design. It is worth failing on by itself rather than waiting
 * for the surfaces pass to notice a `backgroundImage none → image` row, because
 * this needs no build, and because the surfaces pass pairs positionally — one
 * extra section anywhere above and it stops being able to say which row.
 */
export function findSelfBackgrounds(pages, { sectionKey = "pageSections" } = {}) {
  const findings = [];

  const imagePaths = (node, into, depth = 0) => {
    if (!node || depth > 6) return into;
    if (Array.isArray(node)) {
      for (const item of node) imagePaths(item, into, depth + 1);
      return into;
    }
    if (typeof node !== "object") return into;
    for (const [key, value] of Object.entries(node)) {
      if (key === "backgroundImage") continue;
      if (typeof value === "string" && /\.(webp|jpe?g|png|avif|gif|svg)$/i.test(value.trim())) {
        into.add(value.trim());
      } else imagePaths(value, into, depth + 1);
    }
    return into;
  };

  for (const page of pages) {
    for (const section of sectionsOf(page.data, sectionKey)) {
      const background =
        typeof section.backgroundImage?.source === "string"
          ? section.backgroundImage.source.trim()
          : typeof section.backgroundImageSource === "string"
            ? section.backgroundImageSource.trim()
            : "";

      if (!background) continue;

      if (imagePaths(section, new Set()).has(background)) {
        findings.push({
          file: page.file,
          component: String(section._component ?? ""),
          id: typeof section.id === "string" ? section.id : "",
          image: background,
        });
      }
    }
  }

  return findings;
}

/**
 * A `page-sections/**` component missing the CloudCannon scaffolding every
 * library component ships with (`.cloudcannon.inputs.yml` +
 * `.cloudcannon.structure-value.yml`), or a prop shaped like an image path
 * that the component's own `inputs.yml` does not declare `type: image` for.
 *
 * Both faults are invisible to a build. A bespoke component ported by hand —
 * see the "Matching a bespoke page's sections" section of the README — keeps
 * its fixed markup and renders identically either way; only the CMS editing
 * experience is wrong. Missing scaffolding means the component can't be added
 * from the visual editor's section picker at all (`pageSections`'s "Add
 * Component" list is built by globbing every `*.cloudcannon.structure-value.yml`
 * under `page-sections/**`), and an untyped image prop falls back to a plain
 * text box instead of the image picker/upload UI. Neither shows up until an
 * editor opens the CMS, so this checks the content itself rather than
 * anything rendered.
 */
export function findScaffoldingGaps(pages, componentsDir, { sectionKey = "pageSections" } = {}) {
  const findings = [];
  const checked = new Set();
  const imageExt = /\.(webp|jpe?g|png|avif|gif|svg)$/i;

  for (const page of pages) {
    for (const section of sectionsOf(page.data, sectionKey)) {
      const component = String(section._component ?? "").trim();

      if (!component || !component.startsWith("page-sections/") || checked.has(component)) continue;
      checked.add(component);

      const dir = path.join(componentsDir, component);
      if (!fs.existsSync(dir)) continue; // a missing component is a different fault

      const kebab = component.split("/").pop();
      const inputsPath = path.join(dir, `${kebab}.cloudcannon.inputs.yml`);
      const structureValuePath = path.join(dir, `${kebab}.cloudcannon.structure-value.yml`);
      const missing = [
        !fs.existsSync(inputsPath) && `${kebab}.cloudcannon.inputs.yml`,
        !fs.existsSync(structureValuePath) && `${kebab}.cloudcannon.structure-value.yml`,
      ].filter(Boolean);

      if (missing.length) {
        findings.push({ file: page.file, component, missing });
        continue; // nothing to check props against without an inputs.yml
      }

      let inputs;
      try {
        inputs = YAML.parse(fs.readFileSync(inputsPath, "utf8"));
      } catch {
        continue; // a malformed inputs.yml is the build's problem, not this pass's
      }
      if (!inputs || typeof inputs !== "object") continue;

      for (const [key, value] of Object.entries(section)) {
        if (key === "_component" || typeof value !== "string") continue;
        if (!imageExt.test(value.trim())) continue;
        if (inputs[key]?.type === "image") continue;

        findings.push({
          file: page.file,
          component,
          untypedImageProp: key,
          value: value.trim(),
          declaredType: inputs[key]?.type ?? "(auto-detected)",
        });
      }
    }
  }

  return findings;
}

export function auditContentProps({ contentDir, componentsDir, sectionKey = "pageSections" }) {
  const pages = readPages(contentDir);
  const ownedIds = readOwnedIds(componentsDir);

  return {
    pages: pages.length,
    borrowedIds: findBorrowedIds(pages, ownedIds, { sectionKey }),
    selfBackgrounds: findSelfBackgrounds(pages, { sectionKey }),
    scaffoldingGaps: findScaffoldingGaps(pages, componentsDir, { sectionKey }),
  };
}
