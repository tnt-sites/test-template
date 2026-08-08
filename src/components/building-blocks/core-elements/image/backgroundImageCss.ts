/**
 * Builds the CSS custom properties for a section/card background image.
 *
 * Background images are painted with `background-image` on the container that
 * holds the text, NOT with an absolutely-positioned <img> layer. Accessibility
 * checkers (WAVE, axe) resolve a text node's background by walking UP the
 * ancestor chain — an absolutely-positioned sibling is never on that chain, so
 * they fall through to the white <body> and report false contrast errors.
 * Keep backgrounds on the container. See the comment above the `&.bg-*` block
 * in CustomSection.astro for the matching rule about background colors.
 *
 * The URL-generation branches below mirror the ones in Image.astro / the two
 * renderers it delegates to — external CDNs go through unpic's transformUrl,
 * local /src/assets images go through astro:assets getImage, anything else is
 * used verbatim. Change them together.
 *
 * WIDTH TIERS ARE PAIRED WITH src/styles/variables/_media.pcss: `sm` is the
 * default, `lg` swaps in at --from-lg (1024px) and `2xl` at --from-2xl
 * (1536px). If you add or move a tier here, move the matching @media block in
 * the consuming component's CSS too.
 */
import { getImage } from "astro:assets";
import { getProviderForUrl, transformUrl } from "unpic";

interface BackgroundImageProp {
  source?: string | null;
  alt?: string | null;
  positionVertical?: string | null;
  positionHorizontal?: string | null;
  priority?: boolean;
}

export interface BackgroundImageCss {
  /** Custom-property declarations for the container's `style` attribute. */
  style: string;
  /** Set when `priority` is on, so heroes can emit a <link rel="preload">. */
  preload?: { href: string; imagesrcset: string };
}

/** 1x / 2x widths per breakpoint tier. Keep in sync with _media.pcss. */
const TIERS: { name: string; widths: number[] }[] = [
  { name: "sm", widths: [800, 1600] },
  { name: "lg", widths: [1600, 2400] },
  { name: "2xl", widths: [2400] },
];

const EMPTY: BackgroundImageCss = { style: "" };

const imageFiles = import.meta.glob("/src/assets/images/**/*", {
  import: "default",
  eager: true,
}) as Record<string, unknown>;

/**
 * Resolves one width to a served URL, or null if it can't be resolved.
 * Omit `format` to keep the source's own format — used for the fallback layer.
 */
async function servedUrl(source: string, width: number, format?: string): Promise<string | null> {
  if (getProviderForUrl(source) !== false) {
    return transformUrl({ url: source, width, ...(format && { format }) })?.toString() ?? null;
  }

  if (source.startsWith("/src/")) {
    const key = Object.keys(imageFiles).find((candidate) => candidate.endsWith(source));

    if (!key) {
      console.warn(`Background image not found for path: ${source}`);
      return null;
    }

    const meta = imageFiles[key];
    const optimised = await getImage({ src: meta as never, width, ...(format && { format }) });

    if (typeof optimised.src === "string") {
      return optimised.src;
    }

    /* The CloudCannon editor aliases astro:assets to its own shim
       (@cloudcannon/editable-regions/integrations/astro/modules/assets.js),
       whose getImage() echoes the ImageMetadata straight back instead of
       optimising it — so `.src` is an object, not a URL. Drop the
       format-specific tiers in that case: labelling the untouched original as
       `type("image/avif")` would make the browser select it and then fail to
       decode it. The untyped fallback below carries the image instead, which
       is what `.bg-layers` falls through to when no tiers are emitted. */
    if (format) {
      return null;
    }

    const metaSrc = (meta as { src?: unknown } | undefined)?.src;

    return typeof metaSrc === "string" ? metaSrc : null;
  }

  // A public URL we can't transform. Safe to serve verbatim, but never under a
  // requested format — labelling a jpeg as `type("image/avif")` in image-set()
  // would make the browser pick it and fail to decode it.
  return format ? null : source;
}

const avifUrl = (source: string, width: number) => servedUrl(source, width, "avif");

export async function backgroundImageCss(
  backgroundImage: BackgroundImageProp | null | undefined
): Promise<BackgroundImageCss> {
  const source = backgroundImage?.source;

  if (!source || typeof source !== "string" || source.trim() === "") {
    return EMPTY;
  }

  const {
    positionVertical = "top",
    positionHorizontal = "center",
    priority = false,
  } = backgroundImage;

  const declarations: string[] = [];
  let largest: { href: string; imagesrcset: string } | undefined;

  for (const tier of TIERS) {
    const entries: string[] = [];

    for (const [index, width] of tier.widths.entries()) {
      const url = await avifUrl(source, width);

      if (url) {
        entries.push(`url("${url}") type("image/avif") ${index + 1}x`);
      }
    }

    if (entries.length) {
      declarations.push(`--bg-image-${tier.name}: image-set(${entries.join(", ")})`);
    }
  }

  // Plain-URL layer, in the source's own format. Used by browsers without
  // image-set() — and by the tier chain when the source can't be transformed at
  // all — mirroring what the old <Picture> fell back to on its <img>.
  const fallback = (await servedUrl(source, 1600)) ?? source;

  declarations.push(`--bg-image-fallback: url("${fallback}")`);
  declarations.push(`--bg-image-position: ${positionHorizontal} ${positionVertical}`);

  if (priority) {
    const [href, retina] = await Promise.all([avifUrl(source, 1600), avifUrl(source, 2400)]);

    if (href) {
      largest = {
        href,
        imagesrcset: [`${href} 1600w`, retina ? `${retina} 2400w` : ""].filter(Boolean).join(", "),
      };
    }
  }

  return { style: declarations.join("; "), preload: largest };
}
