import { UID_ATTR } from "../mirror/instrument.mjs";

/**
 * Extract the site chrome — navigation, logo, contact details, socials — as
 * *data* rather than as generated components.
 *
 * A template models its header and footer as structured data it already knows
 * how to render. Synthesizing a bespoke nav component would throw that away and
 * produce a three-level menu expressed as several dozen flat props, which no
 * editor can maintain. Filling the existing model keeps the CMS experience the
 * template was designed around, and leaves only styling to reconcile.
 */

export async function extractChrome(page, { chrome, buttonClassPattern }) {
  return page.evaluate(
    ({ chrome, attr, buttonClassPattern }) => {
      const buttonRe = new RegExp(buttonClassPattern, "i");

      const pick = (selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      };

      const isVisible = (el) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      };

      /**
       * Visible label text.
       *
       * `textContent` includes screen-reader-only spans, which is how a menu
       * item migrates as "Home (current)" — markup meant for assistive tech
       * turned into the link's name. Clipped/offscreen nodes are dropped, and
       * the raw text is the fallback for anything not attached to the document.
       */
      const cleanText = (el) => {
        if (!el) return "";
        const srOnly = [...(el.querySelectorAll?.("*") ?? [])].filter((n) => {
          const cs = getComputedStyle(n);
          if (cs.display === "none" || cs.visibility === "hidden") return true;
          if (/\b(sr-only|screen-reader-text|visually-hidden)\b/.test(n.getAttribute("class") || "")) return true;
          const r = n.getBoundingClientRect();
          return r.width <= 1 || r.height <= 1;
        });
        if (!srOnly.length) return (el.textContent || "").replace(/\s+/g, " ").trim();
        const hidden = new Set(srOnly.map((n) => (n.textContent || "").trim()).filter(Boolean));
        let text = (el.textContent || "").replace(/\s+/g, " ").trim();
        for (const part of hidden) text = text.split(part).join(" ");
        return text.replace(/\s+/g, " ").trim();
      };

      /**
       * Read a `<ul>` menu into a recursive tree.
       *
       * Nested lists are the sub-menus, so recursion mirrors the markup exactly
       * and preserves the information hierarchy the site was designed with —
       * flattening it would silently lose the grouping.
       */
      const readMenu = (list, depth = 0) => {
        if (!list || depth > 4) return [];
        const items = [];

        for (const li of list.children) {
          if (li.tagName !== "LI" || !isVisible(li)) continue;

          // A sub-menu is a nested <ul> in a WordPress menu walker, but a
          // plain container of anchors in every Bootstrap-based theme
          // (`<div class="dropdown-menu"><a class="dropdown-item">`). Only the
          // first shape was recognised, so those themes migrated with every
          // dropdown parent present and empty — a top-level menu that looks
          // complete and navigates nowhere.
          const sublist =
            [...li.children].find((c) => c.tagName === "UL") ??
            // The anchors are not always direct children of the panel — themes
            // wrap them again for their mobile layout — so look for the panel
            // by what it holds rather than by its immediate shape.
            [...li.children].find(
              (c) => c.tagName === "DIV" && !c.querySelector("ul, li") && c.querySelectorAll("a").length >= 2
            );

          /*
           * The label lives on whichever direct child isn't the sub-menu.
           *
           * Not "the first anchor": menu scripts routinely replace a dropdown
           * parent's <a> with a <span> or <button> once the menu becomes
           * interactive, so a top-level item can have no anchor of its own. The
           * old code fell back to `li.querySelector("a")` there, which reaches
           * *into* the sub-menu and returns the first child item — the parent
           * then migrated under its first child's name ("About Us" arriving as
           * "What Sets Us Apart"). Everything still renders, so it survives to
           * production unless someone reads the menu.
           */
          const label = [...li.children].find(
            (c) => c !== sublist && c.tagName !== "UL" && cleanText(c)
          );

          /*
           * The href may sit on the label, on a sibling anchor, or — where the
           * script stripped the parent's link — only on a descendant. The
           * descendant is still the best guess for a dropdown parent, which
           * usually points at the same landing page as its first child, so it
           * is kept for the path alone and never for the name.
           */
          const anchor =
            (label?.tagName === "A" ? label : null) ??
            [...li.children].find((c) => c.tagName === "A") ??
            li.querySelector("a");

          if (!label && !anchor) continue;

          const name =
            cleanText(label) ||
            cleanText(anchor) ||
            anchor?.getAttribute("title") ||
            label?.getAttribute("title") ||
            "";

          if (!name) continue;

          items.push({
            name,
            path: anchor?.getAttribute("href") || "",
            // Menu entries are icon-led as often as footer links are — this
            // theme puts a chevron before every dropdown item — and a menu
            // that loses them reads as a plain list against the original.
            icon: iconOf(anchor ?? label ?? li),
            children: !sublist
              ? []
              : sublist.tagName === "UL"
                ? readMenu(sublist, depth + 1)
                : readPanel(sublist),
          });
        }
        return items;
      };

      /**
       * Read a non-list dropdown panel (`<div class="dropdown-menu">`).
       *
       * A mega-menu groups its links into columns whose first link is the
       * category and the rest its members, separated by a rule — so the
       * grouping is recovered from that shape rather than flattened into one
       * 33-item list. Panels are frequently duplicated for mobile and desktop
       * inside the same dropdown, and both copies are hidden until the menu
       * opens (so visibility cannot tell them apart); identical links are
       * deduplicated instead.
       */
      const readPanel = (panel, depth = 0, seen = new Set()) => {
        if (!panel || depth > 4) return [];
        const items = [];
        const add = (el, children, into) => {
          const name = cleanText(el);
          const path = el.getAttribute("href") || "";
          if (!name) return null;
          const key = `${name}|${path}`;
          if (seen.has(key)) return null;
          seen.add(key);
          const item = { name, path, icon: iconOf(el), children: children ?? [] };
          (into ?? items).push(item);
          return item;
        };

        const kids = [...panel.children];
        // A column of a mega-menu reads `<a>Category</a><hr><a>member</a>…`,
        // repeated. The rule that identifies a category is therefore "an
        // anchor immediately followed by a rule" — taking merely the *first*
        // anchor as the parent would fold every later category in the same
        // column under the first one.
        let group = null;

        for (let i = 0; i < kids.length; i++) {
          const kid = kids[i];
          if (kid.tagName === "A") {
            const startsGroup = kids[i + 1]?.tagName === "HR";
            const item = add(kid, [], startsGroup || !group ? items : group.children);
            if (startsGroup && item) group = item;
            continue;
          }
          if (kid.tagName === "DIV" && kid.querySelectorAll("a").length) {
            const nested = readPanel(kid, depth + 1, seen);
            const previous = items[items.length - 1];
            if (previous && !previous.children.length && nested.length && kids[i - 1]?.tagName === "A") {
              previous.children = nested;
            } else {
              items.push(...nested);
            }
          }
        }
        return items;
      };

      /**
       * The header's call-to-action ("24/7 Online Scheduling", "Book Now").
       *
       * Matched on a class name alone this finds nothing on themes that style
       * the button without a `btn` class, and searching only inside the header
       * element misses it entirely where the CTA sits in the nav bar below —
       * which is most of them. The template renders this button from data, so
       * when it is not found the starter's own placeholder link ships instead
       * (an appointment button pointing at a page that does not exist).
       *
       * So: look wherever the menu was found, and accept either the class
       * convention or an anchor that is visibly a button — painted, with real
       * horizontal padding, which prose links never have.
       */
      const readHeaderButtons = () => {
        const opaque = (color) => {
          const m = (color || "").match(/rgba?\(([^)]+)\)/);
          if (!m) return Boolean(color) && color !== "transparent";
          const parts = m[1].split(",").map(parseFloat);
          return (parts.length > 3 ? parts[3] : 1) > 0.02;
        };
        const found = new Map();
        for (const root of menuRoots) {
          for (const a of root.querySelectorAll("a[href]")) {
            const text = cleanText(a);
            const link = a.getAttribute("href") || "";
            if (!text || !link || /^#/.test(link) || found.has(link)) continue;
            // Menu entries are not call-to-action buttons, however they are
            // styled — this theme gives every dropdown item a border, which
            // otherwise makes the whole menu look like a row of buttons.
            if (primaryMenu?.contains(a) || a.closest("li")) continue;
            const classed = (a.getAttribute("class") || "").split(/\s+/).some((c) => buttonRe.test(c));
            const cs = getComputedStyle(a);
            const painted =
              opaque(cs.backgroundColor) ||
              ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(cs[`border${side}Width`]) > 0);
            const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
            if (classed || (painted && padX >= 8)) found.set(link, { text, link });
          }
        }
        return [...found.values()];
      };

      const readLogo = (root) => {
        const img = root?.querySelector("img");
        if (!img) return null;
        return {
          source: img.getAttribute("src") || "",
          alt: img.getAttribute("alt") || "",
        };
      };

      /** Phone, email and address links carry their own recognisable schemes. */
      const readContacts = (root) => {
        const phones = [];
        const emails = [];

        for (const a of root?.querySelectorAll("a[href]") ?? []) {
          const href = a.getAttribute("href") || "";
          if (/^(tel|sms):/i.test(href)) {
            // A practice often lists a separate texting number; the scheme is
            // what distinguishes it from the phone line.
            phones.push({
              label: cleanText(a),
              number: href.replace(/^(tel|sms):/i, "").trim(),
              scheme: href.split(":")[0].toLowerCase(),
            });
          } else if (/^mailto:/i.test(href)) {
            emails.push({ label: cleanText(a), address: href.replace(/^mailto:/i, "").trim() });
          }
        }
        return { phones, emails };
      };

      /**
       * What counts as a column heading.
       *
       * Not `h1`-`h6`. A page builder's heading widget picks whatever tag the
       * author left in a dropdown, and for a footer column that is routinely a
       * `<p>` or a `<div>` — the widget is styling a line of text, not marking
       * up a document outline. This footer's "Quick Links", "Contact Us" and
       * "Office Hours" are all `<p class="elementor-heading-title">`, so read
       * through the tag names alone it comes back with the two real `<h2>`s in
       * the promotional band above and none of the columns the footer is
       * actually drawn in.
       *
       * The builder's own class is the reliable signal, so it is named
       * alongside the tags rather than instead of them.
       */
      const HEADING_SEL = [
        "h1", "h2", "h3", "h4", "h5", "h6",
        ".elementor-heading-title",   // Elementor
        ".wp-block-heading",          // Gutenberg
        ".widget-title", ".widgettitle", // classic widget areas
        ".fusion-title-heading",      // Avada
        ".et_pb_module_header",       // Divi
        ".vc_custom_heading",         // WPBakery
      ].join(",");

      const SOCIAL_HOSTS = {
        "facebook.com": "facebook",
        "instagram.com": "instagram",
        "twitter.com": "twitter",
        "x.com": "twitter",
        "linkedin.com": "linkedin",
        "youtube.com": "youtube",
        "yelp.com": "yelp",
        "tiktok.com": "tiktok",
        "pinterest.com": "pinterest",
      };

      /** Every network the target can draw, however a theme spells it. */
      const SOCIAL_NAMES = new Set([
        ...Object.values(SOCIAL_HOSTS),
        "google",
      ]);

      /**
       * The row of social icons, read from how the theme marked it up rather
       * than from where each link points.
       *
       * Matching on the host alone is what a footer's own markup makes
       * unnecessary and, for one network, wrong. Google is the case: its
       * profile lives on `share.google`, a host a practice also uses for the
       * "Map & Directions" link beside its address, so a host rule either
       * misses the Google icon or promotes the address to a social account.
       * Meanwhile the anchor itself says which network it is — builders emit
       * `elementor-social-icon-google` and a screen-reader label to match —
       * and that is a statement about the link, not an inference from it.
       *
       * So the icon row is read first, by name, and the host scan is kept
       * after it for themes that mark up nothing.
       */
      const SOCIAL_ROW_SEL =
        '[class*="social-icon"], [class*="social-links"], [class*="social-media"], [class*="socials"]';

      const namedSocial = (a) => {
        const words = `${a.getAttribute("class") || ""} ${a.getAttribute("aria-label") || ""} ${cleanText(a)}`
          .toLowerCase();
        // Longest first, so "facebook" is not shadowed by a stray "fb".
        return [...SOCIAL_NAMES]
          .sort((x, y) => y.length - x.length)
          .find((name) => new RegExp(`\\b${name}\\b|-${name}\\b`).test(words));
      };

      const readSocials = (root) => {
        const found = new Map();

        const add = (name, href) => {
          if (!name || !href || found.has(name)) return;
          found.set(name, {
            label: name[0].toUpperCase() + name.slice(1),
            icon: `social/${name}`,
            link: href,
          });
        };

        for (const row of root?.querySelectorAll(SOCIAL_ROW_SEL) ?? []) {
          for (const a of row.matches("a[href]") ? [row] : row.querySelectorAll("a[href]")) {
            add(namedSocial(a), a.getAttribute("href") || "");
          }
        }

        for (const a of root?.querySelectorAll("a[href]") ?? []) {
          const href = a.getAttribute("href") || "";
          let host;
          try {
            host = new URL(href, location.href).host.replace(/^www\./, "");
          } catch {
            continue;
          }
          const key = Object.keys(SOCIAL_HOSTS).find((h) => host.endsWith(h));
          if (key) add(SOCIAL_HOSTS[key], href);
        }
        return [...found.values()];
      };

      /** Plain links, excluding social and contact ones already captured. */
      const readLinks = (root) =>
        [...(root?.querySelectorAll("a[href]") ?? [])]
          .filter((a) => {
            const href = a.getAttribute("href") || "";
            if (/^(tel:|mailto:|#)/i.test(href)) return false;
            try {
              const host = new URL(href, location.href).host.replace(/^www\./, "");
              if (Object.keys(SOCIAL_HOSTS).some((h) => host.endsWith(h))) return false;
            } catch {
              /* relative */
            }
            return cleanText(a).length > 0;
          })
          .map((a) => ({ name: cleanText(a), path: a.getAttribute("href") || "" }));


      /**
       * The icon a chrome link carries, as a bare name.
       *
       * Chrome links are icon-led far more often than page content is — a
       * chevron before every menu entry, a handset before the phone number,
       * a pin before the address. Dropping them migrates a footer whose links
       * are all correct and which looks nothing like the original, so the
       * glyph is recorded by name and mapped onto the target's icon set the
       * same way socials already are.
       *
       * Font Awesome's own class is the name: `fa-chevron-right` is a
       * chevron-right on every site that uses it, which is most WordPress
       * themes. An `<img>` used as an icon is returned as its source instead.
       */
      const iconOf = (el) => {
        const glyph = el.querySelector('i[class*="fa-"], span[class*="fa-"], i[class*="icon-"]');
        if (glyph) {
          const cls = glyph.getAttribute("class") || "";
          const fa = cls.match(/\bfa-([a-z0-9-]+)\b/i);
          if (fa && !/^(fw|lg|[0-9]x|solid|regular|brands)$/i.test(fa[1])) return fa[1];
          const generic = cls.match(/\bicon-([a-z0-9-]+)\b/i);
          if (generic) return generic[1];
        }
        return "";
      };

      /**
       * Does the glyph come after the label rather than before it?
       *
       * Decided on document order among the anchor's own children, since the
       * glyph is often wrapped a level down. `compareDocumentPosition` reads
       * like the right tool and is not: it returns CONTAINED_BY *combined*
       * with FOLLOWING, so testing it for equality against CONTAINED_BY is
       * always false and every trailing arrow migrates as a leading one.
       */
      const iconTrails = (anchor, glyph) => {
        if (!glyph) return undefined;
        const kids = [...anchor.childNodes];
        const glyphIndex = kids.findIndex((k) => k === glyph || k.contains?.(glyph));
        const textIndex = kids.findIndex((k) => k.nodeType === 3 && k.textContent.trim());
        if (glyphIndex < 0 || textIndex < 0) return undefined;
        return glyphIndex > textIndex ? true : undefined;
      };

      /**
       * The column a footer heading belongs to.
       *
       * Walks out from the heading and keeps the *outermost* ancestor that
       * still holds only this one heading — the column box, whatever the theme
       * calls it. Stopping at the first ancestor with links instead would
       * return an inner wrapper on themes that group their links, and taking
       * the parent unconditionally returns the whole row on themes that do
       * not, so the boundary is defined by where a second heading appears.
       */
      const columnOf = (heading) => {
        let node = heading.parentElement;
        let best = null;
        let guard = 0;
        while (node && guard++ < 8) {
          if (node.querySelectorAll(HEADING_SEL).length > 1) break;
          if (node.querySelectorAll("a[href]").length >= 1) best = node;
          node = node.parentElement;
        }
        return best;
      };

      /**
       * Read the footer as the columns it is drawn in.
       *
       * The flat `links` list below loses the only thing a footer's layout is
       * made of. "Helpful Links" and "Our Services" arrive as one 23-item run
       * with no headings, and no arrangement of that list can be rendered back
       * into the four columns the site had. The grouping is in the markup —
       * one heading per column — so it is read rather than inferred.
       */
      const readColumns = (root) => {
        if (!root) return [];
        const columns = [];
        const claimed = new Set();

        for (const heading of root.querySelectorAll(HEADING_SEL)) {
          if (!isVisible(heading)) continue;
          const box = columnOf(heading);
          if (!box || claimed.has(box)) continue;
          claimed.add(box);

          const links = [];
          const seen = new Set();
          for (const a of box.querySelectorAll("a[href]")) {
            if (heading.contains(a)) continue;
            const name = cleanText(a);
            const path = a.getAttribute("href") || "";
            if (!name || !path) continue;
            const key = `${name}|${path}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const glyph = a.querySelector('i[class*="fa-"], span[class*="fa-"], i[class*="icon-"]');
            links.push({
              name,
              path,
              icon: iconOf(a),
              /*
               * Which side of the label the glyph sits on. A chevron leads a
               * menu entry and an arrow trails a "Map & Directions" link —
               * same column, opposite sides — so the position is part of what
               * the link is, not a global setting for the footer.
               */
              iconAfter: iconTrails(a, glyph),
              // Filled in below, once the column's usual colour is known.
              color: getComputedStyle(a).color,
              external: a.getAttribute("target") === "_blank" || undefined,
            });
          }
          /*
           * A link the source singles out.
           *
           * Most footer links share one colour; the odd one is styled as a
           * call to action — this footer's "Map & Directions" is green and
           * heavier than the six links above it. Recording every link's colour
           * would be noise, so only the ones that disagree with the column's
           * usual colour are kept, which is exactly the set that was meant to
           * stand out.
           */
          const tally = new Map();
          for (const link of links) tally.set(link.color, (tally.get(link.color) ?? 0) + 1);
          const usual = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
          for (const link of links) {
            if (link.color === usual) delete link.color;
          }

          if (links.length) columns.push({ title: cleanText(heading), links, box });
        }

        /*
         * The brand column has no heading, so the loop above cannot see it —
         * yet it is a column, and omitting it shifts every remaining column one
         * position left. It is recognised by being a heading-less sibling of a
         * real column that holds the logo.
         *
         * Every row is searched, not just the first column's. A footer is
         * rarely one row: this one stacks a promotional band, a testimonial
         * band and the link columns proper, and the logo sits in the last of
         * them. Looking only where the first heading landed searches the
         * promotional band, finds no logo, and drops the brand column from a
         * footer that plainly has one.
         */
        const rows = [...new Set([...claimed].map((box) => box.parentElement).filter(Boolean))];
        for (const row of rows) {
          for (const el of row.children) {
            if (claimed.has(el)) continue;
            if (!isVisible(el)) continue;
            if (el.querySelector(HEADING_SEL)) continue;
            const img = el.querySelector("img");
            if (!img) continue;
            // Placed where it sits in the row rather than at the front: a logo
            // in the last column is not the first column.
            const kids = [...row.children];
            const before = kids.slice(0, kids.indexOf(el)).filter((sib) => claimed.has(sib)).length;
            const rowStart = columns.findIndex((c) => c.box && row.contains(c.box));
            columns.splice((rowStart < 0 ? 0 : rowStart) + before, 0, {
              title: "",
              brand: true,
              logo: { source: img.getAttribute("src") || "", alt: img.getAttribute("alt") || "" },
              links: [],
            });
            break;
          }
        }

        // `box` was scaffolding for placing the brand column; it is a DOM node
        // and cannot cross back out of the page.
        return columns.map(({ box, ...column }) => column);
      };

      /**
       * The footer's embedded map and booking form.
       *
       * A practice's footer routinely ends with a two-column band — a map on
       * one side, a form on the other — and both are iframes, which is why
       * nothing upstream sees them. To the link reader they are not links; to
       * the column reader they are a column with no text in it; to a screenshot
       * they are a blank rectangle, because a mirrored snapshot cannot load
       * either third party. The band is simply missing from the migrated
       * footer, and missing quietly.
       *
       * What does transfer is the URL and the height the source gave it, which
       * is all the target needs to rebuild the band in its own markup — and a
       * map embed in particular is a URL the practice cannot easily
       * reconstruct, since it encodes the pin the theme was pointed at.
       */
      const EMBED_KINDS = [
        [/maps\.google|google\.[a-z.]+\/maps|openstreetmap|mapbox|maps\.app\.goo\.gl/i, "map"],
        [/forms?\.|typeform|jotform|hubspot|calendly|gravityforms|liine/i, "form"],
      ];

      const readEmbedBand = (footer) => {
        if (!footer) return null;
        const frames = [...footer.querySelectorAll("iframe[src]")].filter(isVisible);
        if (!frames.length) return null;

        // The band is the widest ancestor of the first frame that is still
        // inside the footer — the same climb the style pass makes, so the two
        // describe the same region.
        let band = frames[0];
        for (let node = frames[0]; node && node !== footer; node = node.parentElement) {
          if (node.getBoundingClientRect().width >= footer.getBoundingClientRect().width * 0.9) band = node;
        }

        const embeds = [...band.querySelectorAll("iframe[src]")].filter(isVisible).map((f) => {
          const src = f.getAttribute("src") || "";
          const r = f.getBoundingClientRect();
          return {
            src,
            kind: EMBED_KINDS.find(([re]) => re.test(src))?.[1] ?? "embed",
            title: f.getAttribute("title") || "",
            width: Math.round(r.width) || null,
            height: Math.round(r.height) || null,
          };
        });
        if (!embeds.length) return null;

        /*
         * The words above the form, in the order the band stacks them: a small
         * line over a large one. Kept as a list rather than named "eyebrow"
         * and "heading", because which is which is a matter of size and the
         * sizes are measured, not decided here.
         */
        const headings = [...band.querySelectorAll(HEADING_SEL)]
          .filter(isVisible)
          .map((h) => ({ text: cleanText(h), size: parseFloat(getComputedStyle(h).fontSize) || 0 }))
          .filter((h) => h.text);

        return { embeds, headings };
      };

      /**
       * Socials drawn as images rather than as font glyphs.
       *
       * `readSocials` names the network and leaves the target to draw it from
       * its own icon set, which is right when the source used a webfont. A
       * site that uploaded its own social artwork is stating a design — round
       * outlined badges here, not the target's flat monochrome glyphs — and
       * that is lost unless the image itself comes across.
       */
      const readSocialImages = (root) => {
        const found = [];
        const seen = new Set();
        for (const a of root?.querySelectorAll("a[href] img") ?? []) {
          const anchor = a.closest("a[href]");
          const href = anchor?.getAttribute("href") || "";
          let host;
          try {
            host = new URL(href, location.href).host.replace(/^www\./, "");
          } catch {
            continue;
          }
          const social = Object.keys(SOCIAL_HOSTS).some((h) => host.endsWith(h)) || /google\./.test(host);
          if (!social || seen.has(href)) continue;
          seen.add(href);
          found.push({
            link: href,
            image: a.getAttribute("src") || "",
            alt: a.getAttribute("alt") || "",
            width: Math.round(a.getBoundingClientRect().width) || null,
          });
        }
        return found;
      };

      /**
       * The strip under the footer proper: copyright, and the handful of
       * links (privacy, HIPAA, accessibility) that live only there.
       *
       * It sits outside the `<footer>` landmark on plenty of themes, so it is
       * looked up in the document rather than within the footer element.
       */
      const COPYRIGHT_RE =
        /(?:\u00a9|\(c\)|@)\s*(?:19|20)\d{2}|copyright\b|all rights reserved/i;

      /**
       * The copyright bar on a theme that gives it no class to find it by.
       *
       * A page builder draws that bar as one more generic container — here it
       * is `<div class="e-con e-parent">` holding `<p>@2026 Chapel Hill Dental
       * Arts</p>`, indistinguishable by name from the four containers above
       * it. What does distinguish it is what it says, so it is found by the
       * notice itself: the smallest visible element whose text reads as a
       * copyright, then widened to the bar it sits in — the widest ancestor
       * that still says nothing but the notice — so that the links a theme
       * puts beside the words come with it.
       *
       * Missing it is not a blank space in the migrated footer: the template
       * has its own line there, so the site publishes someone else's credit on
       * every page until this finds the real one.
       */
      const findCopyrightBar = (footer) => {
        if (!footer) return null;
        let best = null;
        for (const el of footer.querySelectorAll("*")) {
          const text = cleanText(el);
          if (!text || text.length > 300 || !COPYRIGHT_RE.test(text)) continue;
          if (!isVisible(el)) continue;
          if (!best || text.length < cleanText(best).length) best = el;
        }
        if (!best) return null;
        // Widen while the parent is still only the notice — one more wrapper
        // each time on a builder's markup, and the footer itself at the end,
        // whose text is far past the cap and stops the climb.
        let bar = best;
        while (
          bar.parentElement &&
          bar.parentElement !== footer.parentElement &&
          cleanText(bar.parentElement).length <= 300 &&
          COPYRIGHT_RE.test(cleanText(bar.parentElement))
        ) {
          bar = bar.parentElement;
        }
        return bar;
      };

      const readCopyright = (footer) => {
        const bar =
          pick(".copyright") ||
          pick("footer .site-info") ||
          pick(".site-footer-bottom") ||
          pick("#colophon .site-info") ||
          findCopyrightBar(footer);
        if (!bar || !isVisible(bar)) return null;
        const links = [...bar.querySelectorAll("a[href]")].map((a) => ({
          name: cleanText(a),
          path: a.getAttribute("href") || "",
          external: a.getAttribute("target") === "_blank" || undefined,
        })).filter((l) => l.name && l.path);
        /*
         * The strip's own words, with the link labels taken out — the links
         * are returned separately and rendering both would print each one
         * twice. Removing them leaves the separators they sat between, so the
         * runs of leftover punctuation collapse rather than surviving as
         * "All Content © 2026 | | |".
         */
        let text = cleanText(bar);
        for (const l of links) text = text.split(l.name).join(" ");
        text = text
          .replace(/\s+/g, " ")
          .replace(/(?:\s*[|·•—–-]\s*)+/g, " | ")
          .replace(/^[\s|·•—–-]+|[\s|·•—–-]+$/g, "")
          .trim();
        return { text, links };
      };

      /**
       * The header's own contact block — the "Call us Today! / (720) …" pair
       * that sits opposite the logo.
       *
       * It is a distinct thing from the phone numbers `readContacts` already
       * collects: those are a list of every tel: link on the page, which the
       * office model consumes. This is a *layout* — a label above a large
       * number, in the top bar — and reproducing it needs to know the label.
       */
      const readHeaderAside = (root) => {
        if (!root) return null;
        const tel = [...root.querySelectorAll('a[href^="tel:"]')].find(isVisible);
        if (!tel) return null;

        // The aside is the smallest ancestor that adds a label to the number.
        let box = tel.parentElement;
        let guard = 0;
        while (box && guard++ < 5) {
          const text = cleanText(box);
          const phone = cleanText(tel);
          if (text && phone && text.replace(phone, "").trim().length >= 3) break;
          box = box.parentElement;
        }
        if (!box || box === root) return null;

        const phone = cleanText(tel);
        const label = cleanText(box).split(phone).join(" ").replace(/\s+/g, " ").trim();

        /*
         * The label is a link as often as it is a caption — this top bar's
         * "Contact Us" sits beside the number and goes to the contact page.
         * Returned as plain text it migrates as a word next to a phone number
         * that used to be the bar's second destination, so where the label is
         * an anchor its href comes with it.
         */
        const labelLink = [...box.querySelectorAll("a[href]")].find(
          (a) => a !== tel && !a.contains(tel) && cleanText(a) && label.includes(cleanText(a))
        );

        return {
          label,
          ...(labelLink ? { link: labelLink.getAttribute("href") || "", icon: iconOf(labelLink) } : {}),
          phone: { display: phone, href: tel.getAttribute("href") || "", icon: iconOf(tel) },
        };
      };

      const header = pick(chrome.header);
      const footer = pick(chrome.footer);

      // The primary menu is the largest list in the header — sites often have
      // a second, smaller utility list alongside it.
      //
      // Searched outside the header too, because a sticky nav bar under a logo
      // strip is a sibling of the header as often as a child of it. Missing it
      // is silent: the merge keeps whatever navigation the template shipped, so
      // the migrated site builds and renders someone else's menu.
      const menuRoots = [header, ...document.querySelectorAll('nav, [role="navigation"]')].filter(
        (el) => el && !footer?.contains(el)
      );
      let primaryMenu = null;
      let mostItems = 0;
      for (const root of menuRoots) {
        for (const list of root.querySelectorAll("nav ul, ul")) {
          if (list.closest("li")) continue; // a sub-menu, reached by recursion
          const count = list.querySelectorAll("li").length;
          if (count > mostItems) {
            mostItems = count;
            primaryMenu = list;
          }
        }
      }

      const headerContacts = readContacts(header);
      const footerContacts = readContacts(footer);

      return {
        header: header
          ? {
              uid: header.getAttribute(attr),
              logo: readLogo(header),
              nav: readMenu(primaryMenu),
              phones: headerContacts.phones,
              emails: headerContacts.emails,
              buttons: readHeaderButtons(),
              aside: readHeaderAside(header),
            }
          : null,

        footer: footer
          ? {
              uid: footer.getAttribute(attr),
              logo: readLogo(footer),
              links: readLinks(footer),
              columns: readColumns(footer),
              socials: readSocials(footer),
              socialImages: readSocialImages(footer),
              phones: footerContacts.phones,
              emails: footerContacts.emails,
              embedBand: readEmbedBand(footer),
              text: cleanText(footer).slice(0, 2000),
              mapUrl:
                footer.querySelector('a[href*="maps."], a[href*="goo.gl"], a[href*="/maps"]')
                  ?.getAttribute("href") ?? null,
            }
          : null,

        copyright: readCopyright(footer),

        // Address and hours are prose, not markup, so they are returned raw for
        // parsing outside the page rather than guessed at here.
        addressBlocks: [...(document.querySelectorAll("address, .address, .adr") ?? [])].map(
          (el) => cleanText(el)
        ),
        siteName:
          document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ||
          readLogo(header)?.alt ||
          "",
      };
    },
    { chrome, attr: UID_ATTR, buttonClassPattern }
  );
}
