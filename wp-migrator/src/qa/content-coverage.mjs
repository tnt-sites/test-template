/**
 * Does the build still say everything the source said, and say it once?
 *
 * `pair-by-text.mjs` compares the styling of text that exists on *both* sides.
 * It is silent, by construction, about text that exists on only one: a key with
 * no counterpart is skipped, because an unpaired element is exactly what it
 * cannot make a typography claim about. `layout-patterns.mjs` then checks the
 * shape of what did survive. Neither notices that a whole section is gone.
 *
 * On this site that blind spot hid two things through several review rounds:
 *
 *   - Four pages shipped with no closing call-to-action at all. The section is
 *     in the source on every page; the pages whose bespoke templates were
 *     written by hand simply never got one, and nothing said so.
 *   - Three pages shipped with no `<h1>`. The emitter kept the heading's
 *     typography on its wrapper and gave the text no prop, so the component
 *     rendered an empty `<section>` — styled, sized, and saying nothing.
 *
 * And the mirror image, which is just as invisible to a pairing comparison:
 * text the build says *twice*. The interior pages render the source's
 * breadcrumb as a migrated section and the template's own breadcrumb above it,
 * so every one of them has two.
 *
 * Chrome is excluded on both sides. The header and footer are deliberately not
 * a copy of WordPress's (see `dev-refix`'s `isMigrated`), so comparing their
 * words would bury the page content this is here to check.
 */

/**
 * Read the page's content text, with counts. Runs inside the browser.
 *
 * Unlike `READ_TEXT_NODES` this keeps duplicates — they are the finding — and
 * records how deep in the document each key sits so a report can be read in
 * page order.
 */
export const READ_CONTENT = () => {
  // Phone numbers are masked before the text becomes a key. The source runs
  // call tracking, which rewrites the number client-side on every render, so
  // the two sides never agree on it — and a paragraph that merely ends with
  // "call us at (801) 210-8116" would be reported as missing content on page
  // after page, which is how a check like this earns being ignored.
  const norm = (s) =>
    (s || "")
      .replace(/ /g, " ")
      .replace(/\+?1?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "#phone")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const CHROME =
    "header, footer, nav, [role=banner], [role=contentinfo], .main-nav, .footer, .mobile-nav, .fixed-tabs, .breadcrumb";
  const blocks = new Map();
  const headings = { h1: 0, h2: 0, h3: 0 };
  let order = 0;

  // Visibility is deliberately not a filter here. Coverage asks whether the
  // build still *contains* the content, and a carousel shows one slide at a
  // time: four of the homepage's five banner captions are hidden at any moment
  // on one side and in flow on the other, which reported the whole carousel as
  // dropped. What matters is presence in the document.
  const isBlock = (el) => {
    const d = getComputedStyle(el).display;

    return d !== "inline" && d !== "inline-block" && d !== "contents" && d !== "none";
  };

  for (const el of document.querySelectorAll(
    "h1,h2,h3,h4,h5,h6,p,li,figcaption,blockquote,td,th,dd,dt"
  )) {
    if (el.closest(CHROME)) continue;

    const tag = el.tagName.toLowerCase();

    if (headings[tag] != null) headings[tag] += 1;

    const key = norm(el.textContent);

    // Short strings collide across unrelated elements ("home", "yes", a date),
    // and very long ones are usually a wrapper that swallowed a whole section.
    if (key.length < 12 || key.length > 400) continue;
    // Only leaf-ish blocks. A `<p>` whose text runs through `<a>`/`<strong>` is
    // one string on both sides and counts; a `<figcaption>` wrapping a heading
    // and a paragraph is a different *shape*, not different content, and its
    // concatenated text exists on neither side once the build splits them.
    if ([...el.children].some(isBlock)) continue;

    order += 1;
    const seen = blocks.get(key);

    if (seen) seen.count += 1;
    else blocks.set(key, { tag, count: 1, order });
  }

  // Images are the same blind spot as a dropped section, one step further out:
  // a pairing comparison has no text to pair on, and coverage above only reads
  // text nodes, so a page can lose every photo it has and still look complete.
  // That is exactly what a lazy-loading source did here — `<img data-src>` with
  // no `src` reached the repo as an empty source, and four pages shipped their
  // prose with none of their pictures while every check stayed green.
  //
  // The key is the file's basename: the two sides legitimately disagree about
  // the path (the source serves /wp-content/uploads/..., the build may hash or
  // resize it), but not about which file it is.
  const images = new Map();

  // The chrome selector above is written for the *built* side's markup. A
  // WordPress theme scatters its logo well outside `header`/`footer` — this one
  // repeats it in `.mobile-logo`, `.menu-logo`, `.top-logo` and `.f-logo`, none
  // of which are inside either — and a logo reported as a dropped image on all
  // 40 pages is how a check like this earns being ignored. A logo is never page
  // content, and "logo" in a wrapper's class or id is how themes say so.
  //
  // The walk stops at `<body>` deliberately: WordPress puts `wp-custom-logo` on
  // the body element itself, so an `[class*="logo"]` selector passed to
  // `closest` matches every image on the page and silently empties this check.
  const inLogo = (start) => {
    // The image's own description is the most reliable signal: a page builder
    // wraps the site logo in generic widget classes (`elementor-widget-image`,
    // `elementor-widget-container`) that say nothing, and only sometimes in a
    // `-theme-site-logo` variant, so an ancestor walk alone misses it on most
    // pages while the `alt` names it on all of them.
    const alt = start.getAttribute("alt") || "";
    if (/\blogo\b/i.test(alt)) return true;

    for (let n = start; n && n !== document.body; n = n.parentElement) {
      const id = n.getAttribute("id") || "";
      const cls = n.getAttribute("class") || "";
      // `site-logo`/`theme-site-logo` are hyphenated compounds, so the token
      // test has to accept a hyphen on the left as well as delimit on it.
      if (/(^|[\s_-])logo([\s_-]|$)/i.test(`${cls} ${id}`)) return true;
    }
    return false;
  };

  for (const el of document.querySelectorAll("img, source[srcset]")) {
    if (el.closest(CHROME) || inLogo(el)) continue;

    const raw =
      el.getAttribute("src") ||
      (el.getAttribute("srcset") || "").split(",")[0]?.trim().split(/\s+/)[0] ||
      "";
    if (!raw || raw.startsWith("data:")) continue;

    const file = raw.split("?")[0].split("#")[0].split("/").pop() || "";
    // Everything from the first dot is dropped: it is the extension, and for a
    // processed asset also the content hash and the converted format that go
    // with it (`image-2.BxK9zQ1a.avif` and `image-2.png` are one image). Then
    // WordPress's own `-1024x684` size suffix, since the two sides may pick
    // different sizes of the same photo. What is left is the identity.
    const key = file
      .toLowerCase()
      .split(".")[0]
      .replace(/-\d{2,4}x\d{2,4}$/, "");
    if (!key) continue;

    images.set(key, (images.get(key) || 0) + 1);
  }

  return { blocks: [...blocks.entries()], headings, images: [...images.entries()] };
};

