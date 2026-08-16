import { UID_ATTR } from "../mirror/instrument.mjs";
import { NORMALIZE_SOURCE, FEATURES_SOURCE } from "./normalize.mjs";

/**
 * Cut a page into sections.
 *
 * Two modes, because real sites come in two shapes. Pages built from `<section>`
 * elements are easy. Pages that are a flat run of headings and paragraphs
 * inside one container are not: there are no section boundaries in the markup
 * at all, so the flow has to be cut at meaningful points. Interior pages on
 * hand-built sites are almost always the second kind.
 *
 * Segmentation runs against the post-JS DOM at a pinned viewport, because the
 * source's own scripts commonly build the structure that defines the sections —
 * and may build a *different* structure at narrow widths.
 */

export async function segmentPage(page, { rules, chrome, roots, viewport, normalizer }) {
  return page.evaluate(
    ({ rules, chrome, roots, viewport, attr, normalizeSrc, featuresSrc, config }) => {
      eval(normalizeSrc);
      eval(featuresSrc);
      const N = makeNormalizer(config);

      const chromeEls = Object.entries(chrome).flatMap(([role, sel]) => {
        try {
          return [...document.querySelectorAll(sel)].map((el) => ({ role, el }));
        } catch {
          return [];
        }
      });
      const chromeNodes = chromeEls.map((c) => c.el);
      const inChrome = (el) => chromeNodes.some((c) => c === el || c.contains(el));

      /**
       * Stable identity for a section root.
       *
       * Sections are frequently *created* by the site's own JavaScript — a
       * wrapper div built around existing content at load time. Such an element
       * has no uid of its own, because it did not exist in the source HTML.
       * Its contents did, though, so identity is anchored on the first stamped
       * descendant plus the number of hops back up to the section root. Both
       * halves are deterministic, so the same section resolves to the same
       * handle in every later browser session.
       */
      const anchorFor = (el) => {
        const own = el.getAttribute(attr);
        if (own) return { uid: own, lift: 0 };

        const stamped = el.querySelector(`[${attr}]`);
        if (!stamped) return { uid: null, lift: 0 };

        let lift = 0;
        for (let n = stamped; n && n !== el; n = n.parentElement) lift++;
        return { uid: stamped.getAttribute(attr), lift };
      };

      const uidOf = (el) => el.getAttribute(attr) ?? anchorFor(el).uid;

      /** Walk back up to a section root the site's own script created. */
      const liftFrom = (el, lift) => {
        let node = el;
        for (let i = 0; i < lift && node; i++) node = node.parentElement;
        return node;
      };

      let sections = [];

      const record = (els, ruleId) => {
        const visible = els.filter((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return cs.display !== "none" && cs.visibility !== "hidden" && r.height > 0;
        });
        if (visible.length === 0) return;

        const anchor = visible[0];
        const text = visible.map((e) => e.textContent || "").join(" ").trim();

        // A run of siblings is described by a synthetic parent so the role
        // sequence covers the whole run, not just its first element.
        let roleSequence;
        if (visible.length === 1) {
          roleSequence = N.sequence(anchor, 0, config.maxDepth);
        } else {
          const holder = document.createElement("div");
          for (const el of visible) holder.appendChild(el.cloneNode(true));
          anchor.parentElement.appendChild(holder);
          holder.style.cssText = "position:absolute;left:-99999px;top:0;width:" + viewport + "px";
          roleSequence = N.sequence(holder, 0, config.maxDepth);
          holder.remove();
        }

        const anchorHandle = anchorFor(anchor);
        if (!anchorHandle.uid) return; // nothing stamped inside — not real content

        sections.push({
          rule: ruleId,
          anchorUid: anchorHandle.uid,
          anchorLift: anchorHandle.lift,
          uidRange: [uidOf(visible[0]), uidOf(visible[visible.length - 1])],
          memberUids: visible.map(uidOf),
          order: sections.length,
          textLength: text.length,
          textPreview: text.slice(0, 120),
          roleSequence,
          features: {
            ...measureFeatures(anchor, viewport),
            // Authors name their own patterns. Two blocks sharing a hand-written
            // class are almost always one component; two with different names
            // usually are not, even when their structure happens to match. This
            // is a light signal, not an identity hash — the previous approach
            // folded every class into the identity and exploded the shape count.
            distinctiveClass: (() => {
              const generic =
                /^(block|wrap|wrapper|inner|contain|container|content|row|col|flex|grid|section|full-page|clear|mini-block)$/i;
              return N.classList(anchor).find((c) => !generic.test(c)) ?? "";
            })(),
          },
          classes: N.classList(anchor),
          id: anchor.id || null,
          tag: anchor.tagName.toLowerCase(),
        });
      };

      const searchRoots = roots.flatMap((sel) => {
        try {
          return [...document.querySelectorAll(sel)];
        } catch {
          return [];
        }
      });
      const scopes = searchRoots.length ? searchRoots : [document.body];

      for (const rule of rules) {
        if (rule.mode === "element") {
          const matched = scopes.flatMap((scope) => {
            try {
              return [...scope.querySelectorAll(rule.selector)];
            } catch {
              return [];
            }
          });
          // Drop nested matches: an outer <section> and an inner one would
          // otherwise both be recorded, double-counting the same content.
          const outermost = matched.filter(
            (el) => !matched.some((other) => other !== el && other.contains(el))
          );
          for (const el of outermost) {
            if (inChrome(el)) continue;
            record([el], rule.id);
          }
          continue;
        }

        if (rule.mode === "flow") {
          const containers = rule.within
            ? scopes.flatMap((scope) => {
                try {
                  return [
                    ...scope.querySelectorAll(rule.within),
                    ...(scope.matches?.(rule.within) ? [scope] : []),
                  ];
                } catch {
                  return [];
                }
              })
            : scopes;

          for (const container of containers) {
            if (inChrome(container)) continue;

            const children = [...container.children].filter((el) => {
              const cs = getComputedStyle(el);
              return cs.display !== "none" && cs.visibility !== "hidden";
            });

            const startsSection = (el) =>
              rule.cutBefore.some((sel) => {
                try {
                  return el.matches(sel);
                } catch {
                  return false;
                }
              });

            const gluedToPrevious = (el, prev) =>
              prev &&
              rule.glue.some((pair) => {
                try {
                  // "a + b": el is `b` and the previous sibling is `a`.
                  const [left, right] = pair.split("+").map((s) => s.trim());
                  return el.matches(right) && prev.matches(left);
                } catch {
                  return false;
                }
              });

            let current = [];
            const flush = () => {
              if (current.length) record(current, rule.id);
              current = [];
            };

            for (let i = 0; i < children.length; i++) {
              const el = children[i];
              if (current.length && startsSection(el) && !gluedToPrevious(el, children[i - 1])) {
                flush();
              }
              current.push(el);
            }
            flush();
          }
        }
      }

      // Drop a section that contains another section.
      //
      // Covering a varied site takes several rules, and those rules overlap: an
      // outer page wrapper matches one while the blocks inside it match
      // another. Keeping the innermost is what gives usable granularity — an
      // element that contains other sections is a layout wrapper, not content.
      // A coarse container with nothing matched inside it is a leaf and stays.
      const byUid = new Map();
      for (const s of sections) {
        const el = document.querySelector(`[${attr}="${s.anchorUid}"]`);
        byUid.set(s, el ? (s.anchorLift ? liftFrom(el, s.anchorLift) : el) : null);
      }

      const nested = new Set();
      for (const [a, elA] of byUid) {
        if (!elA) continue;
        for (const [b, elB] of byUid) {
          if (a === b || !elB) continue;
          // `a` wraps `b`: drop the wrapper, keep the inner section.
          if (elA !== elB && elA.contains(elB)) nested.add(a);
        }
      }

      sections = sections.filter((s) => !nested.has(s));

      // Fold undersized fragments into their predecessor — a stray line of text
      // between two blocks is part of one of them, not a section of its own.
      const merged = [];
      for (const section of sections) {
        const minLength = rules.find((r) => r.id === section.rule)?.minTextLength ?? 0;
        const previous = merged[merged.length - 1];
        if (previous && section.textLength < minLength && previous.rule === section.rule) {
          previous.memberUids.push(...section.memberUids);
          previous.uidRange[1] = section.uidRange[1];
          previous.textLength += section.textLength;
          previous.roleSequence = previous.roleSequence.concat(section.roleSequence);
          continue;
        }
        merged.push(section);
      }

      // Order by position in the document, not by the order the rules ran.
      //
      // Rules are applied one after another, so a rule listed second yields
      // sections that sit above ones from the first rule. Numbering by rule
      // order puts a page's content in the wrong sequence — and makes a
      // page-opening section look like a mid-page one.
      const positionOf = (section) => {
        const el = document.querySelector(`[${attr}="${section.anchorUid}"]`);
        const root = el && section.anchorLift ? liftFrom(el, section.anchorLift) : el;
        if (!root) return Number.MAX_SAFE_INTEGER;

        let index = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
          if (walker.currentNode === root) return index;
          index++;
        }
        return Number.MAX_SAFE_INTEGER;
      };

      const positions = new Map(merged.map((s) => [s, positionOf(s)]));
      merged.sort((a, b) => positions.get(a) - positions.get(b));
      merged.forEach((s, i) => (s.order = i));

      return {
        sections: merged,
        chrome: chromeEls.map(({ role, el }) => ({
          role,
          uid: uidOf(el),
          roleSequence: N.sequence(el, 0, config.maxDepth),
          classes: N.classList(el),
          id: el.id || null,
          tag: el.tagName.toLowerCase(),
        })),
      };
    },
    {
      rules,
      chrome,
      roots,
      viewport,
      attr: UID_ATTR,
      normalizeSrc: NORMALIZE_SOURCE,
      featuresSrc: FEATURES_SOURCE,
      config: {
        noiseClasses: normalizer.noiseClasses ?? [],
        noiseIds: normalizer.noiseIds ?? [],
        buttonClassPattern: normalizer.buttonClassPattern ?? "^btn(-alt)?$",
        maxDepth: normalizer.maxDepth ?? 3,
      },
    }
  );
}
