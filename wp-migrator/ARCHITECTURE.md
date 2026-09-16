# wp-migrator — architecture: current state and proposed change

Goal restated: **reconstruct the rendered WordPress site in Astro as accurately as
possible**, with the rendered original as the authority. Visual fidelity outranks
component reuse.

---

## Part 1 — What the tool does today

### 1.1 How it obtains the WordPress HTML

`src/snapshot/index.mjs` (CLI: `wpmig dev-snapshot <url>`).

Plain `fetch`, **not a browser**. Page discovery cascades:
`/wp-sitemap.xml` → `/sitemap_index.xml` → `/sitemap.xml` → `/page-sitemap.xml`
→ WP REST API (`/wp-json/wp/v2/pages|posts`) → same-origin link crawl.

Each page is written flat as `<slug>.html`, with URLs rewritten root-relative and
internal links pointed at sibling flat filenames. Same-origin `/wp-content` and
`/wp-includes` assets are mirrored recursively, including assets referenced from
inside CSS (`url()`, `@import`), with a `.snapshot-manifest.json` of sha/size for
incremental re-fetch.

Fetching pre-JS bytes is deliberate: every later stage renders them in a real
browser, and saving post-JS `outerHTML` would run a builder's frontend script
twice against an already-mutated DOM.

**Fidelity gap (this is causing a real defect):** only _same-origin_ assets are
mirrored. This page loads Font Awesome **Pro** from
`kit.fontawesome.com/afa87b2d0b.js`. That is never mirrored, so a local render is
missing glyphs the live site has — which is exactly why the "Common Issues" and
"Feel Your Very Best" icons came out empty.

### 1.2 How it obtains CSS

Two independent paths, and the distinction matters:

- **Site-wide tokens** — `src/extract/stylesheets.mjs` reads
  `<link rel="stylesheet">` hrefs _from the rendered DOM_ (so cascade order is
  observed, not hand-maintained), then `src/css/parse.mjs loadStylesheets` reads
  them off the snapshot and parses with postcss, normalizing `rem`→`px`. Feeds
  the palette/ramp/font pipeline.
- **Component CSS** — does **not** come from stylesheets at all. It is
  reconstructed from **computed styles** (§1.5). This was a deliberate decision
  earlier in the project and is the right foundation for this brief.

### 1.3 Does it use a real browser?

Yes — Playwright, in `bin/wpmig.mjs` and `src/extract/index.mjs`.

**But it renders the local snapshot**, served by `src/mirror/serve.mjs`, not the
live site. Combined with §1.1 that means the render the tool measures can differ
from the real site wherever an external resource is involved.

### 1.4 Does it capture screenshots?

**No.** There is no screenshot code in the tool. Every screenshot in this project
so far came from throwaway diagnostic scripts I wrote inline, or from the
predecessor `site-migrator/tools/compare.mjs`. `capture/screenshot.mjs` and
`qa/compare.mjs` were in the original plan and were never built.

### 1.5 Does it extract computed styles?

Yes, and this part is genuinely strong. `src/capture/section.mjs`:

- `BUILD_TREE` — sanitizes to a semantic template tree, collapsing pass-through
  wrapper chains by _geometry_ (not class names), stamping every retained node
  with `data-wpmig-n` so it stays addressable across viewport changes.
- `READ_STYLES` — for every retained node, an ~60-property allowlist
  (`src/capture/allowlist.mjs`) **plus bounding box** (`x/y/w/h`) **plus
  visibility**, at each breakpoint.
- `::before` / `::after` captured wherever `content !== none` (overlays, glyphs).
- `:hover` captured via CDP `CSS.forcePseudoState` across the subtree.
- UA defaults read from a pristine iframe, so emission can diff against them.

Covers essentially all of the brief's §2 list. The allowlist is missing a few
named items (`minWidth`, `gridTemplateRows`, `objectPosition` variants) — trivial
to add.

### 1.6 How it identifies sections/components

`src/detect/segment.mjs` — geometry only, builder-agnostic: exclude chrome by
landmark/overlay, burrow to the fan-out point, score children by full-width
paint / background change / vertical rhythm, expand compound "single template"
wrappers via a height-plausibility gate, fold sub-threshold fragments.
`src/detect/repeats.mjs` finds repeated items (arrays), including layout-column
flattening.

**Important: the brief's §4 is already satisfied.** The tool emits **one bespoke
component per detected section**, named from its own content
(`we-can-fix-these`, `full-mouth-rehabilitation-procedures`), with its own scoped
CSS. There is no mapping onto generic `Hero`/`CardGrid`/`CTA` abstractions —
that was the _predecessor's_ approach, and abandoning it is why this tool exists.
No change needed here.

### 1.7 How it handles responsive styles

Captures at `390,768,1280` and emits **mobile-base + `min-width` overrides**
(`src/generate/css-emit.mjs`).

Two problems:

- **1440 is not captured.** The brief requires it.
- **The mobile-first diff is fragile.** A property present in the base but absent
  at a wider width was previously left alone, so mobile values leaked upward
  (centered text, icons stacking above labels instead of beside). I fixed that
  in `diffDecls` this session by resetting from the wider breakpoint's raw
  computed value — but the underlying strategy is still "one base plus diffs",
  which is inference. Capturing 4 widths and emitting each explicitly is more
  faithful and less clever.

