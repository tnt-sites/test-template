import fs from "node:fs";
import path from "node:path";
import * as parse5 from "parse5";

/**
 * Work out a site's configuration by reading the site.
 *
 * Nearly everything an operator would otherwise type is already stated in the
 * source's own markup: which stylesheets it loads and in what order, which
 * scripts drive its widgets, where its header and footer are. Asking for it
 * again is just an opportunity to get it wrong.
 */

const FONT_SERVICE_HOSTS = [
  "fonts.googleapis.com",
  "use.typekit.net",
  "fonts.bunny.net",
  "cloud.typography.com",
  "fast.fonts.net",
];

function walkNodes(node, visit) {
  for (const child of node.childNodes ?? []) {
    if (child.tagName) visit(child);
    walkNodes(child, visit);
    if (child.content) walkNodes(child.content, visit);
  }
}

const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value ?? null;

/**
 * Stylesheets and scripts, in the order the document loads them.
 *
 * Order is the cascade, so it has to be preserved exactly as the page states
 * it — a reordered list produces colours that are individually right and
 * collectively wrong.
 */
export function detectAssets(html) {
  const doc = parse5.parse(html);
  const stylesheets = [];
  const scripts = [];

  walkNodes(doc, (node) => {
    const tag = node.tagName.toLowerCase();

    if (tag === "link") {
      const rel = (attr(node, "rel") ?? "").toLowerCase();
      const href = attr(node, "href");
      if (!href || !rel.split(/\s+/).includes("stylesheet")) return;
      stylesheets.push(href);
      return;
    }

    if (tag === "script") {
      const src = attr(node, "src");
      if (!src) return;
      scripts.push(src);
    }
  });

  return { stylesheets, scripts };
}

/** Classify a stylesheet so fonts and icon fonts are handled, not inlined. */
export function classifyStylesheet(href, { iconHints = /fontello|icomoon|iconfont|glyph/i } = {}) {
  let host = "";
  try {
    host = new URL(href).host;
  } catch {
    /* relative */
  }

  if (FONT_SERVICE_HOSTS.some((h) => host.endsWith(h))) return "font-service";
  if (iconHints.test(href)) return "icon-font";
  return "stylesheet";
}

/**
 * Scripts worth scanning for widget settings.
 *
 * Libraries themselves carry no configuration — the site's own script is where
 * the carousel speed and arrow visibility are set — so vendor bundles are
 * excluded to keep the scan focused and fast.
 */
const VENDOR_SCRIPT = /jquery|bootstrap|modernizr|popper|slick(\.min)?\.js|swiper|gsap|analytics|gtag|gtm|recaptcha|hotjar|facebook|pixel/i;

