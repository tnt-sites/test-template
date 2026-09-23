/**
 * A minimal instrumented mirror for the sampled pages the extract pass
 * measures. `buildSelectorIndex`/`measureRoles` need every element stamped
 * with `data-mig-uid` (site-migrator's uid-based identity model); rather than
 * mirror the whole site, this instruments just the pages being sampled and
 * symlinks the asset directories alongside them so relative references (CSS,
 * images, fonts) still resolve.
 */

import fs from "node:fs";
import path from "node:path";
import { instrumentHtml } from "../mirror/instrument.mjs";

export function buildMeasurementMirror(staticDir, workDir, pages) {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  for (const entry of fs.readdirSync(staticDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      fs.symlinkSync(path.join(staticDir, entry.name), path.join(workDir, entry.name), "dir");
    }
  }

  for (const page of pages) {
    const html = fs.readFileSync(page.file, "utf8");
    const { html: instrumented } = instrumentHtml(html, page.id);
    fs.writeFileSync(path.join(workDir, `${page.id}.html`), instrumented);
  }
}
