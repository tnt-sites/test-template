/**
 * Repeated-item detection over a captured template tree.
 *
 * A repeat container is an element whose children share the same normalized
 * shape and agree in rendered size — a row of cards, a team grid, a logo
 * strip. The repeat becomes an editable array in the generated component:
 * one template item, N values.
 *
 * Detection is shape-based, never class-based: class names are builder noise
 * by definition here.
 */

/** Flatten a node to comparable tokens, depth-capped so text length can't fork shapes. */
function tokens(node, depth = 0, out = []) {
  if (depth > 6) return out;
  out.push(`${node.tag}:${node.kind}`);
  for (const c of node.children || []) tokens(c, depth + 1, out);
  return out;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function shapeDistance(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  const max = Math.max(ta.length, tb.length);
  return max === 0 ? 0 : levenshtein(ta, tb) / max;
}

function sizesAgree(a, b) {
  const wa = a.box?.w ?? 0;
  const wb = b.box?.w ?? 0;
  if (wa <= 0 || wb <= 0) return true; // hidden at capture width — don't veto on geometry
  return Math.abs(wa - wb) / Math.max(wa, wb) <= 0.15;
}

/** True if a subtree carries any actual content — not just a filler wrapper
 *  (a CSS-grid row padded out with blank slots wraps its spacer in a plain
 *  container div, so this has to look past the immediate node's own kind). */
function hasRealContent(node) {
  if (["img", "raw", "embed"].includes(node.kind)) return true;
  if ((node.text || "").trim()) return true;
  return (node.children || []).some(hasRealContent);
}

/**
 * Decide whether `node`'s children form a repeat.
 * Returns { items, confidence } or null.
 */
function repeatAt(node, { minAuto = 3, maxDistance = 0.2, strictDistance = 0.05 } = {}) {
  const kids = (node.children || []).filter((c) => !c.hidden);
  if (kids.length < 2) return null;
  if (!kids.every((k) => k.tag === kids[0].tag)) return null;
  // Items must have some structure — a run of bare paragraphs is prose, not cards.
  if (!kids.every((k) => (k.children || []).length > 0 || k.kind === "img")) return null;

  let maxDist = 0;
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      maxDist = Math.max(maxDist, shapeDistance(kids[i], kids[j]));
      if (!sizesAgree(kids[i], kids[j])) return null;
    }
  }

  if (kids.length >= minAuto && maxDist <= maxDistance) {
    return { items: kids, confidence: "high", maxDist };
  }
  if (kids.length === 2 && maxDist <= strictDistance) {
    return { items: kids, confidence: "low", maxDist };
  }
  return null;
}

/**
 * Mark repeat containers in the tree (innermost containers are found first,
 * but an outer repeat of composite items may also be marked; emission uses
 * the outermost). Each marked container gains:
 *   repeat: { confidence, itemCount, template, optionalNs }
 * where `template` is the first item annotated with optionality.
 */
