import { gotoStable } from "../browser/load.mjs";

/**
 * Chrome checks beyond geometry.
 *
 * `mig chrome` migrates the header and footer as *data* — nav tree, logo,
 * socials, contact details — and ports their colour and type. It does not port
 * their architecture, and three classes of fault survive that split silently
 * because the page still renders and the build still passes:
 *
 *   1. The nav tree carries the wrong labels.
 *   2. The rebuilt desktop layout overflows narrow viewports.
 *   3. Starter-template demo content is still sitting in the chrome data.
 *
 * Each of these shipped at least once before being caught by eye, so they are
 * checked here rather than left to a reviewer noticing.
 */

/**
 * Read the visible label of every top-level menu item, in document order.
 *
 * Takes the nav *container*, not a link selector, and reads each item's label
 * structurally: the first direct child of the `<li>` that isn't the sub-menu.
 * A selector like `li > a` misses any dropdown parent whose anchor the site's
 * menu script has swapped for a `<span>` or `<button>` — which is exactly the
 * case this check exists to catch, so it must not share the assumption.
 */
export async function readNavLabels(page, url, containerSelector) {
  const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true });
  if (!state.ok) return { ok: false, reason: state.reason };

  const labels = await page.evaluate((sel) => {
    let container = null;
    try {
      container = document.querySelector(sel);
    } catch {
      return [];
    }
    if (!container) return [];

    const list = container.matches("ul") ? container : container.querySelector("ul");
    if (!list) return [];

    const clean = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

    return [...list.children]
      .filter((li) => li.tagName === "LI")
      .filter((li) => li.offsetParent !== null || li.getClientRects().length > 0)
      .map((li) => {
        const sublist = [...li.children].find((c) => c.tagName === "UL");
        const label = [...li.children].find(
          (c) => c !== sublist && c.tagName !== "UL" && clean(c)
        );
        return clean(label);
      })
      .filter(Boolean);
  }, containerSelector);

  return { ok: true, labels };
}

/**
 * Pair up source and migrated nav labels by position.
 *
 * Position rather than text, because the failure this catches is a *renamed*
 * item, not a reordered one: where a dropdown's parent and its first child
 * share an href, the chrome extractor can take the child's label for the
 * parent, so "About Us" migrates as "What Sets Us Apart". Matching on text
 * would report that as one removal plus one addition and bury the cause.
 */
export function compareNavLabels(sourceLabels, targetLabels) {
  const rows = [];
  const length = Math.max(sourceLabels.length, targetLabels.length);

  for (let index = 0; index < length; index++) {
    const source = sourceLabels[index];
    const target = targetLabels[index];

    if (source === target) {
      rows.push({ index, status: "match", source, target });
    } else if (source === undefined) {
      rows.push({ index, status: "extra", source, target });
    } else if (target === undefined) {
      rows.push({ index, status: "missing", source, target });
    } else {
      rows.push({ index, status: "differs", source, target });
    }
  }

  return rows;
}

/** Viewport widths worth checking. Phone, tablet, the breakpoint, desktop. */
export const DEFAULT_WIDTHS = [390, 768, 1024, 1280, 1440];

/**
 * Report viewports where the document is wider than the window.
 *
 * Rebuilding the source's desktop chrome means fixed pixel columns, and a
 * fixed column that is not gated behind a media query pushes the page wider
 * than a phone viewport. The symptom is a horizontal scrollbar on mobile,
 * which never shows up in a desktop screenshot — so it is measured instead.
 */
export async function findOverflow(page, url, widths = DEFAULT_WIDTHS) {
  const rows = [];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true });
    if (!state.ok) continue;

    const measured = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));

    // 1px of slack: sub-pixel layout rounds up on some widths without any
    // scrollbar actually appearing.
    rows.push({
      width,
      doc: measured.doc,
      overflow: measured.doc > measured.win + 1,
    });
  }

  return rows;
}

