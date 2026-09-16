# columbinecreekdentistry.com → CloudCannon Astro

Working notes for the migration of <https://www.columbinecreekdentistry.com/>
into this repo. Source of record for the design is the **rendered** WordPress
site (snapshotted locally); source of record for blog prose is the **WXR
export** in this folder.

## How to re-run any stage

```bash
cd wp-migrator

# 1. mirror the live site (pages + assets) into .wpmig/static
node bin/wpmig.mjs dev-snapshot https://www.columbinecreekdentistry.com --out .wpmig/static

# 2. brand: palette, fonts, nav, footer, office info, SEO  → src/data + src/styles
node bin/wpmig.mjs dev-extract --static .wpmig/static --target .. --write

# 3. one page: components + page md (repeat per page)
node bin/wpmig.mjs dev-page index.html --static .wpmig/static --target .. --namespace wpmig

# 4. install the generated page md into the content collection, then build
#    (generated pages land in .wpmig/out/pages/<original/url/path>.md)
cd .. && npm run build

# 5. measure the built page against the source and correct what is mechanical
cd wp-migrator
node bin/wpmig.mjs dev-compare index.html --static .wpmig/static --dist ../dist --target ..
node bin/wpmig.mjs dev-refine  index.html --static .wpmig/static --dist ../dist --target .. --max-iterations 3

# blog posts, from the XML export (not the snapshot)
node bin/wpmig.mjs dev-posts columbinecreekdentistry-dentistlittleton.WordPress.2026-08-20.xml \
  --target .. --static .wpmig/static --author "Columbine Creek Dentistry" --write
```

```bash
# 6. structural audit: what the build lost, and what it invented
node bin/wpmig.mjs dev-audit --static .wpmig/static --dist ../dist
```

`dev-compare` writes side-by-side/diff PNGs and a `report.json` per page under
`.wpmig/compare/<page>/`. That report — not "it builds" — is what says a page is
done.

`dev-verify` and `dev-audit` answer different questions and both have to be
clean. `dev-verify` pairs elements by text and reports typography; it cannot see
a section that lost its parallax background or its hover captions, because the
words on it are unchanged. `dev-audit` reads the _structure_ of both sides and
reports only what the source has and the build does not:

- header overlaying the hero (absolute + transparent, solid once scrolled)
- carousel indicators that are bars rather than dots
- a row of cards staggered by negative `margin-top`
- `background-attachment: fixed` section photos
- half-screen background-image columns
- captions revealed on hover
- a `::before` gradient scrim over a section photo
- a heading underlined by a painted `::after`

plus five built-only smells: horizontal overflow, the `left: 180px;
margin-left: -195px` full-bleed hack, captions positioned by measured fractional
pixels, sections that style text they were never given a prop for, and emitted
class names that collide with a vendor icon font (`fa-*`, `glyphicon-*`,
`icon-*`) and render its glyph. It also reports class prefixes claimed by more
than one component — invisible in the DOM, but enough to make `dev-refix`
correct the wrong file. `--all` also lists the patterns the build kept, which is
how a new detector is verified.

It also answers two questions no source/built _comparison_ can, because both
compare only what exists on both sides:

- **Coverage** — text the source has that the build never renders (a whole
  section missing), text the build renders twice (the template supplying a block
  the migrated page already carries), and pages with no `<h1>` or several.
- **The component set** — near-identical components that are one section emitted
  once per page family, class prefixes claimed by more than one component, and
  invisible `opacity: 0` link overlays whose captured `:hover` fills the card.
  `--components-only` runs these alone, with no build or snapshot needed.

See ARCHITECTURE Parts 7-9 for why each of these is a property of the pipeline
rather than a one-off.

## Content runs and the family components

`dev-page` routes a section that is only a run of headings, prose, photos and
buttons onto one shared parametric component instead of generating a file for
it — see ARCHITECTURE Part 10 for why length, not paint or measurement, is what
forked fifty-four components out of three layouts. It keeps a component for a
section that paints a band (including with a `::before`), holds a repeat, holds
an embed or raw markup, or has no prose.

```bash
# route content runs at a different component, or "" to disable
node bin/wpmig.mjs dev-page index.html --content-section page-sections/shared-blocks/content-section

# convert output that already exists
node bin/collapse-families.mjs           # report
node bin/collapse-families.mjs --apply   # write
```

The collapse considers every migrator-written component, not a list of name
prefixes — a section named from its words rather than its shape is the same
design under a different name (ARCHITECTURE Part 11). It refuses hand-edited
components on the `by wp-migrator` marker, and deletes a component only if no
page still points at it after the rewrite.

