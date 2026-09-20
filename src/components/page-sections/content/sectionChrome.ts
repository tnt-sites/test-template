/*
 * The visual state the content sections inherited from builders/custom-section.
 *
 * A large body of rules in src/styles/_source-design.pcss keys off the
 * `.custom-section` class as a structural hook — the 30px rhythm between
 * blocks in the content column, the grey card treatment, the sidebar panels,
 * link colours, the gold and callout-bubble variants. The named content
 * components therefore keep rendering `custom-section` alongside their own
 * class, so those 43 rules keep matching after the migration.
 *
 * The three presets below are the only spacing combinations the interior pages
 * use — measured across all 1136 custom-sections before the migration, no
 * other combination appeared more than once:
 *
 *   content  xl / lg / xl    — a block in the main content column
 *   panel    none / md / md  — a panel in the right rail (.cws-side)
 *   bubble   none everywhere — a call-out; its spacing comes from .callout-bubble
 */
export type Preset = "content" | "panel" | "bubble";

const PRESETS: Record<Preset, { maxContentWidth: string; paddingHorizontal: string; paddingVertical: string }> = {
  content: { maxContentWidth: "xl", paddingHorizontal: "lg", paddingVertical: "xl" },
  panel: { maxContentWidth: "none", paddingHorizontal: "md", paddingVertical: "md" },
  bubble: { maxContentWidth: "none", paddingHorizontal: "none", paddingVertical: "none" },
};

export const slugifyLabel = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function chrome(props: {
  preset?: Preset;
  backgroundColor?: string;
  variant?: string;
  class?: string;
  label?: string;
  id?: string;
}) {
  const preset = PRESETS[props.preset ?? "content"] ?? PRESETS.content;
  const bg = props.backgroundColor ?? "none";
  return {
    // `custom-section` is the structural hook the source-design CSS targets.
    classes: [
      "custom-section",
      "bg-layers",
      bg !== "none" && `bg-${bg}`,
      props.variant,
      props.class,
    ].filter(Boolean) as string[],
    // Matches CustomSection's inner wrapper classes exactly: the padding and
    // max-width rules live on `.content` inside `.outer-content`, and rules
    // such as `.custom-section.bg-accent > .outer-content` rely on that nesting.
    contentClasses: [
      "content",
      `pad-x-${preset.paddingHorizontal}`,
      `pad-y-${preset.paddingVertical}`,
      `max-width-${preset.maxContentWidth}`,
    ],
    id: props.id || (props.label ? slugifyLabel(props.label) : undefined),
  };
}

/*
 * Heading size paired with each level throughout the migrated content: h2/h3
 * render at md, h4/h5 at sm, h1 at 2xl. Kept here so all four content
 * components agree, and so the migration script can drop a `size` that only
 * restates the default.
 */
export const DEFAULT_HEADING_SIZE: Record<string, string> = {
  h1: "2xl",
  h2: "md",
  h3: "md",
  h4: "sm",
  h5: "sm",
  h6: "xs",
};
