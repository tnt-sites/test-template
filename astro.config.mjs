import sitemap from "@astrojs/sitemap";
import editableRegions from "@cloudcannon/editable-regions/astro-integration";
import postcssGlobalData from "@csstools/postcss-global-data";
import icon from "astro-icon";
import { defineConfig } from "astro/config";
import autoprefixer from "autoprefixer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcssCustomMedia from "postcss-custom-media";
import postcssEach from "postcss-each";
import postcssImport from "postcss-import";
import postcssNested from "postcss-nested";

import mdx from "@astrojs/mdx";

import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// PostCSS plugin: substitute branding.json values directly into CSS custom properties
function makeBrandingPostcssPlugin() {
  let branding = {};

  try {
    branding = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "src/data/branding.json"), "utf8")
    );
  } catch {
    // branding.json missing or unreadable — use theme defaults
  }

  const varMap = Object.fromEntries(
    [
      ["--color-brand", branding.colorBrand],
      ["--color-brand-secondary", branding.colorBrandSecondary],
      ["--color-brand-muted", branding.colorBrandTertiary],
      ["--color-brand-subtle", branding.colorBrandSubtle],
      ["--color-brand-on", branding.colorBrandOn],
      ["--color-text-on-brand", branding.colorTextOnBrand],
      ["--color-link", branding.colorLink],
      ["--color-link-hover", branding.colorLinkHover],
      ["--font-body", branding.bodyFont?.fontFamily],
      ["--font-headings", branding.headingsFont?.fontFamily],
      ["--font-sans", branding.bodyFont?.fontFamily],
      ["--font-serif", branding.headingsFont?.fontFamily],
    ].filter(([, v]) => v?.trim())
  );

  return {
    postcssPlugin: "branding-theme",
    Declaration(decl) {
      if (decl.prop in varMap) {
        decl.value = varMap[decl.prop];
      }
    },
  };
}
makeBrandingPostcssPlugin.postcss = true;

// Redirects for posts migrated from WordPress (see scripts/migrate-wordpress-blog.mjs)
let wpRedirects = {};
try {
  wpRedirects = JSON.parse(fs.readFileSync(path.resolve(__dirname, "scripts/wp-redirect-map.json"), "utf8"));
} catch {
  // no WordPress redirect map yet — nothing to redirect
}

// https://astro.build/config
export default defineConfig({
  site: "https://example.com",
  redirects: wpRedirects,
  build: {
    inlineStylesheets: "always",
  },
  devToolbar: {
    enabled: false,
  },
  server: {
    port: 4321,
  },
  image: {
    domains: ["assets.imgix.net", "picsum.photos", "placebear.com", "placehold.co"],
  },
  integrations: [
    editableRegions(),
    icon({
      iconDir: path.resolve(__dirname, "src/icons"),
    }),
    sitemap({
      filter: (page) => {
        // Always exclude component library from sitemap if disabled
        if (process.env.DISABLE_COMPONENT_LIBRARY === "true") {
          return !page.includes("/component-library");
        }
        // If not disabled, still exclude from sitemap (existing behavior)
        return !page.includes("/component-library");
      },
    }),
    mdx(),
  ],
  vite: {
    css: {
      devSourcemap: true,
      postcss: {
        plugins: [
          postcssImport,
          postcssGlobalData({
            files: [path.resolve(__dirname, "./src/styles/variables/_media.pcss")],
          }),
          postcssCustomMedia,
          postcssNested,
          postcssEach,
          autoprefixer,
          makeBrandingPostcssPlugin(),
        ],
      },
    },

    resolve: {
      alias: {
        "@components": path.resolve(__dirname, "src/components"),
        "@building-blocks": path.resolve(__dirname, "src/components/building-blocks"),
        "@core-elements": path.resolve(__dirname, "src/components/building-blocks/core-elements"),
        "@forms": path.resolve(__dirname, "src/components/building-blocks/forms"),
        "@wrappers": path.resolve(__dirname, "src/components/building-blocks/wrappers"),
        "@navigation": path.resolve(__dirname, "src/components/navigation"),
        "@page-sections": path.resolve(__dirname, "src/components/page-sections"),
        "@features": path.resolve(__dirname, "src/components/page-sections/features"),
        "@builders": path.resolve(__dirname, "src/components/page-sections/builders"),
        "@data": path.resolve(__dirname, "src/data"),
        "@content": path.resolve(__dirname, "src/content"),
        "@assets": path.resolve(__dirname, "src/assets"),
        "@component-library": path.resolve(__dirname, "src/component-library"),
        "@layouts": path.resolve(__dirname, "src/layouts"),
        "@styles": path.resolve(__dirname, "src/styles"),
      },
    },

    plugins: [tailwindcss()],
  },
});
