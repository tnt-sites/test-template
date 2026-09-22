/**
 * Reconcile the phone numbers read off the rendered page against the ones in
 * the page's own markup.
 *
 * Dental and medical sites run call-tracking almost universally: a third-party
 * script finds every `tel:` link and swaps in a number from a rented pool so
 * the practice can attribute calls to campaigns. It rewrites the href as well
 * as the text, it runs before the capture settles, and — the part that makes
 * it dangerous here — the number it picks *differs on every page load*.
 *
 * Two consecutive captures of this site produced (720) 604-0578 and
 * (720) 617-6531. Neither appears anywhere in the site's markup. Migrating
 * either one bakes a rented, rotating number into static output as the
 * practice's permanent phone number, on every page, where it will keep working
 * right up until the tracking subscription lapses and then route patients to a
 * dead line or to whoever rents it next.
 *
 * Nothing about the rendered value looks wrong, which is why this cannot be
 * left to review: it is a correctly-formatted local number in exactly the place
 * a phone number belongs.
 *
 * The snapshot is fetched pre-JS by design, so the markup still holds the real
 * number. That makes the check cheap: a rendered number absent from the source
 * bytes was put there by a script, and the markup wins.
 */

/** Comparable form of a phone number: digits only, with any country code off. */
export function digitsOf(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/**
 * Every `tel:` number in a raw HTML document, most-used first.
 *
 * Frequency matters: a site's main line is on every page in the header and the
 * footer, while a fax number or a second location appears once. Ordering by
 * count picks the main line without needing to know which is which.
 */
export function phonesInMarkup(html) {
  const counts = new Map();
  for (const m of String(html ?? "").matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) {
    const digits = digitsOf(m[1]);
    if (digits.length < 7) continue;
    counts.set(digits, (counts.get(digits) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([digits, count]) => ({ digits, count }));
}

/**
 * Format `7202222345` the way the source wrote it, so the replacement is not
 * visibly a different style of number from the rest of the site.
 */
function formatLike(digits, template) {
  const shape = String(template ?? "");
  if (digits.length !== 10) return digits;
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)];
  if (/^\(\d{3}\)\s*\d{3}-\d{4}$/.test(shape)) return `(${parts[0]}) ${parts[1]}-${parts[2]}`;
  if (/^\d{3}\.\d{3}\.\d{4}$/.test(shape)) return parts.join(".");
  if (/^\d{3}\s\d{3}\s\d{4}$/.test(shape)) return parts.join(" ");
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

/**
 * Walk the extracted chrome and replace any phone number that the markup does
 * not contain.
 *
 * Conservative on purpose. A number is only overridden when the markup offers
 * a clear main line to override it *with*; where the markup has no `tel:` link
 * at all — a header that renders its number as plain text, say — the rendered
 * value is all there is and is kept, with the substitution reported instead of
 * guessed at.
 *
 * @returns {{swapped: Array<{from: string, to: string, at: string}>, markup: Array}}
 */
export function reconcilePhones(extracted, html) {
  const known = phonesInMarkup(html);
  const swapped = [];
  if (!known.length) return { swapped, markup: known };

  const valid = new Set(known.map((p) => p.digits));
  const main = known[0].digits;

  /** Replace a display/href pair in place when it is a tracking substitution. */
  const fix = (holder, displayKey, hrefKey, at) => {
    if (!holder) return;
    const display = holder[displayKey];
    const digits = digitsOf(display ?? holder[hrefKey]);
    if (!digits || valid.has(digits)) return;

    const to = formatLike(main, display);
    swapped.push({ from: display || holder[hrefKey], to, at });
    if (displayKey in holder) holder[displayKey] = to;
    if (hrefKey && hrefKey in holder) holder[hrefKey] = `tel:${main}`;
  };

  fix(extracted.header?.aside?.phone, "display", "href", "header.aside");
  for (const [i, phone] of (extracted.header?.phones ?? []).entries()) {
    fix(phone, "label", null, `header.phones[${i}].label`);
    if (phone && !valid.has(digitsOf(phone.number))) {
      swapped.push({ from: phone.number, to: main, at: `header.phones[${i}]` });
      phone.number = main;
    }
  }
  for (const [i, phone] of (extracted.footer?.phones ?? []).entries()) {
    fix(phone, "label", null, `footer.phones[${i}].label`);
    if (phone && !valid.has(digitsOf(phone.number))) {
      swapped.push({ from: phone.number, to: main, at: `footer.phones[${i}]` });
      phone.number = main;
    }
  }

  // Footer columns render the number as a link's own text.
  for (const [c, column] of (extracted.footer?.columns ?? []).entries()) {
    for (const [l, link] of (column.links ?? []).entries()) {
      if (!/^tel:/i.test(link.path || "")) continue;
      const digits = digitsOf(link.name);
      if (!digits || valid.has(digits)) continue;
      const to = formatLike(main, link.name);
      swapped.push({ from: link.name, to, at: `footer.columns[${c}].links[${l}]` });
      link.name = to;
      link.path = `tel:${main}`;
    }
  }

  return { swapped, markup: known };
}
