import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import {
  runExtract,
  emitTokens,
  emitSemanticOverrides,
  brandingPatch,
  emitRamp,
} from "../src/extract/index.mjs";
import { Writer } from "../src/fs/write.mjs";
import { patchRegion } from "../src/fs/regions.mjs";
import { patchJson } from "../src/css/tokens/wire.mjs";
import { loadIconSet } from "../src/generate/icon-map.mjs";
import { loadRouteMap } from "../src/snapshot/routes.mjs";
import { ensureFamilySheets } from "../src/extract/fonts.mjs";
import { useRouteMap } from "../src/generate/props.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

export const devExtract = defineCommand({
  meta: {
    name: "dev-extract",
    description:
      "Extract colors, fonts, chrome/site-info, SEO, and images from a snapshot into a target repo.",
  },
  args: {
    static: {
      type: "string",
      description: "Snapshot directory",
      default: path.join(HERE, "../site-migrator/static"),
    },
    target: { type: "string", description: "Target repo root", default: path.join(HERE, "..") },
    "sample-pages": {
      type: "string",
      description: "Pages to sample for color/type measurement",
      default: "6",
    },
    "dry-run": { type: "boolean", description: "Report without writing", default: true },
    write: { type: "boolean", description: "Actually write (overrides --dry-run)", default: false },
  },
  async run({ args }) {
    const staticDir = path.resolve(args.static);
    const targetRoot = path.resolve(args.target);
    if (!fs.existsSync(staticDir)) throw new Error(`snapshot dir not found: ${staticDir}`);
    useRouteMap(loadRouteMap(staticDir));

    const dryRun = !args.write;
    const writer = new Writer({
      targetRoot,
      artifactsDir: path.join(targetRoot, ".migration"),
      dryRun,
      version: "0.1.0",
    });

    console.log(`extracting from ${staticDir} ${dryRun ? "(dry run)" : "(writing)"}…`);
    const result = await runExtract({
      staticDir,
      targetRoot,
      writer,
      sampleLimit: Number(args["sample-pages"]),
      workDir: path.join(HERE, ".wpmig/mirror-tmp"),
    });

    for (const w of result.report.warnings) console.log(`  ! ${w}`);
    console.log(
      `\nscanned ${result.report.pages} page(s), sampled ${result.report.sampled} for colors/type, ${result.seoResults.length} for SEO/images`
    );

    // ---- colors / tokens --------------------------------------------------
    const stylesDir = path.relative(targetRoot, path.join(targetRoot, "src/styles"));
    writer.write(path.join(stylesDir, "source/_tokens.pcss"), emitTokens(result.artifact), {
      gen: "wpmig-extract",
    });
    if (result.artifact.ramp) {
      writer.write(path.join(stylesDir, "source/_ramp.pcss"), emitRamp(result.artifact.ramp), {
        gen: "wpmig-extract",
      });
    }
    patchRegion(
      writer,
      targetRoot,
      path.join(stylesDir, "themes/_default.pcss"),
      "source-theme",
      emitSemanticOverrides(result.artifact)
    );

    const dataDir = path.relative(targetRoot, path.join(targetRoot, "src/data"));
    const brandPatch = brandingPatch(result.artifact, result.artifact.measured);
    // Fonts: point at the now-locally-copied stylesheets, not the source's.
    if (result.fontResult.fontLinks.length) brandPatch.fontLinks = result.fontResult.fontLinks;
    // The sampled page's links are not necessarily every font the site uses.
    const extraFonts = ensureFamilySheets({
      families: [brandPatch.bodyFont?.fontFamily, brandPatch.headingsFont?.fontFamily].filter(
        Boolean
      ),
      staticDir,
      writer,
      have: brandPatch.fontLinks ?? [],
    });
    if (extraFonts.fontLinks?.length) {
      brandPatch.fontLinks = [...extraFonts.fontLinks, ...(brandPatch.fontLinks ?? [])];
      console.log(
        `fonts: recovered ${extraFonts.families.join(", ")} from the snapshot (not linked by the sampled page)`
      );
    }
    patchJson(writer, targetRoot, path.join(dataDir, "branding.json"), brandPatch, {
      replaceKeys: Object.keys(brandPatch),
    });

    console.log(`\ncolor roles: ${JSON.stringify(result.artifact.roles, null, 2)}`);
    console.log(
      `fonts: body=${brandPatch.bodyFont?.fontFamily ?? "—"}  headings=${brandPatch.headingsFont?.fontFamily ?? "—"}`
    );
    console.log(
      `font files: ${result.fontResult.copied.length} copied, ${result.fontResult.missing.length} missing`
    );

    // ---- chrome / site info -------------------------------------------------
    if (result.extracted) {
      const nav = result.buildNavData(
        result.extracted,
        readJson(path.join(targetRoot, dataDir, "mainNav.json")),
        { iconSet: loadIconSet(targetRoot) }
      );
      const footer = result.buildFooterData(
        result.extracted,
        readJson(path.join(targetRoot, dataDir, "footer.json")),
        { iconSet: loadIconSet(targetRoot) }
      );
      const site = result.buildSiteInfo(
        result.extracted,
        readJson(path.join(targetRoot, dataDir, "siteInfo.json")),
        {
          iconSet: loadIconSet(targetRoot),
        }
      );

      const assets = result.collectChromeAssets(result.extracted, {
        mirrorDir: staticDir,
        writer,
        publicDir: "public",
      });

      patchJson(writer, targetRoot, path.join(dataDir, "mainNav.json"), nav, {
        replaceKeys: Object.keys(nav),
      });
      patchJson(writer, targetRoot, path.join(dataDir, "footer.json"), footer, {
        replaceKeys: Object.keys(footer),
      });
      patchJson(writer, targetRoot, path.join(dataDir, "siteInfo.json"), site, {
        replaceKeys: Object.keys(site),
      });

      console.log(`\nsite name: ${result.extracted.siteName || "—"}`);
      console.log(`nav items: ${result.countNav(nav.navData)}`);
      console.log(`office: ${JSON.stringify(site.offices?.[0] ?? {}, null, 2)}`);
      console.log(`socials: ${(site.socials ?? []).map((s) => s.label).join(", ") || "—"}`);
      console.log(
        `chrome assets: ${assets.copied.length} copied, ${assets.missing.length} missing`
      );
      console.log(
        `footer columns: ${(footer.linkColumns ?? []).map((c) => `${c.title || "(brand)"}[${c.links.length}]`).join(" ") || "—"}`
      );
      console.log(
        `header top bar: ${nav.topBar ? `${nav.topBar.label} ${nav.topBar.phone.display}` : "—"}`
      );
    } else {
      console.log("\nno header/footer found — skipping chrome/site-info");
    }

    // ---- SEO ----------------------------------------------------------------
    const seoPatch = {
      name: result.extracted?.siteName || result.homeSeo?.og?.title || "",
      description: result.homeSeo?.description || "",
      logoSource: result.extracted?.header?.logo?.source || "",
      titleFormat: result.titleSuffix ? `{title} | ${result.titleSuffix}` : "{title}",
    };
    patchJson(writer, targetRoot, path.join(dataDir, "seo.json"), seoPatch, {
      replaceKeys: Object.keys(seoPatch),
    });
    console.log(
      `\nseo: title suffix = ${result.titleSuffix ? `"${result.titleSuffix}"` : "(none detected)"}`
    );

    // ---- images ---------------------------------------------------------------
    let imgCopied = 0;
    let imgMissing = 0;
    for (const abs of result.imageUrls) {
      let rel;
      try {
        rel = decodeURIComponent(new URL(abs).pathname).replace(/^\//, "");
      } catch {
        continue;
      }
      if (!rel || /^(https?:)/i.test(rel)) continue;
      const from = path.join(staticDir, rel);
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
        imgMissing++;
        continue;
      }
      writer.writeBinary(path.join("public", rel), fs.readFileSync(from));
      imgCopied++;
    }
    console.log(
      `\nimages: ${result.imageUrls.length} referenced, ${imgCopied} copied/verified, ${imgMissing} missing`
    );

    // ---- summary --------------------------------------------------------------
    console.log(`\n${dryRun ? "[dry run] " : ""}writer summary: ${JSON.stringify(writer.summary)}`);
    if (writer.needsAttention.length) {
      console.log("needs attention:");
      for (const r of writer.needsAttention)
        console.log(`  ${r.outcome}  ${r.path}${r.detail ? `  (${r.detail})` : ""}`);
    }
  },
});
