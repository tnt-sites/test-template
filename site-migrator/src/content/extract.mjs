import { UID_ATTR } from "../mirror/instrument.mjs";

/**
 * Pull the content out of a section, named with the component library's own
 * prop vocabulary.
 *
 * Reusing the library's names (`heading`, `subtext`, `imageSource`,
 * `buttonSections`) is what lets extracted content drop into any target
 * component without a per-component translation table: the mapping is a name
 * match, so adding a cluster to the map is one line rather than a schema.
 *
 * Nothing is ever discarded. Content that finds no home is returned under
 * `unmapped` so the page keeps everything the source had.
 */
export async function extractSection(page, uid, options, lift = 0) {
  return page.evaluate(
    ({ uid, attr, options, lift }) => {
      // `lift` walks back up to a section root that the site's own JavaScript
      // created at load time, and which therefore carries no uid itself.
      let root = document.querySelector(`[${attr}="${uid}"]`);
      for (let i = 0; i < lift && root; i++) root = root.parentElement;
      if (!root) return null;

      const buttonRe = new RegExp(options.buttonClassPattern, "i");
      const isVisible = (el) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      };

      const claimed = new Set();
      const claim = (el) => {
        if (!el) return;
        claimed.add(el);
        for (const d of el.querySelectorAll("*")) claimed.add(d);
      };
      const isClaimed = (el) => {
        for (let n = el; n && n !== root; n = n.parentElement) if (claimed.has(n)) return true;
        return claimed.has(el);
      };

      const out = { uid, props: {}, unmapped: [], embeds: [] };

      // --- Headings -------------------------------------------------------
      // Many sites style a small kicker above the real heading; it is markup-
      // level an <h1> but visually an eyebrow. Ordering by rendered font size
      // rather than tag name identifies which is which.
      const headingEls = [...root.querySelectorAll("h1, h2, h3, .h1, .h2")]
        .filter(isVisible)
        .filter((el) => (el.textContent || "").trim());

      const measured = headingEls.map((el) => ({
        el,
        size: parseFloat(getComputedStyle(el).fontSize) || 0,
        order: headingEls.indexOf(el),
      }));

      if (measured.length) {
        const primary = measured.reduce((a, b) => (b.size > a.size ? b : a));
        out.props.heading = primary.el.innerHTML;
        claim(primary.el);

        // An earlier, visually smaller heading is an eyebrow.
        const eyebrow = measured.find((m) => m.order < primary.order && m.size < primary.size);
        if (eyebrow) {
          out.props.eyebrow = eyebrow.el.textContent.trim();
          claim(eyebrow.el);
        }

        // Any remaining headings stay in the body rather than being dropped.
      }

      // --- Image ----------------------------------------------------------
      // Lazy-loading placeholders have no usable src; requiring a real
      // attribute avoids recording the page URL as an image source.
      const images = [...root.querySelectorAll("img")].filter((img) => {
        const src = img.getAttribute("src");
        return src && src.trim() && !/^data:image\/(gif|svg)/i.test(src) && isVisible(img);
      });

      if (images.length) {
        const biggest = images
          .map((img) => ({ img, r: img.getBoundingClientRect() }))
          .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0].img;

        out.props.imageSource = biggest.getAttribute("src");
        out.props.imageAlt = biggest.getAttribute("alt") || "";
        claim(biggest);

        if (images.length > 1) {
          out.extraImages = images
            .filter((i) => i !== biggest)
            .map((i) => ({ src: i.getAttribute("src"), alt: i.getAttribute("alt") || "" }));
        }
      }

      // --- Buttons --------------------------------------------------------
      const buttons = [...root.querySelectorAll("a")].filter(
        (a) =>
          isVisible(a) &&
          (a.getAttribute("class") || "").split(/\s+/).some((c) => buttonRe.test(c))
      );

      if (buttons.length) {
        out.props.buttonSections = buttons.map((a) => ({
          text: a.textContent.trim(),
          link: a.getAttribute("href") || "",
          newTab: a.getAttribute("target") === "_blank",
        }));
        for (const b of buttons) claim(b);
      }

      // --- Embeds ---------------------------------------------------------
      for (const rule of options.embeds) {
        let matches;
        try {
          matches = [...root.querySelectorAll(rule.match)];
        } catch {
          continue;
        }
        for (const el of matches) {
          if (isClaimed(el)) continue;
          const [kind, name] = rule.from.split(":");
          const value = kind === "attr" ? el.getAttribute(name) : el.textContent.trim();
          if (!value) continue;
          out.embeds.push({ prop: rule.prop, value });
          if (out.props[rule.prop] === undefined) out.props[rule.prop] = value;
          claim(el);
          break;
        }
      }

      /**
       * Identify the icon a list item or card shows.
       *
       * Hand-built sites express these three ways, and all three have to be
       * read from the rendered page rather than the markup: an icon-font glyph
       * injected by a `::before` rule, a decorative background image, or a
       * plain `<img>`. Missing them means every migrated list inherits whatever
       * placeholder icon the target component happens to seed.
       */
      const iconOf = (el) => {
        for (const pseudo of ["::before", "::after"]) {
          const style = getComputedStyle(el, pseudo);

          // The glyph is a private-use codepoint, so it reads as an empty
          // string but is present in the raw content value.
          const content = style.content;
          if (content && content !== "none" && content !== "normal") {
            const codepoints = [...content]
              .map((c) => c.codePointAt(0))
              .filter((c) => c >= 0xe000 && c <= 0xf8ff);
            if (codepoints.length) {
              return {
                kind: "glyph",
                codepoint: codepoints[0].toString(16),
                family: style.fontFamily.replace(/["']/g, "").split(",")[0].trim(),
                color: style.color,
              };
            }
          }

          const bg = style.backgroundImage;
          const url = bg && bg !== "none" ? bg.match(/url\(["']?([^"')]+)["']?\)/) : null;
          if (url) return { kind: "image", src: url[1] };
        }

        const img = el.querySelector("img");
        if (img?.getAttribute("src")) {
          return {
            kind: "image",
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt") ?? "",
          };
        }

        // An explicit icon element, e.g. <i class="icon-phone">.
        const iconEl = el.querySelector('[class*="icon-"]');
        const iconClass = iconEl
          ?.getAttribute("class")
          ?.split(/\s+/)
          .find((c) => /^icon-/.test(c));
        if (iconClass) return { kind: "class", name: iconClass };

        return null;
      };

      // --- Repeated items -------------------------------------------------
      // A run of siblings with the same shape is a list of things, and belongs
      // in an array prop rather than being flattened into prose.
      const signature = (el) =>
        el.tagName +
        "|" +
        (el.getAttribute("class") || "").split(/\s+/).sort().join(".") +
        "|" +
        el.children.length;

      const findRepeats = (parent) => {
        const kids = [...parent.children].filter(isVisible).filter((k) => !isClaimed(k));
        if (kids.length < 2) return null;

        const sig = signature(kids[0]);
        if (!kids.every((k) => signature(k) === sig)) return null;

        const meaningful = kids.filter(
          (k) => k.querySelector("img, a, iframe") || (k.textContent || "").trim().length > 10
        );
        if (meaningful.length < 2) return null;

        /**
         * The item's own copy.
         *
         * A card wraps it in a `<p>`, but a list item often has only a bare
         * `<span>` or raw text. Falling back to the element's own text — minus
         * any heading already captured separately — is what stops a migrated
         * list from keeping the component's seeded "List item 1" placeholders.
         */
        const textOf = (k) => {
          const paragraph = k.querySelector("p")?.textContent.trim();
          if (paragraph) return paragraph;

          const clone = k.cloneNode(true);
          for (const h of clone.querySelectorAll("h1, h2, h3, h4, .h2, .h3")) h.remove();
          return (clone.textContent || "").replace(/\s+/g, " ").trim();
        };

        return kids.map((k) => ({
          heading: k.querySelector("h2, h3, h4, .h2, .h3")?.textContent.trim() ?? "",
          text: textOf(k),
          // Kept so a list that finds no array prop on the chosen component can
          // still be written back as prose without losing its inline markup —
          // `text` has already flattened away the `<strong>` a source list item
          // routinely opens with. Unused when the component does have the prop.
          html: k.innerHTML,
          imageSource: k.querySelector("img")?.getAttribute("src") ?? "",
          imageAlt: k.querySelector("img")?.getAttribute("alt") ?? "",
          link: k.querySelector("a")?.getAttribute("href") ?? "",
          linkText: k.querySelector("a")?.textContent.trim() ?? "",
          icon: iconOf(k),
        }));
      };

      for (const container of [root, ...root.querySelectorAll("ul, ol, div")]) {
        if (out.props.items) break;
        if (isClaimed(container) && container !== root) continue;
        const repeats = findRepeats(container);
        if (repeats && repeats.length >= 2) {
          out.props.items = repeats;
          claim(container);
          break;
        }
      }

      // --- Body -----------------------------------------------------------
      // Everything not already claimed, as one block of HTML for conversion.
      const clone = root.cloneNode(true);
      const claimedUids = new Set();
      for (const el of claimed) {
        const u = el.getAttribute?.(attr);
        if (u) claimedUids.add(u);
      }
      for (const u of claimedUids) {
        const match = clone.querySelector(`[${attr}="${u}"]`);
        if (match) match.remove();
      }
      for (const el of clone.querySelectorAll("script, style, noscript")) el.remove();

      // Absolutise so links and images survive being moved into a new tree.
      for (const el of clone.querySelectorAll("[src]")) {
        el.setAttribute("src", new URL(el.getAttribute("src"), location.href).pathname);
      }
      for (const el of clone.querySelectorAll("[href]")) {
        const href = el.getAttribute("href");
        if (href && !/^(#|mailto:|tel:|javascript:)/i.test(href)) {
          const u = new URL(href, location.href);
          el.setAttribute("href", u.origin === location.origin ? u.pathname + u.hash : href);
        }
      }
      for (const el of clone.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr);

      out.bodyHtml = clone.innerHTML.trim();

      // --- Section chrome --------------------------------------------------
      const cs = getComputedStyle(root);
      const bg = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      let backgroundColorHex = null;
      if (bg) {
        const parts = bg[1].split(",").map((n) => parseFloat(n));
        const alpha = parts.length > 3 ? parts[3] : 1;
        if (alpha > 0.05) {
          backgroundColorHex =
            "#" +
            parts
              .slice(0, 3)
              .map((n) => Math.round(n).toString(16).padStart(2, "0"))
              .join("");
        }
      }
      out.background = { hex: backgroundColorHex, image: cs.backgroundImage !== "none" };
      out.sourceId = root.id || null;

      return out;
    },
    { uid, attr: UID_ATTR, options, lift }
  );
}
