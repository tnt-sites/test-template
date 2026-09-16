/**
 * Teach the target's own components to accept what the migrator measures.
 *
 * The generator emits bespoke components for bespoke sections, but routes
 * anything the starter already has a component for — accordions, content runs —
 * onto that component instead, which is what keeps a migration from producing
 * forty near-identical files. The catch is that a starter component only
 * renders what its props allow, and the starter was written before any of these
 * measurements existed: `dev-page` emits a fully measured `accordionTheme`
 * (white-on-brand-blue title bars, 18px/400, the exact panel borders) into a
 * `faq-section` that never reads it, so the accordion renders in the template's
 * own colours and the measurement is silently discarded.
 *
 * That gap was previously closed by hand, per migration. This closes it in the
 * tool: the props are added to the target's components, once, idempotently, as
 * part of generating a page that needs them.
 *
 * Every patch here must hold two properties, because these are *the user's*
 * files and a migration is not a licence to rewrite them:
 *
 *   - **Idempotent.** Detect the marker and do nothing on a second run.
 *   - **Backwards compatible.** Every added prop falls back to exactly what the
 *     component rendered before, so a page that supplies no theme is unchanged.
 */

import fs from "node:fs";
import path from "node:path";

/** Marks a file this module has already patched. */
const MARK = "wpmig:accordion-theme";

const ACCORDION_REL = "building-blocks/wrappers/accordion/Accordion.astro";
const FAQ_REL = "page-sections/info-blocks/faq-section/FaqSection.astro";

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

/**
 * Give `Accordion.astro` a `theme` object and an `iconName`, and paint from
 * CSS custom properties whose fallbacks are the values it uses today.
 */