Run it more than once, and run `dev-audit` after each pass: collapsing sections
leaves components nothing points at any more, and the audit's per-component
usage shows them. Its coverage check is what proves the rewrite dropped no
text.

## What is migrated

| Area       | State                                                                            |
| ---------- | -------------------------------------------------------------------------------- |
| Snapshot   | 194 pages, 754 assets                                                            |
| Brand      | palette, type scale, fonts, nav, footer, office/hours/socials, SEO               |
| Pages      | all 86 published pages, at their original URLs                                   |
| Blog       | all 119 published posts, with featured images                                    |
| Components | 292 sections → 119 components, in four folders by page family                    |
| Links      | 5,423 broken internal links at first build → 6, each dead on the source site too |

Migrated pages keep their **original URLs**, including nesting
(`/dental-services/general-dentistry/`), so existing links and search rankings
survive. Blog posts keep their WordPress slugs (`/blog/<original-slug>`).

## Component consolidation

The first pass emitted **226 components for 292 sections** — very nearly one per
section, with 48 identical page banners (`aetna-dental`, `delta-dental`,
`sitemap`, …) and 44 identical breadcrumbs among them.

The cause was that component _identity_ was the component _name_, and names come
from `nameFromContent` — the section's first heading. Two pages with the same
banner and different headings never got compared, so nothing could be shared;
two with the same heading and different markup collided and took a letter suffix,
which is where `general-dentistry-b` … `-l` came from.

**Reuse is now keyed on structure.** `src/generate/structure-hash.mjs` hashes the
emitted component with class names canonicalized, prop defaults blanked and
measurement noise quantized; `bin/wpmig.mjs` looks a section up by that hash
before it considers a name. An exact hash is an unconditional share; short of
that, `--reuse-threshold` (default 0.85) allows a near-duplicate **only when the
prop signatures match exactly**, because a shared prop name can mean a different
role. Names now come from `nameFromShape` — `page-banner`, `breadcrumb`,
`cta-band` — with the content-derived name as fallback.

### The one-time pass over the existing output

```bash
node bin/consolidate.mjs            # report the plan, change nothing
node bin/consolidate.mjs --verbose  # ...and say why anything stays separate
node bin/consolidate.mjs --apply    # write it
```

Re-running `dev-page` over all 86 pages would have re-measured everything and
thrown away the refine loop's corrections, so `consolidate.mjs` rebuilds the
components already on disk instead. It clusters them (single-linkage, so the
48 banners reach each other across an 80–107 line range), then **verifies each
member against its cluster's canonical before merging it**. A member merges only
if its props land in the same elements, in the same order, with the same
escaping, inside compatible nesting. Anything else stays its own component —
a partial merge is a real improvement, and forcing the rest through would trade
component count for silently wrong pages.

Four checks earned their place by catching real damage during the work:

- **Heading structure.** The 48-banner canonical came from a service page where
  the small `<h3>` above the title was captured as `heading` and the real page
  `<h1>` as `subheading`. Merging naively demoted the `<h1>` on 43 pages. The
  fix is the `rename` in `src/generate/merge-rules.mjs`, which names those slots
  `eyebrow` and `heading` so the other 47 banners map straight onto the `<h1>`.
- **Escaping.** Some insurance pages store their coverage list as raw `<ul>`
  markup and inject it with `set:html`; others store plain text. Merging a raw
  slot onto an interpolated one printed `&lt;p&gt;` on the page. The merged
  component now injects raw wherever _any_ member did, and the members that
  interpolated have their stored content HTML-escaped to match — the only
  direction that loses nothing.
- **Optional slots.** The canonical emits its own slots unguarded; a member that
  doesn't fill one rendered an empty element. Slots not filled by every member
  are now wrapped in a truthiness guard.
- **Image dimensions.** `width`/`height` are per-instance facts about the file
  each page uses. They are lifted to `<image>Width`/`<image>Height` props, and
  only pages that differ from the merged default carry them.
- **CloudCannon sidecars are transformed, not regenerated.** Rebuilding them
  from the `.astro` was tried first and is lossy: the markup cannot distinguish
  a `textarea` from a `text` or an `image` from a string, and an array's item
  fields vanished whenever its `.map(` sat on its own line — which empties that
  array's editor in CloudCannon while the built page still renders perfectly, so
  a `dist/` diff will never catch it. `src/generate/sidecars.mjs` edits the
  original `_inputs`/`_structures` instead, touching only the component's name,
  its folder and any renamed props. All 119 match their originals exactly.

