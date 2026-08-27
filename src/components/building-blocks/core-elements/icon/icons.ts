/**
 * Inline SVG lookup for the icons in src/icons.
 *
 * This exists instead of astro-icon because astro-icon keys its per-page
 * symbol-dedupe WeakMap on `Astro.locals`, which is undefined under
 * CloudCannon's live-editing renderer — it constructs its own SSRResult and
 * never supplies `locals`, so every icon threw "WeakMap key undefined must be
 * an object or an unregistered symbol" in the visual editor. Inlining keeps the
 * editor and the built site on the same render path.
 */
const iconFiles = import.meta.glob<string>("/src/icons/**/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

/**
 * Match astro-icon's output: size in `em` so font-size drives the icon, and tag
 * it with data-icon. The source files carry their own width/height/aria-hidden,
 * which we strip so ours win.
 */
function normalizeSvg(svg: string, name: string): string {
  return svg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\s(?:width|height|aria-hidden|data-slot)="[^"]*"/g, "").trim();

    return `<svg width="1em" height="1em" data-icon="${name}" ${cleaned}>`;
  });
}

const icons: Record<string, string> = {};

for (const [path, contents] of Object.entries(iconFiles)) {
  const key = path.replace("/src/icons/", "").replace(/\.svg$/, "");

  icons[key] = normalizeSvg(contents, key);
}

/**
 * Returns the inline SVG markup for an icon name, or "" if there is no such
 * icon. astro-icon accepted a bare name or a "set:name" pair; local icons are
 * the only set here, so a "local:" prefix is dropped.
 */
export function getIconSvg(name: unknown, className?: string): string {
  if (!name || typeof name !== "string") {
    return "";
  }

  const svg = icons[name.trim().replace(/^local:/, "")] ?? "";

  if (!svg || !className) {
    return svg;
  }

  return svg.replace("<svg", `<svg class="${className}"`);
}
