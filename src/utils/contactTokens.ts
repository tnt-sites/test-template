import siteInfoData from "@data/siteInfo.json";

/*
 * Content copy on this site was migrated from WordPress with the practice's
 * phone number and address baked into the prose. Rather than leave 250-odd
 * files to update by hand the next time either changes, the copy carries
 * tokens — [[phone]], [[phoneHref]], [[address]] — that resolve from
 * siteInfo.json at build time.
 *
 * Both markdown paths run through here: the remark plugin for page/blog
 * bodies, and replaceContactTokens() for the markdown-it core elements.
 */

interface Address {
  lines?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  mapUrl?: string;
}

interface Phone {
  type?: string;
  display?: string;
  href?: string;
}

interface Office {
  name?: string;
  addresses?: Address[];
  phones?: Phone[];
}

const offices: Office[] = (siteInfoData as any)?.offices ?? [];
const primaryOffice = offices[0] ?? {};
const primaryPhone: Phone = primaryOffice.phones?.[0] ?? {};
const primaryAddress: Address = primaryOffice.addresses?.[0] ?? {};

/* "(760) 940-2273" — the display form, as it should read in prose. */
const phone = primaryPhone.display ?? "";

/* The dialable form. Derived from the display value when no href is set. */
const phoneHref = primaryPhone.href ?? (phone ? `tel:${phone.replace(/[^+\d]/g, "")}` : "");

/*
 * "1934 Via Centre Ste A Vista, CA 92081" — a single line, matching how the
 * migrated copy ran it inline. The multi-line form belongs to the footer and
 * contact components, which build it from siteInfo directly.
 */
const address = [
  ...(primaryAddress.lines ?? []),
  [primaryAddress.city, primaryAddress.state].filter(Boolean).join(", "),
  primaryAddress.postalCode,
]
  .filter((part) => typeof part === "string" && part.trim().length > 0)
  .join(" ")
  .trim();

/*
 * The street line and the "city, state ZIP" line on their own, for the places
 * that stack the address over two lines rather than running it inline.
 */
const addressLine1 = (primaryAddress.lines ?? []).join(" ").trim();
const addressLocality = [
  [primaryAddress.city, primaryAddress.state].filter(Boolean).join(", "),
  primaryAddress.postalCode,
]
  .filter((part) => typeof part === "string" && part.trim().length > 0)
  .join(" ")
  .trim();

const mapUrl = primaryAddress.mapUrl ?? "";
const siteName = (siteInfoData as any)?.siteName ?? "";

export const contactTokens: Record<string, string> = {
  phone,
  phoneHref,
  address,
  addressLine1,
  addressLocality,
  mapUrl,
  siteName,
};

/*
 * Matches [[token]] with optional inner whitespace. Double square brackets
 * rather than the more usual double braces: MDX parses {{...}} as a JSX
 * expression and swallows it before any plugin can see the text.
 */
const TOKEN_PATTERN =
  /\[\[\s*(phone|phoneHref|addressLine1|addressLocality|address|mapUrl|siteName)\s*\]\]/g;

/*
 * An unknown token is left untouched rather than blanked, so a typo shows up
 * on the page instead of silently deleting the phone number.
 */
export function replaceContactTokens(input: string | undefined | null): string {
  if (!input) return "";

  return input.replace(TOKEN_PATTERN, (match, token: string) => contactTokens[token] ?? match);
}

export { phone, phoneHref, address, addressLine1, addressLocality, mapUrl };