/**
 * Compare two `READ_CONTENT` readings.
 *
 * Only the source is authoritative: text the build adds of its own (a "Read the
 * article" button, a category chip) is not a finding, so nothing is reported
 * for a key the source does not have.
 */
export function diffCoverage(source, built) {
  const builtBlocks = new Map(built.blocks);
  const dropped = [];
  const duplicated = [];

  for (const [key, s] of source.blocks) {
    const b = builtBlocks.get(key);

    if (!b) {
      dropped.push({ key, tag: s.tag, order: s.order });
      continue;
    }
    if (s.count === 1 && b.count > 1) {
      duplicated.push({ key, tag: b.tag, times: b.count, order: s.order });
    }
  }

  dropped.sort((a, b) => a.order - b.order);
  duplicated.sort((a, b) => a.order - b.order);

  const headings = [];

  for (const level of ["h1", "h2", "h3"]) {
    if (source.headings[level] !== built.headings[level]) {
      headings.push({ level, source: source.headings[level], built: built.headings[level] });
    }
  }

  const builtImages = new Map(built.images || []);
  const missingImages = (source.images || [])
    .filter(([key]) => !builtImages.has(key))
    .map(([key]) => key);

  return { dropped, duplicated, headings, missingImages };
}

/** Coverage findings in the shape `layout-patterns.mjs` reports. */
export function coverageFindings(coverage) {
  const out = [];
  const excerpt = (k) => (k.length > 64 ? `${k.slice(0, 61)}…` : k);

  if (coverage.dropped.length) {
    out.push({
      kind: "coverage",
      id: "droppedContent",
      label: "Text in the source that the build never renders",
      hint: "A whole section is usually missing — either the emitter gave its text no prop, or the page was rebuilt by hand and the section was not carried over.",
      status: "present",
      builtCount: coverage.dropped.length,
      examples: coverage.dropped.slice(0, 5).map((d) => `<${d.tag}> "${excerpt(d.key)}"`),
    });
  }

  if (coverage.duplicated.length) {
    out.push({
      kind: "coverage",
      id: "duplicatedContent",
      label: "Text the build renders more than once",
      hint: "Usually the template supplies a block the migrated page also carries (a breadcrumb, a page title). Drop one of them.",
      status: "present",
      builtCount: coverage.duplicated.length,
      examples: coverage.duplicated
        .slice(0, 5)
        .map((d) => `<${d.tag}> x${d.times} "${excerpt(d.key)}"`),
    });
  }

  if (coverage.missingImages?.length) {
    out.push({
      kind: "coverage",
      id: "droppedImages",
      label: "Images the source shows that the build never renders",
      hint: "Usually a lazy-loading source: the `<img>` carries no `src` until its script runs, so `img[src]` selectors skip it and the file is never copied. `resolveLazyImages` in browser/load.mjs is what keeps this from happening — check it ran on this page.",
      status: "present",
      builtCount: coverage.missingImages.length,
      examples: coverage.missingImages.slice(0, 5),
    });
  }

  // Only a build with no `<h1>` or with several is worth reporting. The source
  // is inconsistent on purpose — some pages caption the banner with a `<span>`
  // and put the `<h1>` in the content, others put it in the banner — so
  // "source 0, built 1" is the build being *more* correct, not a regression.
  const h1 = coverage.headings.find((h) => h.level === "h1");

  if (h1 && h1.built !== 1) {
    out.push({
      kind: "coverage",
      id: "headingCount",
      label: h1.built === 0 ? "Page has no <h1>" : "Page has more than one <h1>",
      hint:
        h1.built === 0
          ? "A heading was dropped — often a component that kept the heading's typography but was given no prop for its text."
          : "The banner and the page content are both claiming the `<h1>`. One of them should be a `<span>` or an `<h2>`.",
      status: "present",
      builtCount: h1.built,
      examples: [`source ${h1.source}, built ${h1.built}`],
    });
  }

  return out;
}
