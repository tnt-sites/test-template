// WordPress -> Astro blog import.
//
// site-migrator has no WordPress support (it migrates static HTML), so this is
// a one-off importer for newteethdentalsolutionsblog.WordPress.2026-08-12.xml.
//
// Of the export's 11 items only 2 are real: two published posts. The other
// three posts are WordPress's "Hello world!" demo (all in the trash, all
// carrying the same seeded filler body), two pages are also trashed, and the
// rest are attachments plus a wp_global_styles record.
//
// Post filenames deliberately use the WordPress slug with no date prefix,
// because src/pages/blog/[...slug].astro derives the route from the filename —
// so `welcome-to-our-blog.mdx` keeps the post's live URL,
// /blog/welcome-to-our-blog/, byte for byte.
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const XML = path.resolve("../static/newteethdentalsolutionsblog.WordPress.2026-08-12.xml");
const OUT = path.resolve("../src/content/blog");
const IMG_DIR = path.resolve("../public/assets/images/blog");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
  trimValues: false,
});
const doc = parser.parse(fs.readFileSync(XML, "utf8"));
const channel = doc.rss.channel;
const items = Array.isArray(channel.item) ? channel.item : [channel.item];

const val = (v) => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v.__cdata != null) return String(v.__cdata);
  return "";
};

const posts = items.filter(
  (i) => val(i["wp:post_type"]) === "post" && val(i["wp:status"]) === "publish"
);
const attachments = items.filter((i) => val(i["wp:post_type"]) === "attachment");

/* ------------------------------------------------------------ images */
fs.mkdirSync(IMG_DIR, { recursive: true });
const imageMap = new Map(); // remote URL (any size variant) -> local path

const download = async (url, dest) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
};

for (const a of attachments) {
  const url = val(a["wp:attachment_url"]);
  if (!url || /site-logo\.png$/.test(url)) continue; // the blog's own logo, not post content
  const base = path.basename(new URL(url).pathname);
  const dest = path.join(IMG_DIR, base);
  if (!fs.existsSync(dest)) {
    await download(url, dest);
    console.log(`  downloaded ${base} (${fs.statSync(dest).size} bytes)`);
  }
  const local = `/assets/images/blog/${base}`;
  imageMap.set(url, local);
  // Post bodies reference WordPress's generated size variants
  // (…-1024x682.jpg, …-300x200.jpg); point every variant at the original.
  const stem = base.replace(/\.[a-z]+$/i, "");
  const ext = path.extname(base);
  imageMap.set(url.replace(base, `${stem}${ext}`), local);
  imageMap.set(`variant:${stem}`, local);
}

const localFor = (src) => {
  if (imageMap.has(src)) return imageMap.get(src);
  const base = path.basename(new URL(src, "https://x/").pathname);
  const stem = base.replace(/-\d+x\d+(\.[a-z]+)$/i, "$1").replace(/\.[a-z]+$/i, "");
  return imageMap.get(`variant:${stem}`) ?? src;
};

/* --------------------------------------------------- html -> markdown */
const decode = (s) =>
  s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "’").replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“").replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–").replace(/&#8212;/g, "—")
    .replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
    .replace(/&lsquo;/g, "‘").replace(/&rsquo;/g, "’")
    .replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/&reg;/g, "®").replace(/&trade;/g, "™")
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&");

