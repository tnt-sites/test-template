/**
 * What the screenshot shows that the extraction never found.
 *
 * Every other check compares the *rebuild* against the *original*. This one
 * compares the original against **what the migrator managed to extract from
 * it** — a different question, and the one that catches the defect class no
 * DOM check can see by construction: content that is not in the DOM at all.
 *
 * The motivating case: Elementor's gallery renders each image as an empty
 * `<div role="img" data-thumbnail>` and paints it from JS. Before JS there is
 * no `<img>`, no `src`, no `background-image` — so every image-finding path in
 * the pipeline returns nothing while the *picture is plainly visible in the
 * screenshot*. Four magazine covers migrated as blank boxes and every automated
 * check stayed green. A person spotted it in a screenshot in one second.
 *
 * So: show the model the original screenshot, tell it what the extractor
 * actually found, and ask what it can see that is missing.
 *
 * Two rules this module exists to keep:
 *
 *   - **It reports; it never invents.** A finding is a question for a human,
 *     because the answer is frequently "that content was never published"
 *     (this site's Office Tour page shows a gallery to nobody — the photos live
 *     only in the media library and the live page has never displayed them).
 *     A tool that quietly manufactured a gallery there would be inventing
 *     content and calling it a migration.
 *   - **A proposal is not an edit.** `proposeSection` returns a block a person
 *     approves; nothing here writes to a page.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Media the mirror holds that this page's build never references.
 *
 * The offline half of the gap question, and the half that needs no model: the
 * crawler saves whatever it can reach — a gallery's lightbox `href`s pull the
 * files down even when the markup that *displays* them never arrives in a
 * pre-JS snapshot — so files on disk that no built page points at are exactly
 * the shape of content the extractor missed.
 *
 * It cannot say what the picture *is*, or where on the page it belonged. That
 * is the part a person (or a Claude Code session reading the screenshots) does,
 * and this is what hands them the question with the evidence already gathered.
 */
export function mediaGap({ staticDir, referenced, pageSlug }) {
  const candidates = unreferencedMedia(staticDir, referenced, { max: 200 });
  if (candidates.length === 0) return null;

  // Files whose name carries the page's own slug are the strongest signal a
  // human can act on immediately: `office-tour-v1.jpg` on `/office-tour/` is
  // not a coincidence.
  const stem = String(pageSlug || "").replace(/-/g, "");
  const named = candidates.filter(
    (f) => stem && f.toLowerCase().replace(/[-_]/g, "").includes(stem)
  );

  // How many pictures the page itself renders — the caller uses this to decide
  // whether "no images here at all" is itself the signal.
  const pageImages = new Set(
    (referenced || [])
      .map((r) => r.split("/").pop())
      .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
  ).size;

  return { candidates, named, count: candidates.length, pageImages };
}

const DETECT_PROMPT = [
  "This is a screenshot of a web page we are migrating.",
  "",
  "Our extractor read the page's DOM and found the media listed below.",
  "The DOM is a *pre-JavaScript* snapshot, so anything a script injects at",
  "runtime — galleries, carousels, sliders, lightboxes — is invisible to it",
  "while still being plainly visible in this screenshot.",
  "",
  "Compare what you can SEE against what was FOUND. Report only content that is",
  "visible in the screenshot and absent from the found list. Ignore the header,",
  "navigation, footer and any cookie or chat widget.",
  "",
  "For each gap, say where it sits (the nearest heading or landmark), what kind",
  "of thing it is, and how many items it appears to contain.",
  "",
  "Output ONLY a JSON array, no prose:",
  '[{"where":"<nearest heading or landmark>","kind":"gallery|carousel|image|video|embed|other",',
  '"count":<number of items you can see>,"describes":"<what the content is>",',
  '"confidence":"high|medium|low"}]',
  "If everything visible was found, output [].",
].join("\n");

function imageBlock(pngPath) {
  const data = fs.readFileSync(pngPath).toString("base64");
  return { type: "image", source: { type: "base64", media_type: "image/png", data } };
}

/** First JSON array in a text blob, tolerating fences and stray prose. */
function parseArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const textOf = (message) =>
  message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