**Result: 226 → 119 components**, verified by diffing the rendered `dist/` before
and after: **270 of 277 pages are byte-identical**, inline `style` attributes
included, once class names, per-build UUIDs and content-hashed asset filenames
are normalized. Note that a `dist/` diff proves nothing about the CloudCannon
sidecars — they are checked separately, by comparing each component's `_inputs`
and `_structures` against the originals. The other seven differ only by one wrapper `<div>` level or
a `<p>`→`<div>` around rich text, both consequences of a member adopting the
canonical's markup — same content, same order. They are worth an eyeball before
launch: `aetna-dentist`, `delta-dental-dentist`, `geha-dentist`,
`metlife-dental-dentist`, `united-healthcare-dentist`, `lp/dental-emergency`,
`lp/new-patient`.

### Where components live

| Folder                   | Count | What                                                                                               |
| ------------------------ | ----- | -------------------------------------------------------------------------------------------------- |
| `shared-blocks/`         | 2     | `page-banner`, `breadcrumb` — 80+ pages each                                                       |
| `homepage-blocks/wp/`    | 9     | `index.md` only (kept apart from the starter's own `homepage-blocks`)                              |
| `interior-pages-blocks/` | 86    | service, insurance, about, payment, new-patient                                                    |
| `landing-pages-blocks/`  | 22    | `lp/*`, `invisalign-littleton-co`, `dental-implants-littleton-co`, `littleton-emergency-dentistry` |

Placement is derived from the pages that actually use a component, not its name —
the banner and breadcrumb appear on the homepage _and_ the interior pages, which
is what makes them shared.

## Known gaps

- **Starter pages still present.** `src/content/pages/` still holds the
  template's own demo pages (`our-services`, `preventive-dentistry`, `why`,
  `dental-implants`, `location-test`). They are not part of this site — delete
  when ready. (The template's demo blog/landing/pep content has already been
  removed.)
- **Six links still 404**, all of them dead on the source site as well:
  `/sleep-apnea-treatment/`, `/tmd-tmj-treatment`, `/dentistry/`,
  `/dental-savers-relief-plan-special/`, `/payment-confirmation/`, and one with
  a stray `%20`. Point them somewhere real or drop them.
- **The theme linked to short URLs that only worked via WordPress redirects**
  (`/meet-the-team/` → `/about-us/meet-the-team/`). Migrated links now go
  straight to the canonical page; the old short URLs are worth adding as
  redirects for inbound traffic.
- **Icons are substituted, not ported.** The source uses a Font Awesome Pro kit
  served from a CDN; glyphs are matched to this project's own icon set by name.
  A handful had no equivalent and were dropped (`angle-double-right`,
  `phone-volume`, `external-link-alt`).
- **Third-party widgets are not reproduced.** EmbedSocial review strips and
  similar embeds are captured as content but not re-implemented. Their embed
  URLs previously carried the capture server's address as the `parentURL`
  /`origin` parameter — the widget being told it was hosted on a laptop, which
  vendors use for referrer checks and post-submit redirects. Those parameters
  are now stripped at generation.
- **`siteInfo.emails`** carries `info@dentalstudio.com` — that address is what
  the source site publishes, not a placeholder introduced here. Confirm before
  launch.
- **The phone number was call-tracked and rotated per request** — fourteen
  different 720 numbers were captured across the site, one per page fetch. All
  of them are now the practice's Google Business number, `(720) 440-7760` /
  `tel:+17204407760` (507 links). Two exceptions were left deliberately:
  `tel:303-327-9556` on the payment pages, which is stable across requests and
  belongs to the savings-plan administrator rather than the practice, and the
  `tel:+1555…` placeholders inside the template's own `lp-showcase` demo page.
  If the practice wants call tracking back, it belongs in a script, not baked
  into content.

## Fidelity, page by page

Measured at 1440/768/390 against the source render, after one site-wide
correction pass. Pixel mismatch is only reported for the pages that were
re-measured with screenshots (20 of 85); the rest carry
finding counts only, and **20,424 findings remain across the site**.

Mean pixel mismatch on the sampled pages: **15.51%**.

