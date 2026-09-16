/**
 * Prop extraction: decide what in a captured section is editable.
 *
 * Text, colors, images and links become props; repeated items become an
 * editable array; everything else — spacing, type scale, layout — stays baked
 * into the emitted CSS. Naming follows the hand-written artisan components:
 * eyebrow / heading / text / buttonText / cards[].title / …
 */

import { initialsOf } from "./names.mjs";
import { normalizeValue } from "./css-emit.mjs";
import { nearestOption } from "./color-palette.mjs";

const HEADING_TAGS = new Set(["h1", "h2", "h3"]);

/**
 * Flat snapshot filename → the URL the page had on the source site.
 *
 * The snapshot stores every page flat (`/payment-options/dental-savers-plan/`
 * becomes `payment-options-dental-savers-plan.html`), so deriving a route from
 * the filename alone silently flattens the site's URLs — every migrated link to
 * a nested page would point at an address that never existed. The snapshot
 * manifest records the original path for each file; loading it keeps the links
 * (and the redirects the old site's SEO depends on) intact.
 */
let ROUTES = new Map();
/** Known page URLs, and the last path segment of each, for legacy-link repair. */
let KNOWN = new Set();
let BY_TAIL = new Map();

export function useRouteMap(routes) {
  ROUTES = routes instanceof Map ? routes : new Map(Object.entries(routes || {}));
  KNOWN = new Set(ROUTES.values());
  BY_TAIL = new Map();
  for (const url of KNOWN) {
    const tail = url.replace(/\/$/, "").split("/").pop();
    if (!tail) continue;
    // The target renders the blog from its post collection at /blog/, so a
    // link there must not be redirected to the source's own (now frozen)
    // listing page.
    if (tail === "blog") continue;
    // Ambiguous tails are recorded as null so they are never guessed at.
    BY_TAIL.set(tail, BY_TAIL.has(tail) ? null : url);
  }
}

/**
 * Repair a root-relative link that points at a URL the site only serves through
 * a redirect.
 *
 * This theme links to `/meet-the-team/` and `/invisalign/` while the pages
 * themselves live at `/about-us/meet-the-team/` and
 * `/dental-services/cosmetic-dentistry/invisalign/` — WordPress 301s the short
 * form, so the site works and nothing looks wrong until the redirects are gone.
 * On the migrated site they are simply 404s (5,400 of them across this site), so
 * a link whose path is unknown but whose final segment names exactly one real
 * page is pointed at that page. An ambiguous or unmatched tail is left alone
 * rather than guessed at.
 */
function repairLegacyPath(href) {
  if (!KNOWN.size) return href;
  const [pathPart, hash = ""] = href.split("#");
  const withSlash = pathPart.endsWith("/") ? pathPart : `${pathPart}/`;
  if (KNOWN.has(withSlash)) return href;
  const tail = withSlash.replace(/\/$/, "").split("/").pop();
  const target = BY_TAIL.get(tail);
  if (!target || target === withSlash) return href;
  return `${target}${hash ? `#${hash}` : ""}`;
}

/**
 * Drop per-session tracking tokens from an outbound URL.
 *
 * A booking link captured from a live page carries the session it was rendered
 * for (`?liine_session_id=…`). Baked into a component default that token is
 * both meaningless to every later visitor and different on every regeneration,
 * which makes an otherwise deterministic generator produce a diff each run.
 */