/**
 * Ask what the screenshot shows that the extractor did not find.
 *
 * @param {object} client     an Anthropic client
 * @param {string} originalPng
 * @param {object} extracted  what the migrator got: `{ images: string[], sections: string[] }`
 * @returns {Promise<Array<{where,kind,count,describes,confidence}>>}
 */
export async function detectMissingMedia(client, originalPng, extracted, { model } = {}) {
  const found = [
    `Images found in the DOM (${extracted.images?.length ?? 0}):`,
    ...(extracted.images?.length ? extracted.images.map((f) => `  - ${f}`) : ["  (none)"]),
    "",
    `Sections the extractor produced (${extracted.sections?.length ?? 0}):`,
    ...(extracted.sections?.length ? extracted.sections.map((s) => `  - ${s}`) : ["  (none)"]),
  ].join("\n");

  const message = await client.messages.create({
    model,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content: [imageBlock(originalPng), { type: "text", text: `${DETECT_PROMPT}\n\n${found}` }],
      },
    ],
  });

  return parseArray(textOf(message)).filter((f) => f && f.where);
}

const BUILD_PROMPT = [
  "You previously identified content visible in this screenshot that our",
  "extractor could not find. Below is the list of image files we DID capture",
  "into the site's media mirror — files that exist on disk but that no page",
  "markup referenced.",
  "",
  "Match what you can see in the screenshot to those files, in the order they",
  "appear on the page. Use ONLY filenames from the list; never invent one.",
  "If you cannot confidently match an item, leave it out — a short correct list",
  "is worth more than a long speculative one.",
  "",
  "Output ONLY JSON, no prose:",
  '{"images":[{"file":"<exact filename from the list>","alt":"<short description of the image>"}],',
  '"heading":"<section heading if one is visible, else empty>",',
  '"confidence":"high|medium|low","note":"<anything a human should check>"}',
].join("\n");

/**
 * Propose a section for a detected gap — a suggestion, never an edit.
 *
 * The candidate files are the mirror's *unreferenced* media: the crawler saves
 * whatever it can reach, and a gallery's own lightbox hrefs often bring the
 * files down even when the markup that displays them never arrives. Matching
 * them by eye is exactly what a person does here, and it is the one step of
 * this that a model does better than a selector.
 *
 * @returns {Promise<{images:Array<{file,alt}>, heading:string, confidence:string, note:string}|null>}
 */
export async function proposeSection(client, originalPng, candidateFiles, { model } = {}) {
  if (!candidateFiles?.length) return null;

  const list = candidateFiles.map((f) => `  - ${f}`).join("\n");
  const message = await client.messages.create({
    model,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content: [
          imageBlock(originalPng),
          {
            type: "text",
            text: `${BUILD_PROMPT}\n\nAvailable files (${candidateFiles.length}):\n${list}`,
          },
        ],
      },
    ],
  });

  const text = textOf(message);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const out = JSON.parse(text.slice(start, end + 1));
    const allowed = new Set(candidateFiles);
    // The model is told to use only listed filenames; enforce it rather than
    // trust it, because a hallucinated path is a broken image on a live site.
    out.images = (out.images || []).filter((i) => i?.file && allowed.has(i.file));
    return out.images.length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Media files in the mirror that no migrated page references.
 *
 * These are the candidates for a gap: the crawler reached them, so they are on
 * disk, but nothing in the extracted markup points at them.
 */
export function unreferencedMedia(staticDir, referenced, { max = 60 } = {}) {
  const uploads = path.join(staticDir, "wp-content/uploads");
  if (!fs.existsSync(uploads)) return [];

  const used = new Set([...referenced].map((r) => path.basename(r).toLowerCase()));
  const out = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= max) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(jpe?g|png|webp|avif)$/i.test(entry.name)) continue;
      // WordPress writes a size variant per upload; they are the same picture
      // and listing all of them buries the distinct images.
      if (/-\d{2,4}x\d{2,4}\.\w+$/.test(entry.name)) continue;
      if (used.has(entry.name.toLowerCase())) continue;
      if (/logo|favicon|icon|spinner|placeholder/i.test(entry.name)) continue;
      out.push(entry.name);
    }
  };

  walk(uploads);
  return out;
}
