/**
 * Score the built chrome against the source chrome.
 *
 * `qa/compare.mjs` does this for page sections, and it can only do it because
 * generation stamps the same identity on both sides: a captured source node
 * and the class it became. Chrome has no such pairing — the target renders its
 * own markup from data, so there is no generated class to match on, which is
 * why chrome sat outside the comparison and shipped unverified.
 *
 * The role table is the missing identity. `styles.mjs` already names the parts
 * of a header and a footer in a builder-agnostic way; naming the same parts in
 * the *target's* markup makes both sides addressable by the same key, and the
 * comparison becomes the same per-element numeric diff sections get.
 */

/**
 * Where each chrome role lives in the target's rendered output.
 *
 * The counterpart to `ROLES` in `styles.mjs`, which locates them in an
 * arbitrary WordPress theme. This one can be exact rather than a cascade of
 * guesses, because the markup is the starter's own.
 */
export const TARGET_ROLES = {
  headerBand: [".main-nav .hd-topbar"],
  headerInner: [".main-nav .hd-topbar .hd-bar-inner"],
  // As with the footer, one element in the starter answers for both the inner
  // box and the row the source drew with a separate wrapper.
  headerRow: [".main-nav .hd-topbar .hd-bar-inner"],
  headerLogo: [".main-nav .hd-topbar .logo-link img"],
  headerLogoBox: [".main-nav .hd-topbar .logo-link"],
  headerAside: [".main-nav .hd-aside"],
  headerAsideLabel: [".main-nav .hd-aside-label"],
  headerAsidePhone: [".main-nav .hd-aside-phone"],

  navBar: [".main-nav .hd-navbar"],
  navInner: [".main-nav .hd-navbar .hd-bar-inner"],
  navList: [".main-nav .desktop-main-nav > .bar-list"],
  navLink: [".main-nav .desktop-main-nav > .bar-list > .nav-item > a"],
  navCta: [".main-nav .hd-navbar-cta .button"],
  navToggle: [".main-nav .nav-hamburger"],
  navPhone: [".main-nav .hd-navbar-phone"],

  dropdownPanel: [".main-nav .desktop-main-nav .nav-item-content"],
  dropdownItem: [".main-nav .desktop-main-nav .nav-item-content .nav-item > a"],
  dropdownItemIcon: [".main-nav .desktop-main-nav .nav-item-lead"],

  footerBand: ["footer.footer"],
  footerInner: ["footer .footer-columns"],
  // The starter's grid is both the inner box and the row the source drew
  // with a separate wrapper; one element answers for both roles.
  footerRow: ["footer .footer-columns"],
  footerColumn: ["footer .footer-column"],
  footerLogo: ["footer .footer-column-logo img"],
  footerHeading: ["footer .footer-column-title"],
  footerRule: ["footer .footer-column-rule"],
  footerLink: ["footer .footer-column-link"],
  footerLinkIcon: ["footer .footer-column-icon"],
  footerSocialImage: ["footer .footer-column-socials img"],

  copyrightBand: ["footer .footer-copyright"],
  copyrightInner: ["footer .footer-copyright-inner"],
};

/**
 * What gets compared, and how far apart two values may be before it counts.
 *
 * Typography is compared exactly — a 15px menu link rendered at 16px is a real
 * difference and there is no reason to accept it. Geometry gets a tolerance,
 * because the two sides do not have to agree on box model to agree on
 * appearance, and a report that flags every 2px is a report nobody reads.
 */
const CHECKS = [
  { key: "fontSize", kind: "type", tolerance: 0, needsText: true },
  { key: "fontWeight", kind: "type", tolerance: 0, needsText: true },
  { key: "color", kind: "color", needsText: true },
  { key: "backgroundColor", kind: "color" },
  { key: "fontFamily", kind: "family", needsText: true },
  { key: "height", kind: "geometry", tolerance: 4 },
  { key: "width", kind: "geometry", tolerance: 8 },
];

/**
 * Checks that do not apply to a given role.
 *
 * Not every property is comparable between two renderings of the same thing.
 * The source draws its icons as glyphs from an icon font and the target draws
 * SVG, so `font-family: "Font Awesome 6 Free"` against `Montserrat` and
 * `font-weight: 900` against `400` are not differences to fix — they are the
 * substitution the migrator made on purpose, reported once per icon on every
 * page. An `<img>` has a `color` too, inherited from whatever link wraps it,
 * and it means nothing.
 *
 * Left in the table rather than dropped from the roles entirely, because the
 * *geometry* of an icon or a logo is very much worth comparing.
 */
