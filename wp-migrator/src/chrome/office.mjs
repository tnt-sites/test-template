/**
 * Parse a practice's contact details out of footer prose.
 *
 * Addresses and opening hours are almost never marked up semantically on
 * hand-built sites — they are lines of text inside a div. The template models
 * them as structured data, so they have to be recovered by pattern rather than
 * by selector, and anything ambiguous is left out rather than guessed at.
 */

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const DAY_PATTERN = DAYS.map((d) => `${d}|${d.slice(0, 3)}`).join("|");

/** US state abbreviations, to anchor the end of an address. */
const STATE = "A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|OH|OK|OR|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY]";

/**
 * Opening hours, as `day` / `hours` pairs.
 *
 * Sites run the day and its times together (`Monday7:30 am - 2:30 pm`) because
 * they sit in separate elements, so the day name is the delimiter rather than
 * any whitespace.
 */
export function parseOfficeHours(text) {
  if (!text) return [];

  const entries = [];
  const pattern = new RegExp(
    `(${DAY_PATTERN})\\.?\\s*[:–—-]?\\s*` +
      `(closed|by appointment[^A-Z]*|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?\\s*[-–—to]+\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))`,
    "gi"
  );

  for (const match of text.matchAll(pattern)) {
    const day = normalizeDay(match[1]);
    if (!day) continue;
    if (entries.some((e) => e.day === day)) continue;
    entries.push({ day, hours: tidy(match[2]), note: "" });
  }

  return entries;
}

function normalizeDay(raw) {
  const lower = raw.toLowerCase();
  return DAYS.find((d) => d.toLowerCase() === lower || d.slice(0, 3).toLowerCase() === lower) ?? null;
}

function tidy(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*[-–—]\s*/g, " - ")
    .replace(/\s+to\s+/gi, " - ")
    .trim();
}

/**
 * A postal address, split into the fields the template stores.
 * Returns null when no confident match is found — a half-parsed address is
 * worse than none, because it looks filled in.
 */
/**
 * A unit designator, plus a number when it trails ("Suite 4"). The number is
 * matched narrowly so the designator cannot swallow the city that follows it —
 * in "4th Floor Springfield" the unit is "Floor" and "Springfield" is the city.
 */
const UNIT = /\b(floor|fl|suite|ste|apt|apartment|unit|building|bldg|#)\b\.?(?:\s*\d+[a-z]?\b)?/i;

export function parseAddress(text) {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ");

  // Anchor on the state and postal code and read backwards. Scanning forwards
  // for a street number finds whichever digits come first, which in footer
  // prose is usually a phone number rather than the address.
  const anchor = new RegExp(`\\b(${STATE})\\s+(\\d{5}(?:-\\d{4})?)\\b`, "g");
  const match = [...flat.matchAll(anchor)].pop();
  if (!match) return null;

  const [, state, postalCode] = match;
  const before = flat.slice(0, match.index).replace(/[,\s]+$/, "");

  // The street begins at the last "<number> <Word>" close to the anchor.
  const start = [...before.matchAll(/\b\d+[a-z]?\s+[A-Z][A-Za-z.]/g)]
    .map((m) => m.index)
    .filter((i) => before.length - i <= 120)
    .pop();
  if (start === undefined) return null;

  const segments = before
    .slice(start)
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  // The city is the tail of the final segment. Sites frequently run a unit
  // designator straight into the city with no comma between them
  // ("4th Floor Springfield"), so split on the unit rather than the comma.
  let last = segments.pop();
  let city = last;
  const unit = last.match(UNIT);

  if (unit) {
    const cut = unit.index + unit[0].length;
    const unitPart = last.slice(0, cut).trim();
    const remainder = last.slice(cut).trim();
    if (remainder) {
      segments.push(unitPart);
      city = remainder;
    } else {
      city = "";
    }
  }

  city = city.replace(/^[,\s]+|[,\s]+$/g, "");

  // A city with digits in it means the split went wrong; an empty one means
  // there was nothing to find. Either way, no address beats a wrong one.
  if (!city || /\d/.test(city) || segments.length === 0) return null;

  return { lines: segments, city, state, postalCode, country: null };
}

/**
 * Classify a contact number.
 *
 * A practice commonly lists a separate texting number, and the scheme or the
 * surrounding label is the only thing distinguishing it from the phone line.
 */
export function classifyPhone({ href = "", label = "" }) {
  const isSms = /^sms:/i.test(href) || /\b(text|sms)\b/i.test(label);
  const number = href.replace(/^(tel|sms):/i, "").trim();

  const display =
    label.replace(/^\s*(call|text|phone|sms)\b[:\s]*/i, "").trim() || formatNumber(number);

  return {
    type: isSms ? "sms" : "phone",
    display,
    href: href || `${isSms ? "sms" : "tel"}:${number}`,
  };
}

function formatNumber(number) {
  const digits = number.replace(/\D/g, "").replace(/^1/, "");
  if (digits.length !== 10) return number;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Assemble the office record the template stores. */
export function buildOffice(extracted, current = {}) {
  const footerText = extracted.footer?.text ?? "";

  const phones = [...(extracted.header?.phones ?? []), ...(extracted.footer?.phones ?? [])]
    .map((p) => classifyPhone({ href: `tel:${p.number}`, label: p.label }))
    .filter((p, i, all) => all.findIndex((o) => o.href === p.href) === i);

  const emails = (extracted.footer?.emails ?? []).map((e) => ({
    display: e.address,
    href: `mailto:${e.address}`,
  }));

  const address = parseAddress(footerText);
  const officeHours = parseOfficeHours(footerText);

  const office = { ...(current ?? {}) };
  if (address) {
    office.addresses = [{ ...address, mapUrl: extracted.footer?.mapUrl ?? current?.addresses?.[0]?.mapUrl ?? null }];
  }
  if (phones.length) office.phones = phones;
  if (emails.length) office.emails = emails;
  if (officeHours.length) office.officeHours = officeHours;

  return office;
}

export { DAYS };
