import { z } from "zod";

/**
 * Schema for `migration.config.yml`.
 *
 * This file is the *only* place site-specific knowledge lives. The previous
 * toolkit hardcoded one site's class names (`.flex-title`, `.why`,
 * `.page-divider`) into two scripts that had to be kept in sync by hand; every
 * one of those knobs is a field here instead.
 */

const stylesheetEntry = z.union([
  z.string(),
  z.object({
    url: z.string(),
    role: z.enum(["stylesheet", "font-service", "icon-font"]).default("stylesheet"),
  }),
]);

const segmentationRule = z.object({
  id: z.string(),
  mode: z.enum(["element", "flow"]),
  /** `mode: element` — sections are the elements this selector matches. */
  selector: z.string().optional(),
  /** `mode: flow` — walk top-level children of this container. */
  within: z.string().optional(),
  /** Start a new section at any child matching one of these. */
  cutBefore: z.array(z.string()).default([]),
  /** Sibling pairs that must never be split apart. */
  glue: z.array(z.string()).default([]),
  /** Sections with less text than this merge into their predecessor. */
  minTextLength: z.number().int().nonnegative().default(40),
});

const synthesizeTarget = z.object({
  name: z.string().optional(),
  /** Selector for a single chrome element (header/footer). */
  match: z.string().optional(),
  /** Or: synthesize every section on these pages. */
  pages: z.array(z.string()).optional(),
  all: z.boolean().default(false),
  dir: z.string(),
  layer: z.enum(["components", "page-sections"]).default("page-sections"),
  /** Skip CustomSection wrapping (correct for header/footer). */
  bare: z.boolean().default(false),
});

const embedRule = z.object({
  match: z.string(),
  prop: z.string(),
  /** e.g. "attr:src", "attr:data-embed", "text" */
  from: z.string(),
});

const interactionStep = z.object({
  click: z.string().optional(),
  hover: z.string().optional(),
  press: z.string().optional(),
  waitMs: z.number().int().nonnegative().optional(),
  expect: z.string().optional(),
  expectChanged: z.string().optional(),
  count: z.number().int().nonnegative().optional(),
});

