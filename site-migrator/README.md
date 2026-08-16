# site-migrator

Migrates a static HTML/CSS/JS site onto a CloudCannon Astro component template.

Designed to be **copied into a site repo, run, then deleted**. Everything it
generates lives in the site's own `src/`, `public/` and config files; everything
it needs for itself lives inside this folder. Delete the folder and the migrated
site is unaffected.

## Use

```bash
# 1. Drop it into the repo you are migrating into.
tar -xzf site-migrator.tar.gz -C /path/to/site-repo/
cd /path/to/site-repo/site-migrator
npm install

# 2. Put the source site somewhere reachable. A local mirror is preferred —
#    it makes every stage deterministic and repeatable offline.
#    (a wget dump, a cPanel export, or the old repo's static files)
mkdir -p ../static && cp -R /path/to/old-site/* ../static/

# 3. Scaffold the two config files. `target.root` is detected automatically.
node bin/mig.mjs init --source "file:../static"

# 4. Check everything the pipeline needs is in place.
node bin/mig.mjs doctor

# 5. Run the pipeline.
node bin/mig.mjs mirror      # crawl + stamp every element with a stable id
node bin/mig.mjs detect      # fill in the chrome and section selectors
node bin/mig.mjs tokens      # palette, neutral ramp, fonts -> theme layer
node bin/mig.mjs behaviors   # carousel/accordion settings from the source JS
node bin/mig.mjs scan        # segment pages, cluster into visual patterns
node bin/mig.mjs chrome      # nav, logo, footer links, socials -> site data

# 6. Review .migration/scan/contact-sheet.html and write component-map.yml
#    (one line per cluster). Then:
node bin/mig.mjs content     # source content -> library components
                             # unmapped clusters get ranked suggestions
node bin/mig.mjs links       # rewrite legacy .html URLs
node bin/mig.mjs redirects   # public/_redirects for the old URLs

# 7. Build, then check the result against the source.
cd .. && npm run build && cd site-migrator
node bin/mig.mjs qa                    # every check below, against one page
node bin/mig.mjs qa --from about-us    # any other page

# 8. Remove the toolkit.
cd .. && rm -rf site-migrator
```

`--dry-run` on any command shows what would be written without writing it.

## What `qa` checks

Each pass exists because it catches something every earlier pass is blind to.
Ordered roughly by how coarse the fault is.

