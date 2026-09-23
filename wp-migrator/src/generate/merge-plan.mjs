/**
 * Plan the one-time consolidation of the migrated component set.
 *
 * The migrator emitted 226 components for 292 sections because it keyed reuse
 * on content-derived names (see `structure-hash.mjs`). Clustering recovers the
 * ~81 real shapes, but collapsing a cluster is not automatic: members can give
 * the *same prop* a different role. 43 page banners render `heading` as the
 * page `<h1>`; 5 render it as an `<h3>` eyebrow with `subheading` as the
 * `<h1>`. Merging those blindly would demote 43 pages' H1.
 *
 * So this module decides only what it can prove, and refuses the rest: a
 * cluster merges automatically when every member agrees slot-for-slot with the
 * canonical, and otherwise demands an explicit rule. A missing rule is an
 * error, never a guess.
 */

import { clusterComponents } from "./cluster.mjs";

/**
 * The ordered (tag, prop) slots a component's markup exposes.
 *
 * This is the component's contract with its content: which prop lands in which
 * element, in what order. Two components with the same slot list are
 * interchangeable; two that differ need a remap or a rule.
 */
export function slotsOf(astroSource) {
  const parts = astroSource.split(/^---$/m);
  const body = parts.length > 2 ? parts.slice(2).join("---") : astroSource;
  const slots = [];

  for (const line of body.split("\n")) {
    if (line.includes("<style>")) break;
    const tag = line.match(/<([a-z][a-z0-9]*)\b/)?.[1];

    if (!tag) continue;

    // `>{prop}<`, `set:html={prop}`, `{prop && <tag…`, `src={prop}`.
    //
    // Whether a slot interpolates (`{prop}`, escaped) or injects
    // (`set:html={prop}`, raw) is part of its contract, not a detail: the
    // migrator picked per capture, so one insurance page stores its coverage
    // list as raw `<ul>` markup and the next stores plain text. Swapping a raw
    // slot for an escaped one prints the tags on the page.
    const named = [
      ...[...line.matchAll(/set:html=\{\s*([a-zA-Z_$][\w$]*)/g)].map((m) => ({ prop: m[1], html: true })),
      ...[...line.matchAll(/>\{\s*([a-zA-Z_$][\w$]*)\s*(?:\}|<)/g)].map((m) => ({ prop: m[1], html: false })),
      ...[...line.matchAll(/\bsrc=\{([a-zA-Z_$][\w$]*)\}/g)].map((m) => ({ prop: m[1], html: false })),
    ];
    const guard = line.match(/\{([a-zA-Z_$][\w$]*)\s*&&/)?.[1];
    const found = named.length ? named : guard ? [{ prop: guard, html: false }] : [];

    for (const { prop, html } of found) slots.push({ tag, prop, html });
  }
  return slots;
}

const isHeadingTag = (t) => /^h[1-6]$/.test(t);

/**
 * The element skeleton of a component's markup: every tag, in order, with
 * closing tags kept so nesting is encoded.
 *
 * Slot checking alone proves the props land in the right elements, but says
 * nothing about the containers *between* them — two components can agree
 * slot-for-slot and still differ by a wrapper `<div>`, which changes what the
 * CSS grid or flex rules apply to. `<p>` and `<div>` are folded together
 * because swapping those is a deliberate, separately-reported outcome of
 * merging rich-text slots.
 */
function isSubsequence(needle, haystack) {
  let i = 0;

  for (const tag of haystack) if (i < needle.length && needle[i] === tag) i++;

  return i === needle.length;
}

/**
 * Intrinsic `width`/`height` baked onto each `<img>`, keyed by the prop that
 * supplies its `src`.
 *
 * These are per-*instance* facts — the dimensions of the file that page uses —
 * that the generator wrote in as literals. Merging would otherwise stamp the
 * canonical page's image ratio onto every other page's image.
 */
export function imageDimensions(astroSource) {
  const dims = {};

  for (const line of astroSource.split("\n")) {
    const prop = line.match(/\bsrc=\{([a-zA-Z_$][\w$]*)\}/)?.[1];

    if (!prop) continue;
    const w = line.match(/\bwidth="(\d+)"/)?.[1];
    const h = line.match(/\bheight="(\d+)"/)?.[1];

    if (w && h) dims[prop] = { w, h };
  }
  return dims;
}

export function skeletonOf(astroSource) {
  const parts = astroSource.split(/^---$/m);
  const body = parts.length > 2 ? parts.slice(2).join("---") : astroSource;
  const skeleton = [];

  for (const line of body.split("\n")) {
    if (line.includes("<style>")) break;
    for (const m of line.matchAll(/<(\/?)([a-z][a-z0-9]*)\b/g)) {
      const tag = m[2] === "p" ? "div" : m[2];

      skeleton.push(`${m[1]}${tag}`);
    }
  }
  return skeleton;
}

/**
 * Generic flow containers that carry no meaning of their own — the tags a
 * page builder emits by the dozen to hang layout and spacing off. Elementor in
 * particular wraps a single heading in four or five nested `<div>`s, and the
 * exact depth is an artifact of how that one section was authored, not part of
 * its content shape.
 */
const STRUCTURAL_WRAPPERS = new Set(["div", "span"]);

/**
 * The semantic outline of a component's markup: the same tag stream as
 * `skeletonOf`, minus the inert wrapper `<div>`/`<span>` layers.
 *
 * The nesting gate exists to refuse a merge that would restructure a page's
 * *content* — reorder its headings, move a paragraph inside a list. Bare
 * wrappers are not content, and counting them made two sections built from the
 * same block template look incompatible purely because one was authored three
 * `<div>`s deeper than the other. Comparing the outline that actually holds
 * text and media keeps the real guarantee (content lands in the same elements,
 * in the same order — still enforced slot-by-slot in `verifyMember`) while
 * letting builder wrapper noise collapse.
 */
export function semanticSkeletonOf(astroSource) {
  return skeletonOf(astroSource).filter((t) => !STRUCTURAL_WRAPPERS.has(t.replace(/^\//, "")));
}

/**
 * Check a member against the canonical under a prop remap.
 *
 * Slots are matched by *prop*, not by position: a member that omits an optional
 * slot still lines up with the canonical on the ones it does fill. The three
 * things that make a merge unsafe are all checked here —
 *
 *   missing  — the member fills a slot the canonical has no prop for, so its
 *              content would simply vanish.
 *   reorder  — the member's slots map to canonical slots in a different order,
 *              so the rendered content would come out shuffled.
 *   tag      — the same content lands in a different element. Benign for
 *              `<p>` vs `<div>` around rich text; a heading-level change is
 *              flagged separately because demoting an `<h1>` is an SEO
 *              regression, not a cosmetic one.
 */
export function verifyMember(canonicalSlots, memberSlots, remap = {}) {
  const missing = [];
  const tagChanges = [];
  const escapeChanges = [];
  const escapeContent = [];
  const indices = [];

  // A prop can legitimately fill more than one slot, so each canonical slot is
  // consumed at most once and the search runs forward from the last match.
  // Matching on first occurrence instead made a component fail against itself:
  // the second use of a repeated prop resolved back to the first slot and read
  // as a reorder.
  const taken = new Set();
  let cursor = 0;

  for (const slot of memberSlots) {
    const target = remap[slot.prop] ?? slot.prop;
    let i = canonicalSlots.findIndex((c, ix) => ix >= cursor && !taken.has(ix) && c.prop === target);

    if (i === -1) i = canonicalSlots.findIndex((c, ix) => !taken.has(ix) && c.prop === target);
    if (i === -1) {
      missing.push({ prop: slot.prop, as: target });
      continue;
    }
    taken.add(i);
    cursor = i;
    indices.push(i);
    if (canonicalSlots[i].tag !== slot.tag) {
      tagChanges.push({ prop: slot.prop, from: slot.tag, to: canonicalSlots[i].tag });
    }
    if (canonicalSlots[i].html !== slot.html) {
      // escaped -> raw is recoverable: HTML-escape the member's stored content
      // and raw injection renders exactly what interpolation did. raw ->
      // escaped is not — the member's markup would print as visible tags.
      if (canonicalSlots[i].html) escapeContent.push(slot.prop);
      else escapeChanges.push({ prop: slot.prop, from: "raw", to: "escaped" });
    }
  }

  const reordered = indices.some((v, i) => i > 0 && v < indices[i - 1]);
  // Any move across the heading boundary counts, not just h2 -> h3. Promoting
  // a <p> to an <h3> invents a document-outline entry that the source page did
  // not have, which is the same class of mistake as demoting an <h1>.
  const headingLevelChange = tagChanges.some((c) => isHeadingTag(c.from) || isHeadingTag(c.to));

  return {
    ok: !missing.length && !reordered,
    missing,
    reordered,
    tagChanges,
    escapeChanges,
    escapeContent,
    headingLevelChange,
    kind: missing.length || reordered || escapeChanges.length ? "unsafe" : tagChanges.length ? "tag-only" : "identical",
  };
}

/**
 * Build the merge plan.
 *
 * `rules` maps a cluster's canonical name to an explicit decision:
 *   { name, folder, remap: { <member>: { <memberProp>: <canonicalProp> } } }
 * Clusters whose members are all `identical` need no rule beyond a name.
 */
export function buildMergePlan(components, { threshold = 0.85, rules = {} } = {}) {
  const clusters = clusterComponents(components, { threshold });
  const plan = [];
  const problems = [];

  for (const cluster of clusters) {
    const withSlots = cluster.map((c) => ({
      ...c,
      slots: slotsOf(c.source),
      skeleton: skeletonOf(c.source),
      semanticSkeleton: semanticSkeletonOf(c.source),
      dims: imageDimensions(c.source),
    }));
    const picked = withSlots.reduce((a, b) => (b.slots.length > a.slots.length ? b : a));
    // Raw injection is the permissive mode, so the merged component uses it for
    // any slot that *any* member injects raw. Members that interpolated instead
    // get their stored content HTML-escaped, which renders identically once
    // injected — the only direction that loses nothing.
    const rawProps = new Set();

    for (const m of withSlots) {
      for (const sl of m.slots) if (sl.html) rawProps.add(sl.prop);
    }
    const rule = rules[picked.name] ?? {};
    // A rule may rename the canonical's own props — the 48-banner canonical
    // calls its `<h3>` eyebrow "heading" and its `<h1>` "subheading", which
    // reads backwards once 43 other pages map their real `<h1>` onto it.
    // Members are remapped onto the renamed names, so rename first.
    const canonical = {
      ...picked,
      skeleton: picked.skeleton,
      slots: picked.slots.map((sl) => ({
        ...sl,
        prop: rule.rename?.[sl.prop] ?? sl.prop,
        html: sl.html || rawProps.has(sl.prop),
      })),
    };
    // Which of the canonical's own slots have to be switched to set:html.
    const promoteToRaw = picked.slots
      .filter((sl) => !sl.html && rawProps.has(sl.prop))
      .map((sl) => rule.rename?.[sl.prop] ?? sl.prop);

    // A cluster is an invitation to merge, not an instruction. Each member
    // either verifies against the canonical or is left as its own component:
    // a partial merge is a real improvement, and forcing the rest through would
    // trade the component count for silently wrong pages.
    const merged = [];
    const standalone = [];

    for (const m of withSlots) {
      const remap = m.name === picked.name ? (rule.rename ?? {}) : (rule.remap?.[m.name] ?? {});
      const verdict = verifyMember(canonical.slots, m.slots, remap);
      const blocked = [];

      if (verdict.missing.length) {
        blocked.push(`fills ${verdict.missing.map((x) => `"${x.prop}"`).join(", ")} with no matching canonical slot`);
      }
      if (verdict.reordered) blocked.push("maps its slots out of order");
      // The member's structure has to be *contained* in the canonical's, not
      // equal to it: a banner with no eyebrow is legitimately one element
      // shorter, and demanding equality blocked all 43 of them. A member that
      // is not a subsequence has containers the canonical cannot supply, or has
      // them in another order — that would genuinely restructure the page.
      if (m.name !== picked.name && !isSubsequence(m.semanticSkeleton, picked.semanticSkeleton)) {
        blocked.push(`nests incompatibly (${m.semanticSkeleton.length} semantic elements vs the canonical's ${picked.semanticSkeleton.length})`);
      }
      if (verdict.escapeChanges.length) {
        blocked.push(`renders ${verdict.escapeChanges.map((x) => `"${x.prop}" ${x.from}->${x.to}`).join(", ")}`);
      }
      if (verdict.headingLevelChange && !rule.acceptHeadingChange) {
        const c = verdict.tagChanges.filter((x) => isHeadingTag(x.from) || isHeadingTag(x.to));

        blocked.push(`changes heading structure (${c.map((x) => `${x.prop} ${x.from}->${x.to}`).join(", ")})`);
      }

      if (blocked.length) {
        standalone.push({ name: m.name, why: blocked });
        if (m.name === picked.name) problems.push(`${picked.name}: the canonical itself failed to verify — ${blocked.join("; ")}`);
      } else {
        merged.push({ name: m.name, verdict, remap, escapeContent: verdict.escapeContent });
      }
    }

    // A slot only some members fill has to be optional in the merged
    // component. The canonical emits its own slots unguarded — it always had
    // content for them — so absorbing a member that doesn't would render an
    // empty element (an empty <h3> above all 43 banners that have no eyebrow).
    const filled = new Set();

    for (const m of merged) {
      const slots = withSlots.find((w) => w.name === m.name).slots;

      for (const sl of slots) filled.add(m.remap[sl.prop] ?? sl.prop);
    }
    const optional = canonical.slots.map((sl) => sl.prop).filter((prop) => {
      return merged.some((m) => {
        const slots = withSlots.find((w) => w.name === m.name).slots;

        return !slots.some((sl) => (m.remap[sl.prop] ?? sl.prop) === prop);
      });
    });

    // An image prop needs per-instance dimensions as soon as two members
    // disagree about them.
    const canonDims = picked.dims;
    const varyingImages = Object.keys(canonDims).filter((prop) =>
      merged.some((m) => {
        const d = withSlots.find((w) => w.name === m.name).dims[prop];

        return d && (d.w !== canonDims[prop].w || d.h !== canonDims[prop].h);
      })
    );

    for (const m of merged) m.dims = withSlots.find((w) => w.name === m.name).dims;

    plan.push({
      varyingImages,
      canonicalDims: canonDims,
      promoteToRaw: [...new Set(promoteToRaw)],
      optional: [...new Set(optional)],
      name: rule.name ?? picked.name,
      rename: rule.rename ?? {},
      folder: rule.folder ?? null,
      canonical: picked.name,
      size: cluster.length,
      merged,
      standalone,
    });
  }

  return { plan, problems };
}
