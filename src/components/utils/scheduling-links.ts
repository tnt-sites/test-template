/**
 * The practice's online booking runs on a third-party host (FlexBook), and the
 * source site opened every link to it in a new tab so a half-finished booking
 * never replaced the page the visitor came from.
 *
 * These links are authored in a dozen places — nav data, fixed tabs, footer
 * columns, and `buttonLink` fields spread across the page content — so the
 * rule lives here rather than as a `target` spelled out at each call site.
 * Add a host here if the practice ever moves to a different booking provider.
 */
const BOOKING_HOSTS = ["flexbook.me"];

/** True when `href` points at the practice's online booking provider. */
export const isSchedulingLink = (href: unknown): boolean => {
  if (typeof href !== "string") return false;

  const value = href.trim();

  if (!/^https?:\/\//i.test(value)) return false;

  let host: string;

  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return false;
  }

  return BOOKING_HOSTS.some((booking) => host === booking || host.endsWith(`.${booking}`));
};

/**
 * `target`/`rel` for a link, opening scheduling links in a new tab. Spread onto
 * an anchor; it contributes nothing for every other href.
 */
export const schedulingLinkAttrs = (href: unknown): Record<string, string> =>
  isSchedulingLink(href) ? { target: "_blank", rel: "noopener noreferrer" } : {};