| Page                                | Pixel mismatch | Unresolved findings |
| ----------------------------------- | -------------- | ------------------- |
| `covid19-coronavirus-office-policy` | 35.0%          | 45                  |
| `about-us-meet-the-doctors`         | 20.9%          | 106                 |
| `dental-implants-littleton-co`      | 20.3%          | 599                 |
| `about-us-office-tour`              | 17.9%          | 258                 |
| `abscess`                           | 17.6%          | 91                  |
| `broken-fillings`                   | 17.0%          | 148                 |
| `dental-conditions`                 | 16.8%          | 261                 |
| `about-us-meet-the-team`            | 16.1%          | 88                  |
| `about-us-comfort-amenities`        | 13.6%          | 210                 |
| `blue-cross-blue-shield-dentist`    | 13.6%          | 183                 |
| `delta-dental-dentist`              | 13.6%          | 181                 |
| `about-us`                          | 13.5%          | 189                 |
| `cracked-tooth`                     | 13.5%          | 86                  |
| `about-us-patient-reviews`          | 12.5%          | 449                 |
| `ameritas-dentist`                  | 12.3%          | 218                 |
| `aetna-dentist`                     | 12.0%          | 170                 |
| `beam-dental-dentist`               | 11.9%          | 108                 |
| `careington-dentist`                | 11.3%          | 108                 |
| `dental-services`                   | 10.7%          | 566                 |
| `contact-us`                        | 10.1%          | 94                  |

Most of what remains is derived geometry — a section that is short because the
type above it wraps differently, an inset the emitter did not synthesize. The
refine loop corrects only properties the source states outright (typography,
colour, alignment) and reports the rest, on the principle that making a number
go green by pinning a height leaves the layout wrong.

### How the corrections are reconciled

A component's corrections live in one region inside that component, and 62 of
the 215 components are shared between pages. Applying corrections page by page
therefore let the last page written decide what every other page using that
component rendered — measured on one page, imposed on the rest. It looked like
an improvement (total findings fell) while 37 pages got visibly worse.

Corrections are now reconciled before anything is written: a declaration is
applied unless another page using the same component measured a _different_
value for it. On the sampled pages that moved mean pixel mismatch from 18.75%
to 14.30%. Eleven declarations are currently held back as genuine
disagreements — the honest fix for those is to stop sharing the component,
which is not yet automated.

### Added while migrating the full site

- `wpmig dev-refine-all` — measures every page against one build, reconciles and
  applies all corrections, rebuilds once, re-measures. Per-page refining rebuilt
  the site twice per page (roughly seven hours here); this is two builds total,
  with measurement running four pages at a time.
- `wpmig dev-relink` — re-applies link rewriting to output already on disk, so a
  change to the rewriter does not require re-capturing every page in a browser.
- A component registry, so a section name derived from content ("Schedule an
  Appointment", on forty pages) cannot silently overwrite another page's
  component. Same prop signature → shared; different → its own name.
- Legacy-link repair, session-token stripping from outbound URLs, and adoption
  of the source's own header call-to-action in place of the template's.

### Fixed after the full-site pass

- **Two sections of the same page could be given the same component name.** A
  name is unavailable if an earlier section of the same page took it, and
  separately if another page registered a different component under it — those
  two conditions were checked in sequence, so the registry walk could hand a
  section a name its own page had already used. Every sidebar sub-page on this
  site (14 of them, including all five under About Us) collapsed its banner and
  its sidebar into a single component: the sidebar navigation vanished from the
  rendered page while the banner rendered with the wrong props. All 14 pages
  were regenerated after the fix.
- **Embed URLs carried the capture server's address** as their `parentURL` /
  `origin` parameter, telling a booking form or review widget it was hosted on a
  laptop. Stripped at generation now.

## Hand-made changes that a regeneration would overwrite

`src/components/page-sections/wpmig/about-us-f/AboutUsF.astro` (the Office Tour
gallery) has been edited by hand. Re-running
`dev-page about-us-office-tour.html` would replace it and lose:

- **The two-per-row grid of uniform 3:2 tiles.** The source positions every tile
  absolutely from a masonry script, so the captured CSS is a set of frozen
  offsets (`bottom: 2323.7px`) valid at exactly one width — below 1440 the
  photos overlapped each other.
- **The photos as real `<img loading="lazy">` elements**, read from each tile's
  own href. Seven of the twenty-one tiles were still lazy-loading when the page
  was captured, so they had no background image to capture and arrived as empty
  boxes; the URL only ever existed on the anchor.
- **`data-lightbox` on the gallery** and a `<Lightbox />` at the end of the
  section.

The lightbox itself is an ordinary reusable component,
`building-blocks/core-elements/lightbox/Lightbox.astro`, and is not affected by
regeneration. It attaches to any container marked `data-lightbox`, treats each
descendant anchor pointing at an image file as a slide, and is a native
`<dialog>` opened with `showModal()` — the site chrome sits at `z-index: 9999`,
and the browser's top layer sidesteps that contest rather than trying to outbid
it. Keyboard: arrows to move, Escape to close. Without JavaScript the tiles stay
plain links to the full-size photos.
