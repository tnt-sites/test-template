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

      const cleanText = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

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

          const sublist = [...li.children].find((c) => c.tagName === "UL");

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
            children: sublist ? readMenu(sublist, depth + 1) : [],
          });
        }
        return items;
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

      const header = pick(chrome.header);
      const footer = pick(chrome.footer);

      // The primary menu is the largest list in the header — sites often have
      // a second, smaller utility list alongside it.
      let primaryMenu = null;
      let mostItems = 0;
      for (const list of header?.querySelectorAll("nav ul, ul") ?? []) {
        if (list.closest("li")) continue; // a sub-menu, reached by recursion
        const count = list.querySelectorAll("li").length;
        if (count > mostItems) {
          mostItems = count;
          primaryMenu = list;
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
              buttons: [...header.querySelectorAll("a")]
                .filter((a) =>
                  (a.getAttribute("class") || "").split(/\s+/).some((c) => buttonRe.test(c))
                )
                .map((a) => ({ text: cleanText(a), link: a.getAttribute("href") || "" })),
            }
          : null,

        footer: footer
          ? {
              uid: footer.getAttribute(attr),
              logo: readLogo(footer),
              links: readLinks(footer),
              socials: readSocials(footer),
              phones: footerContacts.phones,
              emails: footerContacts.emails,
              text: cleanText(footer).slice(0, 2000),
              mapUrl:
                footer.querySelector('a[href*="maps."], a[href*="goo.gl"], a[href*="/maps"]')
                  ?.getAttribute("href") ?? null,
            }
          : null,

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
