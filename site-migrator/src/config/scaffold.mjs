import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAME, COMPONENT_MAP_FILENAME } from "./load.mjs";
import {
  detectAssets,
  classifyStylesheet,
  isSiteScript,
  localise,
  readEntryPage,
} from "./detect.mjs";

/**
 * `mig init` output. The config file is the primary human interface for a
 * migration, so it ships heavily annotated — every knob here exists because the
 * previous toolkit hardcoded the equivalent and had to be edited per site.
 */

const CONFIG_TEMPLATE = (source, targetRoot, stylesheetsBlock = " []", scriptsBlock = " []") => `# Migration config. This is the only file that should contain
# knowledge about the site being migrated.

source:
  # A live URL, or file:./static for a local mirror (wget dump, cPanel export).
  # A local mirror is preferred: it makes every stage deterministic and offline.
  base: ${source}
  entry:
    - sitemap.xml
  exclude:
    - "/thanks.html"
    - "/sitemap.html"

  # Order matters — this is the cascade order the port replays.
  # Mark font/icon stylesheets so they are handled rather than inlined:
  #   - { url: "https://use.typekit.net/xxxx.css", role: font-service }
  #   - { url: "https://example.com/fontello.css", role: icon-font }
  stylesheets:${stylesheetsBlock}

  # Scanned for plugin option objects (carousel autoplay, arrows, drag...).
  scripts:${scriptsBlock}

  # 'auto' detects the root font-size from the source CSS. Only used to
  # normalise rem on emit; the source's own html{font-size} is never ported.
  rootFontSizePx: auto

target:
  # Relative to this file. ".." is correct when the toolkit sits inside the
  # site repo, which is how it is meant to be used.
  root: ${targetRoot}
  preset: cloudcannon-astro-starter

segmentation:
  # Never treated as page sections; candidates for synthesis instead.
  chrome:
    header: "body > header"
    footer: "body > footer"
  roots: ["main"]

  # Viewport segmentation runs at. Must be a width where the source's own JS has
  # applied its desktop DOM restructuring — some sites move nodes only above a
  # breakpoint, so the post-JS tree genuinely differs by viewport.
  viewport: 1280

  rules:
    # Pages built from real <section> elements.
    - id: real-sections
      mode: element
      selector: "main section, main > section"

    # Pages that are a flat prose blob: cut the flow into sections instead.
    # - id: flow-content
    #   mode: flow
    #   within: "#page"
    #   cutBefore: [".why", ".page-divider > .block", "h2"]
    #   glue: ["h2 + img", "img + p"]
    #   minTextLength: 40

# Stripped before fingerprinting, so cosmetic and runtime-injected markup does
# not fork one visual pattern into many "unique" shapes. Regex, matched whole.
noise:
  classes:
    - "wow"
    - "fade\\\\w*"
    - "animated"
    - "aos-\\\\w+"
    - "slick-\\\\w+"
  attributes:
    - "data-wow-.*"
    - "data-aos.*"
  ids: []

fingerprint:
  clusterThreshold: 0.22
  maxClusters: 25
  # Features that are content variance, not identity — they become props.
  # Anything the source alternates by index (left/right image) belongs here.
  propFeatures: [imageSide, buttonCount, imageCount, textAlign, hasOwnBackground]

# Areas that get bespoke components generated from the source markup, with the
# original class names and CSS preserved. Everything else maps to the template's
# library components.
synthesize:
  - name: SiteHeader
    match: "body > header"
    dir: navigation/site-header
    layer: components
    bare: true
  - name: SiteFooter
    match: "body > footer"
    dir: navigation/site-footer
    layer: components
    bare: true
  # - pages: ["/index.html"]
  #   all: true
  #   dir: page-sections/homepage-blocks

props:
  buttonClassPattern: "^btn(-alt)?$"
  # Collapse consecutive unclassed paragraphs into one markdown prop. Without
  # this a five-paragraph block becomes body1..body5 and an unusable CMS panel.
  proseCollapse: true
  maxColorInputs: 12

embeds:
  - { match: "iframe[src*='google.com/maps']", prop: mapEmbedUrl, from: "attr:src" }
  - { match: "iframe[src*='youtube']", prop: youtubeId, from: "attr:src" }
  - { match: "iframe", prop: embedUrl, from: "attr:src" }

behaviors:
  jsPluginCalls: [slick, slider, carousel, foundation]
  propMap:
    autoplaySpeed: autoplayDelay
    autoplay: autoPlay
    dots: showDots
    arrows: showArrows
    draggable: drag
    slidesToShow: slidesPerView

css:
  tokenize:
    # Rewrite ported color literals to var(--token, #literal) where they match a
    # branding token, so the ported header/footer follow branding.json changes
    # while still rendering the original color if a var is unset.
    enabled: true
    maxDeltaE: 0.02
  # Selectors emitted verbatim, never prefixed (globally unique IDs).
  noScope: []

urls:
  stripExtension: true
  index: { from: "/index.html", to: "/" }
  trailingSlash: always

qa:
  breakpoints: [375, 550, 750, 1024, 1280, 1600]
  layoutDiffMaxPercent: 2
  # Below this width the source's JS may build a different DOM, so the layout
  # budget loosens rather than reporting a false failure.
  mobileStructureBreakpoint: 1025
  mobileLayoutDiffMaxPercent: 5

interactions: []
`;

