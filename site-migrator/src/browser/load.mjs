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

  if (primeLazyLoad) await scrollThrough(page);
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
      }`,
  });

  // Some libraries write the hidden state as an inline style, which a
  // stylesheet cannot override without !important on every property.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[style]")) {
      const style = el.getAttribute("style") || "";
      if (/visibility\s*:\s*hidden|opacity\s*:\s*0/i.test(style)) {
        el.style.visibility = "visible";
        el.style.opacity = "1";
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