function stripSessionParams(href) {
  try {
    const url = new URL(href);
    for (const key of [...url.searchParams.keys()]) {
      if (/session|(^|_)sid$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\?$/, "");
  } catch {
    return href;
  }
}

/** Rewrite a snapshot-internal href to a clean site path. */
export function rewriteHref(href) {
  if (!href) return href;
  if (/^https?:/i.test(href)) return stripSessionParams(href);
  if (/^(mailto:|tel:|sms:|#)/i.test(href)) return href;
  if (href.startsWith("/")) return repairLegacyPath(href);
  const [pathPart, hash = ""] = href.split("#");
  const flat = pathPart.replace(/\.html?$/i, "").replace(/^\.\//, "");
  if (!flat || flat === "index") return `/${hash ? `#${hash}` : ""}`;
  const original = ROUTES.get(flat);
  return `${original || `/${flat}/`}${hash ? `#${hash}` : ""}`;
}

/**
 * Remove references to the machine that captured the page from an embed URL.
 *
 * A booking form or review widget is told which page it is embedded in, via a
 * `parentURL`/`origin` parameter the builder fills in at render time. Captured
 * from the local mirror, that parameter names the capture server
 * (`http://127.0.0.1:52901/contact-us.html`) — and it travels into the migrated
 * page, where the widget is now told it lives on someone's laptop. Vendors use
 * it for referrer checks and for redirecting back after submission, so it is
 * not cosmetic. A loopback address is never meaningful in published output, so
 * any parameter pointing at one is dropped.
 */
export function stripCaptureHost(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    for (const [key, value] of [...parsed.searchParams.entries()]) {
      if (/(^|\/\/)(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/i.test(value)) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString().replace(/\?$/, "");
  } catch {
    return url;
  }
}

export function rewriteHtmlLinks(html) {
  return (html || "").replace(/href="([^"]+)"/g, (m, h) => `href="${rewriteHref(h)}"`);
}

function alphaOf(color) {
  const m = (color || "").match(/rgba?\(([^)]+)\)/);
  if (!m) return color && color !== "transparent" ? 1 : 0;
  const parts = m[1].split(",").map(parseFloat);
  return parts.length > 3 ? parts[3] : 1;
}

function collect(node, list = []) {
  list.push(node);
  for (const c of node.children || []) collect(c, list);
  return list;
}

function fontSizeOf(rec) {
  return parseFloat(rec?.styles?.fontSize) || 16;
}

function weightOf(rec) {
  const w = rec?.styles?.fontWeight;
  return parseFloat(w) || (w === "bold" ? 700 : 400);
}

/**
 * Drop hidden responsive duplicates: builders often emit the same content
 * twice (desktop + mobile variants). Same text, one visible — keep the
 * visible one.
 */
function dropHiddenDuplicates(tree) {
  const byText = new Map();
  for (const node of collect(tree)) {
    if (!node.text || node.text.length < 4) continue;
    const key = `${node.kind}|${node.text}`;
    byText.set(key, [...(byText.get(key) || []), node]);
  }
  for (const nodes of byText.values()) {
    if (nodes.length < 2) continue;
    const visible = nodes.filter((n) => !n.hidden);
    if (visible.length >= 1) {
      for (const n of nodes) if (n.hidden) n.skip = true;
    }
  }
}

/**
 * Merge consecutive body-prose siblings (paragraphs, prose lists, minor
 * headings) into single rich-text nodes rendered with set:html. Title-like
 * leaves (big or bold) stay separate props.
 */
function mergeRichText(node, styleOf) {
  for (const child of node.children || []) mergeRichText(child, styleOf);
  if (node.repeat) return; // items are structured; their leaves stay leaves
  const kids = node.children || [];
  if (kids.length < 2) return;

  const isProse = (n) => {
    if (n.skip) return false;
    if (n.kind === "list") return true;
    if (n.kind === "text" && n.tag !== "span") {
      const rec = styleOf(n.n);
      return fontSizeOf(rec) < 20 && weightOf(rec) < 600;
    }
    if (n.kind === "heading" && !HEADING_TAGS.has(n.tag)) return true;
    return false;
  };

  const merged = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const blockHtml = run
        .map((n) => (n.kind === "list" ? n.html : `<${n.tag}>${n.html}</${n.tag}>`))
        .join("\n");
      const samples = {};
      for (const n of run) if (!(n.tag in samples)) samples[n.tag] = n.n;
      merged.push({
        n: run[0].n,
        tag: "div",
        kind: "richtext",
        hidden: false,
        attrs: {},
        box: run[0].box,
        children: [],
        html: blockHtml,
        text: run.map((n) => n.text).join(" "),
        samples,
        synthetic: true,
      });
    } else {
      merged.push(...run);
    }
    run = [];
  };

  for (const kid of kids) {
    if (isProse(kid)) run.push(kid);
    else {
      flush();
      merged.push(kid);
    }
  }
  flush();
  node.children = merged;
}

/** Keep only the outermost repeat when repeats nest. */
function pruneNestedRepeats(tree) {
  const walk = (node, insideRepeat) => {
    if (node.repeat && insideRepeat) delete node.repeat;
    for (const c of node.children || []) walk(c, insideRepeat || Boolean(node.repeat));
  };
  walk(tree, false);
}

class PropSet {
  constructor() {
    this.list = [];
    this.names = new Set();
  }

  add(base, def) {
    let name = base;
    let i = 2;
    while (this.names.has(name)) name = `${base}${i++}`;
    this.names.add(name);
    const prop = { name, ...def };
    this.list.push(prop);
    return prop;
  }
}

const COLOR_VARS = {
  backgroundColor: "--bg",
  headingColor: "--hd",
  eyebrowColor: "--eb",
  textColor: "--tx",
  titleColor: "--tt",
  titleHoverColor: "--tth",
  cardBackgroundColor: "--cardbg",
  buttonBackgroundColor: "--btnbg",
  buttonTextColor: "--btntx",
  buttonHoverBackgroundColor: "--btnhbg",
  buttonHoverTextColor: "--btnhtx",
  overlayColor: "--ov",
};

/**
 * Extract props from a captured, repeat-annotated tree. Annotates nodes in
 * place (cls, prop, itemProp, array) and returns the prop schema plus this
 * occurrence's values.
 */
export function extractProps({
  tree,
  styles,
  hover,
  breakpoints,
  name,
  maxColorProps = 12,
  branding = {},
  takenPrefixes,
}) {
  const desktop = Math.max(...breakpoints);
  const styleOf = (n) => styles[desktop]?.[n];
  // Class prefixes have to be unique across the whole run, not just within
  // this component — see `initialsOf`.
  const prefix = initialsOf(name, takenPrefixes);

  takenPrefixes?.add(prefix);

  dropHiddenDuplicates(tree);
  pruneNestedRepeats(tree);
  mergeRichText(tree, styleOf);

  // A list that survived merging stands alone; render it as a rich-text blob
  // (a wrapper div with set:html) so its markup stays a single editable value.
  for (const node of collect(tree)) {
    if (node.kind === "list") {
      node.samples = { [node.tag]: node.n };
      node.kind = "richtext";
      node.synthetic = true;
      node.tag = "div";
    }
  }

  // ---- class names ------------------------------------------------------
  const usedCls = new Set([name]);
  tree.cls = name;
  const clsFor = (kindName) => {
    let cls = `${prefix}-${kindName}`;
    let i = 2;
    while (usedCls.has(cls)) cls = `${prefix}-${kindName}${i++}`;
    usedCls.add(cls);
    return cls;
  };
  const kindClass = {
    heading: "heading",
    text: "text",
    richtext: "body",
    list: "list",
    img: "media",
    button: "btn",
    textlink: "link",
    container: "box",
    spacer: "spacer",
    decor: "decor",
    embed: "embed",
    raw: "raw",
  };
  for (const node of collect(tree)) {
    if (node === tree || node.skip) continue;
    const base = node.repeat ? "grid" : kindClass[node.kind] || "box";
    node.cls = clsFor(base);
    if (node.repeat) {
      for (const item of node.children) item.cls = clsFor("item");
    }
  }

  // ---- structural roles -------------------------------------------------
  const props = new PropSet();
  const values = {};
  const colorSlots = [];

  const inRepeatItem = (node, path) => path.some((p) => p.repeat);

  // Walk with path so item subtrees can be treated separately.
  const outsideLeaves = [];
  const arrays = [];
  const walk = (node, path) => {
    if (node.skip) return;
    if (node.repeat) {
      arrays.push({ node, path });
      return; // item internals handled per-array
    }
    if (
      ["heading", "text", "richtext", "list", "button", "textlink", "img", "embed", "raw"].includes(
        node.kind
      )
    ) {
      outsideLeaves.push(node);
    }
    for (const c of node.children || []) walk(c, [...path, node]);
  };
  walk(tree, []);

  // Main heading: first h1-h3, else first big text leaf.
  const textLeaves = outsideLeaves.filter((n) => ["heading", "text"].includes(n.kind));
  let mainHeading =
    textLeaves.find((n) => HEADING_TAGS.has(n.tag)) ??
    textLeaves.find((n) => fontSizeOf(styleOf(n.n)) >= 26);

  // Eyebrow: small leaf sitting before the main heading.
  let eyebrow = null;
  if (mainHeading) {
    const before = textLeaves.slice(0, textLeaves.indexOf(mainHeading));
    const headSize = fontSizeOf(styleOf(mainHeading.n));
    eyebrow = before.reverse().find((n) => fontSizeOf(styleOf(n.n)) <= headSize * 0.72) ?? null;
  }

  const assignText = (node, baseName, kind) => {
    const rich = kind === "html";
    const value = rich ? rewriteHtmlLinks(node.html) : node.text;
    const prop = props.add(baseName, {
      kind: rich ? "html" : "text",
      input: rich ? "html" : value.length > 90 ? "textarea" : "text",
    });
    node.prop = { name: prop.name, kind: prop.kind };
    values[prop.name] = value;
    return prop;
  };

  if (eyebrow) assignText(eyebrow, "eyebrow", "text");
  if (mainHeading)
    assignText(mainHeading, "heading", mainHeading.html !== mainHeading.text ? "html" : "text");

  let sawSubheading = false;
  for (const node of outsideLeaves) {
    if (node === eyebrow || node === mainHeading || node.prop) continue;
    switch (node.kind) {
      case "heading": {
        assignText(
          node,
          sawSubheading ? "heading" : "subheading",
          node.html !== node.text ? "html" : "text"
        );
        sawSubheading = true;
        break;
      }
      case "richtext":
      case "list":
        assignText(node, "text", "html");
        break;
      case "text":
        assignText(node, "text", node.html !== node.text ? "html" : "text");
        break;
      case "button":
      case "textlink": {
        const isPrimary = !props.names.has("buttonText");
        // Map what the source measured onto the shared Button's own prop
        // vocabulary wherever a token genuinely matches, so the component
        // does the work it was designed for. Anything with no token
        // equivalent (exact brand hexes, bespoke padding) is left to a
        // measured override rather than approximated by a token.
        const brec = styleOf(node.n);
        if (node.kind === "button") {
          const fs = fontSizeOf(brec);
          const radius = parseFloat(brec?.styles?.borderTopLeftRadius) || 0;
          const hasBorder = ["Top", "Right", "Bottom", "Left"].some(
            (side) => parseFloat(brec?.styles?.[`border${side}Width`]) > 0
          );
          const filled = alphaOf(brec?.styles?.backgroundColor) > 0.02;
          node.buttonMeta = {
            variant: filled ? "primary" : hasBorder ? "tertiary" : "text",
            size: fs <= 14 ? "sm" : fs <= 18 ? "md" : "lg",
            width: "none",
            uppercase: brec?.styles?.textTransform === "uppercase",
            borderRadius: radius === 0 ? "none" : radius >= 999 ? "full" : "default",
            borderWidth: hasBorder ? "xs" : "none",
          };
        }
        const base = isPrimary ? "button" : "secondaryButton";
        const textProp = props.add(`${base}Text`, { kind: "text", input: "text" });
        const linkProp = props.add(`${base}Link`, { kind: "url", input: "url" });
        node.prop = { name: textProp.name, kind: "text", linkName: linkProp.name };
        values[textProp.name] = node.text;
        values[linkProp.name] = rewriteHref(node.attrs.href || "");
        break;
      }
      case "img": {
        const srcProp = props.add("image", { kind: "image", input: "image" });
        const altProp = props.add(`${srcProp.name}Alt`, { kind: "text", input: "text" });
        node.prop = { name: srcProp.name, kind: "image", altName: altProp.name };
        values[srcProp.name] = node.attrs.src || "";
        values[altProp.name] = node.attrs.alt || "";
        break;
      }
      case "embed": {
        if (node.tag === "iframe" && node.attrs.src) {
          const prop = props.add("embedUrl", { kind: "url", input: "url" });
          node.prop = { name: prop.name, kind: "url" };
          values[prop.name] = stripCaptureHost(node.attrs.src);
        }
        break;
      }
      default:
        break;
    }
  }

  // ---- arrays -----------------------------------------------------------
  for (const { node } of arrays) {
    const template = node.children[0];
    const items = node.children;
    const optional = new Set(node.repeat.optionalNs || []);

    // Name the array from its content.
    const templateNodes = collect(template);
    const hasImg = templateNodes.some((n) => n.kind === "img");
    const hasHeadingish = templateNodes.some(
      (n) =>
        ["heading", "text"].includes(n.kind) &&
        (HEADING_TAGS.has(n.tag) || weightOf(styleOf(n.n)) >= 600 || fontSizeOf(styleOf(n.n)) >= 20)
    );
    const arrayName = hasImg && hasHeadingish ? "cards" : hasImg ? "images" : "items";
    const arrayProp = props.add(arrayName, { kind: "array", itemProps: [] });

    // Assign item-prop roles on the template.
    const itemProps = new PropSet();
    const paths = []; // [{path, propName, kind, attr?}]
    const pathTo = (target) => {
      const trail = [];
      const dfs = (cur, acc) => {
        if (cur === target) {
          trail.push(...acc);
          return true;
        }
        return (cur.children || []).some((c, i) => dfs(c, [...acc, i]));
      };
      dfs(template, []);
      return trail;
    };

    if (template.tag === "a" || (template.attrs.href && !template.prop)) {
      const p = itemProps.add("link", { kind: "url", input: "url" });
      paths.push({ path: [], prop: p, source: "href" });
      template.itemLink = p.name;
    }

    let titled = false;
    for (const tn of templateNodes) {
      if (tn === template && tn.kind === "container") continue;
      const rec = styleOf(tn.n);
      const optionalHere = optional.has(tn.n);
      switch (tn.kind) {
        case "img": {
          const p = itemProps.add("image", { kind: "image", input: "image" });
          const alt = itemProps.add(`${p.name}Alt`, { kind: "text", input: "text" });
          tn.itemProp = { name: p.name, kind: "image", altName: alt.name, optional: optionalHere };
          paths.push(
            { path: pathTo(tn), prop: p, source: "src" },
            { path: pathTo(tn), prop: alt, source: "alt" }
          );
          break;
        }
        case "heading":
        case "text": {
          const titleLike =
            HEADING_TAGS.has(tn.tag) || weightOf(rec) >= 600 || fontSizeOf(rec) >= 20;
          const base = titleLike && !titled ? "title" : "text";
          if (titleLike && !titled) titled = true;
          const p = itemProps.add(base, {
            kind: "text",
            input: base === "text" ? "textarea" : "text",
          });
          tn.itemProp = { name: p.name, kind: "text", optional: optionalHere };
          paths.push({ path: pathTo(tn), prop: p, source: "text" });
          break;
        }
        case "richtext":
        case "list": {
          const p = itemProps.add("text", { kind: "html", input: "html" });
          tn.itemProp = { name: p.name, kind: "html", optional: optionalHere };
          paths.push({ path: pathTo(tn), prop: p, source: "html" });
          break;
        }
        case "button":
        case "textlink": {
          const pt = itemProps.add("buttonText", { kind: "text", input: "text" });
          const pl = itemProps.add("buttonLink", { kind: "url", input: "url" });
          tn.itemProp = { name: pt.name, kind: "text", linkName: pl.name, optional: optionalHere };
          paths.push(
            { path: pathTo(tn), prop: pt, source: "text" },
            { path: pathTo(tn), prop: pl, source: "href" }
          );
          break;
        }
        case "container":
        case "textlinkContainer": {
          // Builders often wrap more than one part of a card in its own <a>
          // (the image, the title) pointing at the same destination. One
          // shared `link` prop drives every anchor in the item rather than
          // leaving the extras unwired.
          if (tn !== template && tn.tag === "a" && tn.attrs.href) {
            let linkProp = itemProps.list.find((ip) => ip.name === "link" && ip.kind === "url");
            if (!linkProp) linkProp = itemProps.add("link", { kind: "url", input: "url" });
            tn.itemLink = linkProp.name;
            paths.push({ path: pathTo(tn), prop: linkProp, source: "href" });
          }
          break;
        }
        default:
          break;
      }
    }

    // Harvest values per item by walking the same child-index paths.
    const at = (item, path) => {
      let cur = item;
      for (const i of path) {
        cur = (cur.children || [])[i];
        if (!cur) return null;
      }
      return cur;
    };
    const itemValues = items.map((item) => {
      const v = {};
      for (const { path, prop, source } of paths) {
        const target = at(item, path);
        if (!target) {
          v[prop.name] = "";
          continue;
        }
        if (source === "text") v[prop.name] = target.text ?? "";
        else if (source === "html") v[prop.name] = rewriteHtmlLinks(target.html ?? "");
        else if (source === "src") v[prop.name] = target.attrs?.src ?? "";
        else if (source === "alt") v[prop.name] = target.attrs?.alt ?? "";
        else if (source === "href") v[prop.name] = rewriteHref(target.attrs?.href ?? "");
      }
      return v;
    });

    // Carousel widgets commonly clone their first/last slides in the DOM for
    // seamless infinite-loop scrolling (Swiper's "loop" mode). Those clones
    // aren't hidden — they're positioned off-screen — so they survive as
    // distinct captured items and would otherwise double up the array.
    // Exact-duplicate items collapse to their first occurrence.
    const seen = new Set();
    const dedupedValues = [];
    for (const v of itemValues) {
      const key = JSON.stringify(v);
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedValues.push(v);
    }

    arrayProp.itemProps = itemProps.list;
    values[arrayProp.name] = dedupedValues;
    node.array = {
      name: arrayProp.name,
      itemProps: itemProps.list,
      template,
      itemVar: arrayName === "cards" ? "c" : "it",
    };
  }

  // ---- color props ------------------------------------------------------
  const addColor = (slotName, nodeN, where, cssProp, rawValue) => {
    if (!rawValue || alphaOf(rawValue) === 0) return null;
    if (colorSlots.length >= maxColorProps) return null;
    // Component defaults follow the repo's hex convention (#321c0e), not the
    // browser's rgb(...) computed form.
    const value = normalizeValue("color", rawValue);
    let finalName = slotName;
    let i = 2;
    while (colorSlots.some((s) => s.name === finalName && s.value !== value))
      finalName = `${slotName}${i++}`;
    const existing = colorSlots.find((s) => s.name === finalName);
    if (existing) {
      existing.uses.push({ nodeN, where, cssProp });
      return existing;
    }
    const varName =
      COLOR_VARS[slotName] && finalName === slotName
        ? COLOR_VARS[slotName]
        : `--c${colorSlots.length + 1}`;
    const slot = { name: finalName, varName, value, uses: [{ nodeN, where, cssProp }] };
    colorSlots.push(slot);
    return slot;
  };

  const rootRec = styleOf(tree.n);
  if (rootRec && alphaOf(rootRec.styles.backgroundColor) > 0) {
    addColor("backgroundColor", tree.n, "base", "backgroundColor", rootRec.styles.backgroundColor);
  }
  const overlayHost = [tree, ...(tree.children || [])].find((c) => {
    const rec = styleOf(c.n);
    return rec?.before && alphaOf(rec.before.backgroundColor) > 0;
  });
  if (overlayHost) {
    addColor(
      "overlayColor",
      overlayHost.n,
      "before",
      "backgroundColor",
      styleOf(overlayHost.n).before.backgroundColor
    );
  }

  const colorFor = (node, slot, cssProp = "color") => {
    const rec = styleOf(node.n);
    if (rec) addColor(slot, node.n, "base", cssProp, rec.styles[cssProp]);
  };
  if (eyebrow) colorFor(eyebrow, "eyebrowColor");
  if (mainHeading) colorFor(mainHeading, "headingColor");
  for (const node of outsideLeaves) {
    if (
      ["richtext", "text", "list"].includes(node.kind) &&
      node.prop &&
      node !== eyebrow &&
      node !== mainHeading
    ) {
      colorFor(node, "textColor");
    }
    if (node.kind === "button" && node.prop) {
      colorFor(node, "buttonBackgroundColor", "backgroundColor");
      colorFor(node, "buttonTextColor", "color");
    }
  }
  for (const { node } of arrays) {
    const template = node.children[0];
    const rec = styleOf(template.n);
    if (rec && alphaOf(rec.styles.backgroundColor) > 0) {
      addColor(
        "cardBackgroundColor",
        template.n,
        "base",
        "backgroundColor",
        rec.styles.backgroundColor
      );
    }
    for (const tn of collect(template)) {
      if (!tn.itemProp) continue;
      if (tn.itemProp.name === "title") colorFor(tn, "titleColor");
      else if (tn.itemProp.kind === "text" || tn.itemProp.kind === "html")
        colorFor(tn, "textColor");
    }
  }

  // Hover color slots: a color/backgroundColor that changes under :hover on a
  // slotted node becomes a <slot>HoverColor prop (the CardGrid caption pattern).
  const hoverSlots = [];
  const baseSlotOfNode = (n, cssProp) =>
    colorSlots.find((s) =>
      s.uses.some((u) => u.nodeN === n && u.cssProp === cssProp && u.where === "base")
    );
  for (const [hostN, states] of Object.entries(hover || {})) {
    for (const [n, hstyles] of Object.entries(states)) {
      for (const cssProp of ["color", "backgroundColor"]) {
        const base = styles[desktop]?.[n]?.styles?.[cssProp];
        const hv = hstyles[cssProp];
        if (!base || !hv || base === hv) continue;
        const baseSlot = baseSlotOfNode(Number(n), cssProp);
        const slotName = baseSlot
          ? `${baseSlot.name.replace(/Color$/, "")}HoverColor`
          : cssProp === "backgroundColor"
            ? "hoverBackgroundColor"
            : "hoverColor";
        const slot = addColor(slotName, Number(n), "hover", cssProp, hv);
        if (slot) hoverSlots.push({ slot, hostN: Number(hostN), nodeN: Number(n), cssProp });
      }
    }
  }

  // Root background-image becomes an editable image (the wood-texture pattern).
  let backgroundImageProp = null;
  const bgImage = rootRec?.styles?.backgroundImage;
  const bgUrl =
    bgImage && bgImage !== "none" ? (bgImage.match(/url\(["']?([^"')]+)["']?\)/) || [])[1] : null;
  const beforeBg = rootRec?.before?.backgroundImage;
  const beforeUrl =
    beforeBg && beforeBg !== "none"
      ? (beforeBg.match(/url\(["']?([^"')]+)["']?\)/) || [])[1]
      : null;
  if (bgUrl || beforeUrl) {
    const prop = props.add("backgroundImage", { kind: "image", input: "image" });
    // The measured URL travels with the prop so emission can tell "this
    // breakpoint shows the image the prop holds" from "this breakpoint shows a
    // different one" — themes routinely swap in a portrait crop below a
    // breakpoint, and substituting the var everywhere silently discards it.
    backgroundImageProp = {
      name: prop.name,
      varName: "--bgimg",
      nodeN: tree.n,
      where: bgUrl ? "base" : "before",
      url: bgUrl || beforeUrl || null,
    };
    values[prop.name] = (bgUrl || beforeUrl || "").replace(/^https?:\/\/[^/]+/, "");
  }

  // Each colour becomes a palette `select` plus a `<name>Hex` override. The
  // select carries the measured colour only when it lands on a brand token or
  // black/white/dark; otherwise the exact captured shade rides in the Hex prop
  // so the migrated section still renders as it did on the source site.
  for (const slot of colorSlots) {
    const prop = props.add(slot.name, { kind: "color", input: "colorSelect" });
    slot.name = prop.name;
    const option = nearestOption(slot.value, branding);
    values[prop.name] = option ?? "";
    const hexProp = props.add(`${prop.name}Hex`, {
      kind: "colorHex",
      input: "color",
      forProp: prop.name,
    });
    slot.hexName = hexProp.name;
    values[hexProp.name] = option ? "" : slot.value;
  }

  return {
    props: props.list,
    values,
    colorSlots,
    hoverSlots,
    backgroundImageProp,
    arrays: arrays.map((a) => a.node),
  };
}

export { collect };
