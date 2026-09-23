import fs from "node:fs";
import path from "node:path";
import { commentStyleFor } from "./provenance.mjs";

/**
 * Marked-region editing for files the toolkit only *partially* owns —
 * `astro.config.mjs`, `src/content.config.ts`, `themes/_default.pcss`,
 * `BaseLayout.astro`.
 *
 * These are hand-authored files that need one generated stanza each. Rewriting
 * them wholesale would destroy the operator's work; this regenerates only what
 * sits between markers and never reformats a byte outside them.
 */

export function markersFor(filePath, name) {
  const style = commentStyleFor(filePath);
  const open = style?.open ?? "/*";
  const close = style?.close ?? "*/";
  const wrap = (text) => (close ? `${open} ${text} ${close}` : `${open} ${text}`);
  return { begin: wrap(`mig:begin ${name}`), end: wrap(`mig:end ${name}`) };
}

export function hasRegion(content, filePath, name) {
  const { begin, end } = markersFor(filePath, name);
  return content.includes(begin) && content.includes(end);
}

export function readRegion(content, filePath, name) {
  const { begin, end } = markersFor(filePath, name);
  const start = content.indexOf(begin);
  const stop = content.indexOf(end);
  if (start === -1 || stop === -1 || stop < start) return null;
  return content.slice(start + begin.length, stop).replace(/^\n|\n[ \t]*$/g, "");
}

/**
 * Replace a region's body, or insert the region if absent.
 *
 * `anchor` controls first-time insertion: `{ after: /regex/ }` or
 * `{ before: /regex/ }`. Without a match the caller gets an error rather than a
 * guessed insertion point — silently putting a `redirects:` key in the wrong
 * scope is worse than failing.
 */
export function upsertRegion(content, filePath, name, body, anchor = {}) {
  const { begin, end } = markersFor(filePath, name);
  const indent = anchor.indent ?? "";
  const block = [begin, body, end].map((l) => (l ? indent + l : l)).join("\n");

  const start = content.indexOf(begin);
  const stop = content.indexOf(end);

  if (start !== -1 && stop !== -1 && stop >= start) {
    return content.slice(0, start) + block.trimStart() + content.slice(stop + end.length);
  }

  if (anchor.after) {
    const m = content.match(anchor.after);
    if (!m) throw new Error(`Cannot insert region "${name}" into ${filePath}: anchor not found`);
    const at = m.index + m[0].length;
    return `${content.slice(0, at)}\n${block}\n${content.slice(at)}`;
  }

  if (anchor.before) {
    const m = content.match(anchor.before);
    if (!m) throw new Error(`Cannot insert region "${name}" into ${filePath}: anchor not found`);
    return `${content.slice(0, m.index)}${block}\n${content.slice(m.index)}`;
  }

  return `${content}\n${block}\n`;
}

export function removeRegion(content, filePath, name) {
  const { begin, end } = markersFor(filePath, name);
  const start = content.indexOf(begin);
  const stop = content.indexOf(end);
  if (start === -1 || stop === -1) return content;
  return content.slice(0, start) + content.slice(stop + end.length);
}

/**
 * Apply a region edit to a file on disk through the Writer, so the same
 * dry-run and reporting path covers partially-owned files too.
 */
export function patchRegion(writer, targetRoot, relPath, name, body, anchor = {}) {
  const abs = path.resolve(targetRoot, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Cannot patch ${relPath}: file does not exist in the target repo`);
  }
  const current = fs.readFileSync(abs, "utf8");
  const next = upsertRegion(current, abs, name, body, anchor);

  if (next === current) {
    writer.results.push({ path: relPath, outcome: "unchanged", detail: `region ${name}` });
    return;
  }
  if (!writer.dryRun) fs.writeFileSync(abs, next, "utf8");
  writer.results.push({
    path: relPath,
    outcome: hasRegion(current, abs, name) ? "updated" : "created",
    detail: `region ${name}`,
  });
}
