/**
 * Group sections into the handful of visual patterns a site actually uses.
 *
 * The distance function is the whole design. Identity must survive the things
 * that vary between instances of one pattern — an extra paragraph, a longer
 * list, an image on the other side — while still separating patterns that are
 * genuinely different, like "has a form" or "is a carousel".
 *
 * Weighting `imageSide` as identity is the specific mistake to avoid: sites
 * commonly alternate it by index, so treating it as identity splits one pattern
 * into two and doubles the mapping work. It is a *prop*, not a shape.
 */

/** Substitutions that should cost little, because they're the same intent. */
const ROLE_AFFINITY = [
  // A list and a paragraph read as different content shapes and usually map to
  // different components, so this stays high enough to keep them apart.
  [["P", "LIST"], 0.5],
  [["P", "QUOTE"], 0.3],
  [["H2", "H3"], 0.2],
  [["H1", "H2"], 0.2],
  [["H3", "H4"], 0.2],
  [["LINK", "BTN"], 0.4],
  [["IMG", "EMBED"], 0.5],
];

/** Strip a run bucket or list count: `Px{3}` and `P` are the same role. */
function baseRole(token) {
  return token.replace(/x\{[^}]*\}$/, "").replace(/\([^)]*\)$/, "");
}

export function roleSubstitutionCost(a, b) {
  if (a === b) return 0;

  const ba = baseRole(a);
  const bb = baseRole(b);

  // Same role, different quantity — cheap. "3 cards" vs "5 cards" is one pattern.
  if (ba === bb) return 0.15;

  for (const [pair, cost] of ROLE_AFFINITY) {
    if ((pair[0] === ba && pair[1] === bb) || (pair[1] === ba && pair[0] === bb)) return cost;
  }
  return 1;
}

/** Levenshtein over role tokens, using the affinity table for substitutions. */
export function sequenceDistance(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 1;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + roleSubstitutionCost(a[i - 1], b[j - 1])
      );
    }
  }

  return d[a.length][b.length] / Math.max(a.length, b.length);
}

/**
 * Weighted distance between two sections.
 * Features listed in `propFeatures` are excluded — they describe variation
 * within a pattern and become component props.
 */
export function sectionDistance(a, b, { weights, propFeatures }) {
  const skip = new Set(propFeatures);

  // `roleSequence` is a blend factor, not another weight in the pool. What a
  // section is *made of* is the primary signal; pooling it with the categorical
  // features divides it by their combined weight, which drags even a completely
  // different structure below any sane threshold and merges the whole site into
  // one cluster.
  const seqShare = Math.min(1, Math.max(0, weights.roleSequence ?? 0.7));
  const sequence = sequenceDistance(a.roleSequence, b.roleSequence);

  let mismatch = 0;
  let scale = 0;
  for (const [feature, weight] of Object.entries(weights)) {
    if (feature === "roleSequence" || skip.has(feature) || !weight) continue;
    const av = a.features?.[feature];
    const bv = b.features?.[feature];
    if (av === undefined || bv === undefined) continue;
    scale += weight;
    if (av !== bv) mismatch += weight;
  }

  const features = scale === 0 ? 0 : mismatch / scale;
  return seqShare * sequence + (1 - seqShare) * features;
}

/** Agglomerative clustering with average linkage. */
export function clusterSections(sections, { threshold, weights, propFeatures }) {
  if (sections.length === 0) return [];

  const n = sections.length;
  const dist = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = sectionDistance(sections[i], sections[j], { weights, propFeatures });
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }

  let clusters = sections.map((_, i) => [i]);

  for (;;) {
    let best = null;
    let bestDistance = Infinity;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let sum = 0;
        for (const x of clusters[i]) for (const y of clusters[j]) sum += dist[x][y];
        const average = sum / (clusters[i].length * clusters[j].length);
        if (average < bestDistance) {
          bestDistance = average;
          best = [i, j];
        }
      }
    }

    if (!best || bestDistance > threshold) break;
    const [i, j] = best;
    clusters[i] = clusters[i].concat(clusters[j]);
    clusters.splice(j, 1);
  }

  return clusters
    .map((members) => buildCluster(members, sections, dist, { weights, propFeatures }))
    .sort((a, b) => b.members.length - a.members.length);
}

/** The member with the smallest total distance to the rest — the exemplar. */
function medoidOf(members, dist) {
  let best = members[0];
  let bestSum = Infinity;
  for (const candidate of members) {
    let sum = 0;
    for (const other of members) sum += dist[candidate][other];
    if (sum < bestSum) {
      bestSum = sum;
      best = candidate;
    }
  }
  return best;
}

function buildCluster(memberIndexes, sections, dist, { propFeatures }) {
  const medoidIndex = medoidOf(memberIndexes, dist);
  const medoid = sections[medoidIndex];
  const members = memberIndexes.map((i) => sections[i]);

  // Distribution of each varying feature — this is what tells a human
  // "13 members, imageSide splits 6/7, so this needs a `reverse` prop".
  const variance = {};
  for (const feature of propFeatures) {
    const counts = {};
    for (const m of members) {
      const v = String(m.features?.[feature]);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    if (Object.keys(counts).length > 1) variance[feature] = counts;
  }

  // A section that opens its page is a hero, whatever it is called. Position is
  // the only reliable signal for this: a hero and a mid-page split block are
  // built from the same parts, so structure alone cannot tell them apart.
  const leading = members.filter((m) => m.order === 0).length;

  return {
    id: clusterId(medoid),
    leadingShare: Number((leading / members.length).toFixed(2)),
    medoidUid: medoid.anchorUid,
    roleSequence: medoid.roleSequence,
    features: medoid.features,
    members: members.map((m) => ({
      uid: m.anchorUid,
      pageId: m.pageId,
      order: m.order,
      textPreview: m.textPreview,
      features: m.features,
    })),
    variance,
    pages: [...new Set(members.map((m) => m.pageId))],
  };
}

/** Name a cluster after its exemplar's most distinctive hook. */
export function clusterId(section) {
  const generic = /^(block|wrap|wrapper|inner|contain|container|content|row|col|flex|grid|section|full-page|clear)$/i;

  if (section.id && !generic.test(section.id)) return slug(section.id);

  const distinctive = (section.classes ?? []).find((c) => !generic.test(c));
  if (distinctive) return slug(distinctive);

  const seq = section.roleSequence.slice(0, 3).join("-").toLowerCase();
  return slug(seq || section.tag || "section");
}

function slug(text) {
  return String(text)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** Ensure every cluster id is unique. */
export function dedupeIds(clusters) {
  const seen = new Map();
  for (const c of clusters) {
    const count = seen.get(c.id) ?? 0;
    seen.set(c.id, count + 1);
    if (count > 0) c.id = `${c.id}-${count + 1}`;
  }
  return clusters;
}