export function detectRepeats(tree, opts = {}) {
  const found = [];

  const markRepeat = (node, items, confidence, maxDist) => {
    const template = items[0];
    const optionalNs = new Set();
    const mark = (tNode, others) => {
      (tNode.children || []).forEach((tChild, i) => {
        const present = others.map((o) => (o.children || [])[i] ?? null);
        if (present.some((p) => p === null || p.tag !== tChild.tag)) {
          optionalNs.add(tChild.n);
          return; // structure diverges below here; don't over-mark descendants
        }
        mark(tChild, present);
      });
    };
    mark(template, items.slice(1));

    node.repeat = { confidence, maxDist: Number(maxDist.toFixed(3)), itemCount: items.length, optionalNs: [...optionalNs] };
    found.push(node);
  };

  const walk = (node) => {
    for (const c of node.children || []) walk(c);
    if (node.kind !== "container" && node.kind !== "list") return;

    // Column/row-wrapper flattening, checked *before* the normal uniform-
    // shape test: a builder splitting a long list into N even groups for
    // layout (15 icons as 3 sibling `<div>`s of 5 each, or unevenly — 7 as
    // 4+3, or across CSS-grid rows padded out with empty filler slots on
    // the last row) produces children that are each *already* a marked
    // repeat internally, but don't look uniform to *each other* by shape —
    // a 4-item group's token sequence is a different length than a
    // 3-item group's, and a trailing row with real content plus blank
    // filler slots never even qualifies as a repeat on its own (the filler
    // has no structure). The normal test below would never flag this
    // container. Instead: gather the already-marked repeat groups directly,
    // then walk any leftover siblings — dropping ones with no real content
    // (filler) and absorbing ones that structurally match the established
    // item template (a trailing row's one real card) — rather than
    // requiring every child to independently qualify.
    const kids = (node.children || []).filter((c) => !c.hidden);
    const repeatKids = kids.filter((k) => k.repeat);
    if (repeatKids.length >= 2) {
      const template = repeatKids[0].children?.[0];
      // Only siblings from the first repeat group onward are candidates — an
      // eyebrow or heading preceding the whole grid is unrelated prefix
      // content, not a partially-filled row, and must never be shape-tested
      // against a card template it was never going to match.
      const firstRepeatIdx = kids.indexOf(repeatKids[0]);
      const others = kids.slice(firstRepeatIdx).filter((k) => !k.repeat);
      const absorbed = [];
      let ok = template != null;

      const matchesTemplate = (n) =>
        n.tag === template.tag && shapeDistance(n, template) <= (opts.maxDistance ?? 0.2) && sizesAgree(n, template);

      for (const other of others) {
        if (!hasRealContent(other)) continue; // filler (a spacer, however deeply wrapped) — silently excluded

        // `other` may itself be one bare trailing item, or — a padded-out
        // last grid row — a group that mixes one real item with filler
        // slots as its *own* siblings. Try both readings before giving up.
        if (matchesTemplate(other)) {
          absorbed.push(other);
          continue;
        }
        const realChildren = (other.children || []).filter(hasRealContent);
        if (realChildren.length > 0 && realChildren.every(matchesTemplate)) {
          absorbed.push(...realChildren);
          continue;
        }
        ok = false; // real content that doesn't match the template — too risky to merge
        break;
      }

      if (ok) {
        const merged = [...repeatKids.flatMap((k) => k.children || []), ...absorbed];
        const confidences = repeatKids.map((k) => k.repeat.confidence);
        const maxDist = Math.max(...repeatKids.map((k) => k.repeat.maxDist));
        for (const k of repeatKids) found.splice(found.indexOf(k), 1);

        // `node` may carry unrelated prefix content of its own (a section's
        // eyebrow/heading sitting before its card grid) — only the matched
        // run (the repeat groups plus whatever was resolved from `others`,
        // filler and all) gets collapsed into one synthetic container in
        // its place; anything before that run is left exactly where it was.
        const host = repeatKids[0];
        node.children = [...kids.slice(0, firstRepeatIdx), host];
        host.children = merged;

        // The host is one of the original layout groups, so its captured
        // styles describe a single *column* (`flex: 0 0 100%` of a narrow
        // track), not the grid the merged items now need to flow in. Left
        // alone, all N items stack in one column. Record the real geometry —
        // the outer container's width and the item's share of it — so the
        // CSS emitter can lay the flattened array out the way the source
        // actually rendered it.
        const outerW = node.box?.w ?? 0;
        const itemW = merged.find((m) => (m.box?.w ?? 0) > 0)?.box?.w ?? 0;
        if (outerW > 0 && itemW > 0) {
          const raw = (itemW / outerW) * 100;
          const snapped = [20, 25, 33.33, 50, 100].find((s) => Math.abs(raw - s) <= 4) ?? Math.round(raw * 100) / 100;
          host.flattenLayout = { basisPct: snapped };
        }

        markRepeat(host, merged, confidences.every((c) => c === "high") && !absorbed.length ? "high" : "low", maxDist);
        return;
      }
    }

    const hit = repeatAt(node, opts);
    if (!hit) return;
    markRepeat(node, hit.items, hit.confidence, hit.maxDist);
  };

  walk(tree);
  return found;
}

