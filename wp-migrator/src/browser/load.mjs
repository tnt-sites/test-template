/**
 * Robust page loading.
 *
 * Real sites pull in third-party fonts, analytics, chat widgets and embeds that
 * may never go quiet, so waiting for `networkidle` hangs and then throws. The
 * previous toolkit did exactly that with no error handling, so one slow page
 * aborted an entire run after it had already written partial output.
 *
 * Here every wait is best-effort with its own timeout, and a page that fails is
 * reported and skipped rather than taking the run down with it.
 */

import { GALLERY_THUMB_ATTRS, LAZY_SRC_ATTRS, LAZY_SRCSET_ATTRS, PLACEHOLDER_SRC } from "./lazy.mjs";

const DEFAULT_TIMEOUT = 20000;

async function tolerate(promise) {
  try {
    await promise;
    return true;
  } catch {
    return false;
  }
}

/**
 * Navigate and settle. Returns what did and didn't succeed so callers can
 * decide whether the measurement is trustworthy.
 */
export async function gotoStable(page, url, opts = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    settleMs = 400,
    primeLazyLoad = false,
    freezeMotion = false,
    reveal = false,
  } = opts;

  const errors = [];
  const onPageError = (e) => errors.push({ type: "pageerror", message: e.message });
  const onConsole = (m) => {
    if (m.type() === "error") errors.push({ type: "console", message: m.text() });
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);

  let response = null;
  const navigated = await tolerate(
    page.goto(url, { waitUntil: "domcontentloaded", timeout }).then((r) => {
      response = r;
      return r;
    })
  );
  if (!navigated) {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    return { ok: false, reason: "navigation failed", errors };
  }

  // An error page is never a valid thing to measure, and it does not look like
  // a failure once it renders: the static server answers a miss with a plain
  // "Not found" body, which measures as a real page roughly 15px tall with none
  // of the expected elements in it. A caller comparing that against the source
  // reports every element as missing — indistinguishable from the content
  // genuinely having been dropped, and far more alarming. Fail here instead.
  const status = response?.status?.() ?? 0;
  if (status >= 400) {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    return { ok: false, reason: `HTTP ${status} for ${url}`, status, errors };
  }

  // Best-effort: these improve fidelity but must never block the run.
  const loaded = await tolerate(page.waitForLoadState("load", { timeout: timeout / 2 }));
  const fontsReady = await tolerate(
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const done = () => resolve(true);
          if (document.fonts?.ready) document.fonts.ready.then(done, done);
          else done();
          setTimeout(done, 5000);
        })
    )
  );

  // Unconditional, unlike the two below: this is a pure attribute rewrite with
  // no scroll and no measurement, and a `src`-less `<img>` is never a thing any
  // caller wants to read or size. Gating it on `primeLazyLoad` would leave it
  // off in exactly the place that first lost the images — `runExtract`'s
  // full-site image sweep, which opts out of priming because it takes no
  // measurements, and which decides what gets copied into the repo.
  await resolveLazyImages(page);

  if (primeLazyLoad) {
    await scrollThrough(page);
    await resolveLazyBackgrounds(page);
  }
  if (reveal) await revealAnimated(page);
  if (freezeMotion) await stopMotion(page);

  await page.waitForTimeout(settleMs);

  page.off("pageerror", onPageError);
  page.off("console", onConsole);
  return { ok: true, status, loaded, fontsReady, errors };
}

/**
 * Scroll the full page in steps so lazy-loaded images decode before capture.
 * Without this, screenshots of anything below the fold are blank.
 */
export async function scrollThrough(page, { step = 600, waitMs = 60 } = {}) {
  await page.evaluate(
    async ({ step, waitMs }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const height = document.body.scrollHeight;
      for (let y = 0; y < height; y += step) {
        window.scrollTo(0, y);
        await sleep(waitMs);
      }
      window.scrollTo(0, 0);
      await sleep(waitMs);
    },
    { step, waitMs }
  );
}

/**
 * Resolve lazy-loaded `<img>` elements by applying the loader's data attribute
 * to `src` ourselves.
 *
 * This used to be left to `scrollThrough`, on the assumption that intersecting
 * a lazy image makes its own loader swap `data-src` into `src`. That assumption
 * only holds when the loader is running, and in these stages it usually is not:
 * pages are replayed from the static mirror through a local server, where the
 * plugin's script may be absent, blocked, or simply never fire its observer
 * headlessly. The image then keeps **no `src` at all** — which is worse than a
 * broken one, because `img[src]` selectors skip it silently and
 * `getAttribute("src")` returns `""`.
 *
 * That is how Taylor Dental Care shipped four pages of text with no photos:
 * `runExtract` never copied the files into the repo and `captureSection`
 * recorded empty sources, while `dev-verify` stayed green throughout because
 * it pairs on text and the text was never wrong.
 *
 * Applying the attribute directly is safe — it is the value the plugin would
 * have written — and a real `src` always wins, so a stale `data-src` left
 * behind after a swap cannot overwrite a good image. See `./lazy.mjs`.
 */
