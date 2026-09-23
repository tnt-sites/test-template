/**
 * Turn scored pages into a work queue a person (or an agent) can act on.
 *
 * `triage.mjs` decides *which* pages are worth opening and why. This module
 * answers the question that immediately follows — **what do I edit?** — and
 * renders the human-readable index. It is the only part of triage that touches
 * the filesystem, deliberately: keeping the scorer pure is what makes the
 * scoring policy testable, and keeping the path resolution here is what makes
 * it testable against fixture directories.
 *
 * The hard part is section -> file, and the order of authority matters:
 *
 *   1. **The page's own `.md` is authoritative for what ships.** Its
 *      `_component:` lines, in document order, are what the site actually
 *      renders today. The IR records what the *generator* produced, which for
 *      any hand-finished page is a different thing — blocks get swapped,
 *      removed and rewritten after generation, and every page in the migration
 *      that motivated this was finished by hand.
 *   2. **The IR supplies `sectionIndex` and `rootClass`**, joined to the `.md`
 *      by component name, so a reason that knows which section it came from can
 *      point at the right file.
 *   3. **The registry supplies `usedByPages`** — the single most useful thing to
 *      tell whoever is about to edit: `1` means the change lands on this page
 *      alone, more means it lands on every page listed. With seventeen
 *      near-identical `media-prose-*` forks in one migration, getting that
 *      backwards means fixing one page and silently breaking eleven.
 */

import fs from "node:fs";
import path from "node:path";