// Interior .html links point at pages this migration has already moved.
const rewriteHref = (href) => {
  const m = href.match(/^https?:\/\/(?:www\.)?newteethhouston\.com\/(.*)$/i);
  let rest = m ? m[1] : href;
  if (m && /^blog\/?/.test(rest)) return "/" + rest.replace(/^blog\/?/, "blog/");
  if (!m && !/^\//.test(href)) return href; // external or relative-external
  const [p, hash = ""] = rest.split("#");
  if (/\.html$/.test(p)) {
    const slug = p.replace(/\.html$/, "");
    return `/${slug}/` + (hash ? "#" + hash : "");
  }
  return m ? "/" + rest : href;
};

const inlineHtml = (html) =>
  decode(html)
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, txt) => {
      const clean = txt.replace(/<[^>]+>/g, "").trim();
      return `[${clean}](${rewriteHref(href)})`;
    })
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, (_, t) => `**${t.replace(/<[^>]+>/g, "").trim()}**`)
    .replace(/<b>([\s\S]*?)<\/b>/gi, (_, t) => `**${t.replace(/<[^>]+>/g, "").trim()}**`)
    .replace(/<em>([\s\S]*?)<\/em>/gi, (_, t) => `*${t.replace(/<[^>]+>/g, "").trim()}*`)
    .replace(/<i>([\s\S]*?)<\/i>/gi, (_, t) => `*${t.replace(/<[^>]+>/g, "").trim()}*`)
    .replace(/<br\s*\/?>/gi, "\n")
    // "3<sup>rd</sup> molars" must not become "3 rd molars".
    .replace(/<\/?(?:sup|sub)>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

// Gutenberg wraps every block in `<!-- wp:type -->` comments. Walking those is
// more reliable than parsing the HTML, because the block name tells us the
// intent (an `wp:image` with align-left is a figure, not a paragraph image).
const toMarkdown = (raw) => {
  const out = [];
  let firstImage = null;

  const blockRe = /<!--\s+wp:([a-z/-]+)(\s+\{[\s\S]*?\})?\s+(\/)?-->([\s\S]*?)(?=<!--\s+wp:|<!--\s+\/wp:[a-z/-]+\s+-->\s*$|$)/g;
  const body = raw.replace(/<!--\s+\/wp:[a-z/-]+\s+-->/g, "");

  let m;
  while ((m = blockRe.exec(body))) {
    const type = m[1];
    const inner = (m[4] || "").trim();
    if (!inner && type !== "more") continue;

    if (type === "paragraph") {
      const t = inlineHtml(inner);
      if (t) out.push(t);
    } else if (type === "heading") {
      const hm = inner.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/i);
      if (hm) {
        const level = Math.max(2, Number(hm[1])); // h1 is the post title
        out.push("#".repeat(level) + " " + inlineHtml(hm[2]));
      }
    } else if (type === "image") {
      const src = inner.match(/<img[^>]*src="([^"]*)"/i)?.[1];
      const alt = inner.match(/<img[^>]*alt="([^"]*)"/i)?.[1] ?? "";
      if (src) {
        const local = localFor(src);
        if (!firstImage) firstImage = { src: local, alt };
        else out.push(`![${decode(alt)}](${local})`);
      }
    } else if (type === "list") {
      // A `wp:list` block nests one `wp:list-item` block per bullet, so the
      // <li>s are NOT inside this block's own inner HTML — they arrive as
      // separate `list-item` blocks below. Only handle the flat case here.
      for (const li of inner.match(/<li[^>]*>[\s\S]*?<\/li>/gi) ?? []) {
        const t = inlineHtml(li.replace(/<\/?li[^>]*>/gi, ""));
        if (t) out.push("- " + t);
      }
    } else if (type === "list-item") {
      const t = inlineHtml(inner.replace(/<\/?li[^>]*>/gi, ""));
      if (t) out.push("- " + t);
    } else if (type === "quote" || type === "pullquote") {
      const t = inlineHtml(inner);
      if (t) out.push("> " + t.replace(/\n/g, "\n> "));
    } else if (type === "html") {
      // Raw HTML block — usually a hand-written <ul>.
      const lis = inner.match(/<li[^>]*>[\s\S]*?<\/li>/gi);
      if (lis) {
        for (const li of lis) {
          const t = inlineHtml(li.replace(/<\/?li[^>]*>/gi, ""));
          if (t) out.push("- " + t);
        }
      } else {
        const t = inlineHtml(inner);
        if (t) out.push(t);
      }
    } else if (type === "separator") {
      out.push("---");
    }
    // `more`, `spacer`, `buttons` etc. carry no prose worth keeping.
  }

  // Collapse the "- " runs into single list blocks.
  const merged = [];
  for (const b of out) {
    const prev = merged[merged.length - 1];
    if (b.startsWith("- ") && prev && prev.startsWith("- ")) merged[merged.length - 1] = prev + "\n" + b;
    else merged.push(b);
  }
  return { markdown: merged.join("\n\n"), firstImage };
};

/* ------------------------------------------------------------- write */
const yamlStr = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Remove the starter's demo posts — 11 lorem-ipsum articles by "Alex Smith"
// about the component library itself, which would otherwise ship as this
// dental practice's blog.
let removed = 0;
for (const f of fs.readdirSync(OUT)) {
  if (!f.endsWith(".mdx")) continue;
  const body = fs.readFileSync(path.join(OUT, f), "utf8");
  if (/Lorem ipsum/i.test(body) || /author:\s*Alex Smith/.test(body)) {
    fs.unlinkSync(path.join(OUT, f));
    removed++;
  }
}
console.log(`removed ${removed} starter demo post(s)`);

for (const p of posts) {
  const title = decode(val(p.title)).trim();
  const slug = val(p["wp:post_name"]).trim();
  const author = decode(val(p["dc:creator"])).trim();
  const dateRaw = val(p["wp:post_date_gmt"]) || val(p["wp:post_date"]);
  const date = new Date(dateRaw.replace(" ", "T") + "Z").toISOString();

  const { markdown, firstImage } = toMarkdown(val(p["content:encoded"]));

  // The schema requires `description`. Every excerpt in this export is empty,
  // so derive it from the first real sentence of the body.
  let description = decode(val(p["excerpt:encoded"])).trim();
  if (!description) {
    const firstPara = markdown.split("\n\n").find((b) => !/^[#\-!>]/.test(b)) ?? "";
    const plain = firstPara.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "");
    description = plain.length > 180 ? plain.slice(0, 177).replace(/\s+\S*$/, "") + "…" : plain;
  }

  // Categories: skip WordPress's "Uncategorized" default.
  const cats = (Array.isArray(p.category) ? p.category : p.category ? [p.category] : [])
    .filter((c) => c["@_domain"] === "post_tag" || c["@_domain"] === "category")
    .map((c) => decode(val(c)).trim())
    .filter((c) => c && c.toLowerCase() !== "uncategorized");
  const tags = [...new Set(cats)];

  const fm = [
    "---",
    "_schema: default",
    `title: ${yamlStr(title)}`,
    `description: ${yamlStr(description)}`,
    `date: ${date}`,
    `author: ${yamlStr(author)}`,
    ...(firstImage ? [`image: ${yamlStr(firstImage.src)}`] : []),
    `tags: ${tags.length ? "" : "[]"}`,
    ...tags.map((t) => `  - ${yamlStr(t)}`),
    "---",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(OUT, `${slug}.mdx`), fm + markdown + "\n");
  console.log(`  ${slug}.mdx  (${markdown.length} chars, image=${firstImage?.src ?? "none"}, tags=${tags.length})`);
}
console.log(`\nimported ${posts.length} published post(s); skipped ${items.length - posts.length - attachments.length} trashed/system item(s)`);
