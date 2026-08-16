import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

/**
 * Recover interaction settings from the source site's JavaScript.
 *
 * Carousels, accordions and sliders are configured with option objects
 * (`autoplaySpeed: 10000`, `arrows: false`, `draggable: false`). Those values
 * are invisible in the DOM and in CSS, so a migration that only looks at markup
 * silently replaces them with the target component's defaults — a carousel that
 * advanced every ten seconds starts advancing every three, with arrows the
 * source deliberately hid.
 *
 * The source JS is never ported: it is 200KB of jQuery plugins. Only the
 * *parameters* are extracted, then mapped onto the target component's props.
 */

/** Convert an AST literal node to a plain JS value, or a marker for non-literals. */
function literalValue(node) {
  switch (node?.type) {
    case "Literal":
      return node.value;
    case "UnaryExpression":
      if (node.operator === "-" && node.argument?.type === "Literal") return -node.argument.value;
      return `<${node.operator}expr>`;
    case "ObjectExpression":
      return objectValue(node);
    case "ArrayExpression":
      return node.elements.map((e) => (e ? literalValue(e) : null));
    case "Identifier":
      return `<${node.name}>`;
    default:
      return "<expr>";
  }
}

function objectValue(node) {
  const out = {};
  for (const prop of node.properties ?? []) {
    if (prop.type !== "Property") continue;
    const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
    out[key] = literalValue(prop.value);
  }
  return out;
}

/** Recover the selector a jQuery call was made against: `$('.x').slick({...})`. */
function selectorOf(callee) {
  let node = callee.object;
  while (node) {
    if (node.type === "CallExpression") {
      const fn = node.callee;
      const isJquery =
        (fn.type === "Identifier" && (fn.name === "$" || fn.name === "jQuery")) ||
        (fn.type === "MemberExpression" && fn.property?.name === "find");
      const first = node.arguments?.[0];
      if (isJquery && first?.type === "Literal" && typeof first.value === "string") {
        return first.value;
      }
      node = fn.type === "MemberExpression" ? fn.object : null;
      continue;
    }
    if (node.type === "MemberExpression") {
      node = node.object;
      continue;
    }
    if (node.type === "ThisExpression") return "<this>";
    return null;
  }
  return null;
}

/**
 * @param {string} source  JavaScript source text
 * @param {string[]} pluginNames  method names to treat as widget initialisers
 */
export function scanBehaviors(source, pluginNames = []) {
  const wanted = new Set(pluginNames);
  const found = [];

  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "script" });
  } catch {
    try {
      ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
    } catch (e) {
      return { behaviors: [], error: `parse failed: ${e.message}` };
    }
  }

  walk.simple(ast, {
    CallExpression(node) {
      const callee = node.callee;
      if (callee?.type !== "MemberExpression") return;

      const method = callee.property?.name ?? callee.property?.value;
      if (!method || !wanted.has(method)) return;

      const options = node.arguments.find((a) => a.type === "ObjectExpression");

      found.push({
        plugin: method,
        selector: selectorOf(callee),
        options: options ? objectValue(options) : {},
      });
    },
  });

  return { behaviors: found };
}

/** Scan every configured source script. */
export function scanScripts(scriptPaths, { mirrorDir, pluginNames }) {
  const results = [];
  const errors = [];

  for (const rel of scriptPaths) {
    const file = path.resolve(mirrorDir, rel.replace(/^\//, ""));
    if (!fs.existsSync(file)) {
      errors.push({ script: rel, reason: "not found" });
      continue;
    }
    const { behaviors, error } = scanBehaviors(fs.readFileSync(file, "utf8"), pluginNames);
    if (error) errors.push({ script: rel, reason: error });
    for (const b of behaviors) results.push({ ...b, script: rel });
  }

  return { behaviors: results, errors };
}

/**
 * Map extracted options onto target component props, and report the ones with
 * nowhere to go.
 *
 * The gap list is the real output: a short, specific statement that the source
 * sets `draggable: false` and the target carousel has no `drag` prop beats
 * discovering it by eye three weeks later.
 */
export function mapToProps(behavior, propMap, availableProps = null) {
  const props = {};
  const unmapped = [];

  for (const [key, value] of Object.entries(behavior.options)) {
    const target = propMap[key];
    if (!target) {
      unmapped.push({ option: key, value, reason: "no mapping configured" });
      continue;
    }
    if (availableProps && !availableProps.includes(target)) {
      unmapped.push({ option: key, value, mapsTo: target, reason: "target component has no such prop" });
      continue;
    }
    props[target] = value;
  }

  return { props, unmapped };
}
