import crypto from "node:crypto";
import path from "node:path";

/**
 * Provenance headers.
 *
 * Every file the toolkit writes carries a machine-readable header recording
 * what generated it and the hash of the body it wrote. That header is what lets
 * a re-run tell "unchanged since I wrote it" from "a human edited this", which
 * is the difference between a safe regeneration and destroying hand work.
 */

export const MARKER = "mig:generated";

const COMMENT_STYLES = {
  ".astro": { open: "<!--", close: "-->" },
  ".html": { open: "<!--", close: "-->" },
  ".yml": { open: "#", close: "" },
  ".yaml": { open: "#", close: "" },
  ".css": { open: "/*", close: "*/" },
  ".pcss": { open: "/*", close: "*/" },
  ".scss": { open: "/*", close: "*/" },
  ".js": { open: "/*", close: "*/" },
  ".mjs": { open: "/*", close: "*/" },
  ".ts": { open: "/*", close: "*/" },
  ".json": null, // JSON has no comments — ownership is tracked in the manifest.
  ".md": "frontmatter",
  ".mdx": "frontmatter",
};

export function commentStyleFor(filePath) {
  // Hash-commented plain-text formats. A `/* */` header silently corrupts these.
  const base = path.basename(filePath);
  if (base === "_redirects" || base === "_headers" || base === "robots.txt") {
    return { open: "#", close: "" };
  }

  const ext = path.extname(filePath).toLowerCase();
  return ext in COMMENT_STYLES ? COMMENT_STYLES[ext] : { open: "/*", close: "*/" };
}

export function hashBody(body) {
  return crypto.createHash("sha256").update(body, "utf8").digest("hex").slice(0, 16);
}

function formatFields(fields) {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, "_")}`)
    .join(" ");
}

function parseFields(text) {
  const fields = {};
  for (const m of text.matchAll(/(\w+)=([^\s]+)/g)) fields[m[1]] = m[2];
  return fields;
}

/**
 * Prepend a provenance header. `hash` is always the hash of the body *without*
 * the header, so a byte-identical regeneration is detectable as a no-op.
 */
export function stampHeader(filePath, body, fields = {}) {
  const style = commentStyleFor(filePath);
  const full = { ...fields, hash: hashBody(body) };

  if (style === null) return body; // JSON — no header possible.

  if (style === "frontmatter") {
    // Markdown carries provenance as a `_mig:` frontmatter key rather than a
    // comment, so it survives being round-tripped by a CMS that rewrites YAML.
    if (!body.startsWith("---\n")) return body;
    const block = Object.entries(full)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `  ${k}: ${JSON.stringify(String(v))}`)
      .join("\n");
    return `---\n_mig:\n${block}\n${body.slice(4)}`;
  }

  const line = style.close
    ? `${style.open} ${MARKER} ${formatFields(full)} ${style.close}`
    : `${style.open} ${MARKER} ${formatFields(full)}`;
  return `${line}\n${body}`;
}

/** The `_mig:` frontmatter block, if the file opens with one. */
const FRONTMATTER_BLOCK = /^---\n_mig:\n((?:[ \t]+\S.*\n)+)/;

/** Read the provenance header from file contents, or null if absent. */
export function parseHeader(filePath, content) {
  const style = commentStyleFor(filePath);
  if (style === null) return null;

  if (style === "frontmatter") {
    const m = content.match(FRONTMATTER_BLOCK);
    if (!m) return null;
    const fields = {};
    for (const line of m[1].split("\n")) {
      const pair = line.match(/^\s+(\w+):\s*"?([^"]*)"?\s*$/);
      if (pair) fields[pair[1]] = pair[2];
    }
    return fields;
  }

  const firstLine = content.split("\n", 1)[0];
  if (!firstLine.includes(MARKER)) return null;
  return parseFields(firstLine.slice(firstLine.indexOf(MARKER) + MARKER.length));
}

/** Strip the provenance header, returning just the body. */
export function stripHeader(filePath, content) {
  const style = commentStyleFor(filePath);

  if (style === "frontmatter") {
    const m = content.match(FRONTMATTER_BLOCK);
    return m ? `---\n${content.slice(m[0].length)}` : content;
  }

  if (!parseHeader(filePath, content)) return content;
  const nl = content.indexOf("\n");
  return nl === -1 ? "" : content.slice(nl + 1);
}

/**
 * A frozen file is one the operator has claimed by hand (`mig freeze`). The
 * toolkit never writes it again — this is the escape hatch for components like
 * a header or footer that have been tuned past what generation can express.
 */
export function isFrozen(fields) {
  return fields?.frozen === "true";
}

export function setFrozen(filePath, content, frozen = true) {
  const fields = parseHeader(filePath, content);
  if (!fields) return null;
  const body = stripHeader(filePath, content);
  return stampHeader(filePath, body, { ...fields, frozen: String(frozen) });
}

/** Where a file's last-written bytes are cached, mirroring the repo layout. */
export function baselinePathFor(artifactsDir, targetRoot, filePath) {
  const rel = path.relative(targetRoot, filePath);
  return path.join(artifactsDir, "baseline", rel);
}
