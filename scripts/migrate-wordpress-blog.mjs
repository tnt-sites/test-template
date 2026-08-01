#!/usr/bin/env node
// One-off migration: WordPress WXR export -> src/content/blog/*.mdx
// Usage: node scripts/migrate-wordpress-blog.mjs <path-to-wxr-export.xml>

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const ROOT = path.resolve(import.meta.dirname, "..");
const BLOG_DIR = path.join(ROOT, "src/content/blog");
const IMAGES_DIR = path.join(ROOT, "src/assets/images/blog");
const REDIRECT_MAP_PATH = path.join(ROOT, "scripts/wp-redirect-map.json");

const SHORTCODE_RE = /\[(caption|gallery|embed|vc_\w+|et_pb_\w+)[^\]]*\]/gi;

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWord(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, "").trim() + "…";
}

function toIsoDate(wpDateStr) {
  const d = new Date(String(wpDateStr).replace(" ", "T"));
  return d.toISOString().slice(0, 10);
}

// Escape stray "<", "{" and "}" outside of code spans/fences so MDX doesn't
// mistake prose (e.g. "reduce bounce rate <5%", "a {value} placeholder") for
// the start of a JSX tag or expression.
function escapeMdxUnsafeChars(markdown) {
  const segments = markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return segments
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      return segment.replace(/<(?![a-zA-Z/!])/g, "&lt;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
    })
    .join("");
}

const EMBED_PLACEHOLDER_RE = /@@WP_EMBED_TODO:(\w+)@@/g;

