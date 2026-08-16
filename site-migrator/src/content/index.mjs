import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { chromium } from "playwright";
import { serve } from "../mirror/serve.mjs";
import { forEachPage } from "../browser/load.mjs";
import { extractSection } from "./extract.mjs";
import { mapToComponent, resolveComponent } from "./map-to-component.mjs";
import { extractSeo } from "./seo.mjs";
import { buildUrlMap, detectSourceHost, rewriteUrl, rewriteText } from "./links.mjs";
import { loadFontelloNames } from "./resolve-icon.mjs";

/**
 * Pull the source site's content into the nearest matching library component.
 *
 * This is deliberately the *content-first* step: get every page's real copy,
 * images and links into real components early, so the remaining work is design
 * refinement on a complete site rather than authoring from scratch. Anything
 * the chosen component cannot hold is preserved on the page instead of dropped.
 */
export async function runContent(ctx, { only = null } = {}) {
  const { config, componentMap, paths } = ctx;

  const mirrorDir = path.join(paths.artifacts, "instrumented");
  const scanFile = path.join(paths.artifacts, "scan", "clusters.json");
  if (!fs.existsSync(scanFile)) throw new Error("No scan found. Run `mig scan` first.");

  const scan = JSON.parse(fs.readFileSync(scanFile, "utf8"));
  const sections = JSON.parse(
    fs.readFileSync(path.join(paths.artifacts, "scan", "sections.json"), "utf8")
  );
  const { pages } = JSON.parse(fs.readFileSync(path.join(paths.artifacts, "pages.json"), "utf8"));

  // uid -> cluster id, so each section knows which mapping applies.
  const clusterOf = new Map();
  for (const cluster of scan.clusters) {
    for (const member of cluster.members) clusterOf.set(member.uid, cluster.id);
  }

  const urlMap = new Map(pages.map((p) => [p.path, p.route]));
  const assetMap = loadAssetMap(paths.artifacts);

  // The source's icon-font vocabulary, and the names the target can render.
  const glyphFile = path.join(paths.artifacts, "icon-glyphs.json");
  const glyphMap = fs.existsSync(glyphFile)
    ? JSON.parse(fs.readFileSync(glyphFile, "utf8"))
    : null;
  const fontelloComponent = path.join(
    paths.components,
    "building-blocks/core-elements/fontello-icon/FontelloIcon.astro"
  );
  const fontelloSet = fs.existsSync(fontelloComponent)
    ? loadFontelloNames(fs.readFileSync(fontelloComponent, "utf8"))
    : null;

  const iconsDir = path.join(paths.targetRoot, "src/icons");
  const iconSet = fs.existsSync(iconsDir)
    ? new Set(
        fs
          .readdirSync(iconsDir)
          .filter((f) => f.endsWith(".svg"))
          .map((f) => f.replace(/\.svg$/, ""))
      )
    : null;

  const targets = pages
    .filter((p) => !only || p.id === only)
    .map((p) => ({ ...p, url: `${mirrorDir ? "" : ""}${p.id}.html` }));

  const { server, url: baseUrl } = await serve(mirrorDir, 0);
  const browser = await chromium.launch();

  const results = [];
  let failures = [];

  try {
    const run = await forEachPage(
      browser,
      targets.map((p) => ({ ...p, url: `${baseUrl}/${p.id}.html` })),
      async (page, p) => {
        const pageSections = sections
          .filter((s) => s.pageId === p.id)
          .sort((a, b) => a.order - b.order);

        const blocks = [];
        const notes = [];
        const approximatedIcons = [];

        for (const section of pageSections) {
          const clusterId = clusterOf.get(section.anchorUid);
          const entry = componentMap.clusters?.[clusterId];
          const resolved = resolveComponent(entry, section);

          if (!resolved?.component) {
            notes.push({
              uid: section.anchorUid,
              cluster: clusterId,
              reason: entry ? "no variant matched" : "cluster not mapped",
              preview: section.textPreview,
            });
            continue;
          }

          const extracted = await extractSection(
            page,
            section.anchorUid,
            {
              buttonClassPattern: config.props.buttonClassPattern,
              embeds: config.embeds,
            },
            section.anchorLift ?? 0
          );
          if (!extracted) continue;

          const mapped = mapToComponent(extracted, resolved.component, {
            componentsDir: paths.components,
            assetMap,
            urlMap,
            glyphMap,
            iconSet,
            fontelloSet,
          });

          if (mapped.error) {
            notes.push({ uid: section.anchorUid, cluster: clusterId, reason: mapped.error });
            continue;
          }

          for (const [prop, expr] of Object.entries(resolved.propOverrides ?? {})) {
            const evaluated = evaluateOverride(expr, section, extracted);
            if (evaluated !== undefined) mapped.value[prop] = evaluated;
          }

          blocks.push(mapped.value);
          if (mapped.approximatedIcons?.length) {
            approximatedIcons.push(...mapped.approximatedIcons);
          }

          if (mapped.unmapped.length) {
            notes.push({
              uid: section.anchorUid,
              cluster: clusterId,
              component: resolved.component,
              unmapped: mapped.unmapped,
            });
          }
        }

        return { page: p, blocks, notes, approximatedIcons, seo: await extractSeo(page) };
      },
      {
        viewport: { width: config.segmentation.viewport, height: 1000 },
        primeLazyLoad: true,
        reveal: true,
      }
    );

    results.push(...run.results.map((r) => r.value));
    failures = run.failures;
  } finally {
    await browser.close();
    server.close();
  }

  return { results, failures };
}

