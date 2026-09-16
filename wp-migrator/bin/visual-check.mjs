import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { chromium } from "playwright";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "../src/mirror/serve.mjs";
import { loadRouteMap } from "../src/snapshot/routes.mjs";
import { capturePageShots } from "../src/capture/screenshot.mjs";
import { compareShots, makeClient, DEFAULT_MODEL } from "../src/qa/visual-check.mjs";
import { detectMissingMedia, proposeSection, unreferencedMedia } from "../src/qa/missing-media.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Is this the SDK failing for lack of a credential? Two shapes reach us: a 401
 * `Anthropic.AuthenticationError` when a key is present but rejected, and a
 * plain Error ("Could not resolve authentication method") thrown at request
 * time when no key/profile resolves at all — the latter is NOT an
 * AuthenticationError instance, so match its message too.
 */
function isAuthError(err) {
  return (
    err instanceof Anthropic.AuthenticationError ||
    /authentication|api[_-]?key|could not resolve/i.test(err?.message || "")
  );
}

/** The live origin the mirror was snapshotted from (for --live). */
function originOf(staticDir) {
  const report = path.join(staticDir, ".snapshot-report.json");
  if (!fs.existsSync(report)) return null;
  try {
    return JSON.parse(fs.readFileSync(report, "utf8")).origin || null;
  } catch {
    return null;
  }
}

