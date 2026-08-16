/**
 * Target-template adapter for the CloudCannon Astro component starter.
 *
 * Everything in here describes *the template*, never the source site being
 * migrated. Keeping it isolated is what lets the rest of the toolkit stay
 * zero-site-specific.
 */

/**
 * Verbatim port of `pascalToKebab` in `src/components/utils/renderBlock.astro`.
 * Any drift here silently produces `_component` strings that resolve to nothing,
 * so it is covered by a test that runs against every component in a real repo.
 */
export function pascalToKebab(pascal) {
  return pascal
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/^-/, "");
}

/**
 * Derive the `_component` key for a component file.
 *
 * `relPath` is relative to `src/components/`, e.g.
 * `page-sections/ctas/cta-split/CtaSplit.astro`.
 *
 * Mirrors renderBlock.astro:21-34 — note the parent-folder collapse: when the
 * kebab-cased filename equals its parent directory, the filename is dropped, so
 * `ctas/cta-split/CtaSplit.astro` is keyed `ctas/cta-split` while
 * `meet-landing/MeetLandingPerson.astro` is keyed `meet-landing/meet-landing-person`.
 */
export function componentKeyFromPath(relPath) {
  const parts = relPath.split(".")[0].split("/");
  const filename = parts[parts.length - 1];
  const kebabFilename = pascalToKebab(filename);

  if (parts.length > 1 && kebabFilename === parts[parts.length - 2]) {
    parts.pop();
  }
  parts[parts.length - 1] = kebabFilename;

  return parts.join("/");
}

/** kebab-case -> PascalCase, for `.astro` filenames and snippet `component_name`. */
export function kebabToPascal(kebab) {
  return kebab
    .split("-")
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
}

/** kebab-case -> camelCase, for snippet keys. */
export function kebabToCamel(kebab) {
  const pascal = kebabToPascal(kebab);
  return pascal[0].toLowerCase() + pascal.slice(1);
}