/**
 * Look for starter-template demo content left in the migrated chrome.
 *
 * `mig chrome` fills the template's own data files, and anything the source
 * had no equivalent for keeps the starter's value. A placeholder address or a
 * demo email reads as real content on a live site, so the markers are matched
 * against the rendered header and footer text rather than the data files —
 * that is where they actually do damage.
 */
export async function findDemoContent(page, url, markers = [], selectors = []) {
  if (markers.length === 0) return { ok: true, hits: [] };

  const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true });
  if (!state.ok) return { ok: false, reason: state.reason };

  const hits = await page.evaluate(
    ([markers, selectors]) => {
      const regions = selectors
        .map((sel) => {
          try {
            return document.querySelector(sel);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const haystack = (regions.length ? regions : [document.body])
        .map((el) => el.innerText || el.textContent || "")
        .join("\n")
        .toLowerCase();

      return markers.filter((marker) => haystack.includes(String(marker).toLowerCase()));
    },
    [markers, selectors]
  );

  return { ok: true, hits };
}

/**
 * Form controls and labels whose accessible name is broken.
 *
 * The template's own nav chrome — not anything a migration generates — shipped
 * two of these before a screen reader user caught them, both invisible to
 * every other check here because the control still works fine with a mouse:
 *
 *   1. An icon-only submenu trigger is a `<label role="button">` wrapping only
 *      an `aria-hidden` chevron, with no `aria-label` of its own — a label
 *      "present" in the DOM with no accessible content.
 *   2. The mobile nav's open and close buttons are both `<label for>` pointing
 *      at the *same* hidden checkbox — a control with two names, which screen
 *      readers announce inconsistently.
 *
 * Runs on whatever page it's pointed at, chrome included, since both faults
 * are absolute (broken or not) rather than a source/migrated comparison.
 */
export function evaluateLabelIssues(page) {
  return page.evaluate(() => {
    const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

    // `textContent` alone counts glyphs inside `aria-hidden` icons (a fontello
    // ligature, a stray unicode arrow) as accessible text, which is exactly
    // backwards — those are the decorative icons this check exists to see
    // through. Walk the tree instead, skipping any `aria-hidden="true"` subtree.
    const accessibleText = (el) => {
      let text = "";
      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.getAttribute("aria-hidden") === "true") return;
        for (const child of node.childNodes) walk(child);
      };
      walk(el);
      return clean(text);
    };

    const describe = (el) => {
      const id = el.id ? `#${el.id}` : "";
      const cls =
        typeof el.className === "string" && el.className.trim()
          ? "." + el.className.trim().split(/\s+/).join(".")
          : "";
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };

    const issues = [];

    // A <label> is only worth flagging if it is doing the job of an
    // interactive control — associated with one via `for`/wrapping, or
    // carrying its own role/tabindex. A bare unused <label> is dead markup,
    // not a broken one.
    for (const label of document.querySelectorAll("label")) {
      if (label.hasAttribute("aria-label") || label.hasAttribute("aria-labelledby")) continue;
      if (accessibleText(label)) continue;

      const isInteractive =
        label.hasAttribute("for") ||
        label.hasAttribute("role") ||
        label.hasAttribute("tabindex") ||
        label.querySelector("input, select, textarea");
      if (!isInteractive) continue;

      issues.push({ type: "empty-label", element: describe(label), for: label.getAttribute("for") });
    }

    for (const control of document.querySelectorAll("input, select, textarea")) {
      if (!control.id) continue;

      const count = document.querySelectorAll(`label[for="${CSS.escape(control.id)}"]`).length;
      if (count > 1) {
        issues.push({ type: "multiple-labels", element: describe(control), count });
      }
    }

    return issues;
  });
}

export async function findLabelIssues(page, url) {
  const state = await gotoStable(page, url, { primeLazyLoad: true, reveal: true });
  if (!state.ok) return { ok: false, reason: state.reason };

  return { ok: true, issues: await evaluateLabelIssues(page) };
}