| Pass | Catches |
|---|---|
| chrome geometry | header/footer/logo/nav boxes, nav labels, overflow at five widths, starter demo content still in the chrome |
| form label accessibility | an icon-only trigger with no accessible name, or a checkbox-hack control (e.g. a mobile nav's open/close pair) with two `<label for>`s pointing at it |
| section heights | a section that came out the wrong size, keyed by the source's own id |
| section surfaces | paint the height check cannot see — a dropped border, a tint on the nearest ramp stop instead of the source hex, an added background image — plus heights for id-less sections, paired by position |
| heading typography | a heading that kept its text and place but took the template's size ramp, and the starter's `.color` accent span arriving on a heading the source paints all one colour |
| broken images | an `<img>` whose file never made it into `public/` |
| image scale | a photo drawn at a different size than the source drew it, flagged `upscaled` when it is stretched past the pixels the file actually has |
| carousel controls | arrows and pager dots still wearing the template's chrome — `mig behaviors` carries the slider's *options* across, never its furniture |
| content props | three faults visible in the frontmatter alone, checked across every page rather than just the one being compared |

The last one runs without a build and reports:

- **borrowed ids** — a cluster mapped onto a generic library component while a
  hand-ported component for that same source section already exists. The source's
  id came across as an `id` prop, the CSS scoped under it did not, and the section
  silently renders in the template's look. Fix in `component-map.yml`, then re-run
  `mig content`.
- **self-referencing backgrounds** — a section painted with one of the images it
  already displays, from `map-to-component` drawing the background and the content
  images out of the same pool.
- **scaffolding gaps** — a `page-sections/**` component referenced in content but
  missing its `.cloudcannon.inputs.yml` / `.cloudcannon.structure-value.yml`, or a
  prop shaped like an image path that the component's own `inputs.yml` does not
  declare `type: image` for. Both build and render fine; only the CMS editing
  experience is broken. See "Matching a bespoke page's sections" below.

## What it writes into the site

| Path | From |
|---|---|
| `src/styles/source/*.pcss` | `tokens` — extracted palette and retinted neutral ramp |
| `src/styles/style.pcss` | `tokens` — marked region importing the above |
| `src/styles/themes/_default.pcss` | `tokens` — marked region mapping semantic vars onto source colours |
| `src/layouts/BaseLayout.astro` | `tokens` — cascade layer order |
| `src/data/branding.json` | `tokens` — brand colours, fonts, font service links |
| `src/content/pages/*.md` | `content` — page frontmatter with `pageSections` |
| `public/assets/**` | `content` — images, at their original source paths |
| `src/data/mainNav.json` | `chrome` — logo and the full navigation tree |
| `src/data/footer.json` | `chrome` — footer and legal links |
| `src/data/siteInfo.json` | `chrome` — site name, socials, address, phone, hours |
| `src/styles/source/_chrome.pcss` | `chrome` — header/footer colours, type and backgrounds |
| `public/_redirects` | `redirects` |

Nothing else is touched. Marked regions (`/* mig:begin … */`) are the only edits
made to files the toolkit does not own outright.

## Re-running safely

Every generated file carries a provenance header recording the hash of what was
written. On a re-run:

- unchanged since generation → replaced
- edited by hand → three-way merged; a genuine conflict leaves your file alone
  and writes a proposal to `.migration/proposals/`
- `node bin/mig.mjs freeze src/components/navigation` → never regenerated again

`node bin/mig.mjs status` reports which files are generated, hand-edited, frozen
or conflicted.

One exception: `content` replaces existing pages by default, because a starter
template ships demo pages (`index.md`, `about-us.md`) under the same names the
migrated site needs. Pass `--keep-existing` to opt out.

## The two config files

**`migration.config.yml`** — all knowledge about the source site. Segmentation
rules, which classes are cosmetic noise, which stylesheets to port, how to
recognise buttons and embeds.

**`component-map.yml`** — one line per section cluster, mapping it to a component
in the template. Roughly ten lines for a typical site. Clusters come from
`scan`; review them in `.migration/scan/contact-sheet.html`.

A cluster can pick its component from a measured feature:

```yaml
clusters:
  interior-banner:
    variants:
      - when: { imageCount: ["1", "2", "3+"] }
        component: page-sections/heroes/hero-split
      - component: page-sections/heroes/hero-center
```

and can set props from measured features, for layouts the source alternates:

```yaml
  divider-block:
    component: page-sections/ctas/cta-split
    propOverrides:
      reverse: "$feature.imageSide == 'left'"
```

## Design notes

**Section identity is a stable id stamped into the raw HTML**, not a position or
a structural hash. Source sites routinely restructure their own DOM on load —
wrapping content in new elements, moving nodes, adding index-derived classes — so
anything positional misaligns the moment a later stage re-renders the page. Ids
ride along with moved nodes; sections the site's JavaScript *creates* are
anchored on their first stamped descendant.

**Clustering is deliberately coarse.** Identity is a role sequence (`IMG H2 P`)
plus a few measured layout features. Things that vary between instances of one
pattern — an extra paragraph, a longer list, an image on the other side — are
reported as *variance* and become component props rather than separate patterns.

**Site chrome is migrated as data, not as generated components.** A template
already models its header and footer as structured data it knows how to render,
so the navigation tree, logo, socials and contact details fill that model. A
generated nav component would express a three-level menu as several dozen flat
props and lose the CMS experience the template was built around.

**Section mapping is discovered, never assumed.** Every site arrives with its
own sections, so the toolkit ships no table of known patterns. Clusters are
named from the source's own ids and classes, and anything left unmapped is
ranked against what the target library can actually hold — by comparing the
props each component declares against the content the cluster contains. The
result is written to `.migration/suggested-component-map.yml` as a pasteable
fragment, including an explicit note wherever the best candidate cannot hold
some of the content.

**Nothing is silently dropped.** Content a component cannot hold is written to
`_migUnmapped` on the page. Embeds keep their URLs. Unmappable legacy links are
reported and left alone rather than guessed at.

**A prose list is prose.** `extract` claims a repeated run of siblings as
`items` and removes it from the body HTML, which is right when the component has
an array prop and wrong when it does not — the list then disappears from the
rendered page rather than merely losing its structure. So a list with nowhere to
go is written back into the body as Markdown, and only lands in `_migUnmapped`
when the component has no prose field either. Check `_migUnmapped` for `items`
after a content run regardless: it now means the component holds neither, which
is worth knowing.

## Matching the source's header and footer

`mig chrome` migrates the chrome as **data plus colour and type**. It does not
migrate its **architecture**, and it cannot: the template models a header and
footer it already knows how to render, and that arrangement is rarely the
source's. Expect to finish the job by hand, and expect `mig qa` to be the thing
that tells you whether you have.

The work is always the same shape:

1. **Measure the source, don't eyeball it.** Get real numbers for the header
   band height, the logo box, where the nav starts, and each footer column —
   then measure the migrated side with the same script. `mig qa` reports the
   deltas for the four roles it knows; anything finer is a few lines of
   Playwright. Screenshots alone will not tell you a column is 40px narrow.

2. **Rebuild the layout in `source-bridge`, never in the component.** The layer
   order puts `source-bridge` above `components` and `page-sections`, so a rule
   there beats the template's own without forking it. `flex`/`grid` `order` is
   usually enough to turn a stacked header into the source's single row. The
   one thing it cannot beat is an **unlayered** rule in a component's
   `<style>` block — check for those first, because no layer outranks them.

3. **Gate every fixed dimension behind a desktop media query.** The source's
   desktop chrome is fixed pixel columns. Ungated, they are wider than a phone
   and the whole document overflows. Below the source's own breakpoint the
   template's responsive chrome already works — leave it alone. `mig qa`
   measures `scrollWidth` against the viewport at 390/768/1024/1280/1440 and
   fails on any overflow.

4. **Check the nav's text, not just its box.** Where a dropdown's parent and
   its first child share an href, the extractor can take the child's label for
   the parent — "About Us" arrives as "What Sets Us Apart". Geometry matches
   perfectly while every menu is misnamed, so `mig qa` compares the top-level
   labels separately.

5. **Hunt the starter's demo content.** Chrome data files keep whatever the
   template shipped for any field the source had no equivalent for, so a
   placeholder street address or demo email can reach a live page looking like
   real practice details. `mig qa` fails on the markers listed in the preset's
   `demoContentMarkers`; add to that list whenever a new one gets through.

Two smaller things that recur:

- **A ported rule can be too broad.** `chrome` measures a role and emits a
  selector for it — `footer a { font-size: 18px }` is measured from the footer's
  body links but also hits the legal bar. When one region looks wrong, check
  whether a ported rule is reaching further than the element it was measured
  from.
- **Ported element rules can lose declarations.** `tokens` ports typography,
  not decoration; `main ul li:before { content: "\e832" }` came through with its
  font and colour but no `content`, so every list marker silently became a
  bullet. Compare a rendered element against the source, not the generated CSS.
- **The template's own nav chrome ships two broken-label patterns**, present
  before any migration touches it: an icon-only submenu trigger
  (`<label role="button">` wrapping only an `aria-hidden` icon, no
  `aria-label`), and the mobile nav's open/close pair both `<label for>`-ed to
  the same hidden checkbox. Neither fails a build or looks wrong on screen, so
  `mig qa`'s form label accessibility pass checks for both on every migrated
  site rather than relying on someone opening a screen reader. Fix the first by
  adding `aria-label`; fix the second by dropping `for` from all but one label
  (checking first whether JS already handles the click via `preventDefault`)
  and giving the rest `role="button"` plus their own `aria-label`.

## Matching a bespoke page's sections

`scan`/`content` map **repeated** section patterns onto template components, and
that is the right trade for interior pages, where the same "image + heading +
paragraph" shape recurs across a dozen of them. A homepage is the opposite case:
every section is one-off — a full-bleed banner, a two-doctor split, an
alternating services block, a review carousel — and clustering flattens them all
onto whichever generic component fits least badly. The page still builds. Its
layout is simply gone.

For those pages, port the source's own markup instead:

1. **One new component per section**, in its own directory under
   `page-sections/homepage-blocks/` — not `page-sections/homepage/`. The
   `-blocks` suffix is the template's own naming convention for one-off
   library sections (see the pre-existing `index-banner`, `index-reviews`,
   etc. in that same directory); a plain `homepage/` reads as a page-specific
   dumping ground and doesn't match anything else in the library. Keep the
   source's ids and class names verbatim — `<section id="banner">`,
   `.container`, `.card`, `.block-1`. The point is not fidelity for its own
   sake: it is that the source's CSS then applies unchanged instead of
   needing translation.
2. **That section's CSS goes in that component's own `<style>` block**, ported
   by selector out of the source stylesheets, `rem`→`px` converted.
3. **Props carry content, not layout.** Heading, image, items — the markup
   structure is fixed to match the source; only the data in it is editable.
4. **Every component needs the same CloudCannon scaffolding trio as the rest
   of the library**: `<kebab-name>.cloudcannon.inputs.yml`,
   `.cloudcannon.structure-value.yml`, and `.cloudcannon.snippets.yml`,
   alongside the `.astro` file. Skip them and the component still renders —
   the page builds fine — but it silently can't be added from the visual
   editor's section picker (`pageSections`'s "Add Component" list is built by
   globbing every `*.cloudcannon.structure-value.yml` under
   `page-sections/**`, per `.cloudcannon/structures/pageSections.cloudcannon.structures.yml`),
   and every prop on it falls back to CloudCannon's auto-detected input type
   instead of the one it should have. `.cloudcannon/scripts/new-component.js`
   is the generator for this trio; adapt its output rather than writing from
   scratch, since these bespoke components have fixed markup and no
   `backgroundColor`/`backgroundImage` props to carry over from its
   `CustomSection`-based template.