export default {
  name: "cloudcannon-astro-starter",

  componentsDir: "src/components",
  contentDir: "src/content",
  stylesDir: "src/styles",
  dataDir: "src/data",
  assetsDir: "src/assets/images",
  publicDir: "public",

  componentKeyFromPath,
  pascalToKebab,
  kebabToPascal,
  kebabToCamel,

  /**
   * Cascade layer a component's styles belong in. Page sections must win over
   * building blocks, per the template README.
   */
  layerFor(relDir) {
    if (relDir.startsWith("page-sections")) return "page-sections";
    if (relDir.startsWith("landing-page-components")) return "page-sections";
    if (relDir.startsWith("pep-components")) return "page-sections";
    return "components";
  },

  /**
   * The declared layer order and the toolkit's rewrite of it. `source-base`
   * sits above the template's `base` (so ported element styling wins) but below
   * `components`; `source-bridge` sits above `page-sections` (so bridge CSS can
   * restyle library components) but below `utils`/`overrides`.
   */
  layerOrder: {
    file: "src/layouts/BaseLayout.astro",
    declared: "@layer reset, base, components, page-sections, utils, overrides;",
    rewritten:
      "@layer reset, base, source-base, components, page-sections, source-bridge, utils, overrides;",
  },

  /** The four sidecar files every component folder carries. */
  fileSet: [
    "{Pascal}.astro",
    "{kebab}.cloudcannon.inputs.yml",
    "{kebab}.cloudcannon.structure-value.yml",
    "{kebab}.cloudcannon.snippets.yml",
  ],

  /**
   * Required key order in a structure-value file. CloudCannon applies
   * `_inputs_from_glob` in document order, so a `_structures` block placed
   * before it silently disables the inputs file.
   * See `.cloudcannon/scripts/new-component.js:161-164`.
   */
  structureValueKeyOrder: [
    "label",
    "icon",
    "description",
    "value",
    "preview",
    "picker_preview",
    "_inputs_from_glob",
    "_structures",
  ],

  /**
   * Prop vocabulary shared by the library components. The synthesizer reuses
   * these names wherever a role matches, which is what lets props map between
   * synthesized and library components without a translation table.
   */
  reservedProps: [
    "id",
    "eyebrow",
    "eyebrowHeading",
    "heading",
    "subtext",
    "body",
    "description",
    "text",
    "imageSource",
    "imageAlt",
    "buttonSections",
    "colorScheme",
    "backgroundColor",
    "backgroundColorHex",
    "backgroundGradient",
    "backgroundImage",
    "reverse",
    "rounded",
    "brickBackground",
  ],

  /** Class hooks the bridge uses to pair source elements with library internals. */
  roleClasses: {
    section: ".custom-section",
    heading: ".heading",
    text: ".text",
    image: ".image",
    button: ".button",
    listItem: ".list-item",
  },

  sectionWrapper: {
    import: 'import CustomSection from "@builders/custom-section/CustomSection.astro";',
    tag: "CustomSection",
  },

  /**
   * One rendered page section on a built page, in document order.
   *
   * `roleClasses.section` is not enough for this: it names the wrapper the
   * library components use, and a hand-ported bespoke section renders the
   * source's own bare `<section id="…">` instead. Every entry in a page's
   * `pageSections` array becomes exactly one `editable-array-item` either way,
   * so its child is the section regardless of which kind it is.
   *
   * The fallback covers a build with editable regions disabled.
   */
  pageSectionSelectors: [
    "main > editable-array > editable-array-item > *",
    "main > *:not(editable-array)",
  ],

  markdownEditorStyles: "/.cloudcannon/styles/editor.css",
  imageUploadPath: "src/assets/images",

  /** Shared structures the synthesizer can reference instead of inlining. */
  sharedStructures: {
    buttonSections: "_structures.buttonSections",
  },

  /**
   * Files the toolkit only partially owns. Each is patched through a marked
   * region rather than regenerated wholesale.
   */
  markedRegionFiles: {
    layerOrder: "src/layouts/BaseLayout.astro",
    pageSchema: "src/content.config.ts",
    semanticTokens: "src/styles/themes/_default.pcss",
    redirects: "astro.config.mjs",
  },

  /**
   * Semantic color custom properties the token stage must cover. The last two
   * are hardcoded hexes in `themes/_default.pcss` that the branding PostCSS
   * plugin never touches — omitting them leaves `backgroundColor: accent`
   * sections cyan no matter what `branding.json` says.
   */
  semanticColorVars: [
    "--color-brand",
    "--color-brand-secondary",
    "--color-brand-muted",
    "--color-brand-subtle",
    "--color-text",
    "--color-text-strong",
    "--color-text-muted",
    "--color-text-on-brand",
    "--color-link",
    "--color-link-hover",
    "--color-bg",
    "--color-bg-surface",
    "--color-bg-muted",
    "--color-bg-accent",
    "--color-bg-highlight",
    "--color-border",
  ],

  /** Slots in `src/data/branding.json`, and the CSS vars they drive. */
  brandingSlots: {
    colorBrand: ["--color-brand"],
    colorBrandSecondary: ["--color-brand-secondary"],
    colorBrandTertiary: ["--color-brand-muted"],
    colorBrandSubtle: ["--color-brand-subtle"],
    colorBrandOn: ["--color-brand-on"],
    colorTextOnBrand: ["--color-text-on-brand"],
    colorLink: ["--color-link"],
    colorLinkHover: ["--color-link-hover"],
    "bodyFont.fontFamily": ["--font-body", "--font-sans"],
    "headingsFont.fontFamily": ["--font-headings", "--font-serif"],
  },

  /**
   * Where each measured chrome role lands in the template's own markup.
   *
   * Selectors are intentionally shallow: they target the component's stable
   * class hooks rather than its internal structure, so a template update does
   * not silently detach the ported styling.
   */
  chromeTargets: {
    headerLayout: ".main-nav .hd-content",
    headerBackground: ".main-nav",
    headerBar: ".main-nav .bar",
    navLink: ".main-nav nav > ul > li > a",
    navSubLink: ".main-nav nav ul ul li a",
    // The logo image sits inside a <picture>, so match the image itself.
    logo: ".main-nav picture img, .main-nav img",
    headerPhone: ".main-nav a[href^='tel:']",

    footerBackground: "footer",
    footerHeading: "footer h2, footer h3",
    footerLink: "footer a",
    footerText: "footer p",
  },

  /**
   * Starter-template content that must not survive a migration.
   *
   * `mig chrome` writes into the template's own data files, so any field the
   * source had no equivalent for keeps whatever the starter shipped. These are
   * the values that have actually reached a built page — a placeholder street
   * address and a demo email in the header and footer read as real practice
   * details. `mig qa` fails when it finds one in the rendered chrome.
   *
   * Matched case-insensitively as substrings, so keep them distinctive: a
   * fragment like "Suite 200" would fire on a real address.
   */
  demoContentMarkers: [
    "123 Main Street",
    "City, ST 12345",
    "info@dentalstudio.com",
    "Turlock Dental Studio",
    "Subtext placeholder text",
    "dunedin-cliff",
    "test header script",
    "Test Footer Script",
  ],

  /** Number of stops in the neutral ramp the token stage regenerates. */
  grayRampSize: 13,
  grayRampFile: "src/styles/variables/_colors.pcss",
};
