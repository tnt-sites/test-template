/**
 * Explicit decisions for clusters the planner will not merge on its own.
 *
 * NOTE: every rule below is spent — the keys name components from the
 * Littleton dental migration, none of which exist in this repo any more. They
 * are kept as worked examples of the rule format, not as live configuration.
 * A new site starts with an empty object and adds only what its own
 * `consolidate.mjs --verbose` run reports as staying standalone.
 *
 * Keyed by the cluster's *canonical* — the member with the richest slot list,
 * which the planner picks and reports. Everything here is a claim about intent
 * that structure alone cannot settle; anything absent stays standalone.
 *
 *   name    — what the consolidated component is called.
 *   folder  — where it lands under src/components/page-sections/.
 *   rename  — prop renames applied to the canonical itself.
 *   remap   — per-member prop renames, onto the canonical's *renamed* props.
 *   acceptHeadingChange — allow a member's content to change heading level.
 */
export const MERGE_RULES = {
  // 48 page banners. The canonical came from a service page, where the small
  // `<h3>` above the title was captured as `heading` and the actual page `<h1>`
  // as `subheading`. Naming them by role instead lets the 43 banners that only
  // ever had an `<h1>` map straight onto `heading` — without the rename they
  // would each have been demoted to the `<h3>`.
  "cosmetic-dentistry": {
    name: "page-banner",
    rename: { heading: "eyebrow", subheading: "heading" },
    // The canonical's four siblings were captured from the same service-page
    // template, so they carry the same backwards naming and need the same
    // correction applied to their content.
    remap: Object.fromEntries(
      ["general-dentistry", "restorative-dentistry", "sedation-dentistry", "payment-options-f"].map(
        (n) => [n, { heading: "eyebrow", subheading: "heading" }]
      )
    ),
  },

  // The breadcrumb trail every interior page opens with, under the banner.
  "home-about-us": { name: "breadcrumb" },

  // The insurance-provider pages: logo, provider heading, coverage prose.
  // Eight members wrap their body text in <p> where the canonical uses <div>;
  // the canonical's <div> is the safe direction, since these fields carry
  // block-level HTML that is not legal inside a <p>.
  "bcbs-employers-in-littleton": { name: "insurance-detail" },

  "about-us-b": { name: "page-banner-stacked" },
  "dont-wait-get-relief": { name: "cta-band" },
  "good-vibes": { name: "media-prose" },
  // Renamed by hand after the fact: this repo calls it `video-hero`.
  "if-youre-experiencing-dental": { name: "lp-heading" },
  "in-the-office": { name: "lp-heading-pair" },
  "look-forward-to-the": { name: "lp-hero-split" },
  "no-more-pain": { name: "lp-band" },
  "paperless-check-in": { name: "lp-media-prose" },
  section: { name: "media-block" },
  "we-are-here-if": { name: "lp-hero-stacked" },
  "we-can-provide-you": { name: "prose-sections" },
};
