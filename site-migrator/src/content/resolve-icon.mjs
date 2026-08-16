import { nearestIcon } from "./validate-icons.mjs";

/**
 * Turn an icon captured from the source into something the target can render.
 *
 * The source names icons in its own icon-font vocabulary (`icon-ok-1`); the
 * target renders a different set. Translating between them is what keeps a
 * migrated list showing a tick rather than whatever placeholder the target
 * component seeds — and the seeded default is the more damaging outcome,
 * because it looks deliberate.
 */

/**
 * Icon-font names to their nearest equivalent in a conventional icon set.
 * Keyed on the meaningful part of the name, with the `icon-` prefix and any
 * numeric variant suffix stripped.
 */
const SEMANTIC_ALIASES = {
  ok: "check",
  "ok-circled": "check-circle",
  "ok-squared": "check-circle",
  check: "check",
  cancel: "x-mark",
  close: "x-mark",
  phone: "phone",
  call: "phone",
  mobile: "device-phone-mobile",
  mail: "envelope",
  email: "envelope",
  location: "map-pin",
  "map-marker": "map-pin",
  direction: "map-pin",
  clock: "clock",
  time: "clock",
  calendar: "calendar",
  "calendar-empty": "calendar",
  star: "star",
  heart: "heart",
  home: "home",
  user: "user",
  "user-md": "user",
  users: "users",
  doc: "document",
  "doc-text": "document-text",
  info: "information-circle",
  "info-circled": "information-circle",
  help: "question-mark-circle",
  attention: "exclamation-triangle",
  money: "banknotes",
  dollar: "currency-dollar",
  credit: "credit-card",
  "credit-card": "credit-card",
  chat: "chat-bubble-left",
  comment: "chat-bubble-left",
  quote: "chat-bubble-left-ellipsis",
  camera: "camera",
  picture: "photo",
  video: "video-camera",
  play: "play",
  search: "magnifying-glass",
  cog: "cog-6-tooth",
  wrench: "wrench",
  shield: "shield-check",
  lock: "lock-closed",
  gift: "gift",
  truck: "truck",
  award: "trophy",
  trophy: "trophy",
  thumbs: "hand-thumb-up",
  "thumbs-up": "hand-thumb-up",
};

/** `icon-ok-1` -> `ok`; `icon-map-marker` -> `map-marker`. */
export function normalizeIconName(name) {
  return String(name)
    .replace(/^icon-/, "")
    .replace(/-\d+$/, "")
    .toLowerCase();
}

/**
 * @param {object} icon   captured by `extractSection`
 * @param {object} glyphMap  `{ family, glyphs: { "icon-ok-1": "\\e832" } }`
 * @param {Set<string>} iconSet  outline icon names the target can render
 * @param {Set<string>} fontelloSet  icon-font names the target can render
 */
export function resolveIcon(icon, { glyphMap, iconSet, fontelloSet } = {}) {
  if (!icon) return null;

  if (icon.kind === "image") {
    return { type: "image", src: icon.src, alt: icon.alt ?? "" };
  }

  let sourceName = null;

  if (icon.kind === "class") {
    sourceName = icon.name;
  } else if (icon.kind === "glyph" && glyphMap?.glyphs) {
    const wanted = `\\${icon.codepoint}`.toLowerCase();
    sourceName = Object.entries(glyphMap.glyphs).find(
      ([, code]) => String(code).toLowerCase() === wanted
    )?.[0];
  }

  if (!sourceName) return null;

  // Templates commonly ship the same icon font the source used, in which case
  // the name carries across untranslated. That is the only lossless outcome —
  // every substitution below is an approximation of the designer's choice.
  if (fontelloSet?.has(sourceName)) {
    return { type: "name", name: sourceName, sourceName, exact: true };
  }

  const normalized = normalizeIconName(sourceName);
  const alias = SEMANTIC_ALIASES[normalized];

  if (alias && (!iconSet || iconSet.has(alias))) {
    return { type: "name", name: alias, sourceName };
  }

  // No alias: try the target's own set directly before giving up.
  if (iconSet) {
    const direct = nearestIcon(normalized, iconSet);
    if (direct) return { type: "name", name: direct, sourceName };
    return { type: "unresolved", sourceName };
  }

  return { type: "name", name: normalized, sourceName };
}

/**
 * Icon-font names the target can actually render.
 *
 * Read from the component's own glyph map rather than the CMS picker list: the
 * picker is a curated subset for editors, while the glyph map is what decides
 * whether a name renders at all.
 */
export function loadFontelloNames(componentSource) {
  if (!componentSource) return null;
  const names = [...componentSource.matchAll(/"(icon-[\w-]+)"\s*:/g)].map((m) => m[1]);
  return names.length ? new Set(names) : null;
}

/**
 * Resolve every item icon in a block.
 *
 * Returns both what could not be translated and what was only approximated, so
 * a substituted icon is visible in the run rather than passing as exact.
 */
export function resolveItemIcons(items, options) {
  const unresolved = [];
  const approximated = [];

  for (const item of items) {
    if (!item.icon) continue;
    const resolved = resolveIcon(item.icon, options);

    if (!resolved) continue;
    if (resolved.type === "name") {
      item.iconName = resolved.name;
      if (!resolved.exact) approximated.push(`${resolved.sourceName} -> ${resolved.name}`);
    }
    else if (resolved.type === "image") {
      item.iconImage = resolved.src;
      item.iconAlt = resolved.alt;
    } else if (resolved.type === "unresolved") {
      unresolved.push(resolved.sourceName);
    }
    delete item.icon;
  }

  return { unresolved, approximated };
}

export { SEMANTIC_ALIASES };
