import fs from "node:fs";
import path from "node:path";

/**
 * Rewrite legacy URLs in migrated content, and emit the redirects that keep the
 * old ones working.
 *
 * Both jobs read the same map. Deriving links and redirects from one source is
 * what stops them disagreeing — a link rewritten to a route that has no redirect,
 * or a redirect pointing somewhere the content never links to.
 */

/** Every form a legacy link appears in, given a page list. */
export function buildUrlMap(pages, { sourceHost = null } = {}) {
  const map = new Map();

  for (const page of pages) {
    const { path: from, route } = page;
    map.set(from, route);
    map.set(from.replace(/^\//, ""), route); // bare relative: `veneers.html`

    if (sourceHost) {
      map.set(`${sourceHost}${from}`, route);
      map.set(`http://${stripScheme(sourceHost)}${from}`, route);
      map.set(`https://${stripScheme(sourceHost)}${from}`, route);
    }
  }

  return map;
}

function stripScheme(host) {
  return host.replace(/^https?:\/\//, "");
}

/**
 * Work out which host the source site published under.
 *
 * Migrated copy is full of absolute self-links, and when the migration runs off
 * a local mirror there is no configured URL to compare them against. Rather than
 * ask for one, infer it: a host only counts if its path matches a page that was
 * actually migrated, so an outbound link to an unrelated site can never be
 * mistaken for the source and rewritten.
 */
export function detectSourceHost(texts, pages) {
  const paths = new Set(pages.map((p) => p.path));
  const votes = new Map();

  for (const text of texts) {
    for (const m of text.matchAll(/https?:\/\/([^/\s"')]+)(\/[^\s"')]*)?/gi)) {
      const [, host, urlPath = "/"] = m;
      const clean = urlPath.split(/[#?]/)[0];
      if (!paths.has(clean)) continue;
      votes.set(host, (votes.get(host) ?? 0) + 1);
    }
  }

  let best = null;
  let bestVotes = 0;
  for (const [host, count] of votes) {
    if (count > bestVotes) {
      bestVotes = count;
      best = host;
    }
  }
  return best;
}

/** Split a URL into target, hash and query so only the path is rewritten. */
function splitUrl(url) {
  const hashAt = url.indexOf("#");
  const queryAt = url.indexOf("?");
  const cut = Math.min(hashAt === -1 ? Infinity : hashAt, queryAt === -1 ? Infinity : queryAt);
  return cut === Infinity
    ? { target: url, suffix: "" }
    : { target: url.slice(0, cut), suffix: url.slice(cut) };
}

/**
 * Rewrite one URL. Anything without a mapping is returned unchanged and
 * reported — guessing at an unmapped legacy path produces a confident 404.
 */
export function rewriteUrl(url, map) {
  if (!url || /^(mailto:|tel:|#|data:|javascript:)/i.test(url)) return { url, changed: false };

  const { target, suffix } = splitUrl(url);
  const mapped = map.get(target) ?? map.get(target.replace(/^\//, ""));

  if (!mapped) {
    const isLegacy = /\.html?$/i.test(target);
    return { url, changed: false, unresolved: isLegacy ? target : null };
  }
  return { url: mapped + suffix, changed: mapped + suffix !== url };
}

/**
 * Rewrite every legacy URL in a file's text.
 *
 * Operates on the raw text rather than a parsed document so it covers markdown
 * link targets, YAML string values and inline HTML in one pass, without
 * reformatting anything it does not change.
 */
export function rewriteText(text, map) {
  const unresolved = new Set();
  let changes = 0;

  // Any token that looks like a legacy page URL, in markdown targets,
  // quoted YAML/HTML attribute values, or bare.
  const pattern = /(["'(\s]|^)((?:https?:\/\/[^\s"'()]+|\/?[\w./-]*\.html?)(?:[#?][^\s"'()]*)?)/gi;

  const next = text.replace(pattern, (whole, lead, url) => {
    const result = rewriteUrl(url, map);
    if (result.unresolved) unresolved.add(result.unresolved);
    if (!result.changed) return whole;
    changes++;
    return `${lead}${result.url}`;
  });

  return { text: next, changes, unresolved: [...unresolved] };
}

/** Walk generated content and rewrite in place. */
export function rewriteContentFiles(dir, map, { writer, targetRoot }) {
  const results = { files: 0, changes: 0, unresolved: new Set() };
  if (!fs.existsSync(dir)) return results;

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.mdx?$/.test(entry.name)) continue;

      const original = fs.readFileSync(full, "utf8");
      const { text, changes, unresolved } = rewriteText(original, map);
      for (const u of unresolved) results.unresolved.add(u);
      if (changes === 0) continue;

      results.files++;
      results.changes += changes;
      if (!writer.dryRun) fs.writeFileSync(full, text, "utf8");
      writer.results.push({
        path: path.relative(targetRoot, full),
        outcome: "updated",
        detail: `${changes} link(s)`,
      });
    }
  };

  walk(dir);
  return { ...results, unresolved: [...results.unresolved] };
}

/**
 * Build the redirect table.
 *
 * Only entries whose source and target actually differ are emitted; a redirect
 * from a URL to itself is a redirect loop waiting to happen.
 */
export function buildRedirects(pages) {
  const redirects = {};
  for (const page of pages) {
    if (page.path === page.route) continue;
    redirects[page.path] = page.route;
  }
  return redirects;
}

/** Netlify/CloudCannon `_redirects` format — the one that works when hosted. */
export function renderRedirectsFile(redirects) {
  const lines = Object.entries(redirects).map(([from, to]) => `${from} ${to} 301`);
  return `${lines.join("\n")}\n`;
}

/** An Astro `redirects` config block, for the dev server and static output. */
export function renderAstroRedirects(redirects) {
  const entries = Object.entries(redirects)
    .map(([from, to]) => `    "${from}": "${to}",`)
    .join("\n");
  return `  redirects: {\n${entries}\n  },`;
}