### 1.8 Any visual comparison or validation?

**None deterministically catch the human-obvious layout difference.** This was
the single biggest gap: a page is declared done when it compiles and the content
looks right — precisely the failure mode the brief calls out. The deterministic
gates that grew since (`pixelmatch`, `dev-verify` text pairing, `dev-audit`
structure) measure _deltas_ between paired elements, and pair only
what already exists on both sides; they cannot phrase a difference a person names
at a glance — "the paragraph runs full-width where the source constrains it,"
"the button is an outline where the source is filled," "the rule is full-width
where the source centres a short one."

**`dev-visual-check`** (`bin/visual-check.mjs`, `src/qa/visual-check.mjs`) closes
that last part, deliberately outside the deterministic contract. It full-page
screenshots the JS-rendered source mirror and the built page and asks a Claude
vision model to name the visible content differences. It is the tool's one
**online, non-deterministic** step, so it is strictly **advisory and opt-in**:
gated behind an explicit command and `ANTHROPIC_API_KEY`, scoped to named
`--pages` to bound cost, report-only (findings are suggestions to a person, never
auto-applied), and it complements — never replaces — the deterministic gates, so
the default pipeline stays offline and reproducible. Findings follow the same
"surface the unresolved thing, don't guess" philosophy as the rest of QA. A
future refinement, noted but not built, is a chrome-free per-section mode reusing
`dev-compare`'s existing source/built section shots keyed by the IR nodeMap.

### 1.10 Chrome — extracted, never compared _(closed)_