export async function resolveLazyImages(page) {
  const resolved = await page.evaluate(
    ({ srcAttrs, srcsetAttrs, galleryAttrs, placeholder }) => {
      const re = new RegExp(placeholder.source, placeholder.flags);
      const pick = (el, names) => {
        for (const name of names) {
          const value = (el.getAttribute(name) || "").trim();
          if (value && !re.test(value)) return value;
        }
        return "";
      };

      let resolved = 0;

      // A scripted gallery's image is an empty element that merely *names* its
      // file. Give it a real `<img>`: everything downstream — the asset copier,
      // the coverage check, the props extractor — is written against `<img>`,
      // and teaching each of them about `role="img"` divs would be the same
      // rule spelled four times. The element keeps its box and classes, so the
      // gallery's own layout still applies.
      for (const host of document.querySelectorAll("[data-thumbnail], [data-large], [data-image]")) {
        if (host.querySelector("img")) continue;
        const url = pick(host, galleryAttrs);
        if (!url) continue;

        const img = document.createElement("img");
        img.setAttribute("src", url);
        // `aria-label` is where these divs carry their alt text, and it is real
        // authored copy — the only description the source ever gave the image.
        img.setAttribute("alt", host.getAttribute("aria-label") || "");
        const w = host.getAttribute("data-width");
        const h = host.getAttribute("data-height");
        if (w) img.setAttribute("width", w);
        if (h) img.setAttribute("height", h);
        // Fill the box the gallery already sized, rather than imposing one.
        // Its own intrinsic ratio, not the box's: these four covers are a
        // magazine page, two landscape clippings and a portrait one, and a
        // single measured `aspect-ratio` on the shared repeat template would
        // letterbox three of them.
        img.style.width = "100%";
        img.style.height = "auto";
        host.appendChild(img);
        host.setAttribute("data-wpmig-gallery-img", "");
        // Elementor sizes these boxes with the padding-bottom ratio trick,
        // which only makes sense while the picture is a *background*. With a
        // real `<img>` in the box that padding is dead space — and worse, the
        // repeat detector measures one item and applies its ratio to every
        // card, so a landscape clipping gets the first item's portrait box.
        // Clear it and let each image state its own size.
        host.style.setProperty("padding-bottom", "0", "important");
        host.style.setProperty("height", "auto", "important");
        resolved++;
      }

      for (const el of document.querySelectorAll("img, source")) {
        // `src` is only meaningful on an `<img>`; a `<source>` inside a
        // `<picture>` is addressed by `srcset` alone, and writing `src` there
        // would leave an inert attribute for `captureSection` to record.
        if (el.tagName === "IMG") {
          const current = (el.getAttribute("src") || "").trim();
          if (!current || re.test(current)) {
            const real = pick(el, srcAttrs);
            if (real) {
              el.setAttribute("src", real);
              resolved++;
            }
          }
        }

        const currentSet = (el.getAttribute("srcset") || "").trim();
        if (!currentSet) {
          const realSet = pick(el, srcsetAttrs);
          if (realSet) el.setAttribute("srcset", realSet);
        }

        // What the loader itself does on success. Sites style `.lazyload` as
        // hidden or mid-transition, so leaving the class on can blank an image
        // that now has a perfectly good source.
        if (el.classList.contains("lazyload")) {
          el.classList.remove("lazyload", "lazyloading");
          el.classList.add("lazyloaded");
        }
      }
      return resolved;
    },
    {
      srcAttrs: LAZY_SRC_ATTRS,
      srcsetAttrs: LAZY_SRCSET_ATTRS,
      galleryAttrs: GALLERY_THUMB_ATTRS,
      placeholder: { source: PLACEHOLDER_SRC.source, flags: PLACEHOLDER_SRC.flags },
    }
  );

  // The gallery's own script paints the same URL as a background *after* this
  // runs, and a per-element clear loses that race. A stylesheet does not: it
  // applies whenever the element appears. Without it the emitter bakes the
  // background onto the repeat *template*, where it can only ever be the first
  // item's image, and every card in the row shows item one behind its own.
  if (resolved) {
    await page.addStyleTag({
      content:
        "[data-wpmig-gallery-img] { background-image: none !important; padding-bottom: 0 !important; height: auto !important; }",
    });
  }
  return resolved;
}

