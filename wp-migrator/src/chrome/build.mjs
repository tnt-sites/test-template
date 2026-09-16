/**
 * Merge extracted chrome data into the target's existing data files, and copy
 * the chrome's own images. Ported from site-migrator's chrome/index.mjs,
 * stripped of its Playwright-driven `runChrome` orchestration.
 */

import fs from "node:fs";
import path from "node:path";
import { buildOffice } from "./office.mjs";
import { rewriteHref } from "../generate/props.mjs";
import { resolveIcon } from "../generate/icon-map.mjs";

/**
 * Menu hrefs come out of the browser exactly as the snapshot rewrote them —
 * `dental-services.html`, relative to the flat mirror. Left alone they are
 * emitted into the target's nav data verbatim, where every one of them 404s.
 */
function rewriteTree(items, iconSet = []) {
  return (items ?? []).map((item) => {
    // An icon the target does not ship is dropped rather than passed through:
    // `astro-icon` throws on an unknown name, so one unmatched glyph in the
    // menu fails the build for every page on the site.
    const icon = item.icon && iconSet.length ? resolveIcon({ name: item.icon }, iconSet) : null;
    return {
      ...item,
      path: rewriteHref(item.path),
      ...(icon ? { icon: icon.name } : item.icon ? { icon: "" } : {}),
      ...(item.children ? { children: rewriteTree(item.children, iconSet) } : {}),
    };
  });
}

/**
 * The alt text for a site's logo.
 *
 * Normally the source's own, because it is the source's logo. The exception is
 * the one this attribute is famous for: WordPress themes get copied between
 * businesses and the logo's alt is what nobody updates, so a practice ships
 * with a competitor's name attached to its own mark. This site does — its
 * header and footer logos are both labelled "Glacier Peak Dentistry".
 *
 * Copying that across is faithful and wrong. It is not a styling detail that a
 * visual comparison would catch, and it is not silent either: it is what a
 * screen reader announces the logo as, on every page.
 *
 * So where the source's alt names something other than the site, the site's
 * own name is used and the substitution is reported. Where it merely differs
 * in wording — "Columbine Creek Dentistry logo", "Home" — it is left alone.
 */
function resolveLogoAlt(sourceAlt, siteName, fallback = "") {
  const alt = (sourceAlt || "").trim();
  const name = (siteName || "").trim();
  if (!alt) return fallback || name;
  if (!name) return alt;

  // "Columbine Creek Dentistry - Dentist Littleton" -> "columbine"
  const distinctive = name
    .toLowerCase()
    .split(/[\s|–—-]+/)
    .filter(Boolean)[0];
  if (!distinctive || distinctive.length < 3) return alt;
  return alt.toLowerCase().includes(distinctive) ? alt : name;
}

export function buildNavData(extracted, current = {}, { iconSet = [] } = {}) {
  const next = { ...current };
  if (extracted.header?.logo?.source) {
    next.logoSource = extracted.header.logo.source;
    next.logoAlt = resolveLogoAlt(extracted.header.logo.alt, extracted.siteName, next.logoAlt);
  }
  if (extracted.header?.nav?.length) next.navData = rewriteTree(extracted.header.nav, iconSet);

  /*
   * The top bar — logo on one side, "Call us Today!" over a large phone number
   * on the other — is a tier of its own above the menu, and the template has
   * no notion of one. Without it the number either disappears or gets folded
   * into the menu row at menu-link size, which is the single most visible
   * difference between a migrated header and the original.
   *
   * Emitted only when the source actually had one, so a site whose header is
   * just a logo and a menu keeps the template's single-tier bar.
   */
  const aside = extracted.header?.aside;
  if (aside?.phone?.display) {
    // The handset beside the number is part of the pattern, not decoration —
    // it is what makes a bare string of digits read as something to call.
    const phoneIcon =
      aside.phone.icon && iconSet.length ? resolveIcon({ name: aside.phone.icon }, iconSet) : null;
    next.topBar = {
      label: aside.label || "",
      phone: {
        display: aside.phone.display,
        href: aside.phone.href || `tel:${aside.phone.display.replace(/[^\d+]/g, "")}`,
        ...(phoneIcon ? { icon: phoneIcon.name } : {}),
      },
    };
  }

  // The template renders its header call-to-action from data and ships a
  // placeholder ("Request an Appointment" → /request-an-appointment/, a page
  // that does not exist here). Where the source has its own CTA, it wins —
  // keeping the template's styling props and replacing only what it says and
  // where it goes.
  const cta = extracted.header?.buttons?.[0];
  if (cta?.text && cta.link && Array.isArray(next.pageButtons) && next.pageButtons.length) {
    next.pageButtons = [
      { ...next.pageButtons[0], text: cta.text, link: rewriteHref(cta.link) },
      ...next.pageButtons.slice(1),
    ];
  }
  return next;
}

