import sitemap from "@astrojs/sitemap";
import editableRegions from "@cloudcannon/editable-regions/astro-integration";
import postcssGlobalData from "@csstools/postcss-global-data";
import icon from "astro-icon";
import { defineConfig } from "astro/config";
import autoprefixer from "autoprefixer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcssCustomMedia from "postcss-custom-media";
import postcssEach from "postcss-each";
import postcssImport from "postcss-import";
import postcssNested from "postcss-nested";

import mdx from "@astrojs/mdx";
import rehypeSchedulingLinks from "./src/components/utils/rehype-scheduling-links.mjs";

import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  site: "https://example.com",
  build: {
    inlineStylesheets: "always",
  },
  devToolbar: {
    enabled: false,
  },
  server: {
    port: 4321,
  },
  markdown: {
    rehypePlugins: [rehypeSchedulingLinks],
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
