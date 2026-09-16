// usage
// node .cloudcannon/scipts/migration-helpers/md-to-mdx.js path/to/folder

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

// Get all .md files (non-recursive)
const files = fs.readdirSync(folderPath).filter((file) => file.toLowerCase().endsWith(".md"));

if (files.length === 0) {
  console.log("ℹ️ No .md files found.");
  process.exit(0);
}

for (const file of files) {
  const oldPath = path.join(folderPath, file);
  const newFilename = file.replace(/\.md$/i, ".mdx");
  const newPath = path.join(folderPath, newFilename);

  fs.renameSync(oldPath, newPath);

  console.log(`✅ ${file} → ${newFilename}`);
}

console.log("🎉 Rename complete.");
