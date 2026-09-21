import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * The remark half of the contact-token system described in contactTokens.ts.
 * It runs inside Astro's markdown/MDX pipeline, so it reads siteInfo.json from
 * disk rather than importing through the "@data" alias, which is not resolved
 * for config-level modules.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteInfo = JSON.parse(readFileSync(path.resolve(__dirname, "../data/siteInfo.json"), "utf8"));

const primaryOffice = siteInfo?.offices?.[0] ?? {};
const primaryPhone = primaryOffice.phones?.[0] ?? {};
const primaryAddress = primaryOffice.addresses?.[0] ?? {};

const phone = primaryPhone.display ?? "";

const tokens = {
  phone,
  phoneHref: primaryPhone.href ?? (phone ? `tel:${phone.replace(/[^+\d]/g, "")}` : ""),
  address: [
    ...(primaryAddress.lines ?? []),
    [primaryAddress.city, primaryAddress.state].filter(Boolean).join(", "),
    primaryAddress.postalCode,
  ]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim(),
  addressLine1: (primaryAddress.lines ?? []).join(" ").trim(),
  addressLocality: [
    [primaryAddress.city, primaryAddress.state].filter(Boolean).join(", "),
    primaryAddress.postalCode,
  ]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim(),
  mapUrl: primaryAddress.mapUrl ?? "",
  siteName: siteInfo?.siteName ?? "",
};

/* [[token]], not {{token}} — see contactTokens.ts for why. */
const TOKEN_PATTERN =
  /\[\[\s*(phone|phoneHref|addressLine1|addressLocality|address|mapUrl|siteName)\s*\]\]/g;

function replace(value) {
  if (typeof value !== "string" || !value.includes("[[")) return value;

  return value.replace(TOKEN_PATTERN, (match, token) => tokens[token] ?? match);
}

/*
 * Walks the tree by hand to avoid pulling in unist-util-visit as a dependency.
 * Only the fields that can carry a token are touched: rendered text, and the
 * url/title of links and images.
 */
function walk(node) {
  if (!node || typeof node !== "object") return;

  if (node.type === "text" || node.type === "inlineCode" || node.type === "code") {
    node.value = replace(node.value);
  }

  if (node.type === "link" || node.type === "image" || node.type === "definition") {
    node.url = replace(node.url);
    node.title = replace(node.title);
  }

  /*
   * MDX embeds raw JSX/HTML as its own node types; their text is not split
   * into `text` children, so replace across the whole value.
   */
  if (
    node.type === "html" ||
    node.type === "mdxFlowExpression" ||
    node.type === "mdxTextExpression"
  ) {
    node.value = replace(node.value);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child);
  }
}

export default function remarkContactTokens() {
  return (tree) => walk(tree);
}