export function buildFooterData(extracted, current = {}, { iconSet = [] } = {}) {
  const next = { ...current };
  if (extracted.footer?.logo?.source) {
    next.logoSource = extracted.footer.logo.source;
    next.logoAlt = resolveLogoAlt(extracted.footer.logo.alt, extracted.siteName, next.logoAlt);
  }

  if (extracted.footer?.links?.length) {
    const legalPattern = /privacy|terms|sitemap|accessibility|disclaimer|cookie/i;
    const links = [];
    const legal = [];
    const seen = new Set();

    for (const link of extracted.footer.links) {
      const key = `${link.name}|${link.path}`;
      if (seen.has(key) || !link.name) continue;
      seen.add(key);
      (legalPattern.test(link.name) ? legal : links).push({
        ...link,
        path: rewriteHref(link.path),
      });
    }

    if (links.length) next.links = links;
    if (legal.length) next.legalLinks = legal;
  }

  const columns = buildLinkColumns(extracted.footer?.columns, iconSet, extracted.siteName);
  if (columns.length) next.linkColumns = columns;

  const socialImages = (extracted.footer?.socialImages ?? []).filter((s) => s.image && s.link);
  if (socialImages.length) next.socialImages = socialImages;

  /*
   * The strip under the footer is its own bar with its own background, and the
   * template renders a fixed sentence there ("Site designed and maintained
   * by …"). Left alone the migrated site credits the wrong agency on every
   * page, which is a claim about a real business rather than a styling slip.
   */
  if (extracted.copyright?.text || extracted.copyright?.links?.length) {
    next.copyright = {
      text: extracted.copyright.text || "",
      links: (extracted.copyright.links ?? []).map((l) => ({ ...l, path: rewriteHref(l.path) })),
    };
  }

  return next;
}

/**
 * Footer link columns, with their icons resolved against the target's set.
 *
 * The icon is dropped rather than guessed when the target has no equivalent:
 * `astro-icon` throws on an unknown name, so an unresolved glyph is a build
 * failure for the whole site, not a gap in one footer column.
 */
function buildLinkColumns(columns, iconSet = [], siteName = "") {
  return (columns ?? [])
    .map((column) => ({
      title: column.title || "",
      ...(column.brand ? { brand: true } : {}),
      ...(column.logo?.source
        ? { logo: { ...column.logo, alt: resolveLogoAlt(column.logo.alt, siteName) } }
        : {}),
      links: (column.links ?? []).map((link) => {
        const icon = link.icon && iconSet.length ? resolveIcon({ name: link.icon }, iconSet) : null;
        return {
          name: link.name,
          path: rewriteHref(link.path),
          ...(icon ? { icon: icon.name } : {}),
          ...(link.iconAfter ? { iconAfter: true } : {}),
          ...(link.color ? { color: link.color } : {}),
          ...(link.external ? { external: true } : {}),
        };
      }),
    }))
    .filter((column) => column.links.length || column.logo);
}

/**
 * A social network's icon is named for the network on the source site and for
 * whatever the target's icon set calls it here — and the target is the
 * authority, since an icon it doesn't ship is a build failure, not a missing
 * glyph (`astro-icon` throws on an unknown name). Twitter/X is the case that
 * bites: the link still points at twitter.com long after the icon was renamed.
 */
function resolveSocialIcons(socials, iconSet = []) {
  if (!iconSet.length) return socials;
  const has = new Set(iconSet);
  const ALIASES = { twitter: ["x"], x: ["twitter"], facebook: ["fb"], youtube: ["yt"] };

  return socials.map((social) => {
    if (!social.icon || has.has(social.icon)) return social;
    const name = social.icon.replace(/^social\//, "");
    const candidate = [name, ...(ALIASES[name] ?? [])]
      .flatMap((n) => [`social/${n}`, n])
      .find((n) => has.has(n));
    return { ...social, icon: candidate ?? "" };
  });
}

export function buildSiteInfo(extracted, current = {}, { iconSet = [] } = {}) {
  const next = { ...current };
  if (extracted.siteName) next.siteName = extracted.siteName;
  if (extracted.footer?.socials?.length) {
    next.socials = resolveSocialIcons(extracted.footer.socials, iconSet);
  }

  const office = buildOffice(extracted, current.offices?.[0]);
  if (Object.keys(office).length) {
    next.offices = [office, ...(current.offices ?? []).slice(1)];
  }

  return next;
}

/** Copy the chrome's own images (logos) into the target and rewrite their paths. */
export function collectChromeAssets(extracted, { mirrorDir, writer, publicDir = "public" }) {
  const copied = [];
  const missing = [];

  const move = (holder, key) => {
    const src = holder?.[key];
    if (!src || /^(https?:|data:|\/\/)/i.test(src)) return;

    const clean = src.split("?")[0].split("#")[0].replace(/^\//, "");
    if (!clean || clean.endsWith("/")) return;

    const from = path.resolve(mirrorDir, clean);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
      missing.push(src);
      return;
    }

    writer.writeBinary(path.join(publicDir, clean), fs.readFileSync(from));
    holder[key] = `/${clean}`;
    copied.push(clean);
  };

  move(extracted.header?.logo, "source");
  move(extracted.footer?.logo, "source");
  for (const social of extracted.footer?.socialImages ?? []) move(social, "image");
  for (const column of extracted.footer?.columns ?? []) move(column.logo, "source");

  return { copied, missing };
}

/** Count the items in a nav tree, for reporting. */
export function countNav(items) {
  return (items ?? []).reduce((n, item) => n + 1 + countNav(item.children), 0);
}
