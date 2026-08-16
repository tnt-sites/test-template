#!/usr/bin/env node
/**
 * WordPress (WXR) -> Astro MDX blog import.
 *
 * The site-migrator pipeline cannot produce blog posts: `mig content` only ever
 * emits `pageSections` front matter, while src/pages/blog/[...slug].astro renders
 * an MDX prose body. So posts come from the XML export instead, which also
 * carries excerpts, authors, dates and taxonomy the rendered DOM does not.
 *
 * Two things drive the design of the body conversion:
 *
 *   1. This export is MIXED. 86 of 204 posts are Gutenberg (`<!-- wp:paragraph -->`
 *      and friends); the other 118 are classic wpautop HTML with no block
 *      comments at all. A block-comment walker — which is what the previous
 *      version of this script was — emits an EMPTY body for those 118. Since
 *      Gutenberg always serialises to valid HTML *between* its comments, the
 *      reliable move is to strip the comments and convert the HTML uniformly.
 *      That also picks up block types a walker would have to special-case
 *      (tables, columns, galleries, covers, groups, buttons).
 *
 *   2. The output is MDX, not Markdown. MDX parses `{...}` as an expression and
 *      `<tag>` as JSX, so raw WordPress HTML and stray braces are build errors
 *      rather than stray text. Everything is sanitised for that before writing.
 *
 * Filenames are `<wp:post_name>.mdx` with no date prefix: the blog route derives
 * its slug from the filename, so a date prefix would change all 204 live URLs.
 * The starter's own demo posts use a date prefix, but they are being deleted.
 *
 * Usage:
 *   node tools/import-wordpress.mjs --xml ../artisan….xml
 *   node tools/import-wordpress.mjs --xml … --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPO = path.resolve(ROOT, "..");

const DEFAULTS = {
  xml: path.join(REPO, "artisandentalinmadisonwi.WordPress.2026-08-16.xml"),
  out: path.join(REPO, "src/content/blog"),
  images: path.join(REPO, "public/assets/images/blog"),
  // The page snapshot already pulled much of /wp-content/uploads/ to disk;
  // prefer those bytes over re-fetching from a ~4s-TTFB origin.
  reuse: path.join(ROOT, "static"),
  host: "artisandentalmadison.com",
  altHosts: ["scott-andersen.eblocks.io"],
  concurrency: 4,
  purgeDemo: true,
  ogFallback: true,
  dryRun: false,
};

// dc:creator gives WordPress login names; without this the blog ships 204 posts
// bylined "lindsayh".
const AUTHOR_MAP = {
  lindsayh: "Artisan Dental",
  tntadmin: "Artisan Dental",
};

const UA = "Mozilla/5.0 (compatible; site-migrator wp-import)";

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-purge-demo") args.purgeDemo = false;
    else if (a === "--no-og-fallback") args.ogFallback = false;
    else if (a === "--xml") args.xml = path.resolve(argv[++i]);
    else if (a === "--out") args.out = path.resolve(argv[++i]);
    else if (a === "--images") args.images = path.resolve(argv[++i]);
    else if (a === "--reuse") args.reuse = path.resolve(argv[++i]);
    else if (a === "--host") args.host = argv[++i];
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pool(items, size, worker) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      while (queue.length) await worker(queue.shift());
    })
  );
}

/* ------------------------------------------------------------------ parse */

const val = (v) => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v.__cdata != null) return String(v.__cdata);
  return "";
};

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** postmeta is a repeated element; flatten it to a plain lookup. */
function metaOf(item) {
  const out = new Map();
  for (const m of asArray(item["wp:postmeta"])) {
    out.set(val(m["wp:meta_key"]), val(m["wp:meta_value"]));
  }
  return out;
}

/* ------------------------------------------------------------- entities */

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", reg: "\u00ae",
  trade: "\u2122", copy: "\u00a9", deg: "\u00b0", eacute: "\u00e9",
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED[name.toLowerCase()] ?? whole);
}