/** `media-prose-bone` -> `MediaProseBone`. Mirrors `pascalFile` in bin/wpmig.mjs. */
export function pascalFile(kebab) {
  return kebab
    .split("-")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Index the component registry by kebab name.
 *
 * The file is `{ version, components: { <hash>: entry }, names: {...} }`; only
 * the entries matter here, and only their `pages` list.
 */
export function indexRegistry(registry) {
  const byKebab = new Map();

  for (const entry of Object.values(registry?.components || {})) {
    if (entry?.kebab) byKebab.set(entry.kebab, entry);
  }
  return byKebab;
}

/**
 * The `_component:` references a page renders, in document order.
 *
 * Reads the raw text rather than parsing YAML: the block list is nested inside
 * front matter whose full schema is irrelevant here, and every reference is a
 * plain scalar on its own line.
 */
export function pageComponentRefs(mdFile) {
  const text = fs.existsSync(mdFile) ? fs.readFileSync(mdFile, "utf8") : "";

  return [...text.matchAll(/^\s*-?\s*_component:\s*["']?([\w./@-]+)["']?\s*$/gm)].map((m) => m[1]);
}

/**
 * Which of this page's components exist nowhere else.
 *
 * This is the retroactive stand-in for a generation-time uncertainty record:
 * it is derived entirely from files that already exist, so it works on a
 * migration finished long before triage did.
 */
export function registryFactsFor(refs, byKebab, families = []) {
  const inFamily = new Set(families.flat());
  const oneOffComponents = [];
  const familyMembers = [];

  for (const ref of refs) {
    const kebab = ref.split("/").pop();
    const entry = byKebab.get(kebab);

    if (!entry || (entry.pages || []).length !== 1) continue;
    oneOffComponents.push(kebab);
    if (inFamily.has(kebab)) familyMembers.push(kebab);
  }

  return { oneOffComponents, familyMembers };
}

/**
 * Where to make the edit for one page.
 *
 * Every path is absolute: the consumer is a report read from somewhere else,
 * and a relative path in it is a path relative to nothing.
 */
export function resolveEditTargets({
  slug,
  contentDir,
  irDir,
  byKebab,
  componentsRoot,
  families = [],
  namespaces = ["wpmig"],
}) {
  const content = path.resolve(contentDir, `${slug}.md`);
  const refs = pageComponentRefs(content);
  const ir = readJson(path.resolve(irDir, `${slug}.json`));
  const inFamily = new Set(families.flat());

  // The IR's sections are joined to the page's blocks by component name. A
  // component used twice on one page gets each occurrence a distinct section,
  // so the join consumes matches rather than reusing the first.
  const irSections = [...(ir?.sections || [])];

  const components = refs.map((ref) => {
    const kebab = ref.split("/").pop();
    const entry = byKebab.get(kebab);
    // A component under the migrator's own namespace that the registry does not
    // know was built by hand — the registry only records what the generator
    // emitted. That is the opposite of shared: it belongs to whoever wrote it,
    // usually for one page. Calling it "used site-wide" because a lookup missed
    // would steer an editor away from the safest edit on the page.
    const inNamespace = namespaces.some((ns) => ref.includes(`/${ns}/`));

    const at = irSections.findIndex((s) => s.id === kebab || s.rootClass === kebab);
    const section = at === -1 ? null : irSections.splice(at, 1)[0];

    const out = {
      component: kebab,
      ref,
      astro: path.resolve(componentsRoot, ref, `${pascalFile(kebab)}.astro`),
      origin: entry ? "generated" : inNamespace ? "hand-built" : "starter",
      shared: !entry && !inNamespace,
      usedByPages: entry ? (entry.pages || []).length : null,
    };

    if (section) {
      out.sectionIndex = section.sectionIndex;
      if (section.rootClass) out.rootClass = section.rootClass;
    }
    if (entry && inFamily.has(kebab)) out.inNearIdenticalFamily = true;
    return out;
  });

  return {
    content,
    components,
    note:
      "Copy and content live in the .md; layout, spacing and colour live in the .astro. " +
      "origin: \"generated\" means the migrator emitted it and usedByPages says how many pages it " +
      "renders — 1 is safe to edit for this page alone, more means the edit lands on every one of " +
      "them. origin: \"hand-built\" means it is in the migrator's namespace but was written by hand, " +
      "so it usually belongs to this page only and regenerating the page would replace it. " +
      "origin: \"starter\" means a shared site-wide component: editing it affects the whole site.",
    registryFacts: registryFactsFor(refs, byKebab, families),
  };
}

/**
 * Pick one representative page per navigation group.
 *
 * Ranking alone samples badly: the worst nine pages of a dental site are
 * frequently nine variants of the same service template, so a queue built from
 * the top of the list can review one page type nine times and never look at
 * Contact. Walking the real nav guarantees the queue spans the site's actual
 * *kinds* of page.
 *
 * A "group" is each top-level nav item, plus each second-level group under a
 * top-level item that has no page of its own — the menu-heading case. Services
 * is exactly that: `path: ""` with six category children over some thirty
 * service pages, so treating it as one group would sample one page in thirty.
 *
 * Within a group the representative is the **highest-scoring** candidate, so
 * the two mechanisms compose rather than compete: each section of the site
 * surfaces its own worst example.
 */
export function selectNavSample({ navData, routes, scored, alwaysInclude = ["index"] }) {
  const bySlug = new Map(scored.map((p) => [p.slug, p]));
  // routes is slug -> "/route/"; the nav speaks in routes.
  const slugOf = new Map();
  for (const [slug, route] of routes) slugOf.set(normalisePath(route), slug);

  const groups = [];

  for (const item of navData || []) {
    const children = item.children || [];
    // A menu heading with no page of its own delegates to its children: each
    // becomes its own group, so every family under it is represented.
    const isHeading = !normalisePath(item.path) && children.length > 0;

    if (isHeading) {
      for (const child of children) {
        groups.push({ name: `${item.name} › ${child.name}`, candidates: collectSlugs(child, slugOf) });
      }
      continue;
    }
    groups.push({ name: item.name, candidates: collectSlugs(item, slugOf) });
  }

  const picked = new Map();

  for (const group of groups) {
    // Ties break on the slug so an unchanged site samples the same page twice
    // running — a queue whose rows shuffle between runs cannot be diffed.
    const best = group.candidates
      .filter((slug) => bySlug.has(slug))
      .sort((a, b) => (bySlug.get(b).score - bySlug.get(a).score) || a.localeCompare(b))[0];

    if (best && !picked.has(best)) picked.set(best, { group: group.name, reason: "representative for this nav group" });
  }

  for (const slug of alwaysInclude) {
    if (bySlug.has(slug) && !picked.has(slug)) {
      picked.set(slug, { group: "Home", reason: "always included" });
    }
  }

  return picked;
}

/**
 * Every page slug reachable from a nav item, itself included.
 *
 * Two normalisations do the real work: a `#fragment` is stripped, because six
 * of one site's seven "New Patients" children are anchors into the single
 * `new-patients` page and would otherwise sample it six times; and an empty
 * path contributes nothing, because it is a menu heading rather than a page.
 */
function collectSlugs(item, slugOf, out = []) {
  const route = normalisePath(item.path);
  const slug = route && slugOf.get(route);

  if (slug && !out.includes(slug)) out.push(slug);
  for (const child of item.children || []) collectSlugs(child, slugOf, out);
  return out;
}

/** `/new-patients/#faq` -> `/new-patients/`; `""` stays `""`. */
function normalisePath(p) {
  const base = String(p || "").split("#")[0].split("?")[0].trim();

  if (!base || base === "#") return "";
  if (/^[a-z]+:\/\//i.test(base)) return "";
  const withLead = base.startsWith("/") ? base : `/${base}`;
  return withLead.endsWith("/") ? withLead : `${withLead}/`;
}

/**
 * The markdown index.
 *
 * Strictly derived from the report and strictly an *index*: it exists so a
 * person can decide at a glance whether to work the queue. The reasons and the
 * edit paths are deliberately not restated here — two renderings of the same
 * findings are two things that can disagree, and the JSON is what should be
 * acted on.
 */
export function renderQueueMarkdown(report) {
  const built =
    report.builtFrom.kind === "dev-server"
      ? `${report.builtFrom.origin} (dev server)`
      : `${report.builtFrom.dir} (built output)`;

  const lines = [
    `# wpmig triage — ${report.counts.flagged} of ${report.counts.scored} pages flagged (threshold ${report.threshold})`,
    "",
    `Built from: ${built}`,
    `Source: ${report.sourceFrom.dir}`,
    `Generated: ${report.generatedAt}`,
    report.scoredWithout.length ? `Scored without: ${report.scoredWithout.join(", ")}` : "",
    "",
    `Full data (act on this, not the table): ${report.jsonPath}`,
    "",
    "| # | score | band | page | nav group | top reason | shots |",
    "|---|-------|------|------|-----------|-----------|-------|",
  ].filter((l) => l !== "");

  for (const page of report.pages) {
    const top = page.reasons[0];
    const shots = page.shots ? path.dirname(Object.values(page.shots)[0].original) : page.captureError ? "capture failed" : "—";

    lines.push(
      `| ${page.rank} | ${page.score} | ${page.band} | ${page.slug} | ${page.navSample?.group || ""} | ` +
        `${top ? `${top.label} (${top.detail})` : "—"} | ${shots} |`
    );
  }

  lines.push("", `${report.counts.captured} page(s) captured. Advisory: review before editing.`);
  return `${lines.join("\n")}\n`;
}
