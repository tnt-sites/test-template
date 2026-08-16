/**
 * Structural normalisation, run in the browser against the post-JS DOM.
 *
 * The output is a *role sequence* — a coarse description of what a section is
 * made of, deliberately blind to the things that vary between instances of the
 * same visual pattern. The previous toolkit hashed the full subtree including
 * class names, so one extra `<br>`, a third list item, or a runtime-injected
 * `elem-left` class forked one pattern into several "unique" shapes: 188
 * sections became 90 shapes needing 118 hand-written mappings.
 */

/** Serialised for injection into the page — keep it self-contained. */
export const NORMALIZE_SOURCE = `
function makeNormalizer(config) {
  const noiseClass = config.noiseClasses.map((p) => new RegExp("^" + p + "$", "i"));
  const noiseId = config.noiseIds.map((p) => new RegExp(p, "i"));
  const buttonRe = new RegExp(config.buttonClassPattern, "i");

  function classList(el) {
    const raw = el.getAttribute("class") || "";
    return raw
      .split(/\\s+/)
      .filter(Boolean)
      .filter((c) => !noiseClass.some((r) => r.test(c)));
  }

  function hasClass(el, name) {
    return classList(el).some((c) => c.toLowerCase() === name);
  }

  /**
   * A wrapper that exists only to hold one child and paints nothing of its own
   * carries no structural meaning; collapsing it stops layout scaffolding from
   * distinguishing otherwise identical sections.
   */
  function isTransparentWrapper(el) {
    const kids = [...el.children];
    if (kids.length !== 1) return false;

    const cs = getComputedStyle(el);
    if (cs.display === "flex" || cs.display === "grid") return false;
    if (cs.backgroundImage !== "none") return false;

    const bg = cs.backgroundColor.match(/rgba?\\(([^)]+)\\)/);
    if (bg) {
      const parts = bg[1].split(",").map(parseFloat);
      const alpha = parts.length > 3 ? parts[3] : 1;
      if (alpha > 0.05) return false;
    }
    if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0) return false;

    const pad = ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"]
      .map((p) => parseFloat(cs[p]) || 0);
    if (Math.max(...pad) > 4) return false;

    return true;
  }

  function roleOf(el) {
    const tag = el.tagName.toLowerCase();
    const classes = classList(el).map((c) => c.toLowerCase());
    const cls = classes.join(" ");

    if (/\\b(slick|swiper|owl-|embla|carousel|slider)\\b/.test(cls)) return "CAROUSEL";
    if (/\\b(accordion|faq|toggle)\\b/.test(cls)) return "ACCORDION";

    if (tag === "form") return "FORM";
    if (tag === "iframe" || el.hasAttribute("data-embed")) return "EMBED";
    if (tag === "video" || tag === "picture") return "IMG";
    if (tag === "img") return "IMG";
    if (tag === "svg" || /^icon-/.test(cls)) return "ICON";
    if (tag === "table") return "TABLE";
    if (tag === "ul" || tag === "ol") return "LIST";
    if (tag === "br" || tag === "hr") return null;

    // Headings are often expressed as a class rather than a tag.
    for (const level of ["h1", "h2", "h3", "h4"]) {
      if (tag === level || classes.includes(level)) return level.toUpperCase();
    }

    if (tag === "a") {
      return classes.some((c) => buttonRe.test(c)) ? "BTN" : "LINK";
    }
    if (tag === "p") return "P";
    if (tag === "blockquote") return "QUOTE";

    return null; // structural container — descend into it
  }

  /** Bucket run lengths so "3 cards" and "5 cards" are the same pattern. */
  function bucket(n) {
    if (n >= 4) return "4+";
    return String(n);
  }

  function sequence(el, depth, maxDepth) {
    if (depth > maxDepth) return ["..."];

    let node = el;
    let guard = 0;
    // Never collapse *past* an element that carries a role. isTransparentWrapper
    // is a purely geometric test — one child, no padding, no background — and a
    // heading satisfies it whenever its text is wrapped in a span, which is
    // exactly what Elementor emits:
    //   <h3 class="elementor-icon-box-title"><span>Title</span></h3>
    // Roles are only ever read off \`node.children\`, so descending into the
    // heading discarded it. On an Elementor source that silently emptied the
    // role sequence of every section whose content sits in inner sections.
    while (
      isTransparentWrapper(node) &&
      roleOf(node.children[0]) === null &&
      guard++ < 10
    ) {
      node = node.children[0];
    }

    const out = [];
    for (const child of node.children) {
      const cs = getComputedStyle(child);
      if (cs.display === "none" || cs.visibility === "hidden") continue;

      const role = roleOf(child);
      if (role === null) {
        out.push(...sequence(child, depth + 1, maxDepth));
      } else if (role === "LIST") {
        const items = child.querySelectorAll(":scope > li").length;
        out.push("LIST(" + bucket(items) + ")");
      } else {
        out.push(role);
      }
    }

    // Collapse consecutive identical roles into a bucketed run.
    const collapsed = [];
    for (const role of out) {
      const last = collapsed[collapsed.length - 1];
      if (last && last.role === role) last.count++;
      else collapsed.push({ role, count: 1 });
    }

    return collapsed.map((r) => (r.count === 1 ? r.role : r.role + "x{" + bucket(r.count) + "}"));
  }

  return { sequence, roleOf, classList, hasClass, isTransparentWrapper };
}
`;

