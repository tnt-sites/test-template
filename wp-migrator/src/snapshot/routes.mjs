/**
 * The flat-file → original-URL map, read back out of the snapshot manifest.
 *
 * The snapshot stores every page flat, so a filename alone cannot say what URL
 * the page had. Every stage that emits a link — component props, the page's own
 * canonical, the nav and footer menus — needs the same answer, so the lookup
 * lives here rather than in whichever command happened to need it first.
 */

import fs from "node:fs";
import path from "node:path";

export function loadRouteMap(staticDir) {
  const file = path.join(staticDir, ".snapshot-manifest.json");
  if (!fs.existsSync(file)) return new Map();
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const routes = new Map();
  for (const [urlPath, rec] of Object.entries(manifest.pages || {})) {
    if (!rec?.file) continue;
    routes.set(rec.file.replace(/\.html?$/i, ""), urlPath);
  }
  return routes;
}