export const devVisualCheck = defineCommand({
  meta: {
    name: "dev-visual-check",
    description:
      "Advisory: Claude compares the original vs the built page side-by-side and reports design differences. Needs ANTHROPIC_API_KEY (or an `ant auth` profile).",
  },
  args: {
    page: {
      type: "positional",
      description: "A page slug to check (or use --pages)",
      required: false,
    },
    pages: { type: "string", description: "Comma-separated page slugs to check", default: "" },
    static: {
      type: "string",
      description: "Snapshot mirror directory",
      default: path.join(HERE, ".wpmig/static"),
    },
    dist: {
      type: "string",
      description: "Built site directory",
      default: path.join(HERE, "../dist"),
    },
    viewports: { type: "string", description: "Comma-separated widths", default: "1440" },
    live: {
      type: "boolean",
      description: "Screenshot the live origin instead of the mirror",
      default: false,
    },
    model: { type: "string", description: "Claude model", default: DEFAULT_MODEL },
    out: {
      type: "string",
      description: "Output directory for screenshots + reports",
      default: path.join(HERE, ".wpmig/visual-check"),
    },
    json: { type: "boolean", description: "Write a JSON report per page", default: false },
    "find-missing": {
      type: "boolean",
      description: "Also ask what the screenshot shows that the extractor never found",
      default: false,
    },
    "build-from-screenshot": {
      type: "boolean",
      description:
        "For each gap, propose a section from unreferenced media (proposal only — nothing is written)",
      default: false,
    },
  },
  async run({ args }) {
    const slugs = [args.page, ...args.pages.split(",")]
      .map((s) => (s || "").trim())
      .filter(Boolean);
    if (slugs.length === 0) {
      console.error("Name at least one page: dev-visual-check <slug> or --pages a,b,c");
      process.exitCode = 1;
      return;
    }

    const client = makeClient();
    // Preflight the credential before doing any (slow) screenshotting, so a
    // missing key fails fast instead of after a full-page capture.
    try {
      await client.messages.countTokens({
        model: args.model,
        messages: [{ role: "user", content: "ping" }],
      });
    } catch (err) {
      if (isAuthError(err)) {
        console.error("No Claude credential. Set ANTHROPIC_API_KEY or run `ant auth login`.");
        process.exitCode = 1;
        return;
      }
      console.error(`Warning: credential preflight failed (${err.message}); continuing.`);
    }

    const staticDir = path.resolve(args.static);
    const distDir = path.resolve(args.dist);
    const outDir = path.resolve(args.out);
    const viewports = args.viewports
      .split(",")
      .map((s) => Number(s.trim()))
      .filter(Boolean);
    const routes = loadRouteMap(staticDir);
    const origin = args.live ? originOf(staticDir) : null;
    if (args.live && !origin) {
      console.error("--live needs the origin from the snapshot report; none found in " + staticDir);
      process.exitCode = 1;
      return;
    }

    const srcSrv = args.live ? null : await serve(staticDir, 0);
    const bltSrv = await serve(distDir, 0);
    const browser = await chromium.launch();
    const page = await browser.newPage();

    let total = 0;
    try {
      for (const slug of slugs) {
        const route = routes.get(slug) || `/${slug}/`;
        const originalUrl = args.live ? origin + route : `${srcSrv.url}/${slug}.html`;
        const builtUrl = `${bltSrv.url}${route}`;
        const slugOut = path.join(outDir, slug);

        let originalShots, builtShots;
        try {
          originalShots = await capturePageShots(page, originalUrl, slugOut, {
            prefix: "original",
            viewports,
          });
          builtShots = await capturePageShots(page, builtUrl, slugOut, {
            prefix: "built",
            viewports,
          });
        } catch (err) {
          console.error(`${slug}: capture failed — ${err.message}`);
          continue;
        }

        const report = { page: slug, route, generatedAt: new Date().toISOString(), viewports: {} };
        for (const width of viewports) {
          const orig = originalShots.find((s) => s.width === width);
          const built = builtShots.find((s) => s.width === width);
          if (!orig || !built) continue;

          let findings;
          try {
            findings = await compareShots(client, orig.file, built.file, { model: args.model });
          } catch (err) {
            if (isAuthError(err)) {
              console.error("Claude auth failed. Set ANTHROPIC_API_KEY or run `ant auth login`.");
              process.exitCode = 1;
              return;
            }
            console.error(`${slug} @ ${width}px: Claude call failed — ${err.message}`);
            continue;
          }
          report.viewports[width] = findings;
          total += findings.length;

          console.log(`\n${slug} @ ${width}px — ${findings.length} difference(s)`);
          for (const f of findings) {
            console.log(`  - ${f.area} [${f.severity}]: ${f.difference}`);
            if (f.suggested_fix) console.log(`      fix: ${f.suggested_fix}`);
          }
        }

        // The gap pass: what does the screenshot show that the DOM never had?
        // Deliberately separate from the comparison above — that one asks
        // whether the rebuild matches, this one asks whether the extraction was
        // complete, and a page can pass the first while failing the second.
        if (args["find-missing"]) {
          const shot = originalShots[0];
          const built = fs.existsSync(path.join(distDir, route.replace(/^\//, ""), "index.html"))
            ? fs.readFileSync(path.join(distDir, route.replace(/^\//, ""), "index.html"), "utf8")
            : "";
          const referenced = [...built.matchAll(/\/wp-content\/uploads\/[^"'\s>)]+/g)].map(
            (m) => m[0]
          );
          const extracted = {
            images: [...new Set(referenced.map((r) => r.split("/").pop()))],
            sections: [
              ...new Set([...built.matchAll(/class="([a-z0-9-]+)"/g)].map((m) => m[1])),
            ].slice(0, 20),
          };

          let gaps = [];
          try {
            gaps = await detectMissingMedia(client, shot.file, extracted, { model: args.model });
          } catch (err) {
            console.error(`${slug}: gap detection failed — ${err.message}`);
          }

          report.missing = gaps;
          if (gaps.length) {
            console.log(
              `\n${slug} — ${gaps.length} thing(s) visible in the screenshot the extractor never found:`
            );
            for (const g of gaps) {
              console.log(
                `  - ${g.where}: ${g.kind}${g.count ? ` (${g.count} items)` : ""} — ${g.describes} [${g.confidence}]`
              );
            }

            if (args["build-from-screenshot"]) {
              const candidates = unreferencedMedia(staticDir, referenced);
              let proposal = null;
              try {
                proposal = await proposeSection(client, shot.file, candidates, {
                  model: args.model,
                });
              } catch (err) {
                console.error(`  proposal failed — ${err.message}`);
              }
              report.proposal = proposal;

              if (proposal) {
                console.log(
                  `\n  Proposed section (${proposal.confidence} confidence) — NOT written:`
                );
                console.log(`    heading: ${proposal.heading || "(none)"}`);
                for (const im of proposal.images) console.log(`    - ${im.file}  "${im.alt}"`);
                if (proposal.note) console.log(`    note: ${proposal.note}`);
              } else {
                console.log(
                  `  No confident match among ${candidates.length} unreferenced file(s).`
                );
              }
            } else {
              console.log("  (re-run with --build-from-screenshot to see a proposed section)");
            }

            console.log(
              "\n  These are questions, not defects: content can be missing because the page never" +
                "\n  published it. Decide per item before adding anything."
            );
          }
        }

        if (args.json) {
          fs.mkdirSync(slugOut, { recursive: true });
          fs.writeFileSync(
            path.join(slugOut, "report.json"),
            JSON.stringify(report, null, 2),
            "utf8"
          );
        }
      }
    } finally {
      await browser.close();
      srcSrv?.server.close();
      bltSrv.server.close();
    }

    console.log(
      `\n${total} difference(s) across ${slugs.length} page(s). Advisory only — review before applying.`
    );
  },
});