/**
 * Copy every image the migrated content references into the target, and rewrite
 * the paths that point at it.
 *
 * Source paths are mirrored verbatim, so `assets/images/x.webp` is served from
 * `/assets/images/x.webp`. Keeping the layout identical means markup lifted
 * straight from the source still resolves, and there is no lookup table to
 * drift out of step with reality.
 */
export function collectContentAssets(results, { mirrorDir, writer, publicDir = "public" }) {
  const map = new Map();
  const missing = new Set();

  const register = (src) => {
    if (!src || /^(https?:|data:|\/\/)/i.test(src)) return;
    if (map.has(src)) return;

    const clean = src.split("?")[0].split("#")[0].replace(/^\//, "");
    // Link targets share the same prose as image sources, and a route such as
    // `/` or `/about-us/` resolves to a directory rather than a file.
    if (!clean || clean.endsWith("/")) return;

    const source = path.resolve(mirrorDir, clean);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      // Only report things that actually look like assets, so a page link with
      // no matching file is not misreported as a missing image.
      if (/\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|pdf)$/i.test(clean)) missing.add(src);
      return;
    }

    writer.writeBinary(path.join(publicDir, clean), fs.readFileSync(source));
    map.set(src, `/${clean}`);
  };

  const isAssetKey = (key) => /^(imageSource|source|src)$/i.test(key);
  const isProseKey = (key) => key === "subtext" || key === "body" || key === "text";

  const walk = (node, visit) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") visit(node, key, value);
      else walk(value, visit);
    }
  };

  for (const result of results) {
    walk(result.blocks, (_node, key, value) => {
      if (isAssetKey(key)) register(value);
      else if (isProseKey(key)) {
        for (const m of value.matchAll(/\]\(([^)\s]+)\)/g)) register(m[1]);
      }
    });
  }

  // Second pass, once every path is known.
  for (const result of results) {
    walk(result.blocks, (node, key, value) => {
      if (isAssetKey(key)) {
        const mapped = map.get(value);
        if (mapped) node[key] = mapped;
      } else if (isProseKey(key)) {
        node[key] = value.replace(/\]\(([^)\s]+)\)/g, (whole, href) =>
          map.has(href) ? `](${map.get(href)})` : whole
        );
      }
    });
  }

  return { map, missing: [...missing] };
}

/**
 * Rewrite legacy URLs inside generated blocks.
 *
 * Done here rather than only in a later pass so that regenerating content is
 * stable: otherwise each run re-emits the source's `.html` links and the link
 * pass rewrites them again, and the two commands never agree.
 */
