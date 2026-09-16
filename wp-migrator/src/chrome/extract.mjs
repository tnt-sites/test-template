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

      const readSocials = (root) => {
        const found = new Map();
        for (const a of root?.querySelectorAll("a[href]") ?? []) {
          const href = a.getAttribute("href") || "";
          let host;
          try {
            host = new URL(href, location.href).host.replace(/^www\./, "");
          } catch {
            continue;
          }
          const key = Object.keys(SOCIAL_HOSTS).find((h) => host.endsWith(h));
          if (!key || found.has(key)) continue;
          const name = SOCIAL_HOSTS[key];
          found.set(key, {
            label: name[0].toUpperCase() + name.slice(1),
            icon: `social/${name}`,
            link: href,
          });
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
          if (node.querySelectorAll("h1,h2,h3,h4,h5,h6").length > 1) break;
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

        for (const heading of root.querySelectorAll("h1,h2,h3,h4,h5,h6,.widget-title")) {
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

          if (links.length) columns.push({ title: cleanText(heading), links });
        }

        /*
         * The brand column has no heading, so the loop above cannot see it —
         * yet it is a column, it is usually the first one, and omitting it
         * shifts every remaining column one position left. It is recognised by
         * being a sibling of a real column that holds the logo.
         */
        const firstColumn = claimed.values().next().value;
        const row = firstColumn?.parentElement;
        for (const el of row?.children ?? []) {
          if (claimed.has(el)) continue;
          if (!isVisible(el)) continue;
          if (el.querySelector("h1,h2,h3,h4,h5,h6")) continue;
          const img = el.querySelector("img");
          if (!img) continue;
          columns.unshift({
            title: "",
            brand: true,
            logo: { source: img.getAttribute("src") || "", alt: img.getAttribute("alt") || "" },
            links: [],
          });
          break;
        }

        return columns;
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
      const readCopyright = () => {
        const bar =
          pick(".copyright") ||
          pick("footer .site-info") ||
          pick(".site-footer-bottom") ||
          pick("#colophon .site-info");
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
        return {
          label,
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
              text: cleanText(footer).slice(0, 2000),
              mapUrl:
                footer.querySelector('a[href*="maps."], a[href*="goo.gl"], a[href*="/maps"]')
                  ?.getAttribute("href") ?? null,
            }
          : null,

        copyright: readCopyright(),

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
