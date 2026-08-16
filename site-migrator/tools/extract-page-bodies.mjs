#!/usr/bin/env node
/**
 * Fill artisan/page-body from the source for every interior page that uses the
 * sidebar layout.
 *
 * `mig content` mapped this layout to the starter's cta-split-learn-more — a
 * marketing split, not a sidebar — so the section nav was dropped entirely and
 * the copy reflowed full width. The nav, featured image and prose are read
 * straight out of the snapshot here.
 *
 * Usage: node tools/extract-page-bodies.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = path.resolve(ROOT, "../src/content/pages");
const dry = process.argv.includes("--dry-run");
const TARGET = /page-sections\/(ctas\/cta-split-learn-more|features\/feature-grid|builders\/custom-section|ctas\/cta-split)$/;

const EXTRACT = () => {
  const H = document.querySelector('header[data-elementor-type="header"]');
  const secs = [...document.querySelectorAll("section.elementor-top-section, div.elementor-top-section")]
    .filter((s) => !H?.contains(s) && !s.closest('[data-elementor-type="footer"]') && !s.closest('[data-elementor-type="popup"]'));
  // Section 1 is usually the body, but not always — take the one with the most
  // text after the banner.
  const body = secs
    .slice(1)
    .sort((a, b) => (b.innerText || "").length - (a.innerText || "").length)[0];
  if (!body) return null;
  const cols = [...body.querySelectorAll(":scope > .elementor-container > .elementor-column")];
  if (!cols.length) return null;

  // Many interior pages are a single content column with no section nav; only
  // treat a column as a sidebar when there really are two and one is narrower.
  let side = null;
  let main = cols[0];
  if (cols.length >= 2) {
    const [a, b2] = [cols[0], cols[1]];
    const wa = a.getBoundingClientRect().width;
    const wb = b2.getBoundingClientRect().width;
    if (Math.min(wa, wb) / Math.max(wa, wb) < 0.75) {
      [side, main] = wa <= wb ? [a, b2] : [b2, a];
    } else {
      main = body; // two equal columns: keep the whole section as content
    }
  }

  const heading = side?.querySelector(".elementor-heading-title,h2,h3");
  const links = [...(side?.querySelectorAll("a") ?? [])]
    .map((a) => ({
      name: (a.innerText || "").replace(/\s+/g, " ").trim(),
      path: a.getAttribute("href") || "",
      current: a.closest("li")?.className.includes("current") ?? false,
    }))
    .filter((l) => l.name && !/^https?:\/\/(www\.)?(facebook|twitter|x|instagram|linkedin|pinterest)/i.test(l.path));

  const img = main.querySelector("img");
  const content =
    main.querySelector(".elementor-widget-theme-post-content") ??
    main.querySelector(".elementor-widget-text-editor") ??
    main;
  return {
    sidebarHeading: heading ? heading.innerText.trim() : "",
    links,
    image: img ? img.getAttribute("src") : "",
    imageAlt: img ? img.getAttribute("alt") || "" : "",
    body: content ? content.innerHTML : "",
    reverse: Boolean(side) && cols[0] !== side,
  };
};

const fixHref = (h) =>
  !h ? "" : h.replace(/^https?:\/\/[^/]+/, "").replace(/^\/?([a-z0-9-]+)\.html$/i, "/$1/");

const files = fs.readdirSync(PAGES).filter((f) => f.endsWith(".md") && f !== "index.md");
const todo = files.filter((f) => TARGET.test(fs.readFileSync(path.join(PAGES, f), "utf8").match(/_component: (\S+)/g)?.join("\n") ?? "")
  || fs.readFileSync(path.join(PAGES, f), "utf8").split("\n").some((l) => TARGET.test(l.trim().replace("- _component: ", "").replace("_component: ", ""))));

const { server, url } = await serve(path.join(ROOT, "static"), 0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let done = 0, skipped = 0, images = new Set();
for (const f of todo) {
  const id = f.replace(/\.md$/, "");
  const src = path.join(ROOT, "static", `${id}.html`);
  if (!fs.existsSync(src)) { skipped++; continue; }
  await page.goto(`${url}/${id}.html`, { waitUntil: "load" }).catch(() => {});
  const data = await page.evaluate(EXTRACT);
  if (!data || (!data.body && !data.links.length)) { skipped++; continue; }

  const p = path.join(PAGES, f);
  const raw = fs.readFileSync(p, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = YAML.parse(m[1]);
  let replaced = false;
  fm.pageSections = (fm.pageSections ?? []).map((s) => {
    if (!TARGET.test(s._component ?? "") || replaced) return s;
    replaced = true;
    if (data.image) images.add(data.image);
    return {
      _component: "page-sections/artisan/page-body",
      id: "",
      sidebarHeading: data.sidebarHeading,
      links: data.links.map((l) => ({ ...l, path: fixHref(l.path) })),
      image: data.image || "",
      imageAlt: data.imageAlt,
      body: data.body,
      backgroundColor: "transparent",
      headingBackground: "#321c0e",
      headingColor: "#ffffff",
      linkColor: "#222222",
      textColor: "#686868",
      reverse: data.reverse,
    };
  });
  // drop any further generic blocks the same source section produced
  fm.pageSections = fm.pageSections.filter((s, i) => !(replaced && i > 0 && TARGET.test(s._component ?? "")));
  delete fm._migUnmapped;
  if (!dry) fs.writeFileSync(p, `---\n${YAML.stringify(fm, { lineWidth: 0 })}---\n${m[2]}`);
  done++;
}

await browser.close();
server.close();

// port the featured images
let copied = 0;
for (const ref of images) {
  const rel = ref.replace(/^\//, "");
  const from = path.join(ROOT, "static", rel);
  const to = path.resolve(ROOT, "../public", rel);
  if (!fs.existsSync(from) || fs.existsSync(to)) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++;
}

console.log(`${dry ? "[dry run] " : ""}page-body: ${done} page(s) filled, ${skipped} skipped, ${copied} image(s) ported`);