/* --------------------------------------------------------------- wpautop */

const BLOCK =
  "address|article|aside|blockquote|details|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul";

/**
 * WordPress's classic auto-paragraph. Applied only to posts with no block
 * comments — Gutenberg output is already fully wrapped, and running this over
 * it would wrap block markup in stray <p>s.
 */
function wpautop(html) {
  let s = html.replace(/\r\n?/g, "\n");
  s = s.replace(new RegExp(`(<(?:${BLOCK})\\b[^>]*>)`, "gi"), "\n\n$1");
  s = s.replace(new RegExp(`(</(?:${BLOCK})>)`, "gi"), "$1\n\n");

  const parts = s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return parts
    .map((part) => {
      // Already a block-level element? Leave it alone.
      if (new RegExp(`^<(?:${BLOCK})\\b`, "i").test(part)) return part;
      if (/^<!--/.test(part)) return part;
      return `<p>${part.replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n\n");
}

/* ------------------------------------------------------- html -> markdown */

function makeTurndown() {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
  td.use(gfm);
  td.remove(["script", "style", "noscript"]);

  // h1 is the post title, which lives in front matter — demote so a post body
  // never opens with a second document-level heading.
  td.addRule("demoteH1", {
    filter: ["h1"],
    replacement: (content) => `\n\n## ${content.trim()}\n\n`,
  });

  // Superscript/subscript would otherwise become stray text with a space
  // ("3<sup>rd</sup>" -> "3 rd"). Keep the character, drop the tag.
  td.addRule("supSub", {
    filter: ["sup", "sub"],
    replacement: (content) => content,
  });

  return td;
}

/**
 * MDX parses `{...}` as a JS expression and `<tag>` as JSX. WordPress prose
 * contains both incidentally, so anything that survived the HTML conversion is
 * neutralised here rather than becoming a build failure across 204 files.
 */
function sanitiseForMdx(md) {
  const fences = [];
  // Protect fenced code, which is allowed to contain anything.
  let out = md.replace(/```[\s\S]*?```/g, (m) => {
    fences.push(m);
    return `\u0000FENCE${fences.length - 1}\u0000`;
  });

  out = out
    .replace(/<!--[\s\S]*?-->/g, "")
    // Any tag turndown did not convert. Autolinks (<https://…>) are preserved.
    .replace(/<(?!https?:\/\/)[^\n>]*>/g, "")
    .replace(/([{}])/g, "\\$1");

  return out.replace(/\u0000FENCE(\d+)\u0000/g, (_, i) => fences[Number(i)]);
}

function tidyMarkdown(md) {
  return md
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
}

