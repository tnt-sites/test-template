/**
 * Check the chrome data the target will ship against the source it came from.
 *
 * The merge is deliberately additive: `buildNavData` and friends overwrite the
 * keys the source has an opinion about and leave the rest of the target's data
 * alone. That is the right default — it keeps the template's styling props,
 * its office-hours model, its button variants — but it has one blind spot.
 * Where the *starter* shipped placeholder content and the source has nothing
 * to say about that field, the placeholder survives the migration and ships.
 *
 * On this site that meant a footer addressed to `info@dentalstudio.com`, a
 * placeholder from the starter, printed on every page of a real dental
 * practice as its contact address. Nothing failed; the field was simply never
 * contradicted. That class of defect is invisible to a visual comparison too,
 * since the layout is correct and only the words are somebody else's.
 *
 * So: anything the target is about to publish as contact detail or branding
 * gets looked up in the source markup, and anything that is not there is
 * reported. Reported, not deleted — a practice may genuinely have added an
 * email address that the old site never listed, and this cannot tell the
 * difference. It can only say which values the source has never heard of.
 */

import { digitsOf } from "./phones.mjs";

/** Everything a chrome audit knows how to look for, and where it lives. */
const CONTACT_PATHS = [
  ["siteInfo", "offices[].emails[].display"],
  ["siteInfo", "offices[].emails[].href"],
  ["siteInfo", "offices[].phones[].display"],
  ["siteInfo", "offices[].addresses[].lines[]"],
];

/** Walk a dotted path with `[]` segments, yielding `{ path, value }` leaves. */
function* walk(node, parts, prefix = "") {
  if (node == null) return;
  if (!parts.length) {
    if (typeof node === "string" && node.trim()) yield { path: prefix, value: node };
    return;
  }
  const [head, ...rest] = parts;
  if (head === "") {
    if (!Array.isArray(node)) return;
    for (const [i, item] of node.entries()) yield* walk(item, rest, `${prefix}[${i}]`);
    return;
  }
  if (head.endsWith("[]")) {
    const key = head.slice(0, -2);
    const list = node[key];
    if (!Array.isArray(list)) return;
    for (const [i, item] of list.entries()) {
      yield* walk(item, rest, `${prefix ? `${prefix}.` : ""}${key}[${i}]`);
    }
    return;
  }
  yield* walk(node[head], rest, `${prefix ? `${prefix}.` : ""}${head}`);
}

/**
 * Is this value present in the source at all?
 *
 * Compared loosely — case-insensitively, and for phone numbers on digits alone
 * — because the same address is written "Suite 60" in one place and "Ste 60"
 * in another, and a number formatted `(720) 222-2345` in the markup may be
 * stored as `7202222345`. A strict match would report every one of those as
 * missing and drown the real finding.
 */
function presentInSource(value, haystack) {
  const text = String(value).trim();
  if (!text) return true;

  const digits = digitsOf(text);
  // A value that is essentially a phone number is compared as one.
  if (digits.length >= 7 && digits.length <= 11 && text.replace(/[\s()+.\-]/g, "").length === digits.length) {
    return haystack.digits.has(digits);
  }

  const needle = text.toLowerCase().replace(/\s+/g, " ");
  if (haystack.text.includes(needle)) return true;

  // Addresses survive reformatting; match on their most distinctive run
  // instead of the whole line.
  const words = needle.split(/[\s,]+/).filter((w) => w.length > 3);
  if (words.length >= 2) {
    return words.every((w) => haystack.text.includes(w));
  }
  return false;
}

/**
 * @param {object} data      the merged data about to be written, by file stem
 * @param {string} sourceHtml raw markup of the page the chrome came from
 * @returns {Array<{file: string, path: string, value: string, note: string}>}
 */
export function auditChromeData(data, sourceHtml) {
  const text = String(sourceHtml ?? "")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ");
  const digits = new Set();
  for (const m of String(sourceHtml ?? "").matchAll(/(\+?\d[\d\s().-]{6,}\d)/g)) {
    const d = digitsOf(m[1]);
    if (d.length >= 7) digits.add(d);
  }
  const haystack = { text, digits };

  const findings = [];
  for (const [file, spec] of CONTACT_PATHS) {
    const parts = spec.split(".");
    for (const { path, value } of walk(data[file], parts)) {
      const bare = value.replace(/^(mailto:|tel:)/i, "");
      if (presentInSource(bare, haystack)) continue;
      findings.push({
        file,
        path,
        value,
        note: "not found in the source page — likely a starter placeholder the source never contradicted",
      });
    }
  }

  /*
   * A logo's alt text is content too, and it is the one piece of chrome
   * content a template routinely gets wrong in the *source*: themes are
   * copied between practices and the alt attribute is what nobody updates.
   * Flagged when it names something other than the site, because it is read
   * aloud to anyone using a screen reader.
   */
  const siteName = data.siteInfo?.siteName || "";
  for (const [file, key] of [["mainNav", "logoAlt"], ["footer", "logoAlt"]]) {
    const alt = data[file]?.[key];
    if (!alt || !siteName) continue;
    const first = siteName.toLowerCase().split(/[\s|–—-]+/)[0];
    if (first && !alt.toLowerCase().includes(first)) {
      findings.push({
        file,
        path: key,
        value: alt,
        note: `does not name "${siteName}" — the source's own alt text names a different practice`,
      });
    }
  }

  return findings;
}
