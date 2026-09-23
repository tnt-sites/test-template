import * as parse5 from "parse5";

/**
 * Stamp every element in a raw HTML document with a stable `data-mig-uid`.
 *
 * This is the backbone of the whole pipeline. Source sites routinely restructure
 * their own DOM at runtime — wrapping flow content, moving nodes between
 * containers, adding index-derived classes — so any identity based on position
 * ("section 3 of this page") silently misaligns the moment a later stage
 * re-renders the page in a fresh browser session. The old toolkit did exactly
 * that and needed a duplicated `expandSection` in two files kept in sync by hand.
 *
 * A uid stamped into the *raw* HTML rides along with the node wherever jQuery
 * moves it, so every later stage re-finds a section with one `querySelector`
 * and no index arithmetic.
 */

export const UID_ATTR = "data-mig-uid";

/** Elements that must not be touched — stamping them changes rendering. */
const SKIP_TAGS = new Set(["html", "head", "meta", "title", "base", "script", "style", "br", "wbr"]);

function* walkElements(node) {
  const children = node.childNodes ?? [];
  for (const child of children) {
    if (child.tagName) {
      yield child;
      yield* walkElements(child);
    } else if (child.content) {
      // <template> content lives in a separate fragment.
      yield* walkElements(child.content);
    }
  }
}

/**
 * @param {string} html raw source HTML
 * @param {string} pageId stable id for the page (usually its slug)
 * @returns {{ html: string, count: number, uids: string[] }}
 */
export function instrumentHtml(html, pageId) {
  const doc = parse5.parse(html, { sourceCodeLocationInfo: false });

  let ordinal = 0;
  const uids = [];

  for (const el of walkElements(doc)) {
    const tag = el.tagName?.toLowerCase();
    if (!tag || SKIP_TAGS.has(tag)) continue;

    // Preserve an existing uid so re-instrumenting a mirror is stable.
    const existing = el.attrs?.find((a) => a.name === UID_ATTR);
    if (existing) {
      uids.push(existing.value);
      continue;
    }

    const uid = `${pageId}:${String(ordinal).padStart(4, "0")}`;
    ordinal++;
    el.attrs = el.attrs ?? [];
    el.attrs.push({ name: UID_ATTR, value: uid });
    uids.push(uid);
  }

  return { html: parse5.serialize(doc), count: uids.length, uids };
}

/** Parse a uid back into its parts. */
export function parseUid(uid) {
  const idx = uid.lastIndexOf(":");
  if (idx === -1) return null;
  return { pageId: uid.slice(0, idx), ordinal: Number(uid.slice(idx + 1)) };
}

/**
 * Recover the raw HTML subtree for a uid range.
 *
 * Prop extraction and `.astro` template generation both want the *raw* markup,
 * not the rendered one: the raw tree has none of the runtime-injected wrapper
 * divs, animation classes, or duplicated nodes, so it produces a far cleaner
 * component template.
 */
export function sliceByUid(html, anchorUid, lastUid = anchorUid) {
  const doc = parse5.parse(html);
  const byUid = new Map();
  for (const el of walkElements(doc)) {
    const uid = el.attrs?.find((a) => a.name === UID_ATTR)?.value;
    if (uid) byUid.set(uid, el);
  }

  const anchor = byUid.get(anchorUid);
  if (!anchor) return null;

  if (anchorUid === lastUid) {
    return parse5.serializeOuter(anchor);
  }

  // A flow-cut section spans several siblings: serialize the run from the
  // anchor through the last node inclusive.
  const parent = anchor.parentNode;
  const siblings = parent?.childNodes ?? [];
  const startIdx = siblings.indexOf(anchor);
  const last = byUid.get(lastUid);
  const endIdx = last ? siblings.indexOf(last) : startIdx;
  if (startIdx === -1 || endIdx === -1) return parse5.serializeOuter(anchor);

  return siblings
    .slice(startIdx, endIdx + 1)
    .map((n) => (n.tagName ? parse5.serializeOuter(n) : (n.value ?? "")))
    .join("");
}

export { walkElements };