/**
 * Resolve lazy-loaded *background* images.
 *
 * The `<img>` counterpart above handles elements; this handles the same
 * plugins' background case, where the URL is parked in `data-bg` and only ever
 * applied from script. Every stage downstream otherwise measures the section
 * with `background-image: none` — which is how the Taylor Dental Care closing
 * CTA lost its photo and its gradient scrim while `dev-verify` stayed clean,
 * since the text on it was never wrong.
 *
 * Applying the attribute directly is safe: it is the value the plugin would
 * have written, and an element that already has a background is left alone.
 */
export async function resolveLazyBackgrounds(page) {
  await page.evaluate(() => {
    const ATTRS = ["data-bg", "data-background", "data-background-image", "data-src-bg"];

    for (const el of document.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))) {
      if (getComputedStyle(el).backgroundImage !== "none") continue;

      const url = ATTRS.map((a) => el.getAttribute(a)).find((v) => v && v.trim());

      if (url) el.style.backgroundImage = `url("${url.trim().replace(/"/g, '\\"')}")`;
    }
  });
}

/** Halt animations and transitions so captures are deterministic. */
export async function stopMotion(page) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto !important;
      caret-color: transparent !important;
    }`,
  });
}

/**
 * Force scroll-reveal content into its final visible state.
 *
 * Reveal-on-scroll libraries (WOW.js, AOS, and similar) hold elements at
 * `visibility: hidden` or `opacity: 0` until they enter the viewport. Any
 * visibility test then reports real content as invisible, which quietly drops
 * images — and whole sections — from a migration. Scrolling alone is not enough:
 * the observer may never fire in a headless run, and elements above the final
 * scroll position revert.
 */
export async function revealAnimated(page) {
  await page.addStyleTag({
    content: `
      [class*="wow"], [class*="animate"], [class*="animated"], [class*="fade"],
      [class*="reveal"], [class*="slide-in"], [data-aos], [data-wow-delay],
      [data-wow-duration], [data-animate] {
        visibility: visible !important;
        opacity: 1 !important;
        transform: none !important;
        animation: none !important;
      }
      /* The hidden state is often on a *descendant* of the animated element,
         which matches none of the selectors above: an Elementor gallery marks
         the link \`elementor-animated-content\` and then hides the image div
         inside it. Clearing the subtree is what stops a measurement being taken
         of a half-scaled, invisible box — the gallery's covers were captured at
         \`transform: matrix(0.5,…)\` and \`filter: opacity(0)\` and baked a 143px
         max-width that rendered them 21px wide. */
      [class*="wow"] *, [class*="animate"] *, [class*="animated"] *,
      [class*="fade"] *, [class*="reveal"] *, [class*="slide-in"] *,
      [data-aos] *, [data-animate] * {
        visibility: visible !important;
        opacity: 1 !important;
        transform: none !important;
        filter: none !important;
        animation: none !important;
        transition: none !important;
      }`,
  });

  // Some libraries write the hidden state as an inline style, which a
  // stylesheet cannot override without !important on every property.
  //
  // `filter: opacity(0)` belongs here too: it hides an element as completely as
  // `opacity: 0` does, and a measurement taken through it is a measurement of
  // something invisible.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[style]")) {
      const style = el.getAttribute("style") || "";
      if (/visibility\s*:\s*hidden|opacity\s*:\s*0|filter\s*:[^;]*opacity\(\s*0/i.test(style)) {
        el.style.visibility = "visible";
        el.style.opacity = "1";
        el.style.filter = "none";
      }
      // A mid-flight reveal leaves a scale/translate behind, and every geometry
      // the capture takes through it is wrong by that factor.
      if (/transform\s*:\s*(matrix|scale|translate)/i.test(style)) {
        el.style.transform = "none";
      }
    }
  });
}

/**
 * Run a callback over many pages, tolerating individual failures.
 * Returns results plus the list of pages that could not be measured.
 */
export async function forEachPage(browser, pages, fn, opts = {}) {
  const { viewport = { width: 1280, height: 1000 }, ...loadOpts } = opts;
  const results = [];
  const failures = [];

  const page = await browser.newPage({ viewport });
  try {
    for (const p of pages) {
      const state = await gotoStable(page, p.url, loadOpts);
      if (!state.ok) {
        failures.push({ page: p, reason: state.reason });
        continue;
      }
      try {
        results.push({ page: p, value: await fn(page, p, state) });
      } catch (e) {
        failures.push({ page: p, reason: e.message });
      }
    }
  } finally {
    await page.close();
  }

  return { results, failures };
}