5. **Any prop that holds an image path must be declared `type: image`** in
   the `.cloudcannon.inputs.yml`, with the same
   `paths: { uploads: src/assets/images, static: "" }` options every other
   image input in the library uses. Left untyped, CloudCannon infers a plain
   text box for it from the string value in `structure-value.yml`, which
   still renders correctly but loses the image picker/upload UI — easy to
   miss because nothing in `qa` or the build catches a field simply being the
   wrong *input* type.

Then measure, because every fault this creates is silent. `mig qa` compares the
height of each section on a page, paired by the id both sides share, and reports
any section it cannot find on the migrated page at all — which is what a
flattened bespoke section looks like. Heights are per-section and independent;
vertical offsets are not, so a single 24px error reads as every section below it
being wrong. That is why the table reports height and not position.

### What a CSS port loses

These recur often enough to check for directly. All of them build and render;
each one leaves a section the wrong size.

- **Media-query wrappers get flattened.** The source's `@media (max-width:
  1000px)` overrides ported as top-level rules, so the *mobile* banner layout
  applied at every width and the desktop overlay never appeared. Confirm each
  ported block still sits inside the media query it came from.
- **Attribute selectors are missed.** The source styled its buttons with
  `[class^="btn"]`; ported as `.btn` it arrived without the rule's `min-width`
  and its `/1` line-height, so every pill shrink-wrapped its label.
- **Global resets do not come across.** A source-wide `img { display: block;
  margin: 0 auto }` or a reset that zeroes heading margins is invisible in any
  one section's rules, but every section depends on it. Restate it scoped to the
  component that needs it rather than site-wide, where it re-centres every image
  in the template.
- **Shared display classes are used but never defined.** The source's `.h1`,
  `.h2`, `.h1-small` are declared once, globally, and referenced by every
  section. Ported section-by-section they are referenced everywhere and defined
  nowhere, so each one silently falls back to the tag's own size — an eyebrow
  renders as a second headline. These belong in `source-bridge`.
- **Plugin stylesheets are not ported.** `behaviors` reads a carousel's
  *settings*; nothing brings across the library's theme CSS. Re-implementing the
  behaviour in vanilla JS leaves the arrows as bare glyphs and the dots as list
  bullets until that CSS is ported too.
- **The template's own defaults leak in.** A starter's
  `:where(:root) h1..h6 { margin: 0.8em 0 0.5em }` and its own `.card` margin
  both apply to ported markup that shares those tags and class names, and the
  source has no equivalent. Zero-specificity `:where()` rules are cheap to
  neutralise; a same-named component class needs the reset stated explicitly.
- **Tailwind claims class names you never wrote.** A source class shaped
  `word-<number>` can match a dynamic utility: `.block-1` became
  `block-size: 4px`. Generated utilities are unlayered, so no `@layer` outranks
  them — only specificity does. Scope with the section's id.
- **Headings keep their text and lose their type.** This is the one that has got
  through most often, because it is the only item here that does *not* leave the
  section the wrong size: a one-line heading rendered at 70px Inter instead of
  46px uppercase serif still fits inside the geometry tolerance. `map-to-component`
  hands the string to the template's `Heading`, which brings its own size ramp
  and its own `margin-top`, and the starter's structure default wraps a word in
  a `.color` span the source never had — so a phrase the source paints one
  colour ships with its last word in the brand colour. `mig qa` now compares
  computed type for every heading it can pair by text, and flags a highlight the
  source does not have. Fix the type in `source-bridge`; fix the highlight in the
  content **and** in the component's `.cloudcannon.structure-value.yml`, or every
  new instance re-adds it.
- **Everything on the rule that gave up a `backgroundColor` survives except the
  background.** `map-to-component` reads a source section's rule for the props it
  knows and drops the rest of that rule on the floor. The source's
  `.block:nth-of-type(even) { background-color: #f2f2f2; border: 1px solid #000 }`
  arrived as `backgroundColor: surface` with no outline, on every service page.
  A 1px border is a 2px height change, so no geometry tolerance will ever catch
  it. Same blindness for `box-shadow`, `border-radius` and `outline`. Restate the
  decoration in the component keyed off the class the prop renders —
  `.cta-split.bg-surface { border: 1px solid #000 }` — so it follows the prop
  instead of being pinned to one page.
- **The tint itself lands on the nearest ramp stop.** `#f2f2f2` became
  `--color-bg-surface`, which the derived ramp puts at `#eaeaea`. Eight points of
  grey, no geometry change, every tinted section on the site. Decide once whether
  the shared ramp should carry the source's hex.
- **A `<figure>` built for a photo stretches an icon.** The template's `Image`
  component is sized for responsive photography — a card-width image with `width:
  100%`. Point it at a source icon with its own small intrinsic size (a 45×74
  `.svg`) and one of them, by chance of aspect ratio, balloons to fill the card;
  the rest just look tiny where they aren't cropped. The source never scales
  these at all — no `width`/`height` rule anywhere, the browser renders each SVG
  at the size its own attributes say. Match that: no `width: 100%` on an icon
  figure, `height: auto; max-width: 100%` only as a safety net.
- **A source-wide list marker (`main ul li:before`, a fontello glyph) never
  matches an array field's items.** CloudCannon's array-editing markup wraps
  each item in `<editable-array-item>`, not `<li>` — the same class of gap as
  the scope-class note above, different selector. `main ul li` is invisible to
  it and the list silently loses its marker. Restate the marker scoped to the
  array item tag, the same way the scope-class fix restates a bare selector
  per component.
- **Asset copying only runs once, content keeps changing after.**
  `collectContentAssets` (invoked by `mig content`) copies every image the
  content it is handed references — it is not buggy, it is just a one-shot
  step. A page's content regenerated, or hand-corrected, after that run keeps
  the new `imageSource` path in the markdown, but nothing re-triggers the copy,
  so the build succeeds and ships a silently broken `<img>`. No other pass
  catches this — a broken image still occupies its box, so geometry, surfaces
  and heading checks all read clean. `mig qa` now loads the live page and
  flags any `<img>` whose file never arrived; fix it by re-running `mig
  content` (safe — it's idempotent) or copying the file from the source mirror
  by hand.

`mig qa` now compares both of those directly: it reads each section's computed
background, border, radius and shadow on the two sides and diffs them. That pass
pairs sections by **document order**, not by id, because the sections it is for
usually have none — the source's `div.why` and `.page-divider > .block` carry a
class and nothing else, and the id-keyed height pass skips them silently. The
same positional pairing gives them a height check too, which is what caught
`div.why` rendering at 347px against the source's 204px after being mapped onto
the template's generic heading-plus-list component.

When a section is the wrong height and the CSS looks right, read the element's
**matched rules** in the browser rather than the stylesheet — `CSS.getMatchedStylesForNode`
over CDP, or devtools by hand. Every item above was found that way; none of them
is visible in the CSS you ported.

## Requirements

Node ≥ 22. `npm install` fetches a Chromium build for the measurement passes.

## Visual fidelity: what actually goes wrong

The pipeline reliably gets *content* onto the page. Getting it to **look like the
source** is where the time goes, and every failure so far has come from one of a
short list of causes. Check these before hand-tuning anything, and run
`tools/compare.mjs` rather than judging by eye — every item below was originally
missed by eyeballing screenshots and only found once the two renders were put
side by side with their computed styles printed underneath.

```bash
node tools/compare.mjs                  # homepage, every section
node tools/compare.mjs our-office       # one page
node tools/compare.mjs index --section 3
node tools/compare.mjs index --styles-only
```

It pairs source and built sections by index and reports height/image-count
mismatches plus a computed-style diff over the properties that have actually
gone wrong. Side-by-side PNGs land in `.migration/compare/`.

### The toolkit re-skins; it does not port a design

`mig chrome` migrates the header and footer as **data** into the template's own
components, and `mig content` maps sections onto components that have their own
designs. Neither reproduces the source's layout, and the generated
`_chrome.pcss` says as much in its header. The `synthesize` config that would
have generated components from source markup **is declared in the schema and
never read by any code** — like `noise.ids` and `noise.attributes`, it is dead.

So if the brief is "make it look like the original", budget for building
components by hand. Everything below is about making those components correct
the first time.

### Failure modes, in the order they bit

1. **A global rule matches your component's class.** Astro scopes a component's
   own styles, but the template's global CSS still matches its elements. A
   `.panel` wrapper rendered with `display: none` because the starter defines
   `.panel { display: none }`. **Prefix every class** (`fb-panel`, `cg-media`).
2. **Layered CSS loses to unlayered CSS.** Rules in `@layer source-bridge` are
   beaten by any component `<style>` block, which is unlayered. Affiliation
   sizing silently did nothing for two rounds. **Anything targeting a
   component's internals belongs in that component**, not the bridge.
3. **Local overrides fight the shared rule.** Three components carried their own
   button colour and radius, so a site-wide button change skipped them. Keep
   colour and shape in one place; let components set typography only.
4. **Overlays are layered the other way round.** The source puts its wood
   texture *on the overlay* (`background-image` + colour + `opacity: .15` +
   `mix-blend-mode: lighten`) above a solid section. Reading `background-image`
   off the section returns `none` and invites you to put the texture underneath,
   which renders far too light. **Walk descendants for backgrounds**, not just
   the section.
5. **Sampling one element and generalising.** Header buttons are 50px pills;
   every body and footer button is square. Measuring one and applying it
   everywhere inverted the whole site's buttons. **Sample per context.**
6. **Eyebrows are heading widgets.** The source builds kickers out of heading
   widgets, so "the first heading" is often the kicker (Open Sans 18px italic,
   0.5px tracking) and the real title is the second. Naive pairing reports a
   permanent italic/tracking mismatch that is not real.
7. **Carousels report every slide, and they rotate.** An image carousel clones
   slides, so the DOM holds 17 where the design shows 5. Read `slides_to_show`
   and `autoplay_speed` from `data-settings` — and note that the extra logos
   are not decoration to be trimmed away, they rotate through. Building a
   static row of the visible count silently drops the rest of the set.
8. **Global list markers.** `main ul li:before` injects a Fontello glyph whose
   font is never loaded, so every ported list renders a tofu box with a 50px
   indent. The starter ships `ul.no-check` as the escape hatch.
9. **Section padding is much larger than it looks.** The source runs 100–150px
   of vertical padding; defaulting to a comfortable `4.5rem` made every built
   section shorter than its counterpart. Compare heights, not just styles.
10. **Fonts declared but never served.** `mig tokens` records `font-service`
    stylesheets in `branding.json`, but nothing copies the files. A self-hosted
    source ships four brand faces that all 404 — see `tools/port-fonts.mjs`.

### A working order for a new component

1. `tools/compare.mjs <page> --section N` — read the source's real numbers.
2. Build it with prefixed classes, and props for text, images, links and colours.
3. Rebuild, re-run the same command, and drive the diff to empty.
4. Only then move on. A section left "close enough" is a fix request later.
