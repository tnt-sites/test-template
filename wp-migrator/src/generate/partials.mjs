/**
 * Cross-component partial detection.
 *
 * `cluster.mjs` and the `dev-page` reuse registry both decide sharing on a
 * *whole component*: a section is shared only when its entire emitted source
 * matches one already registered. That is the right call for page banners,
 * and it is structurally unable to see the case that keeps biting us.
 *
 * The dental service pages each segment into one section that is the whole
 * main column — sidebar, then a card grid, then several paragraphs of prose
 * that are different on every page. The card grid inside them is the same
 * widget, but the sections containing it never hash alike, so each page got
 * its own copy of the grid's markup and CSS under its own class prefix
 * (`gdb-`, `rdb-`, `woso-`). A fix applied to one silently skipped the others,
 * which is how a hover state landed on `general-dentistry` alone.
 *
 * The reusable unit here is a *sub-tree*, not a section. This module finds
 * those: the repeat blocks the migrator already emits (`{list.map(…)}`) are
 * exactly the candidates, they are self-contained, and their class names are
 * the only thing separating one copy from the next. Two repeat blocks that
 * differ only in class prefix are the same partial wearing different names.
 *
 * Detection is deliberately separated from extraction. Reporting is safe to
 * run on every migration; rewriting a component's CSS is not something to do
 * without a human looking at the diff.
 */

/** The `{list.map((it) => ( … ))}` blocks in an emitted component. */
export function repeatBlocks(astroSource) {
  const lines = astroSource.split("\n");
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)\{(\w+)\.map\(\((\w+)\) => \($/);

    if (!open) continue;
    const [, indent, listName, itemVar] = open;
    const close = `${indent}))}`;
    const end = lines.indexOf(close, i + 1);

    if (end === -1) continue;
    blocks.push({
      listName,
      itemVar,
      startLine: i,
      endLine: end,
      source: lines.slice(i, end + 1).join("\n"),
    });
    i = end;
  }
  return blocks;
}

/** Every class name a block's markup writes, in document order, deduped. */
export function blockClasses(blockSource) {
  const seen = new Set();

  for (const m of blockSource.matchAll(/class="([^"{]+)"/g)) {
    for (const name of m[1].trim().split(/\s+/)) seen.add(name);
  }
  return [...seen];
}

/**
 * A block's shape with its class names and item variable removed.
 *
 * Class names are the *only* thing the migrator varies between copies of the
 * same widget — it derives them from the component name — so stripping them is
 * what lets `gdb-box11` and `rdb-box12` compare equal. The item variable goes
 * too (`it` vs `c`), and so does whitespace, which differs with nesting depth.
 *
 * The *list* name goes with them. It is numbered by the order the arrays were
 * found on the page, so the same link list is `items3List` on one component
 * and `items7List` on the next; keeping it would file six copies of one shape
 * under six different keys and report none of them as shared.
 */
export function partialKey(blockSource, itemVar = "it") {
  return blockSource
    .replace(/ class="[^"{]*"/g, "")
    .replace(/\{\w+\.map\(\(\w+\) =>/, "{@list.map((@) =>")
    .replace(new RegExp(`\\b${itemVar}\\.`, "g"), "@.")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Group repeat blocks that are the same partial across different components.
 *
 * `components`: [{ name, source }]. Returns one group per shape that appears
 * in two or more *distinct* components, largest first. A shape used twice
 * inside a single component is not a cross-component partial and is left
 * alone — that is a job for the component's own author.
 */
export function findSharedPartials(components) {
  const byKey = new Map();

  for (const { name, source } of components) {
    for (const block of repeatBlocks(source)) {
      const key = partialKey(block.source, block.itemVar);

      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ component: name, classes: blockClasses(block.source), ...block });
    }
  }

  return [...byKey.entries()]
    .map(([key, members]) => ({ key, members }))
    .filter(({ members }) => new Set(members.map((m) => m.component)).size > 1)
    .sort((a, b) => b.members.length - a.members.length);
}

/**
 * The classes a block owns outright: written by its markup, and never
 * mentioned by any rule that also touches a class from outside it.
 *
 * Ownership is what makes moving a rule safe. `.gdb-box12` is owned — every
 * rule naming it names only card classes — so the rule can move to the partial
 * wholesale. A class the surrounding section also styles through a descendant
 * selector is not owned, and its rules have to stay behind.
 */
export function ownedClasses(astroSource, classes) {
  const candidates = new Set(classes);
  const style = astroSource.includes("<style")
    ? astroSource.slice(astroSource.indexOf("<style"))
    : "";

  for (const { selector } of styleRules(style)) {
    const named = [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);

    if (!named.some((n) => candidates.has(n))) continue;
    // A rule spanning the boundary disqualifies the block's classes in it.
    if (named.some((n) => !candidates.has(n))) {
      for (const n of named) candidates.delete(n);
    }
  }
  return [...candidates];
}

/**
 * Top-level and nested declaration blocks in a stylesheet, as
 * `{ selector, start, end }` offsets. Good enough for the emitted CSS, which
 * is plain rules inside at most one `@media` level.
 */
export function styleRules(css) {
  const rules = [];
  const re = /(?:^|\})\s*([^{}@][^{}]*)\{/g;
  let m;

  while ((m = re.exec(css))) {
    const selector = m[1].trim();
    const bodyStart = m.index + m[0].length;
    const end = css.indexOf("}", bodyStart);

    if (end === -1) break;
    // Only real declaration blocks — a nested block means this was a wrapper.
    if (!css.slice(bodyStart, end).includes("{")) {
      rules.push({ selector, start: m.index + m[0].indexOf(selector), end: end + 1 });
    }
    re.lastIndex = bodyStart;
  }
  return rules;
}
