/**
 * Re-apply link rewriting to output that is already on disk.
 *
 * Link repair is part of generation, so the normal way to pick up a change to
 * it is to regenerate. That means re-capturing every page in a browser, which
 * for a whole site is hours of work to change some strings — and the rewrite is
 * a pure function of the URL, identical whether it runs during generation or
 * afterwards. This applies it in place instead, over the emitted pages, the
 * component defaults and the site's chrome data.
 *
 * Only values that are actually links are touched: `href="…"` attributes and
 * YAML/JS values whose key names one (`link`, `buttonLink`, `path`, …). A blind
 * search-and-replace over the file would also hit image paths that happen to
 * share a slug.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { rewriteHref, useRouteMap } from "../src/generate/props.mjs";
import { loadRouteMap } from "../src/snapshot/routes.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Source page URLs, filled in from the route map at run time. */
let KNOWN_PAGES = [];

// Trailing digits included: prop names are de-duplicated by suffix, so a
// section with several buttons emits `buttonLink`, `buttonLink2`, … and a
// pattern anchored at the end matches none of them.
const LINK_KEY = /(?:^|[a-z])(?:link|href|path|url)\d*$/i;

function walkFiles(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/**
 * Posts moved: WordPress served them at the site root, the target serves the
 * collection under /blog/. Cross-links between posts, and links to posts from
 * pages, still point at the old root path — which the route map cannot repair,
 * because a post is not one of the pages it knows about. The target's own blog
 * directory is the authority for what moved.
 */
function loadPostRoutes(targetRoot) {
  const dir = path.join(targetRoot, "src/content/blog");
  if (!fs.existsSync(dir)) return new Map();
  const moved = new Map(
    fs
      .readdirSync(dir)
      .filter((f) => /\.mdx?$/.test(f))
      .map((f) => {
        const slug = f.replace(/\.mdx?$/, "");
        return [`/${slug}/`, `/blog/${slug}`];
      })
  );
  // The listing moved too: WordPress served it wherever the page sat in the
  // menu (`/about-us/blog/`), the target serves it at /blog/ from the
  // collection, so the migrated stub page does not exist.
  for (const url of KNOWN_PAGES) {
    if (/\/blog\/$/.test(url)) moved.set(url, "/blog/");
  }
  return moved;
}

/** Rewrite every link-shaped value in one file's text. */
function relinkText(text, postRoutes = new Map()) {
  let changed = 0;
  const fix = (value) => {
    const moved = postRoutes.get(value) ?? postRoutes.get(`${value}/`);
    const next = moved ?? rewriteHref(value);
    if (next !== value) changed++;
    return next;
  };

  let out = text.replace(/href="([^"]*)"/g, (m, href) => `href="${fix(href)}"`);
  // Markdown links in imported post prose: [text](/meet-the-team/)
  out = out.replace(/\]\((\/[^)\s]*)\)/g, (m, href) => `](${fix(href)})`);
  // YAML scalars: `buttonLink: /meet-the-team/`, quoted or bare.
  out = out.replace(
    /^(\s*(?:- )?)([\w]+):\s*(["']?)(\/[^\s"'#][^\s"']*|https?:\/\/[^\s"']+)\3\s*$/gm,
    (m, indent, key, quote, value) =>
      LINK_KEY.test(key) ? `${indent}${key}: ${quote}${fix(value)}${quote}` : m
  );
  // JS/Astro prop defaults: `buttonLink = "/meet-the-team/"`.
  out = out.replace(/(\b[\w]+)(\s*=\s*)"([^"]*)"/g, (m, key, eq, value) =>
    LINK_KEY.test(key) ? `${key}${eq}"${fix(value)}"` : m
  );
  // JSON: `"link": "/meet-the-team/"`.
  out = out.replace(/"([\w]+)":\s*"([^"]*)"/g, (m, key, value) =>
    LINK_KEY.test(key) ? `"${key}": "${fix(value)}"` : m
  );
  return { out, changed };
}

export const devRelink = defineCommand({
  meta: {
    name: "dev-relink",
    description: "Re-apply link rewriting to already-generated pages, components and chrome data.",
  },
  args: {
    static: {
      type: "string",
      description: "Snapshot directory",
      default: path.join(HERE, ".wpmig/static"),
    },
    target: { type: "string", description: "Target repo root", default: path.join(HERE, "..") },
    namespace: { type: "string", description: "Generated component namespace", default: "wpmig" },
    write: {
      type: "boolean",
      description: "Actually write (default is a dry run)",
      default: false,
    },
  },
  async run({ args }) {
    const targetRoot = path.resolve(args.target);
    const routes = loadRouteMap(path.resolve(args.static));
    useRouteMap(routes);
    KNOWN_PAGES = [...routes.values()];

    const files = [
      ...walkFiles(path.join(targetRoot, "src/content/pages"), [".md"]),
      ...walkFiles(path.join(targetRoot, "src/components/page-sections", args.namespace), [
        ".astro",
        ".yml",
      ]),
      ...walkFiles(path.join(HERE, ".wpmig/out/pages"), [".md"]),
      // Imported posts carry the same legacy links in their prose.
      ...walkFiles(path.join(targetRoot, "src/content/blog"), [".mdx", ".md"]),
      path.join(targetRoot, "src/data/mainNav.json"),
      path.join(targetRoot, "src/data/footer.json"),
      path.join(targetRoot, "src/data/siteInfo.json"),
    ].filter((f) => fs.existsSync(f));

    const postRoutes = loadPostRoutes(targetRoot);
    let touched = 0;
    let rewrites = 0;
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      const { out, changed } = relinkText(text, postRoutes);
      if (!changed || out === text) continue;
      touched++;
      rewrites += changed;
      if (args.write) fs.writeFileSync(file, out);
    }

    console.log(
      `${rewrites} link(s) rewritten across ${touched} file(s) of ${files.length}` +
        (args.write ? "" : " — dry run, pass --write to apply")
    );
  },
});
