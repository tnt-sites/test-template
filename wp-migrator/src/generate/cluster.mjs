/**
 * Group generated components that are the same widget wearing different words.
 *
 * Single-linkage over the structural similarity in `structure-hash.mjs`: A and
 * B join the same cluster if *some* chain of pairwise matches connects them.
 * Seed-based greedy clustering was tried first and is wrong here — the 48 page
 * banners span 80 to 107 lines, and whichever one seeds the cluster leaves the
 * far end of that range outside the threshold. Chaining is what lets the
 * heading-only banner and the heading+subheading banner reach each other
 * through the middle of the range.
 */

import { similarity, markupTokens } from "./structure-hash.mjs";

class DisjointSet {
  #parent = new Map();

  find(x) {
    if (!this.#parent.has(x)) this.#parent.set(x, x);
    let root = x;

    while (this.#parent.get(root) !== root) root = this.#parent.get(root);
    // Path compression, so a long chain doesn't cost the next lookup.
    while (this.#parent.get(x) !== root) {
      const next = this.#parent.get(x);

      this.#parent.set(x, root);
      x = next;
    }
    return root;
  }

  union(a, b) {
    const [ra, rb] = [this.find(a), this.find(b)];

    if (ra !== rb) this.#parent.set(ra, rb);
  }
}

/**
 * `components`: [{ name, source }]. Returns clusters of the input objects,
 * largest first, each member decorated with its `tokens`.
 */
export function clusterComponents(components, { threshold = 0.85 } = {}) {
  const items = components.map((c) => ({ ...c, tokens: markupTokens(c.source) }));
  const ds = new DisjointSet();

  for (const it of items) ds.find(it.name);

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const [a, b] = [items[i], items[j]];

      if (ds.find(a.name) === ds.find(b.name)) continue;
      // An LCS can be no longer than the shorter stream, so this ratio is a
      // hard ceiling on the similarity — skipping here is exact, not heuristic,
      // and it takes the 4,898-line outliers out of the O(n*m) path entirely.
      const ceiling = (2 * Math.min(a.tokens.length, b.tokens.length)) / (a.tokens.length + b.tokens.length);

      if (ceiling < threshold) continue;
      if (similarity(a.tokens, b.tokens) >= threshold) ds.union(a.name, b.name);
    }
  }

  const groups = new Map();

  for (const it of items) {
    const root = ds.find(it.name);

    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(it);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}
