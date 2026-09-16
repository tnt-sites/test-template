/**
 * Copy the assets a generated page actually references out of the snapshot.
 *
 * `dev-extract` mirrors the *inventory* it can see from the markup — `<img>`
 * sources, chrome logos, fonts. A generated component references more than
 * that: a section's hero photograph is usually a CSS `background-image`, which
 * appears only in the computed styles the capture measured. Those paths are
 * emitted into the component and the page's props, and without this step they
 * point at files that were never brought across — the page builds clean and
 * renders with an empty band where the hero should be.
 *
 * So the reference list is read back out of the emitted output itself: whatever
 * the generated files ask for is what gets copied, with no second guess about
 * which properties can carry a URL.
 */

import fs from "node:fs";
import path from "node:path";

/** Site-root-relative WordPress asset paths, as emitted into markup and CSS. */
const ASSET_REF = /\/wp-(?:content|includes)\/[^\s"'()\\]+/g;

export function collectAssetRefs(values) {
  const refs = new Set();
  const walk = (value) => {
    if (typeof value === "string") {
      for (const match of value.match(ASSET_REF) ?? []) {
        const clean = match.split("?")[0].split("#")[0];
        // A URL-encoded path resolves to a different file on disk than the
        // literal one; the snapshot stored the decoded name.
        refs.add(decodeURIComponent(clean));
      }
      return;
    }
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") return Object.values(value).forEach(walk);
  };
  walk(values);
  return [...refs];
}

export function copyReferencedAssets({ refs, staticDir, targetRoot, publicDir = "public" }) {
  const copied = [];
  const missing = [];

  for (const ref of refs) {
    const from = path.join(staticDir, ref.replace(/^\//, ""));
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
      missing.push(ref);
      continue;
    }
    const to = path.join(targetRoot, publicDir, ref.replace(/^\//, ""));
    if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied.push(ref);
  }

  return { copied, missing };
}
