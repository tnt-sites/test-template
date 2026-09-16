/**
 * Advisory visual QA: ask Claude to name the design differences between the
 * original page and the migrated rebuild.
 *
 * Every other check in this tool is deterministic and mechanical — a measured
 * pixel or style delta (see `src/qa/compare.mjs`, `dev-verify`, `dev-audit`).
 * This one is deliberately NOT: it is a vision-model judgment, online and
 * non-deterministic, and exists to catch the human-obvious differences that a
 * per-element delta cannot phrase ("the paragraph is full-width; the source
 * constrains it"; "the button is an outline, the source is filled"). It is an
 * advisory layer — findings are suggestions to a person, never auto-applied —
 * and stays behind an explicit command + API key so the default pipeline
 * remains offline and reproducible.
 */

import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-5";

const PROMPT = [
  "These are two screenshots of the same web page.",
  "Image 1 is the ORIGINAL design — treat it as the source of truth.",
  "Image 2 is our MIGRATED rebuild of it.",
  "",
  "List the concrete, visible differences in the CONTENT of the page:",
  "element width / max-width (e.g. a paragraph that should be constrained but runs full-width),",
  "spacing and alignment, colors, typography size and weight, dividers / horizontal rules",
  "(their position, width, and color), button styles, and any missing or extra elements.",
  "",
  "The site header, top bar, navigation and footer are an intentional re-theme, not a bug —",
  "note only a MAJOR chrome regression, and otherwise focus on the content sections.",
  "",
  "Output ONLY a JSON array, no prose, of the form:",
  '[{"area":"<which section/element>","severity":"high|medium|low",',
  '"difference":"<what differs, original vs rebuild>","suggested_fix":"<concrete CSS/layout change>"}]',
  "Report real, visible differences only. Be specific and concise. If there are none, output [].",
].join("\n");

/** Read a PNG file into a Claude base64 image block. */
function imageBlock(pngPath) {
  const data = fs.readFileSync(pngPath).toString("base64");
  return { type: "image", source: { type: "base64", media_type: "image/png", data } };
}

/** Pull the first JSON array out of a text blob, tolerating stray prose/fences. */
function parseFindings(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(arr)) return arr;
    } catch {
      // fall through to the raw-text finding
    }
  }
  const trimmed = text.trim();
  if (!trimmed) return [];
  return [{ area: "(unparsed)", severity: "low", difference: trimmed, suggested_fix: "" }];
}

/**
 * Compare one original screenshot against one built screenshot.
 * @returns {Promise<Array<{area,severity,difference,suggested_fix}>>}
 */
export async function compareShots(client, originalPng, builtPng, { model = DEFAULT_MODEL } = {}) {
  const message = await client.messages.create({
    model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content: [imageBlock(originalPng), imageBlock(builtPng), { type: "text", text: PROMPT }],
      },
    ],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return parseFindings(text);
}

/** Construct the client, or return null when no credential is resolvable. */
export function makeClient() {
  try {
    // Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth` profile.
    return new Anthropic();
  } catch {
    return null;
  }
}
