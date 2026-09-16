import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { importPosts } from "../src/content/posts.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const devPosts = defineCommand({
  meta: {
    name: "dev-posts",
    description: "Import blog posts from a WordPress export (WXR) into the target's blog collection.",
  },
  args: {
    xml: { type: "positional", description: "WordPress export .xml file", required: true },
    target: { type: "string", description: "Target repo root", default: path.join(HERE, "..") },
    static: { type: "string", description: "Snapshot dir to source images from", default: path.join(HERE, ".wpmig/static") },
    author: { type: "string", description: "Override the author byline on every post", default: "" },
    limit: { type: "string", description: "Cap post count (smoke test)", default: "0" },
    write: { type: "boolean", description: "Actually write (default is a dry run)", default: false },
  },
  async run({ args }) {
    const xmlFile = path.resolve(args.xml);
    if (!fs.existsSync(xmlFile)) throw new Error(`export not found: ${xmlFile}`);

    const result = await importPosts({
      xmlFile,
      targetRoot: path.resolve(args.target),
      staticDir: path.resolve(args.static),
      author: args.author,
      limit: Number(args.limit),
      dryRun: !args.write,
      log: (msg) => console.log(msg),
    });

    for (const w of result.warnings.slice(0, 20)) console.log(`  ! ${w}`);
    if (result.warnings.length > 20) console.log(`  ! …and ${result.warnings.length - 20} more`);
    for (const m of result.missing.slice(0, 10)) console.log(`  missing asset: ${m}`);

    if (!args.write) {
      const sample = result.written[0];
      if (sample) {
        console.log(`\n===== ${path.basename(sample.file)} =====\n${sample.contents.slice(0, 1200)}`);
      }
      console.log(`\n(dry run — pass --write to apply)`);
    }
  },
});