const COMPONENT_MAP_TEMPLATE = `# Cluster -> library component. Written once, after reviewing
# .migration/scan/contact-sheet.html. Expect roughly 10 entries.
#
# Only internal-page clusters need mapping; anything listed under \`synthesize\`
# in migration.config.yml gets its own generated component instead.

clusters: {}
#   interior-hero:   { component: page-sections/heroes/hero-banner }
#   why-list:        { component: page-sections/info-blocks/why }
#   divider-block:
#     component: page-sections/ctas/cta-split
#     propOverrides:
#       reverse: "$feature.imageSide == 'left'"
#   faq-accordion:   { component: page-sections/info-blocks/faq-section }
#   more-to-explore: { component: page-sections/ctas/more-to-explore }
`;

/**
 * Detect whether we are sitting inside the site repo we are meant to migrate.
 *
 * The toolkit is designed to be copied into a repo, run, then deleted, so the
 * common case is a subdirectory whose parent is the site. Working that out here
 * means the scaffolded config points at the right tree without being told.
 */
function detectTargetRoot(dir) {
  const parent = path.dirname(dir);
  const markers = ["astro.config.mjs", "cloudcannon.config.yml", "package.json"];
  const inParent = markers.some((m) => fs.existsSync(path.join(parent, m)));
  const inSelf = markers.some((m) => fs.existsSync(path.join(dir, m)));

  // A package.json of our own is the toolkit's, not the site's.
  const selfIsToolkit = fs.existsSync(path.join(dir, "bin", "mig.mjs"));
  if (inParent && (selfIsToolkit || !inSelf)) return "..";
  return ".";
}

/**
 * Render the stylesheet list a site actually loads, in document order.
 *
 * Order is the cascade, so it is preserved exactly as the page states it.
 */
function renderStylesheets(hrefs) {
  if (!hrefs.length) return " []";
  return (
    "\n" +
    hrefs
      .map((href) => {
        const role = classifyStylesheet(href);
        const target = localise(href);
        return role === "stylesheet"
          ? `    - ${target}`
          : `    - { url: "${href}", role: ${role} }`;
      })
      .join("\n")
  );
}

function renderScripts(srcs) {
  const own = srcs.filter(isSiteScript).map(localise);
  if (!own.length) return " []";
  return "\n" + own.map((s) => `    - ${s}`).join("\n");
}

export function scaffoldConfig(dir, { source = "file:./static", force = false } = {}) {
  const written = [];
  const targetRoot = detectTargetRoot(dir);

  // Paths in the config are relative to the config file, so a source mirror
  // inside the site repo needs to reach back up too.
  if (targetRoot === ".." && source.startsWith("file:./")) {
    source = source.replace("file:./", "file:../");
  }

  // Read the site's own markup rather than asking for what it already states.
  let stylesheetsBlock = " []";
  let scriptsBlock = " []";
  let detected = null;

  if (source.startsWith("file:")) {
    const sourceDir = path.resolve(dir, source.slice("file:".length));
    if (fs.existsSync(sourceDir)) {
      const html = readEntryPage(sourceDir);
      if (html) {
        detected = detectAssets(html);
        stylesheetsBlock = renderStylesheets(detected.stylesheets);
        scriptsBlock = renderScripts(detected.scripts);
      }
    }
  }

  const configPath = path.join(dir, CONFIG_FILENAME);
  if (force || !fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      CONFIG_TEMPLATE(source, targetRoot, stylesheetsBlock, scriptsBlock),
      "utf8"
    );
    written.push(CONFIG_FILENAME);
  }

  const mapPath = path.join(dir, COMPONENT_MAP_FILENAME);
  if (force || !fs.existsSync(mapPath)) {
    fs.writeFileSync(mapPath, COMPONENT_MAP_TEMPLATE, "utf8");
    written.push(COMPONENT_MAP_FILENAME);
  }

  return { written, detected };
}
