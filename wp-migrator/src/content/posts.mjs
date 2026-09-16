/**
 * WordPress export (WXR) → blog collection importer.
 *
 * The rest of the tool reconstructs *rendered* pages: it measures a real
 * browser render because a page's design is the thing being migrated. Posts are
 * the opposite case — their design is the blog template, which the target repo
 * already owns, and what has to survive is the prose. So posts come from the
 * XML export (the authoritative source text) rather than from the snapshot,
 * and are converted to Markdown instead of reconstructed as components.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFragment } from "parse5";
import { srcFromAttrs } from "../browser/lazy.mjs";

const WP = "http://wordpress.org/export/1.2/";
const CONTENT = "http://purl.org/rss/1.0/modules/content/";
const DC = "http://purl.org/dc/elements/1.1/";
const EXCERPT = "http://wordpress.org/export/1.2/excerpt/";

// ---------------------------------------------------------------------------
// WXR parsing
// ---------------------------------------------------------------------------

/**
 * Minimal WXR reader. WXR is namespaced XML with CDATA payloads; a full XML
 * parser is a dependency this tool doesn't have, and the format is regular
 * enough (flat <item> list, no nesting inside items) to read directly.
 */
export function parseWxr(xml) {
  const channel = {
    title: firstTag(xml, "title"),
    link: firstTag(xml, "link"),
    baseUrl: (firstTag(xml, "wp:base_site_url") || "").replace(/\/$/, ""),
    items: [],
  };

  for (const raw of xml.split("<item>").slice(1)) {
    const body = raw.split("</item>")[0];
    channel.items.push({
      title: firstTag(body, "title"),
      link: firstTag(body, "link"),
      slug: firstTag(body, "wp:post_name"),
      id: firstTag(body, "wp:post_id"),
      parent: firstTag(body, "wp:post_parent"),
      type: firstTag(body, "wp:post_type"),
      status: firstTag(body, "wp:status"),
      date: firstTag(body, "wp:post_date_gmt") || firstTag(body, "wp:post_date"),
      creator: firstTag(body, "dc:creator"),
      content: firstTag(body, "content:encoded"),
      excerpt: firstTag(body, "excerpt:encoded"),
      attachmentUrl: firstTag(body, "wp:attachment_url"),
      categories: readCategories(body),
      meta: readMeta(body),
    });
  }
  return channel;
}

function firstTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : "";
}

function decode(value) {
  const cdata = value.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
  if (cdata) return cdata[1];
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readCategories(body) {
  const out = [];
  for (const m of body.matchAll(
    /<category domain="([^"]+)" nicename="([^"]+)"[^>]*>([\s\S]*?)<\/category>/g
  )) {
    out.push({ domain: m[1], slug: m[2], label: decode(m[3]) });
  }
  return out;
}

function readMeta(body) {
  const meta = {};
  for (const block of body.split("<wp:postmeta>").slice(1)) {
    const chunk = block.split("</wp:postmeta>")[0];
    const key = firstTag(chunk, "wp:meta_key");
    if (key) meta[key] = firstTag(chunk, "wp:meta_value");
  }
  return meta;
}

// ---------------------------------------------------------------------------
// HTML → Markdown
// ---------------------------------------------------------------------------

const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "figure",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "hr",
  "table",
]);

/**
 * Convert post HTML to Markdown.
 *
 * Deliberately a conversion rather than a passthrough: the collection is `.mdx`,
 * where raw HTML is parsed as JSX. WordPress prose is full of things JSX
 * rejects — unclosed `<br>`, `class=`/`style=` attributes, stray `{`` — so
 * embedding it verbatim turns a content import into a build break. Markdown has
 * none of those hazards and round-trips these posts (headings, lists, links,
 * emphasis, images) without loss.
 */