/** Layout and semantic features measured from the rendered section. */
export const FEATURES_SOURCE = `
function measureFeatures(el, viewportWidth) {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  const kids = [...el.children].filter((c) => {
    const s = getComputedStyle(c);
    return s.display !== "none" && s.visibility !== "hidden";
  });

  let columns = 1;
  if (cs.display === "grid") {
    columns = (cs.gridTemplateColumns || "").split(/\\s+/).filter(Boolean).length || 1;
  } else if (cs.display === "flex" && cs.flexDirection.startsWith("row")) {
    columns = kids.length || 1;
  }

  const flowDirection =
    cs.display === "flex" ? (cs.flexDirection.startsWith("row") ? "row" : "column")
    : cs.display === "grid" ? (columns > 1 ? "row" : "column")
    : "column";

  // Which side the dominant image sits on, by comparing bounding boxes.
  const images = [...el.querySelectorAll("img, picture, video")]
    .map((i) => ({ el: i, r: i.getBoundingClientRect() }))
    .filter((i) => i.r.width > 40 && i.r.height > 40)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);

  const texts = [...el.querySelectorAll("p, h1, h2, h3, h4")]
    .map((t) => ({ el: t, r: t.getBoundingClientRect() }))
    .filter((t) => t.r.width > 0)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);

  let imageSide = "none";
  if (images.length) {
    if (!texts.length) imageSide = "only";
    else {
      const img = images[0].r;
      const txt = texts[0].r;
      const overlapsVertically = img.top < txt.bottom && txt.top < img.bottom;
      if (!overlapsVertically) imageSide = img.top < txt.top ? "top" : "bottom";
      else imageSide = img.left + img.width / 2 < txt.left + txt.width / 2 ? "left" : "right";
    }
  }

  const bgMatch = cs.backgroundColor.match(/rgba?\\(([^)]+)\\)/);
  let hasOwnBackground = cs.backgroundImage !== "none";
  if (!hasOwnBackground && bgMatch) {
    const parts = bgMatch[1].split(",").map(parseFloat);
    const alpha = parts.length > 3 ? parts[3] : 1;
    hasOwnBackground = alpha > 0.05;
  }

  const contentWidths = [900, 1100, 1300, 1500];
  const inner = kids.length ? kids[0].getBoundingClientRect().width : rect.width;
  let containerMaxWidth = "none";
  for (const w of contentWidths) {
    if (Math.abs(inner - w) < 80) { containerMaxWidth = String(w); break; }
  }

  const cls = (el.getAttribute("class") || "").toLowerCase();
  const bucket = (n) => (n >= 3 ? "3+" : String(n));

  return {
    flowDirection,
    columns: bucket(columns),
    imageSide,
    hasOwnBackground,
    textAlign: cs.textAlign,
    fullBleed: rect.width >= viewportWidth - 2,
    containerMaxWidth,
    hasCarousel: /slick|swiper|owl-|embla|carousel|slider/.test(cls)
      || !!el.querySelector('[class*="slick"],[class*="swiper"],[class*="carousel"],[class*="slider"]'),
    hasAccordion: /accordion|faq/.test(cls)
      || !!el.querySelector('[class*="accordion"],[class*="faq"],details'),
    hasForm: !!el.querySelector("form"),
    hasEmbed: !!el.querySelector("iframe,[data-embed]"),
    hasMap: !!el.querySelector('iframe[src*="map"]'),
    buttonCount: bucket([...el.querySelectorAll("a")].filter((a) =>
      /\\bbtn|\\bbutton/i.test(a.getAttribute("class") || "")).length),
    imageCount: bucket(images.length),
  };
}
`;