function patchAccordion(source) {
  if (source.includes(MARK)) return null;
  if (!source.includes("const {") || !source.includes('class:list={["accordion"]}')) return null;

  let out = source.replace(
    /const \{\n  items,/,
    `const {\n  items,\n  /* ${MARK} */\n  theme = {},\n  iconName,`
  );
  if (out === source) return null;

  // The style block is global (`is:global`), so the variables have to live on
  // the element rather than in the scoped rule.
  out = out.replace(
    '<div class:list={["accordion"]} {...arrayDataAttributes} {...htmlAttributes}>',
    `<div\n  class:list={["accordion"]}\n  style={themeVars}\n  data-icon={iconName === "" ? "none" : undefined}\n  {...arrayDataAttributes}\n  {...htmlAttributes}\n>`
  );

  // Build the inline custom properties from whatever the theme supplies.
  out = out.replace(
    /const hasItems = items\?\.length > 0;/,
    `const THEME_VARS: Record<string, string> = {
  titleBackground: "--acc-title-bg",
  titleColor: "--acc-title-color",
  titleBackgroundOpen: "--acc-title-bg-open",
  titleColorOpen: "--acc-title-color-open",
  titleFontSize: "--acc-title-size",
  titleFontWeight: "--acc-title-weight",
  titlePadding: "--acc-title-padding",
  titleGap: "--acc-title-gap",
  itemGap: "--acc-item-gap",
  itemBorder: "--acc-item-border",
  detailPadding: "--acc-detail-padding",
  detailBorderTop: "--acc-detail-border-top",
  detailBorderRight: "--acc-detail-border-right",
  detailBorderBottom: "--acc-detail-border-bottom",
  detailBorderLeft: "--acc-detail-border-left",
};
const themeVars = Object.entries(THEME_VARS)
  .filter(([key]) => theme?.[key])
  .map(([key, cssVar]) => \`\${cssVar}:\${theme[key]}\`)
  .join(";") || undefined;

const hasItems = items?.length > 0;`
  );

  // Paint. Every fallback is what the component rendered before the patch, so
  // an unthemed accordion is byte-identical in the browser.
  out = out.replace(
    /  @layer components \{\n    \.accordion \{\n      margin-top: var\(--spacing-lg\);\n    \}\n  \}/,
    `  @layer components {
    .accordion {
      margin-top: var(--spacing-lg);
      display: flex;
      flex-direction: column;
      gap: var(--acc-item-gap, 0);
    }

    /* ${MARK} — measured design, each falling back to the starter's own value. */
    .accordion > * + *,
    .accordion .accordion-item + .accordion-item {
      border-top: var(--acc-item-border, revert);
    }

    .accordion .accordion-item-title {
      background: var(--acc-title-bg, revert);
      color: var(--acc-title-color, revert);
      font-size: var(--acc-title-size, revert);
      font-weight: var(--acc-title-weight, revert);
      padding: var(--acc-title-padding, revert);
      gap: var(--acc-title-gap, revert);
    }

    /* The title text is its own span and carries the template's own colour,
       so painting only the summary leaves it unchanged. */
    .accordion .accordion-item-title-text {
      color: inherit;
      font-size: inherit;
      font-weight: inherit;
    }

    .accordion .accordion-item[open] > .accordion-item-title {
      background: var(--acc-title-bg-open, var(--acc-title-bg, revert));
      color: var(--acc-title-color-open, var(--acc-title-color, revert));
    }

    .accordion[data-icon="none"] .accordion-item-icon {
      display: none;
    }

    .accordion .accordion-item-detail {
      padding: var(--acc-detail-padding, revert);
      border-top: var(--acc-detail-border-top, revert);
      border-right: var(--acc-detail-border-right, revert);
      border-bottom: var(--acc-detail-border-bottom, revert);
      border-left: var(--acc-detail-border-left, revert);
    }
  }`
  );

  return out === source ? null : out;
}

/**
 * Make `faq-section` pass the theme through — and stop it overriding the
 * open/single behaviour the page asked for.
 */
function patchFaqSection(source) {
  if (source.includes(MARK)) return null;
  if (!source.includes("<Accordion")) return null;

  let out = source.replace(
    /  label = "About FAQ",/,
    `  label = "About FAQ",\n  /* ${MARK} */\n  accordionTheme = {},\n  iconName,\n  singleOpen = true,\n  openFirst = false,\n  backgroundColorHex = "",`
  );
  if (out === source) return null;

  // The migrator names a measured band in `backgroundColorHex` and leaves
  // `backgroundColor` as "none", because the measured value is a literal rather
  // than one of the target's named options. A component that reads only the
  // named prop therefore drops the band — which is how an accordion ended up
  // white beside the grey run it shares a band with in the source.
  out = out
    .replace(/  backgroundColor,\n/, `  backgroundColor,\n`)
    .replace(
      /  backgroundColor=\{backgroundColor\}/,
      `  backgroundColor={backgroundColorHex ? undefined : backgroundColor}\n  style={backgroundColorHex ? \`background-color:\${backgroundColorHex}\` : undefined}`
    );

  out = out.replace(
    /<Accordion label=\{label\} singleOpen=\{true\} openFirst=\{false\} items=\{items\} \/>/,
    `<Accordion
    label={label}
    singleOpen={singleOpen}
    openFirst={openFirst}
    items={items}
    theme={accordionTheme}
    iconName={iconName}
  />`
  );

  return out === source ? null : out;
}

/**
 * Apply every patch this migration needs to the target's components.
 *
 * Returns what changed so the caller can report it — a migration that silently
 * edits the user's component library is worse than one that does not edit it.
 */
export function patchStarterComponents(targetRoot, { dryRun = false } = {}) {
  const root = path.join(targetRoot, "src/components");
  const jobs = [
    { rel: ACCORDION_REL, patch: patchAccordion },
    { rel: FAQ_REL, patch: patchFaqSection },
  ];

  const patched = [];
  const skipped = [];

  for (const { rel, patch } of jobs) {
    const file = path.join(root, rel);
    const source = read(file);

    if (source === null) {
      skipped.push({ rel, reason: "not in target" });
      continue;
    }
    if (source.includes(MARK)) {
      skipped.push({ rel, reason: "already patched" });
      continue;
    }

    const next = patch(source);
    if (!next) {
      // The component has been customised past what these patches recognise.
      // Saying so is the whole value here: the alternative is a theme that is
      // emitted, ignored, and debugged by hand later.
      skipped.push({ rel, reason: "shape not recognised — patch by hand" });
      continue;
    }

    if (!dryRun) fs.writeFileSync(file, next);
    patched.push(rel);
  }

  return { patched, skipped };
}