export function htmlToMarkdown(html, { rewriteUrl = (u) => u } = {}) {
  const frag = parseFragment(html);
  const blocks = [];
  renderChildren(frag, blocks, { rewriteUrl, listStack: [] });
  return blocks
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderChildren(node, blocks, ctx) {
  let inline = [];
  const flush = () => {
    const text = collapse(inline.join(""));
    if (text) blocks.push(text);
    inline = [];
  };

  for (const child of node.childNodes || []) {
    const tag = child.tagName;
    if (child.nodeName === "#text") {
      // Classic-editor content is stored the way it was typed: paragraphs are
      // blank lines, not `<p>` tags — WordPress only inserts those at render
      // time (`wpautop`). Reading the stored markup literally would run a whole
      // post together as one paragraph, so the same rule is applied here: a
      // blank line ends a paragraph, a lone newline is a hard break.
      const paragraphs = child.value.split(/\n[ \t]*\n/);
      paragraphs.forEach((part, i) => {
        if (i > 0) flush();
        inline.push(escapeText(part.replace(/\n[ \t]*/g, "  \n")));
      });
      continue;
    }
    if (!tag || tag === "script" || tag === "style") continue;

    if (!BLOCK.has(tag)) {
      inline.push(renderInline(child, ctx));
      continue;
    }

    flush();
    renderBlockNode(child, blocks, ctx);
  }
  flush();
}

function renderBlockNode(node, blocks, ctx) {
  const tag = node.tagName;

  if (/^h[1-6]$/.test(tag)) {
    // WordPress prose starts its subheads at h2 under the post title; the
    // template already renders the title as the page h1, so the levels carry
    // over unchanged. An h1 inside the body is the one exception — it would
    // duplicate the page heading, so it is demoted.
    const level = Math.max(2, Number(tag[1]));
    const text = collapse(inlineOf(node, ctx));
    if (text) blocks.push(`${"#".repeat(level)} ${text}`);
    return;
  }

  if (tag === "hr") return blocks.push("---");

  if (tag === "pre") {
    const text = textOf(node).replace(/\n+$/, "");
    if (text.trim()) blocks.push("```\n" + text + "\n```");
    return;
  }

  if (tag === "blockquote") {
    const inner = [];
    renderChildren(node, inner, ctx);
    const quoted = inner
      .join("\n\n")
      .split("\n")
      .map((l) => `> ${l}`.trimEnd())
      .join("\n");
    if (quoted.trim()) blocks.push(quoted);
    return;
  }

  if (tag === "ul" || tag === "ol") {
    const items = [];
    let index = 1;
    for (const li of node.childNodes || []) {
      if (li.tagName !== "li") continue;
      const inner = [];
      renderChildren(li, inner, { ...ctx, listStack: [...ctx.listStack, tag] });
      const body = inner.join("\n\n").trim();
      if (!body) continue;
      const marker = tag === "ol" ? `${index++}. ` : "- ";
      const pad = " ".repeat(marker.length);
      items.push(
        marker +
          body
            .split("\n")
            .map((l, i) => (i === 0 ? l : pad + l))
            .join("\n")
      );
    }
    if (items.length) blocks.push(items.join("\n"));
    return;
  }

  if (tag === "figure") {
    const inner = [];
    renderChildren(node, inner, ctx);
    if (inner.length) blocks.push(inner.join("\n\n"));
    return;
  }

  // p / div / section / li-content / anything else structural: its children are
  // either inline (one paragraph) or further blocks.
  renderChildren(node, blocks, ctx);
}

function renderInline(node, ctx) {
  const tag = node.tagName;

  if (tag === "br") return "  \n";
  if (tag === "img") {
    // Post bodies can carry the same lazy-loading markup as the rendered pages
    // — some plugins rewrite the stored content, not just the output — and this
    // path has no browser to resolve it, so it reads the data attributes
    // directly. Without this an `<img data-src="…">` returned "" and the image
    // was dropped from the post with no warning.
    const src = srcFromAttrs((name) => attr(node, name));
    if (!src) return "";
    return `![${escapeText(attr(node, "alt") || "")}](${ctx.rewriteUrl(src, "image")})`;
  }
  if (tag === "a") {
    const href = attr(node, "href");
    const text = collapse(inlineOf(node, ctx));
    if (!text) return "";
    if (!href) return text;
    return `[${text}](${ctx.rewriteUrl(href, "link")})`;
  }
  if (tag === "strong" || tag === "b") {
    const text = collapse(inlineOf(node, ctx));
    return text ? `**${text}**` : "";
  }
  if (tag === "em" || tag === "i") {
    const text = collapse(inlineOf(node, ctx));
    return text ? `*${text}*` : "";
  }
  if (tag === "code") {
    const text = textOf(node);
    return text ? `\`${text}\`` : "";
  }
  return inlineOf(node, ctx);
}

function inlineOf(node, ctx) {
  let out = "";
  for (const child of node.childNodes || []) {
    if (child.nodeName === "#text") out += escapeText(child.value);
    else if (child.tagName && child.tagName !== "script" && child.tagName !== "style") {
      out += renderInline(child, ctx);
    }
  }
  return out;
}

function textOf(node) {
  let out = "";
  for (const child of node.childNodes || []) {
    if (child.nodeName === "#text") out += child.value;
    else out += textOf(child);
  }
  return out;
}

function attr(node, name) {
  return (node.attrs || []).find((a) => a.name === name)?.value || "";
}

/**
 * MDX compiles `{` as an expression and `<` as a tag, so any literal that
 * survives from the source prose has to be neutralized. Everything else is left
 * alone — over-escaping ordinary punctuation is what makes machine-converted
 * Markdown unreadable to the person who edits it next.
 */
function escapeText(text) {
  return text.replace(/ /g, " ").replace(/([{}<>])/g, "\\$1");
}

function collapse(text) {
  // Preserve the two-space hard break `<br>` produces; collapse everything else.
  return text
    .replace(/[ \t]*\n(?![ \t]*\n)/g, (m) => (m.startsWith("  \n") ? m : " "))
    .replace(/ {2}\n[ \t]+/g, "  \n")
    .replace(/[ \t]{2,}(?!\n)/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** yaml scalar quoting for the small, known set of frontmatter fields. */
function yamlString(value) {
  const s = String(value ?? "");
  if (!s) return '""';
  if (/^[\w][\w .,'&()/-]*$/.test(s) && !/: |#/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function frontmatter(fields) {
  const lines = ["---", "_schema: default"];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      lines.push(`${key}:`);
      for (const v of value) lines.push(`  - ${yamlString(v)}`);
    } else {
      lines.push(`${key}: ${value instanceof Date ? value.toISOString() : yamlString(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Resolve a source URL to something the target can serve, and report the asset
 * so the caller can bring the bytes across.
 */
function makeUrlRewriter({ origin, postSlugs, assets }) {
  const sameOrigin = (u) => u.startsWith(origin) || u.startsWith(origin.replace("://www.", "://"));

  return (url, kind) => {
    if (!url) return url;
    if (url.startsWith("#") || url.startsWith("mailto:") || url.startsWith("tel:")) return url;

    let rel = url;
    if (/^https?:\/\//.test(url)) {
      if (!sameOrigin(url)) return url; // external link/image: leave as-is
      rel = url.replace(/^https?:\/\/[^/]+/, "");
    }

    if (kind === "image") {
      const name = assets.claim(rel);
      // Relative from src/content/blog/<file>.mdx, so Astro's asset pipeline
      // picks the image up and optimizes it like any other src/ image.
      return name ? `../../assets/images/blog/${name}` : url;
    }

    const slug = rel.replace(/^\//, "").replace(/\/$/, "");
    if (postSlugs.has(slug)) return `/blog/${slug}`;
    return rel.startsWith("/") ? rel : `/${rel}`;
  };
}

/** Collects the images a conversion referenced, de-duplicated by source path. */
function assetCollector() {
  const byPath = new Map();
  const used = new Set();
  return {
    claim(relPath) {
      if (byPath.has(relPath)) return byPath.get(relPath);
      const base = decodeURIComponent(relPath.split("?")[0].split("/").pop() || "");
      if (!base) return null;
      let name = base.replace(/[^\w.-]+/g, "-");
      for (let i = 2; used.has(name.toLowerCase()); i++) {
        name = name.replace(/(\.[^.]+)$/, `-${i}$1`);
      }
      used.add(name.toLowerCase());
      byPath.set(relPath, name);
      return name;
    },
    entries: () => [...byPath.entries()],
  };
}

/**
 * Copy an asset out of the local snapshot, falling back to the network for
 * anything the crawl never linked (featured images only referenced by the
 * listing page, for instance).
 */
async function fetchAsset(relPath, { staticDir, origin }) {
  const local = path.join(staticDir, decodeURIComponent(relPath.split("?")[0]).replace(/^\//, ""));
  if (fs.existsSync(local) && fs.statSync(local).isFile()) return fs.readFileSync(local);
  try {
    const res = await fetch(origin + relPath, { redirect: "follow" });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function importPosts({
  xmlFile,
  targetRoot,
  staticDir,
  author,
  limit = 0,
  dryRun = true,
  log = () => {},
}) {
  const channel = parseWxr(fs.readFileSync(xmlFile, "utf8"));
  const origin = channel.baseUrl || channel.link.replace(/\/$/, "");

  const attachments = new Map();
  for (const item of channel.items) {
    if (item.type === "attachment" && item.attachmentUrl)
      attachments.set(item.id, item.attachmentUrl);
  }

  let posts = channel.items.filter((i) => i.type === "post" && i.status === "publish");
  posts.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (limit) posts = posts.slice(0, limit);

  const postSlugs = new Set(posts.map((p) => p.slug));
  const blogDir = path.join(targetRoot, "src/content/blog");
  const imageDir = path.join(targetRoot, "src/assets/images/blog");

  const written = [];
  const warnings = [];
  const assets = assetCollector();
  const rewriteUrl = makeUrlRewriter({ origin, postSlugs, assets });

  for (const post of posts) {
    const slug = post.slug || post.link.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
    if (!slug) {
      warnings.push(`skipped "${post.title}" — no slug`);
      continue;
    }

    const body = htmlToMarkdown(post.content, { rewriteUrl });
    if (!body.trim()) {
      warnings.push(`skipped "${slug}" — empty body`);
      continue;
    }

    const description =
      post.meta._yoast_wpseo_metadesc?.trim() ||
      htmlToMarkdown(post.excerpt || "", { rewriteUrl })
        .replace(/\s+/g, " ")
        .trim() ||
      body
        .replace(/[#*[\]()>`\\]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 155);

    let image = "";
    const thumbUrl = attachments.get(post.meta._thumbnail_id);
    if (thumbUrl) {
      const rel = thumbUrl.replace(/^https?:\/\/[^/]+/, "");
      const name = assets.claim(rel);
      if (name) image = `/src/assets/images/blog/${name}`;
    } else {
      warnings.push(`"${slug}" — no featured image`);
    }

    // Categories are the editorial grouping WordPress shows; post_tags on this
    // export are SEO keyword spam ("dentist-near-me" on every post), so only
    // categories carry over as tags.
    const tags = post.categories
      .filter((c) => c.domain === "category" && c.label.toLowerCase() !== "uncategorized")
      .map((c) => c.label);

    const date = post.date ? new Date(post.date.replace(" ", "T") + "Z") : new Date();
    const file = path.join(blogDir, `${slug}.mdx`);
    const contents =
      frontmatter({
        title: post.title,
        description,
        date,
        author: author || post.creator,
        image,
        tags,
      }) + `\n\n${body}\n`;

    written.push({ file, contents, slug });
  }

  // Assets: one pass over everything claimed by frontmatter + body conversion.
  const copied = [];
  const missing = [];
  for (const [rel, name] of assets.entries()) {
    const dest = path.join(imageDir, name);
    if (!dryRun && fs.existsSync(dest)) {
      copied.push(name);
      continue;
    }
    const bytes = await fetchAsset(rel, { staticDir, origin });
    if (!bytes) {
      missing.push(rel);
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(imageDir, { recursive: true });
      fs.writeFileSync(dest, bytes);
    }
    copied.push(name);
  }

  // A post pointing at an image that never arrived would fail the build (Astro
  // resolves relative image references at compile time), so drop those
  // references rather than ship a broken post.
  const missingNames = new Set(
    missing.map((rel) => assets.entries().find(([r]) => r === rel)?.[1])
  );
  if (missingNames.size) {
    for (const entry of written) {
      for (const name of missingNames) {
        if (!entry.contents.includes(name)) continue;
        entry.contents = entry.contents
          .replace(new RegExp(`^image: .*${escapeRegex(name)}.*\\n`, "m"), "")
          .replace(new RegExp(`!\\[[^\\]]*\\]\\([^)]*${escapeRegex(name)}[^)]*\\)`, "g"), "");
        warnings.push(`"${entry.slug}" — dropped unavailable image ${name}`);
      }
    }
  }

  if (!dryRun) {
    fs.mkdirSync(blogDir, { recursive: true });
    for (const entry of written) fs.writeFileSync(entry.file, entry.contents);
  }

  log(`${written.length} post(s) ${dryRun ? "would be written" : "written"}`);
  log(`${copied.length} image(s) ${dryRun ? "resolved" : "copied"}, ${missing.length} unavailable`);
  return { written, copied, missing, warnings, origin };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