async function downloadImage(url, destDir) {
  mkdirSync(destDir, { recursive: true });
  const filename = decodeURIComponent(path.basename(new URL(url).pathname));
  const dest = path.join(destDir, filename);
  if (!existsSync(dest)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  return filename;
}

async function main() {
  const exportPathArg = process.argv[2];
  if (!exportPathArg) {
    console.error("Usage: node scripts/migrate-wordpress-blog.mjs <path-to-wxr-export.xml>");
    process.exit(1);
  }

  const xml = readFileSync(path.resolve(exportPathArg), "utf8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => ["item", "category", "wp:postmeta", "wp:author"].includes(name),
  });
  const data = parser.parse(xml);
  const channel = data.rss.channel;
  const items = channel.item ?? [];

  const authorNameByLogin = new Map();
  for (const author of channel["wp:author"] ?? []) {
    authorNameByLogin.set(
      author["wp:author_login"],
      author["wp:author_display_name"] || author["wp:author_login"]
    );
  }

  const attachmentUrlById = new Map();
  for (const item of items) {
    if (item["wp:post_type"] === "attachment" && item["wp:attachment_url"]) {
      attachmentUrlById.set(String(item["wp:post_id"]), item["wp:attachment_url"]);
    }
  }

  const posts = items.filter(
    (item) => item["wp:post_type"] === "post" && item["wp:status"] === "publish"
  );

  const turndownService = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  turndownService.use(gfm);
  turndownService.addRule("wpEmbeds", {
    filter: ["iframe", "script", "video", "object", "embed"],
    replacement: (_content, node) => `\n\n@@WP_EMBED_TODO:${node.nodeName.toLowerCase()}@@\n\n`,
  });

  mkdirSync(BLOG_DIR, { recursive: true });

  const usedFilenames = new Set();
  const redirectMap = {};
  let warningCount = 0;

  for (const item of posts) {
    const title = String(item.title ?? "").trim();
    const wpSlug = item["wp:post_name"] || slugify(title);
    const date = toIsoDate(item["wp:post_date"]);

    let filenameBase = `${date}-${slugify(wpSlug)}`;
    let filename = `${filenameBase}.mdx`;
    let suffix = 2;
    while (usedFilenames.has(filename)) {
      filename = `${filenameBase}-${suffix++}.mdx`;
    }
    usedFilenames.add(filename);
    const newSlug = filename.replace(/\.mdx$/, "");

    if (item.link) {
      redirectMap[new URL(item.link).pathname] = `/blog/${newSlug}/`;
    }

    const authorLogin = item["dc:creator"];
    const author = authorNameByLogin.get(authorLogin) || authorLogin || "Anonymous";

    const categories = Array.isArray(item.category) ? item.category : item.category ? [item.category] : [];
    const tags = [
      ...new Set(
        categories
          .map((c) => (typeof c === "object" ? String(c["#text"] ?? "").trim() : String(c).trim()))
          .filter((name) => name && name !== "Uncategorized")
      ),
    ];

    let contentHtml = String(item["content:encoded"] ?? "").replace(/<!--[\s\S]*?-->/g, "");
    const excerptText = stripHtml(item["excerpt:encoded"]);

    const imageDestDir = path.join(IMAGES_DIR, newSlug);
    const imgUrlToLocal = new Map();
    const inlineImgUrls = [...contentHtml.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);

    const thumbnailMeta = (item["wp:postmeta"] ?? []).find((m) => m["wp:meta_key"] === "_thumbnail_id");
    const featuredUrl = thumbnailMeta ? attachmentUrlById.get(String(thumbnailMeta["wp:meta_value"])) : undefined;

    const urlsToDownload = [...new Set([...(featuredUrl ? [featuredUrl] : []), ...inlineImgUrls])].filter(
      (url) => /^https?:\/\//i.test(url)
    );

    for (const url of urlsToDownload) {
      try {
        const filename = await downloadImage(url, imageDestDir);
        imgUrlToLocal.set(url, `/src/assets/images/blog/${newSlug}/${filename}`);
      } catch (err) {
        warningCount++;
        console.warn(`  [warn] ${wpSlug}: failed to download image ${url} (${err.message})`);
      }
    }

    for (const [url, localPath] of imgUrlToLocal) {
      contentHtml = contentHtml.split(url).join(localPath);
    }

    let markdownBody = escapeMdxUnsafeChars(turndownService.turndown(contentHtml));
    markdownBody = markdownBody.replace(
      EMBED_PLACEHOLDER_RE,
      (_match, tag) => `{/* TODO: manual review - removed <${tag}> embed from original WordPress post */}`
    );

    if (SHORTCODE_RE.test(contentHtml)) {
      warningCount++;
      console.warn(`  [warn] ${wpSlug}: contains WordPress shortcode(s), needs manual review`);
      markdownBody = `{/* TODO: manual review - original post contained WordPress shortcode(s) */}\n\n${markdownBody}`;
    }

    const description = excerptText || truncateAtWord(stripHtml(contentHtml), 160);
    // No WordPress featured image? fall back to the post's first inline image so blog index cards still show a thumbnail.
    const usingInlineImageAsFeatured = !featuredUrl && Boolean(inlineImgUrls[0]);
    const imageFrontmatter =
      (featuredUrl && imgUrlToLocal.get(featuredUrl)) ||
      (usingInlineImageAsFeatured && imgUrlToLocal.get(inlineImgUrls[0]));

    // The post template renders `image` as a hero above the body, so drop that same
    // image from the body when we borrowed it from inline content - otherwise it shows twice.
    if (usingInlineImageAsFeatured && imageFrontmatter) {
      const escapedPath = imageFrontmatter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      markdownBody = markdownBody
        .replace(new RegExp(`!\\[[^\\]]*\\]\\(${escapedPath}\\)\\n*`), "")
        .replace(/^\s+/, "");
    }

    const frontmatterLines = [
      "---",
      `title: ${JSON.stringify(title)}`,
      `description: ${JSON.stringify(description)}`,
      `date: ${date}`,
      `author: ${JSON.stringify(author)}`,
      ...(imageFrontmatter ? [`image: ${JSON.stringify(imageFrontmatter)}`] : []),
      `tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]`,
      "---",
      "",
    ];

    writeFileSync(path.join(BLOG_DIR, filename), frontmatterLines.join("\n") + markdownBody + "\n");
  }

  writeFileSync(REDIRECT_MAP_PATH, JSON.stringify(redirectMap, null, 2) + "\n");

  console.log(`\nMigrated ${posts.length} post(s) to ${path.relative(ROOT, BLOG_DIR)}/`);
  console.log(`Redirect map written to ${path.relative(ROOT, REDIRECT_MAP_PATH)} (${Object.keys(redirectMap).length} entries)`);
  if (warningCount > 0) {
    console.log(`${warningCount} warning(s) above - review flagged posts by hand before publishing.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