/* -------------------------------------------------------------------- main */

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.xml)) throw new Error(`XML not found: ${args.xml}`);

  console.log(`Reading ${path.relative(process.cwd(), args.xml)} …`);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "__cdata",
    trimValues: false,
  });
  const doc = parser.parse(fs.readFileSync(args.xml, "utf8"));
  const items = asArray(doc.rss.channel.item);

  const posts = items.filter(
    (i) => val(i["wp:post_type"]) === "post" && val(i["wp:status"]) === "publish"
  );
  const attachments = items.filter((i) => val(i["wp:post_type"]) === "attachment");
  console.log(`  ${items.length} items -> ${posts.length} published posts, ${attachments.length} attachments`);

  /* ---- attachment index ------------------------------------------------ */
  // Three lookups, because bodies and thumbnails reference attachments three
  // different ways: by post id (_thumbnail_id), by exact URL, and by a
  // generated size variant (…-1024x682.jpg) of the original.
  const byId = new Map();
  const byUrl = new Map();
  const byBasename = new Map();

  for (const a of attachments) {
    const url = val(a["wp:attachment_url"]);
    if (!url) continue;
    const id = String(val(a["wp:post_id"]));
    byId.set(id, url);
    byUrl.set(url, url);

    const base = path.posix.basename(new URL(url, `https://${args.host}`).pathname);
    byBasename.set(base, url);

    // _wp_attachment_metadata enumerates the exact generated size filenames —
    // more reliable than regex-stripping a -WxH suffix.
    const meta = metaOf(a).get("_wp_attachment_metadata") ?? "";
    for (const m of meta.matchAll(/"file";s:\d+:"([^"]+)"/g)) {
      byBasename.set(path.posix.basename(m[1]), url);
    }
    const stem = base.replace(/\.[a-z0-9]+$/i, "");
    byBasename.set(`stem:${stem}`, url);
  }

  const hostRe = new RegExp(
    `https?://(?:www\\.)?(?:${[args.host, ...args.altHosts].map((h) => h.replace(/\./g, "\\.")).join("|")})`,
    "gi"
  );

  /** Resolve any image reference to the canonical original attachment URL. */
  const originalFor = (src) => {
    // convert() strips the host before this runs, so most refs arrive
    // root-relative. Re-absolutise, or the download step later gets a path
    // fetch() cannot parse.
    let abs = src.replace(hostRe, `https://${args.host}`);
    if (abs.startsWith("/")) abs = `https://${args.host}${abs}`;
    if (byUrl.has(abs)) return abs;
    let base;
    try {
      base = path.posix.basename(new URL(abs, `https://${args.host}`).pathname);
    } catch {
      return abs;
    }
    if (byBasename.has(base)) return byBasename.get(base);
    const stem = base.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, "$1").replace(/\.[a-z0-9]+$/i, "");
    return byBasename.get(`stem:${stem}`) ?? abs;
  };

  const wanted = new Map(); // remote original URL -> local /assets path
  const localFor = (src) => {
    const original = originalFor(src);
    if (wanted.has(original)) return wanted.get(original);
    let base;
    try {
      base = path.posix.basename(new URL(original, `https://${args.host}`).pathname);
    } catch {
      return src;
    }
    if (!base || !/\.[a-z0-9]+$/i.test(base)) return src;
    const local = `/assets/images/blog/${base}`;
    wanted.set(original, local);
    return local;
  };

  /* ---- body conversion ------------------------------------------------- */
  const td = makeTurndown();

  const convert = (rawContent) => {
    let html = rawContent.replace(hostRe, "");

    const hadBlocks = /<!--\s*wp:/.test(html);
    html = html.replace(/<!--\s*\/?wp:[a-z0-9/-]+(\s+\{[\s\S]*?\})?\s*\/?-->/g, "");
    if (!hadBlocks) html = wpautop(html);

    // Elementor/Gutenberg spacers carry no prose and turn into stray blank
    // blocks; drop them before conversion.
    html = html.replace(/<div[^>]*\bstyle="[^"]*height:\s*\d+px[^"]*"[^>]*>\s*<\/div>/gi, "");

    // iframes are JSX in MDX. Keep the URL as a link rather than dropping it.
    html = html.replace(/<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/iframe>/gi, (_, src) => {
      const url = src.startsWith("//") ? `https:${src}` : src;
      return `<p><a href="${url}">${url}</a></p>`;
    });

    // Point images and internal links at their migrated destinations.
    html = html.replace(/<img\b[^>]*>/gi, (tag) =>
      tag
        .replace(/\bsrc=(["'])([^"']+)\1/i, (_, q, s) => `src=${q}${localFor(s)}${q}`)
        // srcset lists size variants that all collapse to one local file.
        .replace(/\s+(?:data-)?srcset=(["'])[^"']*\1/gi, "")
        .replace(/\s+sizes=(["'])[^"']*\1/gi, "")
    );

    const firstImage = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] ?? null;

    let md = td.turndown(html);
    md = sanitiseForMdx(md);
    md = tidyMarkdown(md);
    return { markdown: md, firstImage };
  };

  /* ---- per-post -------------------------------------------------------- */
  const records = [];
  for (const p of posts) {
    const meta = metaOf(p);
    const slug = val(p["wp:post_name"]).trim();
    if (!slug) continue;

    const { markdown, firstImage } = convert(val(p["content:encoded"]));

    let description = decodeEntities(val(p["excerpt:encoded"]))
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!description) {
      const firstPara = markdown.split("\n\n").find((b) => !/^[#\-!>|]/.test(b)) ?? "";
      const plain = firstPara.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*\\]/g, "");
      description =
        plain.length > 180 ? `${plain.slice(0, 177).replace(/\s+\S*$/, "")}…` : plain;
    }
    if (!description) description = decodeEntities(val(p.title)).trim();

    const tags = [
      ...new Set(
        asArray(p.category)
          .filter((c) => ["category", "post_tag"].includes(c["@_domain"]))
          .map((c) => decodeEntities(val(c)).trim())
          .filter((t) => t && t.toLowerCase() !== "uncategorized")
      ),
    ];

    const creator = decodeEntities(val(p["dc:creator"])).trim();
    const dateRaw = val(p["wp:post_date_gmt"]) || val(p["wp:post_date"]);
    const parsed = new Date(`${dateRaw.replace(" ", "T")}Z`);
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

    // Tier 1: the declared featured image. Tier 3 (first inline image) is set
    // here; tier 2 (og:image) is filled in below for whatever is still missing.
    const thumbId = meta.get("_thumbnail_id");
    const thumbUrl = thumbId ? byId.get(String(thumbId)) : null;
    const image = thumbUrl ? localFor(thumbUrl) : firstImage;

    records.push({
      slug,
      title: decodeEntities(val(p.title)).trim() || slug,
      description,
      date,
      author: AUTHOR_MAP[creator] ?? creator ?? "Artisan Dental",
      image: image ?? null,
      imageSource: thumbUrl ? "thumbnail" : firstImage ? "inline" : "none",
      tags,
      markdown,
      link: val(p.link),
    });
  }

  /* ---- tier 2: og:image for posts with no resolvable featured image ---- */
  const needsOg = records.filter((r) => !r.image);
  if (args.ogFallback && needsOg.length) {
    console.log(`Resolving ${needsOg.length} featured images via og:image …`);
    let done = 0;
    await pool(needsOg, 3, async (rec) => {
      try {
        const res = await fetch(rec.link || `https://${args.host}/blog/${rec.slug}/`, {
          headers: { "User-Agent": UA },
        });
        if (res.ok) {
          const html = await res.text();
          const og = html.match(
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
          )?.[1];
          if (og) {
            rec.image = localFor(og);
            rec.imageSource = "og";
          }
        }
      } catch {
        /* leave unset; `image` is optional in the schema */
      }
      if (++done % 25 === 0) console.log(`  … ${done}/${needsOg.length}`);
      await sleep(120);
    });
  }

  /* ---- images ---------------------------------------------------------- */
  console.log(`Collecting ${wanted.size} referenced images …`);
  let copied = 0;
  let downloaded = 0;
  const imageFailures = [];

  if (!args.dryRun) {
    fs.mkdirSync(args.images, { recursive: true });
    await pool([...wanted.entries()], args.concurrency, async ([url, local]) => {
      const dest = path.join(args.images, path.basename(local));
      if (fs.existsSync(dest)) return;

      // Prefer bytes the page snapshot already fetched.
      let pathname;
      try {
        pathname = new URL(url, `https://${args.host}`).pathname;
      } catch {
        pathname = null;
      }
      const cached = pathname ? path.join(args.reuse, pathname.replace(/^\//, "")) : null;
      if (cached && fs.existsSync(cached)) {
        fs.copyFileSync(cached, dest);
        copied++;
        return;
      }

      // Old posts reference a /uploads/sites/<n>/ multisite prefix that no
      // longer resolves; the file usually exists one level up.
      const candidates = [url];
      if (/\/uploads\/sites\/\d+\//.test(url)) {
        candidates.push(url.replace(/\/uploads\/sites\/\d+\//, "/uploads/"));
      }

      let lastErr = "no candidate";
      for (const candidate of candidates) {
        try {
          const res = await fetch(candidate, { headers: { "User-Agent": UA } });
          if (!res.ok) {
            lastErr = `HTTP ${res.status}`;
            continue;
          }
          fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
          downloaded++;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err.message;
        }
      }
      if (lastErr) imageFailures.push({ url, reason: lastErr });
    });
  }
  console.log(`  ${copied} reused from snapshot, ${downloaded} downloaded, ${imageFailures.length} failed`);

  /* ---- write ----------------------------------------------------------- */
  const yamlStr = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  // Remove anything in the collection that this export does not account for.
  // Matching on a byline was too narrow — the starter's 11 demo posts are
  // bylined by several fake authors, not just "Alex Smith", so only one was
  // ever caught. The imported slug set is the authoritative list.
  if (args.purgeDemo && !args.dryRun && fs.existsSync(args.out)) {
    const keep = new Set(records.map((r) => `${r.slug}.mdx`));
    let removed = 0;
    for (const f of fs.readdirSync(args.out)) {
      if (!f.endsWith(".mdx") || keep.has(f)) continue;
      fs.unlinkSync(path.join(args.out, f));
      removed++;
    }
    console.log(`Removed ${removed} post(s) not present in the export`);
  }

  if (!args.dryRun) fs.mkdirSync(args.out, { recursive: true });

  // Some 2014-era posts reference images from an old /uploads/sites/7/
  // multisite that 404 at every path on the live server — they are already
  // broken on the source site, so there is nothing to migrate. Drop the
  // references rather than shipping <img> tags that cannot resolve.
  const haveImage = (local) =>
    args.dryRun || fs.existsSync(path.join(args.images, path.basename(local)));
  let droppedImgs = 0;
  let droppedFeatured = 0;

  for (const r of records) {
    r.markdown = r.markdown.replace(/!\[([^\]]*)\]\((\/assets\/images\/blog\/[^)\s]+)\)/g, (whole, alt, src) => {
      if (haveImage(src)) return whole;
      droppedImgs++;
      return "";
    });
    if (r.image && !haveImage(r.image)) {
      r.image = null;
      droppedFeatured++;
    }
    r.markdown = tidyMarkdown(r.markdown);
  }
  if (droppedImgs || droppedFeatured) {
    console.log(`Dropped ${droppedImgs} unresolvable inline image(s) and ${droppedFeatured} featured image(s)`);
  }

  let written = 0;
  for (const r of records) {
    const fm = [
      "---",
      `title: ${yamlStr(r.title)}`,
      `description: ${yamlStr(r.description)}`,
      `date: ${r.date.toISOString()}`,
      `author: ${yamlStr(r.author)}`,
      ...(r.image ? [`image: ${yamlStr(r.image)}`] : []),
      r.tags.length ? "tags:" : "tags: []",
      ...r.tags.map((t) => `  - ${yamlStr(t)}`),
      "---",
      "",
    ].join("\n");

    if (!args.dryRun) fs.writeFileSync(path.join(args.out, `${r.slug}.mdx`), `${fm + r.markdown}\n`);
    written++;
  }

  const empty = records.filter((r) => r.markdown.trim().length < 40);
  const noImage = records.filter((r) => !r.image);
  const bySource = records.reduce((a, r) => ({ ...a, [r.imageSource]: (a[r.imageSource] ?? 0) + 1 }), {});

  console.log(`\n${args.dryRun ? "[dry run] " : ""}Wrote ${written} posts to ${path.relative(process.cwd(), args.out)}`);
  console.log(`  featured image source:`, bySource);
  console.log(`  ${noImage.length} without an image, ${empty.length} with a near-empty body`);
  if (empty.length) console.log(`  near-empty: ${empty.slice(0, 10).map((r) => r.slug).join(", ")}`);
  if (imageFailures.length) {
    console.log(`  image failures (first 5):`);
    for (const f of imageFailures.slice(0, 5)) console.log(`    ${f.reason}  ${f.url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