`src/chrome/extract.mjs` read the header and footer as **data** and stopped
there. That decision is still right (see the module's own note: filling the
template's model is what keeps the chrome editable), but only half of it was
built. Nothing measured how the source _presented_ that chrome, so the header
and footer — the one region that renders on every page of the site — were the
one region that never had to look like the original, and had no way to be
checked against it.

Four things closed it:

- **`src/chrome/styles.mjs`** measures the chrome by _role_ — band, logo, menu
  link, dropdown panel, call-to-action, footer heading, rule, copyright strip —
  across breakpoints. Roles rather than a discovered tree, because chrome is
  the one region of a site whose parts are known in advance; that is what lets
  a template rendering its own markup still be styled from the measurements.
  Dropdown panels are forced visible for the read, since a hidden element has
  no box and no resolved colours.
- **`src/chrome/css-emit.mjs`** writes those measurements as a `--chrome-*`
  custom-property layer. Properties rather than rules: the target's chrome DOM
  is not the source's, so emitting selectors would emit them for a DOM that
  does not exist here. The component decides which of its own parts each
  measurement applies to, and anything the source lacked never gets a token, so
  the component keeps its own default.
- **`src/chrome/compare.mjs`** scores the built chrome against the source. Page
  sections pair by generated class name; chrome has none, and the role table is
  the missing identity — the same per-element numeric diff, on both sides.
- **`src/chrome/audit.mjs`** and **`phones.mjs`** cover the two failures that
  are invisible to any visual check: starter placeholders the source never
  contradicted (an `info@dentalstudio.com` shipping as a real practice's
  address), and call-tracking scripts, which rewrite every `tel:` link at
  runtime with a rented number that differs on each page load. Three
  consecutive captures of the reference site produced three different numbers,
  none of them in the site's own markup. The snapshot is fetched pre-JS by
  design, so the markup still holds the real number and wins.

Driven by `wpmig dev-chrome [--compare]`. It is a pass of its own rather than
more of `dev-extract` because chrome changes for its own reasons, and
re-deriving a palette from a site that has not changed colour to pick up a menu
edit is waste.

### 1.9 Where the missing capabilities belong

| Capability                  | Where                                                                          |
| --------------------------- | ------------------------------------------------------------------------------ |
| Multi-viewport screenshots  | new `src/capture/screenshot.mjs`                                               |
| Persisted IR                | new `src/ir/` + write from the capture stage                                   |
| Built-page measurement      | reuse `READ_STYLES` against the Astro render                                   |
| Diffing                     | new `src/qa/compare.mjs`                                                       |
| Correction loop             | new `src/refine/` + a CSS override layer                                       |
| Live/external-asset capture | `src/snapshot/index.mjs` + `src/mirror/serve.mjs`                              |
| Orchestration               | new `bin/migrate.mjs` (`wpmig migrate <page>`)                                 |
| Chrome styling + comparison | `src/chrome/{styles,css-emit,compare,audit,phones}.mjs` — **built**, see §1.10 |

---

## Part 2 — Proposed change (smallest that satisfies the brief)

Nothing in capture / detect / generate gets rewritten. They work and are
validated. Four things get **added**, one gets **fixed**.

### The load-bearing insight

The captured tree already stamps every retained node with a stable marker, and
`src/generate/*` already emits **deterministic class names** per node
(`.wcft-heading`, `.wcft-grid`). So the same logical element is addressable on
**both** sides. That means the comparison can be **numeric and per-element**, not
just a pixel blob:

> `.wcft-heading` — source `x=596 y=1204 w=412 h=48 fontSize=22px`
> built `x=578 y=1170 w=412 h=64 fontSize=30px`
> → 18px left, 34px high, 16px too tall, font-size +8px

That is the brief's §8 output, and it falls out of data the tool already has.
Pixel diffing (`pixelmatch`) then serves as the overall gate and the visual
artifact, not as the diagnostic.

### Change 1 — Persist the IR (`src/ir/`)

Today `captureSection`'s output is used once, in memory, and discarded. Persist
it as the contract between stages:

```
.wpmig/ir/<page>/
  page.json                 # section order, boundaries, ids
  sections/<id>.json        # tree + per-breakpoint styles/geometry + assets + repeats
  shots/<id>@{1440,768,390}.png
```

`<id>` is content-derived and stable, so re-runs are diffable. This is the
enabler for everything else: without it the loop has nothing to iterate on.

### Change 2 — Screenshots (`src/capture/screenshot.mjs`)

Breakpoints become `1440,768,390` (adds 1440; keeps 768/390). Per page and per
section, full-height, after `scrollThrough`/`revealAnimated`/`stopMotion` (all
already in `src/browser/load.mjs`). Used for both source and built renders, so
the same module serves both sides.

### Change 3 — Compare (`src/qa/compare.mjs`)

Given a page id: serve the source snapshot and the built `dist/`, render both at
each breakpoint, and produce:

- per-element geometry/typography deltas (the table above), ranked by severity
- `pixelmatch` score per section per breakpoint
- side-by-side + difference images
- `.wpmig/compare/<page>/report.json` — the machine-readable feedback

Pairing is by generated class name on the built side and marker on the source
side. Where a source node has no counterpart it is reported as _missing_, which
is what would have caught the dropped `step-7`/`section-15` components
immediately rather than three turns later.

### Change 4 — Refine loop (`src/refine/`)

Reads `report.json`, applies corrections, re-renders, repeats until deltas are
under threshold or no further improvement.

**Corrections land in a separate override layer**, not by rewriting the generated
CSS: `<component>.corrections.css`, imported after the scoped block, owned
exclusively by the refine stage. Rationale:

- `generate` stays deterministic and idempotent
- the loop is re-runnable without compounding edits
- corrections are reviewable in isolation — you can see exactly what the loop
  changed and why
- it composes with the existing `Writer` provenance/3-way-merge model instead of
  fighting it

Start with mechanical, high-confidence corrections (explicit geometry: width /
max-width / margin / padding / gap / font-size / line-height / position offsets /
alignment), each traceable to a measured delta. Anything the loop can't resolve
mechanically is left in the report as an explicit unresolved finding rather than
guessed at.

### Change 5 — Fix acquisition fidelity

Two options; I'd do (a) first since it is small and removes a whole class of
defect:

- **(a) Mirror external subresources.** During snapshot, also fetch cross-origin
  CSS/JS/font/image referenced by pages (FA kits, Google Fonts) and rewrite to
  local paths. Removes the missing-icon failure and makes the local render
  self-contained and reproducible offline.
- **(b) Allow capture against the live URL** (`--source live`) for cases where a
  builder's runtime behavior can't be mirrored, accepting network dependence.

### Orchestration

```
wpmig migrate <page> [--max-iterations 5] [--threshold 2%]
```

```
snapshot ─▶ capture ──▶ IR + source shots
                              │
                              ▼
                          generate ──▶ components + page
                              │
                              ▼
                        build + render ──▶ built shots
                              │
                              ▼
                        compare ──▶ report.json
                              │
                    ┌─────────┴── deltas over threshold?
                    ▼                          │
                 refine ──▶ corrections.css ───┘
                                     │
                                     ▼
                              accept + report
```

### What does _not_ change

`capture/section.mjs`, `detect/*`, `generate/*`, `css/*`, `chrome/*`, `fs/*`
keep their current responsibilities. `css-emit` gains explicit per-breakpoint
emission (Change 2) instead of base+diff inference; everything else is additive.

### Acceptance

A page is complete when, at 1440/768/390, every section is under the pixel
threshold **and** no unresolved geometry/typography delta exceeds tolerance —
demonstrated by `report.json` and the diff images, not by "it compiles".

---

## Part 3 — Reuse is decided at the wrong granularity _(open)_

§1.6 records that the tool emits one bespoke component per detected section and
calls it settled. That is right for whole sections, and it is blind to the case
below.

The dental service pages each segment into a single section spanning the whole
main column: a sidebar menu, a grid of service cards, then several paragraphs
of page-specific prose. `dev-page`'s reuse registry hashes the _entire_ emitted
component, so `general-dentistry-b`, `restorative-dentistry-b` and
`we-offer-several-options` never matched — the prose below the cards differs on
every page. Each got its own copy of the card grid under its own class prefix
(`gdb-`, `rdb-`, `woso-`).

That copy is invisible until someone edits it. Adding a hover state and card
links to the general dentistry cards left the restorative and cosmetic pages
untouched, and nothing in the pipeline said so.

**The reusable unit is a sub-tree, not a section.** The repeat blocks the tool
already emits (`{list.map(…)}`) are the natural candidates: self-contained,
and separated from their duplicates only by class prefix and list name — both
of which the migrator derives mechanically.

`src/generate/partials.mjs` finds them. `wpmig dev-partials` reports every
repeat-block shape appearing in more than one component, with the count of
classes whose CSS rules are safe to move (`ownedClasses` — a class the
surrounding section reaches through a descendant selector is not safe, and its
rules stay put). `--check` fails a build on new duplicates.

Detection is wired up; **extraction is still manual**. Rewriting a component
means moving rules across four breakpoints and the `wpmig:corrections` region,
and that diff wants a human. The three service-card components were
consolidated by hand into
`page-sections/shared-blocks/service-card-grid/ServiceCardGrid.astro`; running
`dev-partials` today reports the two shapes that remain (a link-list item in 4
components, a rich-text item in 6).

The deeper fix, if this recurs: have `detect/segment.mjs` cut these pages at the
card grid instead of swallowing it into the column, so whole-section hashing
sees the shared widget on its own. That trades a faithful single section for
three that compose — worth doing only if sub-section reuse keeps costing more
than the segmentation churn.

---

## Part 4 — The comparison pairs the wrong nodes _(fixed; segmentation still open)_

§1.8 called the absence of visual validation the biggest gap. A comparison was
built since, and it had a defect worse than having none: it reported confident,
precise findings about the wrong elements.

`bin/compare.mjs` pairs a built element with its source counterpart through
`data-wpmig-n`, the index `BUILD_TREE` stamps while walking the DOM. That index
is _positional_, and it has to bridge two DOMs that are not the same shape —
`BUILD_TREE` collapses pass-through wrappers by geometry, and the Astro rebuild
has a different set of wrappers than WordPress emitted. Wherever the two sides
collapsed a different number of them, every index past that point shifted, and
each built node was compared against its neighbour's source.

`refine/index.mjs` then copied that neighbour's typography in good faith. The
damage was site-wide and consistent: headings flattened to `Roboto 16px`, the
paragraph after them inflated to `Montserrat 32px`, and a section's background
painted onto the element above it. 55 pages carried it — `<h2>Schedule an
Appointment</h2>` at body size on the restorative page, the call-us band's blue
on the paragraph above the band on eight condition pages.

**Text is the stable key.** A heading says the same words in both DOMs however
its wrappers collapsed. `src/qa/pair-by-text.mjs` pairs on normalized text, and
finds the true counterpart or honestly finds nothing.

- `wpmig dev-verify` reports every typography disagreement between a built page
  and its source, per element, with `--severe-only` for the heading/body swaps.
- `wpmig dev-refix` re-derives the corrections from the same source
  measurements with pairing that holds, and rewrites each component's
  `wpmig:corrections` region. A class seen on several pages is corrected only
  where those pages agree; disagreements are reported, never averaged. It
  writes into a breakpoint when the generated CSS already sets that property
  there, because a base-level correction loses to `@media (min-width: 1440px)`
  — the width the measurements are taken at.

Severe findings went from 189 to 41 across 205 pages.

### What is left

- **Rich text has no per-element classes.** Corrections attach to a class, and
  the `<li>` and `<p>` inside a `set:html` blob have none. Two pages
  (`covid19-coronavirus-office-policy`, `swollen-or-bleeding-gums`) still
  disagree for this reason. The fix is a descendant rule on the container,
  emitted only when several children disagree identically.
- **Five components share a class prefix.** `call-us-today-to` and its four
  siblings all emit `cutt-`. Astro's scoping keeps them apart at render time,
  but every tool that reasons about classes — the corrections state, `dev-refix`,
  `dev-partials` — sees one class with conflicting measurements and backs off.
  `nameFromShape`/`nameFromContent` disambiguate the _component_ name and then
  derive the prefix from initials, which re-collides. The prefix should be
  derived from the final name, not the words.
- **Measurement is 1440-only.** `dev-verify` and `dev-refix` load one viewport.
  The mobile and tablet emissions are unverified.

---

## Part 5 — Two gaps surfaced while fixing the payment pages _(open)_

### 5.1 Different-role sections collapse into one component

`payment-options-e` renders two headings and a background image. On
`flexible-payment-options` that is correct — it is the page's blue banner. On
`alphaeon-credit` the _same_ component was placed as the main content section,
and every content prop the page carried (the sidebar links, two body
paragraphs, the contact CTA) was dropped on the floor: the component has no
slots for them. The page rendered two headings floating over the banner
texture and nothing else.

This is Part 3's defect from the other direction. There, one widget was copied
into many components; here, two different sections were fused into one because
their top-level shape — a container with a couple of headings — hashed alike.
Whole-section structural hashing cannot tell a banner from a content column
that merely opens with headings.

Fixed for this page by repointing it at `payment-options-g`, whose slots match
its content exactly (it is the content component the sibling flexible page
already uses). The general fix is the same as Part 3's: the reuse key needs to
consider a section's _role_, not only its element skeleton — a section that owns
the page's body prose is not interchangeable with one that owns a banner, even
when both start with an `<h1>`.

**`dev-verify` cannot catch this.** It pairs elements by text and compares
their styles; content the build never emitted has no built element to pair, so
it produces no finding. Missing whole sections are invisible to a comparison
that only measures what rendered. Detecting them needs the inverse check —
source text with no built counterpart — which is a worthwhile addition.

### 5.2 Baked-in raw tables lose all styling

The two pricing tables on the payment pages are emitted as raw HTML strings
(`raw0`/`raw1`) rendered through `set:html`, with no class on any `th`/`tr`/`td`.
The component CSS is reconstructed from computed styles keyed on the migrator's
class stamps (§1.5), and these elements carry none, so none of their styling
survived: the comparison table's blue header row and striped body, the pricing
table's grey header, the cell borders and padding — all gone, leaving the
browser's bare table defaults plus a stray global grey.

Reconstructed by hand here (measured off the WP original, scoped with
`:global()` so the selectors reach into the `set:html` subtree). The migrator
should either stamp classes onto raw-table internals before emit, or capture
table styling as a recognised sub-shape the way it does repeat grids.

---

## Part 6 — Generalizing the page-as-component families _(largely done)_

§1.6 emitted one component per detected section; Parts 3 and 5.1 showed the cost
when the _same_ page shape recurs. The interior pages were the worst case: 35
components across general-dentistry (b–l), cosmetic, restorative, sedation,
new-patients, about-us and payment-options, each a whole page baked into one
file, all the same skeleton — side menu, main heading, a run of
subheading/prose blocks, and a closing contact CTA — wearing different words.

These are now one component, `shared-blocks/interior-content`, driven by a typed
`blocks` array (prose / image / cards / table / cta) so a page carries any
number of sections in any order. Migration was mechanical: `partials.mjs`-style
markup parsing derived each component's prop→slot mapping (`slotparse` in the
migration scratch), and each page's flat props (`heading`, `text`, `heading2`,
`text2`, `secondaryButtonText9`…) were folded into blocks. The model learns
roles from level, not position: the main heading is the leading `<h2>`, the CTA
heading is the trailing `<h2>` before the buttons, and everything between is
prose at its own level — the rule that stopped a review name (`<h4>`) from being
promoted to a page title.