const NOT_APPLICABLE = {
  dropdownItemIcon: ["fontFamily", "fontWeight", "fontSize"],
  footerLinkIcon: ["fontFamily", "fontWeight", "fontSize"],
  navToggle: ["fontFamily", "fontWeight", "fontSize", "color"],
  headerLogo: ["color", "fontFamily", "fontWeight", "fontSize"],
  footerLogo: ["color", "fontFamily", "fontWeight", "fontSize"],
  footerSocialImage: ["color", "fontFamily", "fontWeight", "fontSize"],
};

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** Compare font stacks by their first family only. */
const primaryFamily = (v) =>
  String(v ?? "")
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

/**
 * @param {object} source measured source roles at one width
 * @param {object} built   measured built roles at the same width
 * @returns {{findings: Array, compared: number, missing: string[]}}
 */
export function compareChrome(source, built) {
  const findings = [];
  const missing = [];
  let compared = 0;

  for (const role of Object.keys(source ?? {})) {
    const from = source[role];
    const to = built?.[role];
    if (!from) continue;

    if (!to) {
      /*
       * A role the source has and the build does not. Reported rather than
       * skipped: this is the finding that matters most, because a part that
       * is simply absent looks like nothing at all in a token diff — the
       * tokens are all present and correct, and the element that would have
       * used them was never rendered.
       */
      missing.push(role);
      findings.push({
        role,
        kind: "missing",
        severity: 100,
        detail: "present in source, absent from build",
      });
      continue;
    }
    compared++;

    const skip = NOT_APPLICABLE[role] ?? [];
    /*
     * A container — a list, a rule, a link around a logo — resolves type and
     * colour it never draws with. Those inherited values differ freely between
     * two DOMs that look identical, so they are compared only where at least
     * one side actually renders text with them. Background and geometry are
     * still compared everywhere, because a container paints those.
     */
    const rendersText = Boolean(from.ownsText || to.ownsText);
    for (const check of CHECKS) {
      if (skip.includes(check.key)) continue;
      if (check.needsText && !rendersText) continue;
      const a = check.kind === "geometry" ? from.box?.[check.key] : from.styles?.[check.key];
      const b = check.kind === "geometry" ? to.box?.[check.key] : to.styles?.[check.key];
      if (a == null || b == null) continue;

      if (check.kind === "color") {
        if (String(a) === String(b)) continue;
        findings.push({
          role,
          kind: "color",
          prop: check.key,
          source: a,
          built: b,
          severity: 40,
          detail: `${check.key} ${a} -> ${b}`,
        });
        continue;
      }

      if (check.kind === "family") {
        if (primaryFamily(a) === primaryFamily(b)) continue;
        findings.push({
          role,
          kind: "type",
          prop: check.key,
          source: a,
          built: b,
          severity: 50,
          detail: `font ${primaryFamily(a)} -> ${primaryFamily(b)}`,
        });
        continue;
      }

      const na = num(a);
      const nb = num(b);
      if (na == null || nb == null) {
        if (String(a) !== String(b)) {
          findings.push({
            role,
            kind: check.kind,
            prop: check.key,
            source: a,
            built: b,
            severity: 30,
            detail: `${check.key} ${a} -> ${b}`,
          });
        }
        continue;
      }
      const delta = nb - na;
      if (Math.abs(delta) <= (check.tolerance ?? 0)) continue;
      findings.push({
        role,
        kind: check.kind,
        prop: check.key,
        source: na,
        built: nb,
        delta: Math.round(delta * 100) / 100,
        severity: Math.min(100, Math.abs(delta) * (check.kind === "type" ? 8 : 1)),
        detail: `${check.key} ${na} -> ${nb} (${delta > 0 ? "+" : ""}${Math.round(delta)})`,
      });
    }
  }

  findings.sort((a, b) => b.severity - a.severity);
  return { findings, compared, missing };
}

/** Human-readable digest of one comparison run. */
export function formatChromeReport(byWidth) {
  const lines = [];
  for (const [width, result] of Object.entries(byWidth)) {
    const { findings, compared } = result;
    lines.push(`\n${width}px — ${compared} role(s) compared, ${findings.length} finding(s)`);
    if (!findings.length) {
      lines.push("  matches");
      continue;
    }
    for (const f of findings.slice(0, 14)) {
      lines.push(`  ${f.role.padEnd(20)} ${f.detail}`);
    }
    if (findings.length > 14) lines.push(`  … ${findings.length - 14} more`);
  }
  return lines.join("\n");
}
