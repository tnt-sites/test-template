// @ts-expect-error — markdown-it ships no bundled types in this project
import markdownit from "markdown-it";

const md = markdownit({ html: true });

/** Render a CloudCannon markdown field to HTML for `set:html`. */
export function renderMarkdown(value: unknown): string {
  return typeof value === "string" && value.trim() ? md.render(value) : "";
}

export function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Builds an inline `style` string of CSS custom properties, skipping any value
 * that's blank — same convention as `BaseLayout.astro`'s branding vars, so a
 * CloudCannon color field left empty falls back to whatever a component's own
 * <style> block declares, instead of clobbering it with an empty value.
 */
export function cssVars(vars: Record<string, string | undefined | null>): string | undefined {
  const css = Object.entries(vars)
    .filter(([, value]) => hasText(value))
    .map(([property, value]) => `${property}: ${value};`)
    .join(" ");

  return css || undefined;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

type ModalItem = { heading?: string; name?: string; modalContent?: string };

/**
 * Deterministic dialog id for an item that opens a modal, or `null` when the
 * item has no modal content. Both the trigger and the <dialog> are built from
 * this same call, so they can't drift apart.
 *
 * `sectionId` keeps ids unique when two sections on one page share a heading.
 */
export function modalIdFor(
  item: ModalItem | undefined,
  index: number,
  sectionId: string
): string | null {
  if (!item || !hasText(item.modalContent)) return null;

  const label = item.heading || item.name || "";

  return `${sectionId}-${slugify(label)}-${index}`;
}
