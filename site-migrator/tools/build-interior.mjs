#!/usr/bin/env node
/**
 * Assemble complex interior pages from the Artisan component vocabulary.
 *
 * extract-page-bodies.mjs treats a page as "banner + one body", which is right
 * for the ~70 simple pages (a bio really is a sidebar plus prose) but wrong for
 * the ~19 pages that are structurally closer to the homepage. Flattening those
 * keeps the words and throws away the composition — about-us was the worst case.
 *
 * This classifies each source section by measured shape and emits the component
 * already built for that shape, rather than inventing new ones.
 *
 * Usage:
 *   node tools/build-interior.mjs about-us [--dry-run]
 *   node tools/build-interior.mjs --all-complex
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = path.resolve(ROOT, "../src/content/pages");
const PUBLIC = path.resolve(ROOT, "../public");
const STATIC = path.join(ROOT, "static");
const WOOD = "/wp-content/uploads/2021/05/brown-wood-texture-and-backgroun-nw.jpg";
const dry = process.argv.includes("--dry-run");

/** Read every content section on the page, with the numbers needed to classify. */
const READ = () => {
  const H = document.querySelector('header[data-elementor-type="header"]');
  const secs = [...document.querySelectorAll("section.elementor-top-section, div.elementor-top-section")]
    .filter((s) => !H?.contains(s) && !s.closest('[data-elementor-type="footer"]') && !s.closest('[data-elementor-type="popup"]'));
  const t = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : "");
  const strip = (u) => (u ? u.replace(/^https?:\/\/[^/]+/, "") : "");
  const bgOf = (el) => {
    for (const n of [el, ...el.querySelectorAll(":scope > .elementor-background-overlay, :scope > .elementor-container")]) {
      const m = getComputedStyle(n).backgroundImage.match(/url\(["']?([^"')]+)/);
      if (m) return strip(m[1]);
    }
    return "";
  };
  return secs.map((s) => {
    const r = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    const cols = [...s.querySelectorAll(":scope > .elementor-container > .elementor-column")];
    const imgs = [...s.querySelectorAll("img")];
    const heads = [...s.querySelectorAll(".elementor-heading-title, h1, h2, h3")];
    const small = (el) => el && Number.parseFloat(getComputedStyle(el).fontSize) < 24;
    const eyebrow = heads.length > 1 && small(heads[0]) ? heads[0] : null;
    const heading = heads.find((h) => h !== eyebrow) ?? null;
    const btn = s.querySelector(".elementor-button");
    const content = s.querySelector(".elementor-widget-theme-post-content, .elementor-widget-text-editor");
    return {
      height: Math.round(r.height),
      hidden: cs.display === "none" || cs.visibility === "hidden" || r.height < 5,
      text: t(s),
      bgColor: cs.backgroundColor,
      bgImage: bgOf(s),
      cols: cols.length,
      colWidths: cols.map((c) => Math.round(c.getBoundingClientRect().width)),
      images: imgs.map((i) => ({ src: strip(i.getAttribute("src")), alt: i.getAttribute("alt") || "" })),
      carousel: !!s.querySelector(".swiper, .elementor-image-carousel"),
      perView: Number((s.querySelector("[data-settings]")?.getAttribute("data-settings") ?? "").match(/slides_to_show"?:\s*"?(\d+)/)?.[1] ?? 0),
      listItems: [...s.querySelectorAll(".elementor-icon-list-item")].map((li) => t(li)).filter(Boolean),
      // This source uses icon-box far more than image-box; matching only the
      // latter sent every section to the generic split-feature fallback.
      imageBoxes: [...s.querySelectorAll(".elementor-widget-image-box, .elementor-widget-icon-box")].map((w) => ({
        icon: strip(w.querySelector("img")?.getAttribute("src")),
        title: t(w.querySelector(".elementor-image-box-title, .elementor-icon-box-title")),
        text: t(w.querySelector(".elementor-image-box-description, .elementor-icon-box-description")),
        link: w.querySelector("a")?.getAttribute("href") ?? "",
      })).filter((b) => b.title || b.text),
      eyebrow: t(eyebrow),
      heading: t(heading),
      body: (() => {
        if (!content) return "";
        // Clean the lifted markup in the DOM, where it can be walked properly:
        //  - drop heading/button widgets, which we re-emit as a real CTA
        //    component; left in they render as unstyled Elementor markup
        //  - drop srcset/sizes, which point at WordPress size variants that
        //    were never ported, so the browser picks a 404 and shows alt text
        const clone = content.cloneNode(true);
        clone.querySelectorAll(".elementor-widget-heading, .elementor-widget-button, .elementor-button-wrapper")
          .forEach((n) => n.remove());
        clone.querySelectorAll("img").forEach((img) => {
          img.removeAttribute("srcset");
          img.removeAttribute("sizes");
          img.removeAttribute("data-srcset");
          img.removeAttribute("width");
          img.removeAttribute("height");
        });
        return clone.innerHTML;
      })(),
      bodyText: t(content),
      button: btn ? { text: t(btn), link: btn.getAttribute("href") ?? "" } : null,
      iframes: [...s.querySelectorAll("iframe")].map((f) => f.getAttribute("src") ?? ""),
      // A single Elementor section often holds several distinct blocks — page
      // content, a CTA and a logo carousel all at once. Record them separately
      // so one carousel cannot swallow the rest of the section.
      carouselImages: [...s.querySelectorAll(".swiper, .elementor-image-carousel")]
        .flatMap((c) => [...c.querySelectorAll("img")])
        .map((i) => ({ src: strip(i.getAttribute("src")), alt: i.getAttribute("alt") || "" })),
      contentImages: [...s.querySelectorAll(".elementor-widget-image img, .elementor-widget-theme-post-content img")]
        .map((i) => ({ src: strip(i.getAttribute("src")), alt: i.getAttribute("alt") || "" })),
      hasPostContent: !!s.querySelector(".elementor-widget-theme-post-content"),
    };
  });
};

const fixHref = (h) =>
  !h ? "" : h.replace(/^https?:\/\/[^/]+/, "").replace(/^\/?([a-z0-9-]+)\.html$/i, "/$1/").replace(/^\/category\/services\//, "/services/");

const C = (name, o) => ({ _component: `page-sections/artisan/${name}`, id: "", ...o });
const ctaBar = (s) =>
  C("split-feature", {
    eyebrow: "", heading: s.heading, text: "", image: "",
    buttonText: s.button?.text ?? "", buttonLink: fixHref(s.button?.link),
    reverse: false, align: "center", mediaMinHeight: "0px",
    backgroundColor: "#321c0e", eyebrowColor: "#d2b22e",
    headingColor: "#ffffff", textColor: "#ffffff",
  });

const isDark = (c) => /rgb\(\s*(\d+)/.test(c) && Number(c.match(/rgb\(\s*(\d+)/)[1]) < 90 && !/, 0\)$/.test(c);

/** Measured shape -> the component already built for it. */
function classify(s) {
  if (s.hidden || (!s.text && !s.images.length && !s.iframes.length)) return null;

  // Compound section: split it rather than letting the carousel win.
  const uniqCarousel = [...new Map(s.carouselImages.map((i) => [i.src, i])).values()];
  const hasCopy = s.hasPostContent || s.contentImages.length > 0 || s.bodyText.length > 120;
  if (uniqCarousel.length >= 3 && hasCopy) {
    const out = [];
    // Only synthesise an <img> when the post content does not already carry
    // one, or the flyer renders twice — once real, once as a broken duplicate
    // showing its alt text.
    const bodyHasImg = /<img\b/i.test(s.body || "");
    const bodyHtml =
      (!bodyHasImg && s.contentImages.length
        ? s.contentImages.map((i) => `<p><img src="${i.src}" alt="${i.alt}"></p>`).join("")
        : "") + (s.body || "");
    if (bodyHtml.trim()) {
      out.push(C("split-feature", {
        eyebrow: "", heading: "", text: bodyHtml, image: "",
        buttonText: "", buttonLink: "", reverse: false, align: "left", mediaMinHeight: "0px",
        backgroundColor: "transparent", eyebrowColor: "#d2b22e",
        headingColor: "#321c0e", textColor: "#333333",
      }));
    }
    if (s.heading && s.button) out.push(ctaBar(s));
    out.push(C("logo-strip", {
      eyebrow: "", heading: "",
      logos: uniqCarousel.map((i) => ({ image: i.src, alt: i.alt, link: "" })),
      perView: s.perView || Math.min(5, uniqCarousel.length), autoplaySeconds: 5,
      backgroundColor: "#321c0e", backgroundImage: WOOD, overlayOpacity: 0.15,
      eyebrowColor: "#ffffff", headingColor: "#ffffff",
    }));
    return out;
  }

  // A short band that is just a headline and a button is a CTA bar, not a
  // content split — health-plans has one at 162px.
  if (s.heading && s.button && !s.images.length && !s.imageBoxes.length && s.bodyText.length < 160) {
    return ctaBar(s);
  }

  // A carousel or a run of logos with no prose is a logo strip.
  if ((s.carousel || s.images.length >= 4) && s.bodyText.length < 120 && !s.imageBoxes.length) {
    return C("logo-strip", {
      eyebrow: s.eyebrow, heading: s.heading,
      logos: s.images.map((i) => ({ image: i.src, alt: i.alt, link: "" })),
      perView: s.perView || Math.min(5, s.images.length), autoplaySeconds: 5,
      backgroundColor: "#321c0e", backgroundImage: WOOD, overlayOpacity: 0.15,
      eyebrowColor: "#ffffff", headingColor: "#ffffff",
    });
  }

  // Icon/image boxes = the services grid.
  if (s.imageBoxes.length >= 2) {
    return C("services-grid", {
      eyebrow: s.eyebrow, heading: s.heading, text: s.bodyText.slice(0, 400),
      buttonText: s.button?.text ?? "", buttonLink: fixHref(s.button?.link),
      cards: s.imageBoxes.map((b) => ({ icon: b.icon, title: b.title, text: b.text, link: fixHref(b.link) })),
      backgroundColor: "#ffffff", eyebrowColor: "#d2b22e", headingColor: "#321c0e", textColor: "#333333",
      cardBackgroundColor: "#fbfaf7",
    });
  }

  // A photo band carrying a checklist.
  if (s.bgImage && s.listItems.length >= 3) {
    return C("feature-banner", {
      eyebrow: s.eyebrow, heading: s.heading, items: s.listItems, image: s.bgImage,
      overlayColor: "rgba(50, 28, 14, 0.72)", eyebrowColor: "#ffffff", headingColor: "#ffffff",
      textColor: "#ffffff", markerColor: "#d2b22e", minHeight: `${Math.max(420, s.height)}px`,
      panelColor: "rgba(50, 28, 14, 0.92)", panelWidth: "620px",
    });
  }

  // Three-ish equal columns each with a picture = the card row.
  if (s.cols >= 3 && s.images.length >= s.cols - 1 && s.images.length <= 6) {
    return C("card-grid", {
      cards: s.images.slice(0, s.cols).map((i) => ({ image: i.src, title: i.alt, text: "", link: "" })),
      backgroundColor: "#321c0e", backgroundImage: WOOD, overlayOpacity: 0.15,
      titleColor: "#ffffff", textColor: "#ffffff", captionColor: "#d2b22e",
      sectionBackgroundColor: "transparent",
    });
  }

  if (s.iframes.some((f) => /youtube|vimeo/i.test(f))) {
    return C("video-row", {
      videos: s.iframes.filter((f) => /youtube|vimeo/i.test(f))
        .map((f) => ({ youtubeId: (f.match(/embed\/([A-Za-z0-9_-]+)/) ?? [])[1] ?? "", title: "" }))
        .filter((v) => v.youtubeId),
      backgroundColor: "#ffffff",
    });
  }

  if (s.iframes.some((f) => /maps\./i.test(f))) {
    return C("contact-block", {
      heading: s.heading, details: [], formBlocks: [], formAction: "/thank-you/",
      mapEmbedUrl: s.iframes.find((f) => /maps\./i.test(f)), mapHeight: "380px",
      backgroundColor: "#ffffff", headingColor: "#321c0e", labelColor: "#321c0e", textColor: "#333333",
    });
  }

  // Everything else is copy, with or without a picture beside it.
  const img = s.images[0]?.src ?? "";
  const dark = isDark(s.bgColor);
  return C("split-feature", {
    eyebrow: s.eyebrow, heading: s.heading, text: s.body || `<p>${s.bodyText}</p>`,
    image: s.cols >= 2 && img ? img : "",
    buttonText: s.button?.text ?? "", buttonLink: fixHref(s.button?.link),
    reverse: false, align: s.cols >= 2 && img ? "left" : "left",
    mediaMinHeight: s.cols >= 2 && img ? "420px" : "0px",
    backgroundColor: dark ? s.bgColor : "transparent",
    eyebrowColor: "#d2b22e",
    headingColor: dark ? "#ffffff" : "#321c0e",
    textColor: dark ? "#ffffff" : "#333333",
  });
}

const ids = process.argv.includes("--all-complex")
  ? ["about-us", "why-choose-artisan", "botox-for-therapeutics-esthetics", "full-partial-mouth-rehabilitation",
     "new-smile-design", "ceramic-veneers", "services"]
  : process.argv.slice(2).filter((a) => !a.startsWith("--"));

const { server, url } = await serve(STATIC, 0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const wanted = new Set();

for (const id of ids) {
  if (!fs.existsSync(path.join(STATIC, `${id}.html`))) { console.log(`  ! no snapshot for ${id}`); continue; }
  await page.goto(`${url}/${id}.html`, { waitUntil: "load" }).catch(() => {});
  await page.evaluate(() => new Promise((r) => { let y = 0; const t = setInterval(() => { window.scrollTo(0, y += 700); if (y > 12000) { clearInterval(t); r(); } }, 15); }));
  const secs = await page.evaluate(READ);

  const content = secs.filter((x) => !x.hidden && (x.text || x.images.length || x.iframes.length));
  const bannerSrc = content[0];
  const raw2 = content.slice(1).flatMap((x) => classify(x) ?? []).filter(Boolean);
  // The same CTA often appears both inside a compound section and again as its
  // own band; keep the first.
  const seenCta = new Set();
  const built = raw2.filter((sec) => {
    const isCta = sec._component.endsWith("split-feature") && sec.heading && sec.buttonText && !sec.text;
    if (!isCta) return true;
    const key = `${sec.heading}|${sec.buttonText}`;
    if (seenCta.has(key)) return false;
    seenCta.add(key);
    return true;
  });
  const md = path.join(PAGES, `${id}.md`);
  if (!fs.existsSync(md)) { console.log(`  ! no page file for ${id}`); continue; }
  const raw = fs.readFileSync(md, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = YAML.parse(m[1]);
  const banner = (fm.pageSections ?? []).find((s) => s._component?.endsWith("artisan/page-banner"));
  if (banner && bannerSrc) {
    // Interior banners often sit on a photo. The old index-banner carried a
    // null backgroundImage, so the swap had nothing to copy and every banner
    // came out as the plain brown band.
    if (bannerSrc.bgImage) {
      banner.backgroundImage = bannerSrc.bgImage;
      wanted.add(bannerSrc.bgImage);
    }
    if (!banner.eyebrow && bannerSrc.eyebrow) banner.eyebrow = bannerSrc.eyebrow;
  }
  fm.pageSections = [...(banner ? [banner] : []), ...built];
  delete fm._migUnmapped;

  for (const s of built) {
    for (const k of ["image", "backgroundImage"]) if (typeof s[k] === "string" && s[k].startsWith("/wp-")) wanted.add(s[k]);
    for (const l of s.logos ?? []) if (l.image) wanted.add(l.image);
    for (const c of s.cards ?? []) { if (c.image) wanted.add(c.image); if (c.icon) wanted.add(c.icon); }
  }

  if (!dry) fs.writeFileSync(md, `---\n${YAML.stringify(fm, { lineWidth: 0 })}---\n${m[2]}`);
  const kinds = built.map((s) => s._component.split("/").pop());
  console.log(`  ${id.padEnd(38)} ${secs.length} src -> ${built.length}: ${[...new Set(kinds)].join(", ")}`);
}

await browser.close();
server.close();

let copied = 0;
for (const ref of wanted) {
  const rel = ref.replace(/^\//, "");
  const from = path.join(STATIC, rel), to = path.join(PUBLIC, rel);
  if (!fs.existsSync(from) || fs.existsSync(to)) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to); copied++;
}
console.log(`\n${dry ? "[dry run] " : ""}${copied} image(s) ported`);
