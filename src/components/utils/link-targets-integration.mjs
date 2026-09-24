import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One rule for which links open a new tab: links off the site do, links to
 * the site's own pages don't.
 *
 * Anchors reach the page from everywhere — nav and footer data, component
 * props, and raw HTML in migrated page content (rendered with `set:html`, so
 * no component ever sees it). The migrated content carried WordPress's habit
 * of `target="_blank"` on internal links, and many external links had none.
 * Rather than police every source, the finished HTML is corrected once after
 * the build, so content added in the CMS later is covered too.
 *
 * Documents (PDF, Word) keep a new tab when authored with one, since they
 * leave the page just as an external link does.
 */

// Hosts that are this site, when content spells a link out in full.
const OWN_HOSTS = ["columbinecreekdentistry.com", "cloudvent.net"];

const DOCUMENT = /\.(pdf|docx?)(?:[?#]|$)/i;

const isOwnHost = (host) => OWN_HOSTS.some((own) => host === own || host.endsWith(`.${own}`));

/** "external", "internal", or null for hrefs the rule leaves alone. */
const classify = (href) => {
  const value = href.trim();

  if (/^https?:\/\//i.test(value)) {
    try {
      return isOwnHost(new URL(value).hostname.toLowerCase()) ? "internal" : "external";
    } catch {
      return null;
    }
  }
  // tel:, mailto:, javascript:, and in-page anchors aren't navigation.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("#")) return null;
  return "internal";
};

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
const dropAttr = (tag, name) => tag.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`, "i"), "");

export const fixLinkTargets = (html) =>
  html.replace(/<a\b[^>]*>/gi, (tag) => {
    const hrefMatch = attr(tag, "href");

    if (!hrefMatch) return tag;
    const href = hrefMatch[1] ?? hrefMatch[2] ?? "";
    const kind = classify(href);

    if (kind === "external") {
      const out = dropAttr(dropAttr(tag, "target"), "rel");
      const rel = (attr(tag, "rel")?.[1] ?? "").split(/\s+/).filter(Boolean);

      for (const token of ["noopener", "noreferrer"]) if (!rel.includes(token)) rel.push(token);
      return out.replace(/>$/, ` target="_blank" rel="${rel.join(" ")}">`);
    }

    if (kind === "internal" && !DOCUMENT.test(href) && attr(tag, "target")) {
      const rel = (attr(tag, "rel")?.[1] ?? "")
        .split(/\s+/)
        .filter((token) => token && token !== "noopener" && token !== "noreferrer");
      let out = dropAttr(dropAttr(tag, "target"), "rel");

      if (rel.length) out = out.replace(/>$/, ` rel="${rel.join(" ")}">`);
      return out;
    }

    return tag;
  });

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

export default function linkTargets() {
  return {
    name: "link-targets",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        let changed = 0;

        for await (const file of htmlFiles(fileURLToPath(dir))) {
          const html = await readFile(file, "utf8");
          const fixed = fixLinkTargets(html);

          if (fixed !== html) {
            await writeFile(file, fixed);
            changed++;
          }
        }
        logger.info(`Corrected link targets in ${changed} page(s).`);
      },
    },
  };
}
