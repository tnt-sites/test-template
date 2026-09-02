import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "zod";

const pageSchema = z.object({
  title: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  pageSections: z
    .array(z.any())
    .nullish()
    .transform((v) => v ?? []),
});

const docsPageSchema = z.object({
  title: z.string(),
  contentSections: z
    .array(z.any())
    .nullish()
    .transform((v) => v ?? []),
});

const docsComponentSchema = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  order: z.number().optional(),
  overview: z.string().optional(),
  spacing: z.string().optional().nullable(),
  component: z.string().optional(),
  component_path: z.string().optional(),
  blocks: z
    .union([z.record(z.string(), z.any()), z.array(z.record(z.string(), z.any()))])
    .optional(),
  slots: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        fallback_for: z.string().optional().nullable(),
        child_component: z
          .object({
            name: z.string(),
            props: z.array(z.string()).optional(),
          })
          .optional()
          .nullable(),
      })
    )
    .optional(),
  examples: z
    .union([
      z.array(
        z.object({
          title: z.string().optional(),
          slugs: z.array(z.string()),
        })
      ),
      z.null(),
    ])
    .optional()
    .transform((val: any) => {
      if (!val) return [];

      return val.map((example: any) => ({
        title:
          example.title ||
          (example.slugs?.[0]
            ? example.slugs[0].replace(/-/g, " ").charAt(0).toUpperCase() +
              example.slugs[0].replace(/-/g, " ").slice(1)
            : "Example"),
        slugs: example.slugs,
        size: example.size ?? "md",
      }));
    }),
});

const pagesCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: pageSchema,
});

const docsPagesCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/component-library/content/pages" }),
  schema: docsPageSchema,
});

const docsComponentsCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/component-library/content/components" }),
  schema: docsComponentSchema,
});

const blogPostSchema = z.object({
  title: z.string(),
  description: z.string(),
  date: z.coerce.date(),
  author: z.string().default("Anonymous"),
  image: z.string().optional(),
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
});

const blogCollection = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/blog" }),
  schema: blogPostSchema,
});

const landingStyles = [
  "cosmetic",
  "count-on-us",
  "custom",
  "dental-implants",
  "emergency",
  "new-patient-emergency-combo",
  "new-patient-split-banner",
  "new-patient-three-callouts",
] as const;

const landingComponentConfigSchema = z.union([
  z.record(z.string(), z.any()),
  z.array(z.record(z.string(), z.any())),
]);

const landingPageSchema = z.object({
  title: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  landingStyle: z.string().optional(),
  landingMainNav: landingComponentConfigSchema.optional(),
  landingFooter: landingComponentConfigSchema.optional(),
  landingPageSections: z
    .array(z.any())
    .nullish()
    .transform((v) => v ?? []),
  head_scripts: z.array(z.string()).optional(),
  footer_scripts: z.array(z.string()).optional(),
  extraFonts: z.array(z.string()).optional(),
  parentLandingPage: z.string().optional(),
});

const landingPagesCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/landing-pages" }),
  schema: landingPageSchema,
});

const pepPagesCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pep-pages" }),
  schema: z.object({
    title: z
      .string()
      .nullish()
      .transform((v) => v ?? ""),
    landingMainNav: landingComponentConfigSchema.optional(),
    landingFooter: landingComponentConfigSchema.optional(),
    pepSections: z.array(z.any()).optional(),
    extraFonts: z.array(z.string()).optional(),
    head_scripts: z.array(z.string()).optional(),
    footer_scripts: z.array(z.string()).optional(),
    parentLandingPage: z.string().optional(),
  }),
});

export const collections = {
  pages: pagesCollection,
  "docs-pages": docsPagesCollection,
  "docs-components": docsComponentsCollection,
  blog: blogCollection,
  "landing-pages": landingPagesCollection,
  "pep-pages": pepPagesCollection,
};
