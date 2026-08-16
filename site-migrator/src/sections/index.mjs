import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { serve } from "../mirror/serve.mjs";
import { forEachPage } from "../browser/load.mjs";
import { segmentPage } from "./segment.mjs";
import { clusterSections, dedupeIds } from "./cluster.mjs";

export async function runScan(ctx) {
  const { config, paths } = ctx;

  const mirrorDir = path.join(paths.artifacts, "instrumented");
  if (!fs.existsSync(mirrorDir)) throw new Error("No mirror found. Run `mig mirror` first.");

  const { pages } = JSON.parse(fs.readFileSync(path.join(paths.artifacts, "pages.json"), "utf8"));

  const { server, url: baseUrl } = await serve(mirrorDir, 0);
  const browser = await chromium.launch();

  const allSections = [];
  const chromeByPage = {};
  let failures = [];

  try {
    const targets = pages.map((p) => ({ ...p, url: `${baseUrl}/${p.id}.html` }));

    const run = await forEachPage(
      browser,
      targets,
      async (page, p) => {
        const result = await segmentPage(page, {
          rules: config.segmentation.rules,
          chrome: config.segmentation.chrome,
          roots: config.segmentation.roots,
          viewport: config.segmentation.viewport,
          normalizer: {
            noiseClasses: config.noise.classes,
            noiseIds: config.noise.ids,
            buttonClassPattern: config.props.buttonClassPattern,
            maxDepth: config.fingerprint.maxDepth,
          },
        });

        for (const s of result.sections) allSections.push({ ...s, pageId: p.id });
        chromeByPage[p.id] = result.chrome;
        return result.sections.length;
      },
      {
        viewport: { width: config.segmentation.viewport, height: 1000 },
        primeLazyLoad: true,
        reveal: true,
      }
    );

    failures = run.failures;
  } finally {
    await browser.close();
    server.close();
  }

  const clusters = dedupeIds(
    clusterSections(allSections, {
      threshold: config.fingerprint.clusterThreshold,
      weights: config.fingerprint.identityWeights,
      propFeatures: config.fingerprint.propFeatures,
    })
  );

  const scanDir = path.join(paths.artifacts, "scan");
  fs.mkdirSync(scanDir, { recursive: true });

  // A page with no sections migrated empty. It almost always means its layout
  // uses a container no rule covers — a gallery, a profile page, a one-off —
  // and it is the single most useful thing to surface after a scan.
  const withSections = new Set(allSections.map((s) => s.pageId));
  const emptyPages = pages
    .map((p) => p.id)
    .filter((id) => !withSections.has(id) && !failures.some((f) => f.page.id === id));

  const artifact = {
    generatedAt: new Date().toISOString(),
    emptyPages,
    pagesScanned: pages.length - failures.length,
    sectionCount: allSections.length,
    clusterCount: clusters.length,
    failures: failures.map((f) => ({ page: f.page.id, reason: f.reason })),
    clusters,
    chrome: chromeByPage,
  };

  fs.writeFileSync(path.join(scanDir, "sections.json"), JSON.stringify(allSections, null, 2));
  fs.writeFileSync(path.join(scanDir, "clusters.json"), JSON.stringify(artifact, null, 2));

  return artifact;
}

/**
 * Guard against silently regressing to a shape-per-section explosion. If the
 * clusterer produces almost as many clusters as sections it has learned
 * nothing, and the mapping work it implies is the very thing this replaces.
 */
export function checkClusterHealth(artifact, config) {
  const problems = [];

  if (artifact.clusterCount > config.fingerprint.maxClusters) {
    problems.push(
      `${artifact.clusterCount} clusters exceeds maxClusters (${config.fingerprint.maxClusters}). ` +
        `Raise fingerprint.clusterThreshold or add more noise.classes.`
    );
  }

  const singletons = artifact.clusters.filter((c) => c.members.length === 1);
  if (singletons.length > artifact.clusterCount / 2) {
    problems.push(
      `${singletons.length} of ${artifact.clusterCount} clusters have a single member — ` +
        `identity is still too strict.`
    );
  }

  return problems;
}

/** A reviewable summary: one row per cluster, not one per section. */
export function renderContactSheet(artifact) {
  const rows = artifact.clusters
    .map((c) => {
      const variance = Object.entries(c.variance)
        .map(([k, counts]) => {
          const parts = Object.entries(counts)
            .map(([v, n]) => `${v}&times;${n}`)
            .join(", ");
          return `<li><code>${k}</code>: ${parts}</li>`;
        })
        .join("");

      return `<tr>
        <td><strong>${c.id}</strong><br><small>${c.members.length} on ${c.pages.length} page(s)</small></td>
        <td><code>${c.roleSequence.join(" ")}</code></td>
        <td>${variance ? `<ul>${variance}</ul>` : "<small>uniform</small>"}</td>
        <td><small>${escapeHtml(c.members[0]?.textPreview ?? "")}</small></td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<meta charset="utf-8">
<title>Section clusters</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; max-width: 1200px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border-bottom: 1px solid #ddd; padding: .6rem; vertical-align: top; text-align: left; }
  code { background: #f4f4f4; padding: .1em .3em; }
  ul { margin: 0; padding-left: 1.2em; }
  .summary { background: #f8f8f8; padding: 1rem; margin-bottom: 1rem; }
</style>
<h1>Section clusters</h1>
<div class="summary">
  <strong>${artifact.sectionCount}</strong> sections across
  <strong>${artifact.pagesScanned}</strong> pages collapsed into
  <strong>${artifact.clusterCount}</strong> clusters.
  <br><small>Map each cluster to a component in <code>component-map.yml</code>.
  Features listed under &ldquo;varies&rdquo; are props, not separate patterns.</small>
</div>
<table>
  <tr><th>Cluster</th><th>Role sequence</th><th>Varies</th><th>Sample text</th></tr>
  ${rows}
</table>`;
}

function escapeHtml(text) {
  return String(text).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
}
