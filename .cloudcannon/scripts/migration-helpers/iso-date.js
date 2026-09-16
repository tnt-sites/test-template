// usage
// node .cloudcannon/scipts/migration-helpers/iso-date.js path/to/folder
// note this looks for the key 'date', so if you have a different key, you need to change this script.

import fs from "fs";
import path from "path";
import process from "process";

const rootFolder = process.argv[2];

if (!rootFolder) {
  console.error("❌ Please provide a folder path.");
  process.exit(1);
}

if (!fs.existsSync(rootFolder)) {
  console.error("❌ Folder does not exist.");
  process.exit(1);
}

// Convert date string to full ISO format (UTC)
function toFullISO(value) {
  const parsed = new Date(value);

  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString(); // "YYYY-MM-DDTHH:MM:SS.sssZ"
}

// Process a single file
function processFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");

  // Only process files with YAML frontmatter at top
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (!frontmatterMatch) return;

  let frontmatter = frontmatterMatch[1];
  let updated = false;

  // Replace date: field with full ISO
  frontmatter = frontmatter.replace(/^date:\s*(.+)$/gm, (match, rawDate) => {
    const iso = toFullISO(rawDate.trim());

    if (!iso) return match; // leave as-is if invalid
    updated = true;
    return `date: ${iso}`;
  });

  if (updated) {
    const newContent = content.replace(/^---\n([\s\S]*?)\n---/, `---\n${frontmatter}\n---`);

    fs.writeFileSync(filePath, newContent, "utf8");
    console.log(`✅ Updated date → ${filePath}`);
  }
}

// Recursively walk folder
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile()) {
      processFile(fullPath);
    }
  }
}

// Run
walk(rootFolder);
console.log("🎉 Frontmatter full ISO date normalization complete.");