~32 components collapsed into `interior-content`; five banner variants
(`<h3>`+`<h1>` over a texture) folded into the existing `page-banner`. Every
migrated page was diffed against its source with `dev-verify`; the fixes that
surfaced are now permanent parts of the component (headings render `set:html`
so `&amp;` and `<br>` survive; the `Call Us Now` tel: button stays mobile-only;
`h2`–`h5` subheadings each carry their size).

### What was deliberately left as its own component

Seven interior components are genuinely distinct widgets, not repeated page
shells, and generic prose blocks would lose them: the blog post grid
(`about-us-c`), the office-tour gallery (`about-us-f`), the partners page
(`cosmetic-dentistry-dentist-in`), the new-patient-specials pricing callout
(`new-patients-b`), the two pricing-table pages (`payment-options-b`/`-d`), and
the in-network insurance columns (`payment-options-h`). These keep bespoke
components on purpose — the lesson of Parts 3/5.1 cuts both ways: consolidation
is right only where the shape actually repeats.

---

## Part 7 — Typography-only verification passes broken layouts _(closed)_

`dev-verify` (§1.8's answer) pairs source and built elements by their text and
diffs typography. That is the right key and it catches real regressions, but it
is structurally blind: a section says the same words at the same size whether or
not it kept its parallax background, its overlay header, its half-screen photo
column or its hover captions.

The Taylor Dental Care homepage passed `dev-verify` and still needed a full
hand rebuild. Seven things were wrong, and none of them were accidents:

| What was lost                                | Why the pipeline loses it                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header overlaying the hero                   | `position: absolute` + transparent background is a relationship _between_ the header and the next section; computed styles are read one node at a time |
| Staggered card row                           | same — the alternating negative `margin-top` only means something relative to its siblings                                                             |
| `background-attachment: fixed` section photo | a background on a container the emitter classifies as a pass-through wrapper and collapses                                                             |
| `::before` gradient scrim over a photo       | same                                                                                                                                                   |
| Half-screen background-image column          | the column has no content of its own, so it collapses to nothing                                                                                       |
| Hover-revealed image captions                | a hover reveal is two states of one element; at rest it is an invisible paragraph, and captured as pixels it becomes `top: 154.4px`                    |
| `fa-heading` rendering a Font Awesome glyph  | emitted class names are not namespaced against the theme CSS the mirror still ships                                                                    |

Two acquisition bugs sat underneath them. Lazy-loaded **background** images
(`data-bg`) were never primed — `scrollThrough` wakes `<img>` lazyloaders
because they swap `data-src` themselves, but a background URL is only ever
applied from script, and the observer does not fire headless. Everything
downstream measured those sections as `background-image: none`.

### What was built

- `src/browser/load.mjs → resolveLazyBackgrounds` — applies `data-bg` /
  `data-background` / `data-background-image` / `data-src-bg` to any element
  that still has no background. Runs as part of `primeLazyLoad`, so every stage
  that already asked for lazy priming gets it.
- `src/qa/layout-patterns.mjs` — `DETECT_PATTERNS` (the seven signatures above,
  run identically on source and build) and `DETECT_SMELLS` (built-only
  artefacts: horizontal overflow, the `left: 180px; margin-left: -195px`
  full-bleed hack, fractional absolute offsets read off the _authored_ CSSOM
  rules rather than computed values, and class names that match a vendor icon
  rule and render its private-use glyph).
- `bin/audit.mjs` — `wpmig dev-audit`. A pattern is reported only when the
  source has it and the build does not, so the report is a to-do list rather
  than an inventory. Each finding carries the fix.

A pattern that is present on both sides is `kept` and hidden unless `--all` is
passed; that mode is also how a new detector is checked, since a detector that
fires on neither side is indistinguishable from a passing page.

---

## Part 8 — What the interior pages added to Part 7 _(closed)_

Part 7 came out of one homepage. Auditing the 79 interior pages surfaced four
more failures, all of them again properties of the pipeline:

**8.1 A value that matches the UA default is not safe to drop.**
`css-emit` skips a declaration equal to the tag's UA default, and skips an
inherited one equal to the parent's. Both mean "the target will arrive here on
its own", and both are false the moment the target theme restyles the tag. The
source set its interior `h2` at 24px — exactly the UA default — with
`font-weight: 400` inherited from the section around it, so _both_ were dropped
and 96 headings rendered at the starter's `:where(:root) h2` size of 46px bold.
The emitter already had the concept (`FORCE_ON_SHARED`, for text inside the
shared `Button`); headings now carry the same force list. Existing output was
repaired with `dev-refix`.

**8.2 A pseudo-element's box is its whole declaration.**
`pseudoDecls` emitted `content`, absolute insets and paint, but never
`display`/`width`/`height`/`margin`. The source underlines every interior `h2`
with `h2::after { display: block; width: 100%; height: 1px; margin: 15px auto }`
— which arrived as `content: ""` on a zero-sized inline box, 89 times. `width`
and `height` are deliberately absent from `STYLE_PROPS` because a computed width
on a real node is a _used_ value; a pseudo with empty content has no content to
be sized by, so there they are the authored value and are now captured (a width
matching the host's content box is recorded as `100%`, not as the pixel it
measured). Emitted only for pseudos in normal flow: a glyph takes its size from
the icon font, and an absolutely-positioned one is already described by its
inset.

**8.3 Class prefixes were unique per component, not per site.**
`initialsOf` truncates to four letters, so `card-grid-home-chao` and
`card-grid-home-cosmetic` were both `cghc`, and `media-prose-what` and
`media-prose-who` were both `mpw` — 74 colliding class names across 19
components. Astro's scoping hides it at render time, which is why it survived so
long; what breaks is every tool that maps a class back to its owning file.
`dev-refix` corrected one component of each pair using the _other's_
measurements. `initialsOf` now takes the set of prefixes already claimed and
lengthens until unique, and `dev-audit` reports collisions in existing output.

**8.4 `dev-refix` reconciled only the pages that disagreed.**
It recorded the source value for a class _only where the build already differed_,
then treated a single recorded value as agreement. `.cgt-heading` is
right-aligned on one page and left on another; whichever page happened to differ
was the only one observed, so no conflict was reported and its alignment was
written into the shared component — after which the _other_ page differed, and
the next run wrote the opposite value. A correction that flipped every pass and
was wrong on one page either way. It now records the source value on every page
carrying the class and writes only properties some page actually renders wrongly,
so a genuine per-page difference surfaces as a conflict and is left alone.

### Also added to `dev-audit`

- `headingRule` — a heading the source underlines with a painted `::after` that
  the build renders flat (8.2's signature).
- `emptySection` — a section that styles text it was never given a prop for.
  Three pages shipped with no `<h1>` at all this way: the emitter kept the
  heading's typography on the wrapper and dropped the text.
- a static class-prefix collision check (8.3), which no DOM detector can see.

---

## Part 9 — `dev-audit`'s three blind spots, closed

Parts 7 and 8 gave `dev-audit` structural detectors. Reviewing the site again
showed the command still could not see two of the defects that had taken the
longest to find, for the same reason `dev-verify` could not: both compare things
that exist on both sides.

**9.1 Coverage — `src/qa/content-coverage.mjs`.**
`diffTextNodes` skips a key with no counterpart, because an unpaired element is
precisely what it cannot make a typography claim about. So text present on only
one side produces no finding at all. Four pages shipped with no closing CTA and
three with no `<h1>`, and every check the tool had ran clean on them.

`READ_CONTENT` reads the page's content text with counts and reports what the
source says and the build does not, plus what the source says once and the build
says twice (the interior pages carry the migrated breadcrumb _and_ the
template's). Three filters keep the signal usable:

- Chrome is excluded on both sides, for `dev-refix`'s reason: the header and
  footer are deliberately not a copy of WordPress's.
- Visibility is _not_ a filter. A carousel shows one slide at a time, so four of
  the homepage's five banner captions are hidden on one side and in flow on the
  other; coverage asks whether the build still contains the content.
- Only leaf-ish blocks count. A `<p>` whose text runs through `<a>`/`<strong>`
  is one string on both sides; a `<figcaption>` wrapping a heading and a
  paragraph is a different _shape_, and its concatenated text exists on neither
  side once the build splits the two.

An `<h1>` count is reported only when the build has none or several — the source
is inconsistent on purpose (some pages caption the banner with a `<span>` and
put the `<h1>` in the content, others put it in the banner), so "source 0,
built 1" is the build being more correct.

**9.2 The component set — `src/qa/component-hygiene.mjs`.**
Every page can render exactly what its own component says while the _set_ of
components is wrong, which no render comparison can see. Three checks read the
emitted files instead:

- **Near-identical components.** The site's one closing CTA came out as seven
  components across 36 pages, the interior banner as four. Six of the seven were
  missing the background photo and the map, and each had to be found separately.
  Compared on `markupTokens` (markup shape only) for the reason that module
  documents — the per-instance wall of measured CSS otherwise drowns out the
  element structure.
- **Class-prefix collisions** (Part 8.3), which scoped styles hide at render
  time.
- **Invisible overlays that paint on hover.** A full-bleed `<a>` at `opacity: 0`
  is a hit target; the capture read its `:hover` state like any other and
  emitted the background colour it found, so hovering a patient card filled it
  flat lime. The signature is a rule whose base state is invisible and whose
  hover state sets paint — distinguished from the intended reveal, which only
  restores opacity.

`--components-only` runs just these, with no build or snapshot needed.

---

## Part 10 — One design, forty components _(closed)_

Fifty-four of this site's components were the `card-grid` / `media-prose` /
`prose-block` families, and they were all the same three layouts. The obvious
theory for why they forked is paint and measurement — the same band at two
background colours, one section measured 44px taller than another. That theory
is wrong, and it is worth recording that it was tested: blanking _every_
content-sized box metric from the structural identity merged **zero** of the
fifty-four. Normalising colour, direction and slot form on top of that merged
four.

What forks them is **length**. `extractProps` turns a captured section's slots
into a fixed prop list — `heading`, `text`, `heading2`, `text2`, … — so a run of
three headings and a run of ten are components with different prop lists.
`findReusable` compares structure and prop signature, and both differ by
construction. No reuse rule that operates on a fixed prop list can ever unify
them. Hence `media-prose-b` through `-i`, `card-grid-home-botox` through
`-teeth`, `prose-block-home-cerec` through `-success`.

### The fix: stop treating length as structure

`src/generate/content-run.mjs` classifies a captured section. A section that is
_only_ a run of headings, prose, photos and buttons carries no design of its own
worth a component, so `dev-page` emits it as an ordered `blocks` array on one
shared parametric component (`--content-section`, default
`page-sections/shared-blocks/content-section`) and never generates a file. What
genuinely varies between instances — which side the photo floats, whether the
copy is centred — are inputs on that component.

Four things keep their own component, each a property of the capture rather than
a maintained list:

| Keeps a component                                           | Why                                                                                                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root paints a background **or a `::before`/`::after` does** | A band is a design. The interior banner paints nothing on its root and lays a 50% lime wash over its photo with a pseudo-element; checking the root alone flattened it. |
| Contains a repeat                                           | A `.map()` is a gallery, a team grid, an hours table, a sitemap — four different widgets a generic card list would flatten into one.                                    |
| Contains an embed or raw markup                             | A form, a map, a table.                                                                                                                                                 |
| No prose at all                                             | A lone photo or button is a widget, not a content band.                                                                                                                 |

The target component is checked for existence first; routing pages at a
component that was never written builds a site that renders nothing.

### `collapse-families.mjs` — the same rule, for output that already exists

The pass existed but had never been run here, and was unsafe as written: it
matched by directory-name prefix and deleted every match, including the
homepage's components while deliberately not rewriting the homepage, and onto a
target component that did not exist. It now shares the classifier's four refusal
rules, plus two more:

- **Hand-edited components are refused** on the `by wp-migrator` marker, the
  same signal `dev-refix` uses. A component someone has rewritten is theirs.
- **Deletion follows what the pages point at after the rewrite**, never the list
  of what was converted.

On this site it converted 37 components across 30 pages into 47 sections, and
`dev-audit`'s coverage check confirmed no text was lost and `dev-verify` no
typography changed. Two mistakes it caught on the way are recorded in the code:
carrying the captured `headingColor` across painted every heading _and its
divider_ the page title's navy, and deriving "is this section centred" from any
`text-align: center` in the file read the `<h1>`'s alignment and centred whole
pages of left-aligned body copy.

---

## Part 11 — The collapse filtered on the wrong thing _(closed)_

Part 10's pass matched candidates on the `card-grid` / `media-prose` /
`prose-block` name prefixes. Those are the names `nameFromShape` gives a section
whose shape it recognises; a section it does not recognise is named from its
words instead. So a plain run of prose beside a photo on two doctor-profile
pages was called `home-dr-glenn-taylor` and was never even considered, while the
identical shape on the page next to it was called `media-prose-e` and collapsed.

Candidacy is now every migrator-written component — the `by wp-migrator` marker
is the only name-adjacent test left, and it is a provenance check rather than a
classification. The refusal rules read the file, so what a component _is_
decides, and one more was added: a section with no prose and no heading is a
banner or a widget, never a content run. That is what keeps a bare
`<img>`-plus-overlay section (the blog banner) from being flattened into a
paragraph.

The same pass also has to be run _repeatedly_. Collapsing sections leaves
components that nothing points at any more — this site had six that no page had
ever referenced, left over from earlier runs, and three of them had been
carefully preserved by hand as "real widgets" before anyone checked whether they
were used. `dev-audit`'s per-component usage is the cheap way to see it.

### What one design looks like once it is one component

Sixty-nine components became eleven. The reductions that were not Part 10's
block-array conversion were all the same shape of mistake — one section, several
files:

| Was                     | Now                         | Why it forked                                                         |
| ----------------------- | --------------------------- | --------------------------------------------------------------------- |
| 4 interior banners      | `shared-blocks/page-banner` | Each page family segmented its banner separately                      |
| 7 closing CTAs          | one `media-prose-schedule`  | Same, on 40 pages                                                     |
| 2 "why choose us" bands | one                         | Differed by one line: `set:html={heading}` vs a text child            |
| 1 blog banner           | `shared-blocks/page-banner` | A banner named `photo-mosaic` because it has no words to name it from |
| 2 breadcrumbs           | deleted                     | The template renders one; the migrated copy was a second              |
| 6 unreferenced          | deleted                     | Never used by any page                                                |

The eleven that remain are genuinely distinct: the homepage's four bespoke
sections, the site-wide CTA, the page heading, and four widgets whose repeat
block is a real design (a membership-plan grid, a team grid, a sitemap tree, the
homepage callouts).

---

## Part 12 — Nothing decided _which page to open next_ _(closed)_

Every check described above reports on a page you have already chosen to look
at. With ninety mirrored pages, choosing is the part that does not scale, and it
was entirely manual: `dev-audit`, `dev-verify` and `dev-compare` each print
their own report, none ranks a page against another page, and by default none
persists anything (`--json` is opt-in on two of them and absent on the third).

The observation that motivated this: **screenshotting the original and showing
the images to a model finds more real defects than any of the automated
output**, because the differences that matter are the ones nobody wrote a rule
for. But taking those screenshots was a per-page chore, and nothing said which
pages deserved them.

### `wpmig dev-triage`

`bin/triage.mjs` does the mechanical half and stops:

1. **Scores every page** — `src/qa/triage.mjs`, pure and offline — merging the
   checks that already exist: layout patterns, content coverage, an optional
   `dev-verify --json` artifact, a whole-page pixel diff, the component
   registry, and (going forward) the generation-time uncertainty record.
2. **Ranks worst-first**, then adds one representative page per navigation
   group.
3. **Screenshots original vs rebuild** for the pages that survive, and writes
   one `queue.json` carrying the score, the reasons _with the hint prose of the
   check that raised each one_, absolute PNG paths, and the exact `.md` and
   `.astro` files to edit.

It never edits anything and never calls a model. Emitting a queue _is_ the
feature: the judgement stays with whoever reads it. This is the deliberate
counterpart to `dev-visual-check` (§1.8), which asks a model and is therefore
online and advisory; triage is offline, deterministic and reproducible, and the
two compose — triage picks the pages, and a person or `dev-visual-check` looks
at them.

### Three decisions worth keeping

**Scoring is additive with per-channel caps, not a weighted mean.** A mean lets
one clean viewport wash out a catastrophic one, and buries a page whose only
defect is that every photo is missing. Any single severe defect must flag a page
on its own; several must stack. Caps stop one noisy channel saturating the
score, and the remainder is distributed largest-first so the points beside each
reason sum to exactly the score — otherwise they are decoration, not an
explanation.

**An absent signal costs a page nothing.** The uncertainty record
(`.wpmig/uncertainty/<slug>.json`) did not exist when the pages in front of us
were generated, and those pages were hand-finished afterwards, so re-running the
generator to obtain it is not an option. A scorer that read "no record" as
"unknown, therefore suspicious" would flag all of them at once and say nothing.
`scorePage` with `uncertainty: null` returns the same score as an all-clear
record, and a test pins exactly that. This is also why the record is a **sibling
of the IR rather than a field on it**: `dev-compare` hard-fails without an IR,
and these two must degrade differently.

The retroactive stand-in is the **component registry**, which already knows
which components exist on exactly one page. A one-off — especially one in a
group `duplicateFamilies()` flags as near-identical — is usually a hand-fork,
and that is derivable today for pages generated long before any of this. On the
migration that motivated the work, 39 of 53 pages carry none, so it
discriminates rather than firing everywhere.

**Nav sampling stops the queue reviewing one page type nine times.** The worst
nine pages of a dental site are frequently nine variants of the same service
template. `selectNavSample` walks `src/data/mainNav.json` so the queue spans the
site's _kinds_ of page. Three shapes in real nav data drive its rules: a
label-only parent (`path: ""`) is a menu heading and delegates to its children,
so each family under Services becomes its own group rather than Services
sampling one page in thirty; `#fragment` children collapse to their host page,
so six anchors into `new-patients` contribute one candidate and not six votes;
and within a group the representative is the **highest-scoring** candidate, so
sampling and ranking compose — each area of the site surfaces its own worst
example.

### `--built-origin`

The built side can be screenshotted from a running Astro dev server rather than
`dist/`, which is how iteration actually happens — no rebuild between fixes.
`loadRouteMap` already yields routed paths, so this is a base-URL swap and no
new path logic; only the _source_ side is flat (`/<slug>.html`). Two details
were not free: the run **preflights the origin before launching Chromium**,
because `gotoStable` returns `{ok:false}` on a refused connection rather than
throwing, which without the check turns a stopped dev server into ninety
identical failures instead of one sentence naming both ways out; and
`suppressOverlays` in `src/capture/screenshot.mjs` had to learn about
`astro-dev-toolbar`, a custom element with no id and no class, small enough to
pass the 35%-coverage test, that would otherwise be burned into every capture.
That fix reads the `class` _attribute_ and the tag name — `el.className` is not
a string on custom or SVG elements.