export const configSchema = z.object({
  source: z.object({
    /** Live URL or `file:./static` for a local mirror. */
    base: z.string(),
    /** Sitemap paths or a homepage to crawl from. */
    entry: z.array(z.string()).default(["sitemap.xml"]),
    exclude: z.array(z.string()).default([]),
    /** Order matters — this is the cascade order. */
    stylesheets: z.array(stylesheetEntry).default([]),
    scripts: z.array(z.string()).default([]),
    /**
     * Root font-size in px. `auto` detects it from the source CSS. Only ever
     * used to normalise `rem` on emit — the source's own `html{font-size}` rule
     * is never ported.
     */
    rootFontSizePx: z.union([z.literal("auto"), z.number().positive()]).default("auto"),
    maxPages: z.number().int().positive().default(500),
  }),

  target: z.object({
    root: z.string().default("."),
    preset: z.string().default("cloudcannon-astro-starter"),
  }),

  segmentation: z.object({
    /** Never sections; the header and footer are migrated separately. */
    chrome: z.record(z.string(), z.string()).default({}),
    /**
     * Override where a chrome style role is measured from, when a site's
     * markup does not match the defaults (e.g. `headerBar: "#hd-bottom"`).
     */
    chromeRoleSelectors: z.record(z.string(), z.string()).default({}),
    roots: z.array(z.string()).default(["main"]),
    rules: z.array(segmentationRule).default([]),
    /**
     * Viewport segmentation runs at. Must be a width where the source's own JS
     * has applied its desktop DOM restructuring — some sites move nodes only
     * above a breakpoint, so the post-JS tree differs by viewport.
     */
    viewport: z.number().int().positive().default(1280),
  }).default({}),

  /** Stripped before fingerprinting. Regex sources, matched whole. */
  noise: z.object({
    classes: z.array(z.string()).default([]),
    attributes: z.array(z.string()).default([]),
    ids: z.array(z.string()).default([]),
  }).default({}),

  fingerprint: z.object({
    maxDepth: z.number().int().positive().default(3),
    runBuckets: z.array(z.union([z.number(), z.string()])).default([1, 2, 3, "4+"]),
    clusterThreshold: z.number().positive().default(0.22),
    maxClusters: z.number().int().positive().default(25),
    identityWeights: z.record(z.string(), z.number()).default({
      // Blend factor, not a pooled weight: the share of distance attributable
      // to structure, with the categorical features splitting the remainder.
      roleSequence: 0.7,
      flowDirection: 0.6,
      columns: 0.6,
      hasOwnBackground: 0.4,
      hasCarousel: 1.0,
      hasAccordion: 1.0,
      hasForm: 1.0,
      containerMaxWidth: 0.2,
      distinctiveClass: 0.8,
    }),
    /**
     * Features that are content variance, not identity — they become props.
     * `imageSide` belongs here whenever the source alternates it by index.
     */
    propFeatures: z
      .array(z.string())
      .default(["imageSide", "buttonCount", "imageCount", "textAlign", "hasOwnBackground"]),
  }).default({}),

  synthesize: z.array(synthesizeTarget).default([]),

  props: z.object({
    buttonClassPattern: z.string().default("^btn(-alt)?$"),
    inlineMarkdownTags: z
      .array(z.string())
      .default(["a", "strong", "em", "b", "i", "sup", "sub", "br", "span"]),
    /** Collapse consecutive unclassed flow elements into one markdown prop. */
    proseCollapse: z.boolean().default(true),
    /** Cap color inputs per synthesized component, ranked by rendered area. */
    maxColorInputs: z.number().int().nonnegative().default(12),
    maxArrayNesting: z.number().int().positive().default(2),
    reserved: z.record(z.string(), z.string()).default({}),
  }).default({}),

  embeds: z.array(embedRule).default([]),

  behaviors: z.object({
    jsPluginCalls: z.array(z.string()).default([]),
    propMap: z.record(z.string(), z.string()).default({}),
  }).default({}),

  css: z.object({
    tokenize: z.object({
      enabled: z.boolean().default(true),
      maxDeltaE: z.number().positive().default(0.02),
      /** Emit `var(--token, #literal)` so fidelity survives an unset var. */
      fallbackLiteral: z.boolean().default(true),
    }).default({}),
    /** Selectors emitted verbatim, never prefixed (globally unique IDs). */
    noScope: z.array(z.string()).default([]),
    /** A selector matching more than this share of site elements is global. */
    globalMatchShare: z.number().positive().default(0.05),
  }).default({}),

  tokens: z.object({
    colorMergeDeltaE: z.number().positive().default(0.025),
    grayRampAnchor: z.string().default("computed:body:background-color"),
    minAreaShare: z.number().nonnegative().default(0.002),
  }).default({}),

  assets: z.object({
    /** CSS-referenced assets mirror their source paths verbatim under here. */
    cssReferenced: z.string().default("public/"),
    content: z.string().default("src/assets/images/pages/{slug}/"),
    iconFont: z.string().default("public/fonts/"),
  }).default({}),

  urls: z.object({
    stripExtension: z.boolean().default(true),
    index: z.object({ from: z.string(), to: z.string() }).default({
      from: "/index.html",
      to: "/",
    }),
    trailingSlash: z.enum(["always", "never"]).default("always"),
  }).default({}),

  qa: z.object({
    breakpoints: z.array(z.number().int().positive()).default([375, 550, 750, 1024, 1280, 1600]),
    layoutDiffMaxPercent: z.number().nonnegative().default(2),
    chromeDiffMaxPercent: z.number().nonnegative().default(15),
    /**
     * Below this width the source's own JS may produce a structurally different
     * DOM, so layout diffs get a looser budget.
     */
    mobileStructureBreakpoint: z.number().int().positive().default(1025),
    mobileLayoutDiffMaxPercent: z.number().nonnegative().default(5),
    styleAssertions: z
      .array(z.string())
      .default([
        "font-family",
        "font-size",
        "font-weight",
        "line-height",
        "color",
        "background-color",
        "letter-spacing",
        "text-transform",
      ]),
    colorToleranceDeltaE: z.number().positive().default(0.03),
    fontSizeTolerancePct: z.number().nonnegative().default(5),
  }).default({}),

  interactions: z
    .array(z.object({ cluster: z.string(), steps: z.array(interactionStep) }))
    .default([]),
});

export function validateConfig(raw) {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`
    );
    throw new Error(`Invalid migration.config.yml:\n${lines.join("\n")}`);
  }
  return result.data;
}