export function rewriteBlockLinks(results, { pages, sourceHost }) {
  const map = buildUrlMap(pages, { sourceHost });
  let changes = 0;

  const linkKeys = /^(link|href|url|canonical)$/i;
  const proseKeys = /^(subtext|body|text|description)$/i;

  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      if (typeof value !== "string") {
        walk(value);
        continue;
      }
      if (linkKeys.test(key)) {
        const result = rewriteUrl(value, map);
        if (result.changed) {
          node[key] = result.url;
          changes++;
        }
      } else if (proseKeys.test(key)) {
        // Prose carries markdown links *and* raw HTML preserved from the
        // source, so it needs the same text rewriter the standalone link pass
        // uses — handling only markdown syntax leaves `href="…"` behind and the
        // two commands never converge.
        const result = rewriteText(value, map);
        if (result.changes) {
          node[key] = result.text;
          changes += result.changes;
        }
      }
    }
  };

  for (const result of results) {
    walk(result.blocks);
    // Content that found no home is still content: it is written onto the page
    // and should carry working links, not the source's legacy URLs.
    for (const note of result.notes ?? []) {
      for (const entry of note.unmapped ?? []) {
        if (typeof entry.content !== "string") continue;
        const rewritten = rewriteText(entry.content, map);
        if (rewritten.changes) {
          entry.content = rewritten.text;
          changes += rewritten.changes;
        }
      }
    }
    if (result.seo?.canonical) {
      const canonical = rewriteUrl(result.seo.canonical, map);
      if (canonical.changed) {
        result.seo.canonical = canonical.url;
        changes++;
      }
    }
  }

  return changes;
}

/** Frontmatter for one page. */
export function renderPage(result, { collection = "pages" } = {}) {
  const { page, blocks, notes, seo } = result;

  const frontmatter = {
    title: seo?.title ?? page.id,
    ...(seo?.description ? { description: seo.description } : { description: "" }),
    ...(seo?.canonical ? { canonical: seo.canonical } : {}),
    pageSections: blocks,
  };

  // Content the chosen components could not hold stays on the page. Losing it
  // silently is worse than carrying it until someone decides where it belongs.
  const leftovers = notes.filter((n) => n.unmapped?.length);
  if (leftovers.length) {
    // `_mig` is reserved for the provenance header, so leftovers use their own
    // key — two blocks writing `_mig` produced a duplicate YAML mapping key
    // that failed the build.
    frontmatter._migUnmapped = {
      sections: leftovers.map((n) => ({
        component: n.component,
        fields: n.unmapped.map((u) => ({ field: u.field, content: u.content })),
      })),
    };
  }

  const yaml = YAML.stringify(frontmatter, { lineWidth: 0 });
  return `---\n${yaml}---\n`;
}

function loadAssetMap(artifacts) {
  const file = path.join(artifacts, "assets.json");
  if (!fs.existsSync(file)) return new Map();
  return new Map(Object.entries(JSON.parse(fs.readFileSync(file, "utf8"))));
}

/**
 * Evaluate a `propOverrides` expression such as
 * `"$feature.imageSide == 'left'"`. Deliberately tiny — this is a mapping
 * config, not a scripting surface.
 */
export function evaluateOverride(expr, section, extracted) {
  if (typeof expr !== "string" || !expr.startsWith("$")) return expr;

  const comparison = expr.match(/^\$(\w+)\.([\w.]+)\s*(==|!=)\s*'([^']*)'$/);
  if (comparison) {
    const [, scope, field, op, expected] = comparison;
    const actual =
      scope === "feature" ? section.features?.[field] : lookup(extracted?.props, field);
    const equal = String(actual) === expected;
    return op === "==" ? equal : !equal;
  }

  const plain = expr.match(/^\$(\w+)\.([\w.]+)$/);
  if (plain) {
    const [, scope, field] = plain;
    return scope === "feature" ? section.features?.[field] : lookup(extracted?.props, field);
  }

  return expr;
}

function lookup(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