export function isSiteScript(src) {
  if (/^(https?:)?\/\//i.test(src)) return false; // third-party
  // Root-relative paths whose first segment is a hostname are third-party too;
  // tag managers and trackers are commonly served this way.
  if (/^\/[\w-]+\.[\w.-]+\//.test(src)) return false;
  return !VENDOR_SCRIPT.test(src);
}

/**
 * Find the element that holds the page's content sections.
 *
 * Returns candidate selectors ordered by how section-like their children are.
 * A container whose children are mostly sizeable, similarly-shaped blocks is
 * the content root; one with a couple of large children is usually a layout
 * wrapper a level too high.
 */
export const DETECT_SECTION_ROOTS = `
(function detectSectionRoots(chromeSelectors) {
  const chrome = chromeSelectors.flatMap((s) => {
    try { return [...document.querySelectorAll(s)]; } catch { return []; }
  });
  const inChrome = (el) => chrome.some((c) => c === el || c.contains(el));

  const LIST = /^(ul|ol|dl|table|tbody|tr|nav|select)$/i;

  const visible = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== "none" && cs.visibility !== "hidden" && r.height > 20;
  };

  const selectorFor = (el) => {
    if (el.id) return "#" + el.id;
    const classes = (el.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean);
    if (classes.length) return el.tagName.toLowerCase() + "." + classes[0];
    return el.tagName.toLowerCase();
  };

  /** Shape of an element, for judging whether siblings are alike. */
  const signature = (el) =>
    el.tagName + ":" + [...el.children].map((c) => c.tagName).slice(0, 6).join(",");

  /**
   * Are a container's children sections in their own right, or parts of one?
   *
   * A run of similar, substantial blocks is a list of sections. A handful of
   * dissimilar fragments — a heading, an image, a lead paragraph — is one
   * section that has been split into pieces, often by the source site's own
   * scripts wrapping things for layout. Cutting at the wrong level turns a
   * single banner into three meaningless sections.
   */
  const childrenAreSections = (kids) => {
    if (kids.length < 2) return false;

    // Explicit sectioning markup settles it.
    if (kids.filter((k) => k.tagName === "SECTION" || k.tagName === "ARTICLE").length >= 2) {
      return true;
    }

    const shapes = new Set(kids.map(signature));
    const homogeneity = 1 - (shapes.size - 1) / Math.max(1, kids.length - 1);

    const substantial = kids.filter(
      (k) => (k.textContent || "").trim().length > 80 && k.getBoundingClientRect().height > 60
    ).length;
    const substantialShare = substantial / kids.length;

    // Many similar, meaty children: a section list. Few mixed fragments: parts.
    if (kids.length >= 4 && substantialShare >= 0.5) return true;
    return homogeneity >= 0.5 && substantialShare >= 0.6;
  };

  const candidates = [];
  const roots = document.querySelectorAll("main, main *, body > div, body > div *");

  for (const el of roots) {
    if (inChrome(el)) continue;
    // A list is content inside a section, never the container of sections.
    if (LIST.test(el.tagName)) continue;

    const kids = [...el.children].filter(visible);
    if (kids.length < 2) continue;
    if (kids.every((k) => LIST.test(k.tagName) || k.tagName === "LI")) continue;

    const heights = kids.map((k) => k.getBoundingClientRect().height);
    const covered = heights.reduce((a, b) => a + b, 0);
    const total = el.getBoundingClientRect().height || 1;
    const coverage = Math.min(1, covered / total);

    const withText = kids.filter((k) => (k.textContent || "").trim().length > 40).length;
    const textShare = withText / kids.length;

    const asSections = childrenAreSections(kids);

    candidates.push({
      selector: selectorFor(el),
      // Either the children are the sections, or this element is one.
      childSelector: asSections ? selectorFor(el) + " > *" : selectorFor(el),
      level: asSections ? "children" : "self",
      children: kids.length,
      coverage: Number(coverage.toFixed(2)),
      textShare: Number(textShare.toFixed(2)),
      score: Number((coverage * 0.4 + textShare * 0.4 + Math.min(kids.length, 8) / 8 * 0.2).toFixed(3)),
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 8);
})
`;

/** Read the source's own markup for the chrome elements. */
export const DETECT_CHROME = `
(function detectChrome() {
  const pick = (candidates) => {
    for (const selector of candidates) {
      try {
        const el = document.querySelector(selector);
        if (el && el.getBoundingClientRect().height > 20) return selector;
      } catch { /* unsupported */ }
    }
    return null;
  };

  return {
    header: pick(["body > header", "header", "#header", ".header", "body > .header"]),
    footer: pick(["body > footer", "footer", "#footer", ".footer", "body > .footer"]),
  };
})
`;

/** Resolve a source-relative href against the mirror. */
export function localise(href) {
  if (/^https?:\/\//i.test(href)) return href;
  return href.replace(/^\.?\//, "");
}

/** Read the source's landing page from a local mirror. */
export function readEntryPage(dir) {
  for (const name of ["index.html", "index.htm", "home.html"]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  const first = fs.readdirSync(dir).find((f) => /\.html?$/i.test(f));
  return first ? fs.readFileSync(path.join(dir, first), "utf8") : null;
}
