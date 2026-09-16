// usage
// node .cloudcannon/scipts/migration-helpers/html-to-md.js path/to/folder

import fs from "fs";
import path from "path";
import process from "process";

const folderPath = process.argv[2];

if (!folderPath) {
  console.error("❌ Please provide a folder path.");
  process.exit(1);
}

if (!fs.existsSync(folderPath)) {
  console.error("❌ Folder does not exist.");
  process.exit(1);
}

// Get all .html files in the folder (non-recursive)
const files = fs.readdirSync(folderPath).filter((file) => file.toLowerCase().endsWith(".html"));

if (files.length === 0) {
  console.log("ℹ️ No .html files found.");
  process.exit(0);
}

for (const file of files) {
  const htmlPath = path.join(folderPath, file);
  const html = fs.readFileSync(htmlPath, "utf8");

  // Extract <title>
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "Untitled";

  const markdown = `---
title: "${title.replace(/"/g, '\\"')}"
---
`;

  const mdFilename = file.replace(/\.html$/i, ".md");
  const mdPath = path.join(folderPath, mdFilename);

  // Write markdown
  fs.writeFileSync(mdPath, markdown, "utf8");

  // Delete original HTML
  fs.unlinkSync(htmlPath);

  console.log(`✅ ${file} → ${mdFilename} (HTML deleted)`);
}

console.log("🎉 Conversion complete.");
