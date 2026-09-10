---
name: TripMate
description: A warm near-black ground under frosted glass, three colours that each mean exactly one thing, and a live globe behind it all.
colors:
  canvas: "#121110"
  surface-deep: "rgb(28 26 24)"
  foreground: "#f7f5f2"
  muted: "rgba(247, 245, 242, 0.62)"
  on-deep: "#f7f5f2"
  accent: "#28b981"
  accent-hover: "#34cb90"
  accent-foreground: "#06241a"
  money: "#e9b44c"
  money-soft: "rgba(233, 180, 76, 0.18)"
  alert: "#e4553f"
  alert-soft: "rgba(228, 85, 63, 0.16)"
  card-border: "rgba(247, 245, 242, 0.12)"
  tag-neutral-bg: "rgba(247, 245, 242, 0.11)"
  tag-neutral-fg: "#dcd7d1"
  tag-positive-bg: "rgba(40, 185, 129, 0.16)"
  tag-positive-fg: "#6fd3a9"
  tag-highlight-bg: "rgba(233, 180, 76, 0.18)"
  tag-highlight-fg: "#f0c97a"
  tile: "rgba(247, 245, 242, 0.08)"
  tile-foreground: "#dcd7d1"
  route-casing: "#0a0806"
  shadow-hairline: "rgb(0 0 0 / 0.32)"
  shadow-control: "rgb(0 0 0 / 0.4)"
  shadow-control-soft: "rgb(0 0 0 / 0.37)"
  shadow-raised: "rgb(0 0 0 / 0.45)"
  shadow-panel: "rgb(0 0 0 / 0.5)"
  shadow-object: "rgb(0 0 0 / 0.55)"
  shadow-deep: "rgb(0 0 0 / 0.7)"
  shadow-scrim: "rgb(0 0 0 / 0.8)"
  shadow-glyph: "rgb(0 0 0 / 0.85)"
  shadow-solid: "#000"
  globe-tint-dawn: "rgb(255 188 152 / 0.4)"
  globe-tint-dusk: "rgb(255 146 84 / 0.52)"
  globe-tint-night: "rgb(46 68 128 / 0.7)"
  route-day-1: "#4e8c99"
  route-day-1-glow: "#7fb3bd"
  route-day-2: "#a46e93"
  route-day-2-glow: "#c596b6"
  route-day-3: "#c4784b"
  route-day-3-glow: "#dfa079"
  route-day-4: "#7e9c5e"
  route-day-4-glow: "#a6bf89"
  route-day-5: "#7b77ae"
  route-day-5-glow: "#a6a2d0"
  map-glass: "rgb(18 16 15)"
  map-glass-edge: "rgb(255 255 255 / 0.16)"
  city-boundary: "#ece6de"
typography:
  root:
    fontSize: "16px"
    note: "A flat 16px root. Fluidity lives in the two display classes' own clamp(), not in html."
  tracking:
    display: "-0.018em"
    heading: "-0.012em"
    body: "0em"
    label: "0.18em"
    note: "Four tokens, replacing 20 literals. Tracking belongs to the face, so every literal in the codebase was invalidated the day the face changed — the display negatives were still at -0.085em/-0.106em, tuned for Wix Madefor. Three literals survive on purpose and are documented at their declaration: 0.02em and 0.05em on map labels over imagery, -0.005em on .price-display."
  hero:
    fontFamily: "Melodrama, ui-serif, Georgia, serif"
    fontSize: "clamp(2.5rem, 6.2vw, 5.25rem)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "var(--tracking-display)"
  display:
    fontFamily: "Melodrama, ui-serif, Georgia, serif"
    fontSize: "clamp(2rem, 5vw, 3.75rem)"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "var(--tracking-display)"
  display-quiet:
    fontFamily: "Melodrama, ui-serif, Georgia, serif"
    fontSize: "clamp(1.75rem, 3.6vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "var(--tracking-display)"
    note: "`.font-scene-display.is-quiet` — the second display step, so four consecutive landing bands do not all open at the same size. A class rather than a `text-[...]` utility, because `.font-scene-display` is unlayered and carries its own font-size; an arbitrary utility would be emitted inside @layer utilities and lose to it. Carried by the two quiet bands (HowItWorks, DestinationMap)."
  display-xl:
    fontFamily: "Melodrama, ui-serif, Georgia, serif"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "var(--tracking-display)"
    note: "`.font-display-xl` — the serif at whatever size the caller sets (the /trips and /profile mastheads). Declares no font-size, so a `text-*` utility beside it is live; it DOES declare line-height, so a `leading-*` utility beside it is dead."
  headline:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "var(--tracking-heading)"
    note: "`.font-display` — the SANS heading class, despite the name. It and `.font-display-xl` were one class until Melodrama landed and the 20px navbar wordmark came out spindly in a display serif. Declares no font-size: `text-base` through `text-2xl` beside it are live."
  title:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  standfirst:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontSizeSm: "1.125rem"
    fontWeight: 500
    lineHeight: 1.55
    maxWidth: "46ch"
    note: "Hero.tsx only — the one line under the hero, and the only body step above `prose`. It steps up at `sm` because the hero headline steps up with the viewport and the gap between them has to stay readable; every other body role holds a stable size. 46ch, not 58ch: this sits under a 5.25rem headline capped at 18ch and a longer measure under it reads as two unrelated blocks."
  prose:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    maxWidth: "58ch"
    note: "`.scene-prose` carries the size as well as the leading, so a standfirst cannot pick its own. 58ch is the one measure value in the system — HowItWorks, /trips and the print page all use it; nothing else runs uncapped."
  field:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.4
    note: "16px is a floor, not a step: below it iOS Safari zooms the viewport on focus."
  label:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "var(--tracking-label)"
    note: "Uppercase. THE label step — one size, one tracking, one spelling (`text-[0.6875rem]`). Replaced six sizes in a 3px range (9.92/10/11/11.2/12/13px) written four ways, at four tracking values. Section openers, entry-capsule cells, map day badges, the DAY n OF m stamp."
  caption:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    note: "12px, and deliberately distinct from `label`: no uppercase, no tracking. dl keys, footnotes, third-party chrome. The smallest step that sets real words rather than a tracked-out label."
  price:
    fontFamily: "Melodrama, ui-serif, Georgia, serif"
    fontWeight: 400
    fontFeature: "proportional-nums lining-nums"
    letterSpacing: "-0.005em"
    note: "`.price-display`, landing prices and the export's day total. The currency mark is a child span at 0.42em / 60% opacity / translateY(-0.62em), so the figure is what gets read. Proportional, not tabular — nothing is being compared in a column here."
  figure:
    fontFamily: "Tabular, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 600
    fontFeature: "tabular-nums"
    note: "Values compared IN A COLUMN, and nothing else — five sites: the dl columns, the stop-time gutter, the day totals, the budget readout, the how-it-works step numbers. Only the last is on a landing route and it sits in the third band, so the face ships preload: false rather than competing with the first viewport. Never a sentence, never a stamp, never a price meant to be felt."
  cardTitle:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "var(--tracking-heading)"
    note: "Plan-card titles on the landing's featured row. A step above `headline` and below the section display."
  map-day-label:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    letterSpacing: "var(--tracking-label)"
    note: "`.marker-day-label` only — uppercase day badges standing on the globe. The product's own text face: there is no map-native typeface any more."
  map-stop-label:
    fontFamily: "Switzer, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    letterSpacing: "0.02em"
    note: "Map-native. `.marker-title-card` and `.marker-place-label` only. Keeps a literal tracking value: this is a legibility register over imagery, not the interface one."
rounded:
  node: "4px"
  surface-sm: "5px"
  surface-md: "6px"
  surface-lg: "8px"
  panel: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.full}"
    padding: "12px 26px"
    typography: "{typography.title}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
  button-destructive:
    backgroundColor: "{colors.alert}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
  card-glass:
    backgroundColor: "{colors.surface-deep}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.panel}"
    padding: "20px"
  hero-capsule:
    backgroundColor: "rgb(247 245 242 / 0.97)"
    textColor: "{colors.canvas}"
    rounded: "{rounded.full}"
    padding: "6px"
  hero-capsule-cell:
    backgroundColor: "transparent"
    textColor: "{colors.canvas}"
    padding: "9px 20px"
    typography: "{typography.field}"
  chip-neutral:
    backgroundColor: "{colors.tag-neutral-bg}"
    textColor: "{colors.tag-neutral-fg}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  chip-positive:
    backgroundColor: "{colors.tag-positive-bg}"
    textColor: "{colors.tag-positive-fg}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  chip-highlight:
    backgroundColor: "{colors.tag-highlight-bg}"
    textColor: "{colors.tag-highlight-fg}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  day-tab-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.full}"
    padding: "8px 28px"
  budget-tile:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.tile-foreground}"
    rounded: "{rounded.surface-lg}"
    padding: "12px"
  budget-tile-total:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.money}"
    rounded: "{rounded.surface-lg}"
    padding: "12px"
    typography: "{typography.figure}"
  marker-title-card:
    backgroundColor: "rgb(18 16 15 / 0.75)"
    textColor: "rgb(244 247 250 / 0.97)"
    rounded: "{rounded.surface-sm}"
    padding: "0.3rem 0.55rem 0.34rem"
    typography: "{typography.map-stop-label}"
  marker-day-label:
    backgroundColor: "rgb(18 16 15 / 0.75)"
    rounded: "{rounded.surface-md}"
    padding: "0.34rem 0.7rem 0.36rem"
    typography: "{typography.map-day-label}"
---

# Design System: TripMate

## Overview

**Creative North Star: "The Kiln"**

The product is one continuous scene: a live photorealistic globe on two surfaces, a real photograph
on the landing, and everything else floating over them as frosted glass cut from a single warm
near-black. The ground is `#121110` — warm, but only just. That near-neutrality was the correction
that made the system work: a genuinely brown ground composites the card to `rgb(32,24,20)`, a
12-point spread between channels, and a gold money figure printed on brown is two neighbouring hues
with nowhere to separate. This ground composites the card to `rgb(26,24,22)`, a 4-point spread, so
gold, jade and coral each get clean air while the whole thing still reads warm rather than clinical.

The register is a consumer travel product finished to the craft level of Airbnb and Vercel, not an
instrument panel and not an awwwards poster. The first viewport does work: a full-bleed photograph
on a scroll parallax, a two-line proposition, and a destination-plus-dates capsule that opens the
wizard already filled in. It refuses the one-enormous-word-over-a-stock-mountain move; there is no
withheld CTA and no kicker anywhere in the product.

The system's whole discipline is that **each colour means exactly one thing**. The predecessor ran
on a single amber accent that painted 55 elements on one screen of `/trip/[id]` — the primary
button, a "DAY 1 OF 3" label, the budget-bar fill, the download control and the selected day tab —
so there was no way to tell an action from a readout, and a healthy budget printed in the warning
colour. Three named roles replaced it: jade acts, gold counts, coral warns. Everything else is the
one slate at some alpha.

**Key Characteristics:**
- One material: `--surface-deep-rgb` at varying alpha and blur radius, never a second grey.
- Three semantic colour roles, each with one meaning and each measured AA against the card ground.
- Three interface typefaces with one job apiece — display, text, and a mono that sets every figure.
- Round what you touch, square what you read.
- Exactly one light surface in the whole product: the hero's entry capsule.
- The globe is the page's ongoing motion; nothing else loops.

## Colors

A warm near-neutral near-black under warm off-white type, with three saturated roles that are
rationed rather than decorative.

### Primary
- **Kiln Jade** (`{colors.accent}`): **action, and only action.** Primary buttons, the selected day
  tab, focus rings, the hovered or selected stop on the globe, the hairline that draws in under a
  stop's name on hover. Never a label, never a figure, never a fill that merely reports a number.
  It is a *light* colour, so its foreground is dark — `{colors.accent-foreground}`, drawn from the
  jade's own hue rather than from the canvas so a filled control reads as a solid object and not as
  a hole punched through to the page behind it (6.55:1 on the jade).
- **Jade Hover** (`{colors.accent-hover}`): the only hover treatment a filled action gets. No lift,
  no glow.

### Secondary
- **Kiln Gold** (`{colors.money}`): **money, and only money.** Per-stop costs, day totals, the Total
  row, the on-plan portion of the budget bar, the price on a tier card. A figure is information, not
  an invitation, so it never borrows the action colour. `{colors.money-soft}` is its only fill.
- **Ember Coral** (`{colors.alert}`): **over-plan and failure.** The over-budget figure and its "over
  budget" line, failed requests, the destructive confirmation. `{colors.alert-soft}` backs the inline
  warning rows. Before this role existed, roughly thirty sites reached for raw Tailwind red literals
  because the one-accent rule left nowhere for a warning to live.

### Neutral
- **Kiln Ground** (`{colors.canvas}`): the page floor, and the colour `GlobeBackground` reads at
  Viewer init for Cesium's own `scene.backgroundColor`, so the WebGL clear colour and the DOM around
  it cannot drift apart and show a seam at the canvas edge.
- **The One Slate** (`{colors.surface-deep}`, authored as channels so alpha can vary): every frosted
  panel, control pill, badge, scrim, nav bar and loader. One step up from the ground.
- **Warm Paper** (`{colors.foreground}` / `{colors.on-deep}`): body text everywhere, and text over
  any dark surface — a header band, a photo overlay, the map.
- **Muted Paper** (`{colors.muted}`): secondary prose, built as the paper white at 62% rather than
  as a sampled grey, so it stays correct on every surface alpha instead of being tuned for one.
- **Hairline** (`{colors.card-border}`): every divider, panel edge and drawn rule.
- **Chips and tiles** (`{colors.tag-neutral-bg}` / `{colors.tag-positive-bg}` /
  `{colors.tag-highlight-bg}` / `{colors.tile}`): glass chrome, not warm paper. With three real roles
  the positive chip gets its green back — under the previous single-accent rule it had to give it up,
  and a positive chip and a neutral chip were indistinguishable.

### Tertiary (map-native, outside the interface palette)
These are the route's own colours. They are **not** part of the interface palette and must never
appear in a panel, chip or button — the globe gets its own colours because it is photography, not a
surface. They live in `:root` only so there is one place to change them; JS reads them back through
`getComputedStyle`.

- **The day pool** (`{colors.route-day-1}` and its four siblings, each a **pair**: a core and a
  softer companion). The core draws the ribbon body, the ring cores, the beam core and the day
  badge's border; the companion draws the halo, the outermost radar ring and the outer footprint
  disc. Five pairs, cycling every five days.

  **Pigments, not neon, and the name changed with the values.** This pool was
  `--route-neon-*` — a saturated cyan/magenta/amber/lime/violet set, drawn as emissive with coloured
  blooms. A finish review named it a foreign register sitting inside this system on the product's
  core screen, and it was re-derived rather than desaturated: five earth pigments at a deliberately
  tight luminance band (0.205–0.290), so no day reads as "the faint one" — a complaint the old
  pool's own notes recorded about its fifth entry. Adjacent separation never drops below 54°.

  **None of the five falls inside `ACCENT_HUE_BAND`**, and that is the property to preserve. The old
  pool had exactly one day colliding with the accent and relied on `emphasisColorFor` swapping the
  hover tint to white; that mitigation has one fallback colour and no more. Not needing it is
  strictly better than spending it. `src/lib/mapRoute.test.mjs` guards this — it asserts every
  shipped palette clears the band, *and* that the guard still fires for a colour inside it.
- **Route Casing** (`{colors.route-casing}`): the dark stroke down both ribbon edges. Near-black
  rather than pure black — a true black edge reads as a hole punched in the photography, a warm
  near-black reads as depth. **The casing, not the hue, is what makes a route legible over
  uncontrolled aerial imagery**, and always was.
- **Map Glass** (`{colors.map-glass}` / `{colors.map-glass-edge}`): the backdrop behind every label
  standing on the globe. One deep near-opaque ink, so a label is legible over anything the tiles can
  put behind it — which no text-shadow alone can promise over a white plaza at noon.
- **City Boundary** (`{colors.city-boundary}`): the destination's administrative outline. A cool
  near-white rather than a hue, because the boundary is context for everything else on the map and
  any colour of its own would compete with the day ramp above it.

### Named Rules

**The One Meaning Rule.** Jade acts, gold counts, coral warns. A colour that means two things means
nothing, and this palette exists because the last one meant five. If a new element needs colour, ask
which of the three verbs it is doing; if the answer is "none", it is the one slate at an alpha.

**The One Slate Rule.** Every panel, pill, badge, scrim and loader is `--surface-deep-rgb` at some
alpha. If a new surface needs a background it takes this token at a new alpha — it does not take a
new grey, and it does not leave the material for `--canvas`. Full opacity is where that step ends
(`.glass-nav-menu`, `.glass-itinerary.is-opaque`).

**The Two Foregrounds Rule.** `--accent-foreground` means "text on jade" and is dark. `--on-deep`
means "text on something dark" and is light. They are not interchangeable, and conflating them is the
specific bug this palette was rebuilt to fix.

**The Darken-Never-Lighten Rule.** Anything layered over photography or terrain is tinted toward the
one slate or toward black, never toward white. `.glass-control` darkens on hover (0.55 → 0.72 → 0.82)
rather than lightening, because these pills float over a live globe that idles anywhere from open
ocean to a snowfield and a white wash would cut contrast exactly where the terrain is brightest.

**The Photograph-Is-Not-A-Surface Rule.** A scrim over destination photography makes *large* type
safe and small type only apparently safe. Measured across eight cities, mean luminance ranges 0.040
to 0.348 and Kyoto peaks at 0.947 — near-white sky, where white body text is 2.41:1 under a 60% scrim
and 3.56:1 under 75%. So: **large type on the photograph, everything small or dense in a darkened
band.** The generation screen and the itinerary header are both built on that split.

**The Contrast Floor.** Every role is measured against the composited card ground `rgb(26,24,22)`:
body 16.27:1, descriptions 8.41:1, times and micro-labels 4.84:1, money 9.36:1, alert 4.78:1, accent
7.04:1, and dark ink on the jade button 6.55:1. All AA including the dimmest. The system this
replaced did not clear that bar and said so in its own comments. Keep it cleared, and re-measure
against the *composited* ground rather than against `--canvas`.

**The Hue Band Lives in TypeScript Too.** `ACCENT_HUE_BAND` in `src/lib/mapRoute.ts` is a
`[135, 180]` literal that encodes where `--accent` sits on the hue wheel, and `emphasisColorFor`
swaps the hover tint to white on any day whose own core falls inside it. **Move `--accent` and you
must move that literal by hand** — a CSS-only sweep misses it, and the failure is silent: pointing at
a stop still fires, the feedback simply disappears.

## Typography

**Display Font:** Melodrama (`--font-display-stack`), self-hosted variable woff2, 39.6KB
**Body Font:** Switzer (`--font-sans-stack`), self-hosted variable woff2, 42.2KB
**Figure Font:** Tabular (`--font-mono-stack`), self-hosted variable woff2, 22.3KB, `preload: false`
**Map-native faces:** none. Three faces ship, and the globe uses the same three.

All three are Fontshare (Indian Type Foundry), free for commercial use with self-hosting permitted,
delivered through `next/font/local` from committed files in `public/fonts/` rather than a CDN.

**Character:** A high-contrast display serif against a neutral grotesk — the pairing a hotel folio
or an auction catalogue uses, and the reason the product reads as considered rather than as
well-made SaaS. Melodrama carries thin-to-thick modulation and appears at exactly one weight, 400;
its restraint is the point, and a bold cut of it would undo the whole effect. Switzer is upright and
unremarkable on purpose. Nothing is italic.

This replaced Wix Madefor Display + Text + Sometype Mono, chosen three days earlier by elimination
and competent at everything except the one thing this surface has to do in its first second.

### Hierarchy
- **Hero** (Melodrama 400, `clamp(2.5rem, 6.2vw, 5.25rem)`, 1.04, `--tracking-display`):
  `.font-scene-hero`, the landing proposition and nothing else.
- **Display** (Melodrama 400, `clamp(2rem, 5vw, 3.75rem)`, 1.08, `--tracking-display`):
  `.font-scene-display`, every landing section heading and the destination on the generation screen.
- **Display at any size** (Melodrama 400, 1.04, `--tracking-display`): `.font-display-xl`, the serif
  where the caller sets the size — `/trips` and `/profile` mastheads. Owns `line-height`, so a
  `leading-*` utility beside it is dead; see the Unlayered-Beats-Utility rule below.
- **Heading** (Switzer 600, `--tracking-heading`): `.font-display`, panel and card headings at the
  app's 16–24px step. **This is the sans class, not the serif one** — they were one class until
  Melodrama landed and the 20px navbar wordmark came out spindly. The serif is `.font-display-xl`.
- **Body** (Switzer 400, 1rem / 0.875rem, 1.6): product copy — day rows, stop notes, descriptions.
- **Standfirst** (Switzer 500, 1.0625rem → 1.125rem at `sm`, 1.55, capped 46ch): the hero support
  line and nothing else. The only body step above `prose`, and the only one that scales with the
  viewport — it has to hold its distance from a headline that does.
- **Prose** (Switzer 400–500, 1rem, 1.65): `.scene-prose` on marketing paragraphs; the app's own
  panels stay dense. Capped at **58ch** wherever it runs long — `HowItWorks`, `/trips`, the print
  page. That is the one measure value; there is not a second.
- **Field** (Switzer 500, 1rem, 1.4): every input. 16px is a hard floor.
- **Label** (Switzer 500–600, **0.6875rem**, **`--tracking-label`**, uppercase): section openers,
  entry-capsule cell labels, map day badges, the `DAY n OF m` stamp. One size, one tracking, one
  spelling.
- **Caption** (Switzer 400, 0.75rem): the distinct quieter role — dl keys, footnotes. Not a label:
  no uppercase, no tracking.
- **Price** (Melodrama 400, `proportional-nums lining-nums`, `-0.005em`): `.price-display`. The
  currency mark is subordinated to `0.42em` at 60% opacity and raised `-0.62em`, so what a visitor
  reads is the figure. Landing prices only.
- **Figure** (Tabular 600, `tabular-nums`): values compared **in a column**. Five sites.

### Named Rules

**The Three Faces Rule.** Melodrama sets headings, the hero and the landing price. Switzer sets
everything read as prose or operated as a control. Tabular sets figures in columns. A fourth
interface face needs a fourth job, and there isn't one.

**The Figure Rule, narrowed — and this is the version that is actually true.** A census found the
previous rule ("mono for every figure") honoured in about a quarter of cases: 5 of 19 money renders,
and no date, time, duration or temperature anywhere. So the rule is now **tabular mono where values
are compared in a column** — the dl columns, the stop-time gutter, the day totals, the budget
readout, the how-it-works step numbers. Everything else that used to reach for mono goes elsewhere:

- A price a visitor is meant to *feel* rather than compare is `.price-display`, at display scale in
  the serif. That is what a menu or a lot listing does and what a monospace can never do.
- A sentence is never mono. Three of `ImageRow`'s four "stat" lines contain no digit at all
  ("Lodging, food, and transit — itemized") and were set in mono with `tabular-nums` on them,
  aligning nothing.
- A stamp is not a column. `DAY 2 OF 5` has two numerals and nothing to align them against.

Mono reaches the landing at exactly one place — the how-it-works step numbers, in the third band —
which is why it ships `preload: false` rather than being dropped: nothing in the first viewport
paints it, so it should not compete with the hero photograph and the two faces that do.

**The Tracking-Is-A-Token Rule.** Four values, and no fifth:

| Token | Value | Where |
|---|---|---|
| `--tracking-display` | `-0.018em` | the serif at display scale |
| `--tracking-heading` | `-0.012em` | headings and card titles |
| `--tracking-body` | `0em` | prose, controls, buttons, small text |
| `--tracking-label` | `0.18em` | every uppercase label |

The census that preceded this found **20 distinct letter-spacing values**, six of them on uppercase
labels 10–13px apart with no two derived from each other. Worse, the display negatives ran to
`-0.085em` and `-0.106em` — numbers tuned for Wix Madefor and never revisited when the face changed,
which at the footer's 45px links meant −3.8px per gap and letters touching in Switzer. **Tracking
belongs to the face, so a face swap invalidates every literal in the codebase.** Tokens are how that
stops being true.

Three literal values survive on purpose, all documented at their declaration: `0.02em` and `0.05em`
on map labels over imagery (a legibility register, not the interface one) and `-0.005em` on
`.price-display` (optical, for the serif's figure widths).

**Where the Unlayered-Beats-Utility Rule bites hardest.** That rule is stated in full under
Elevation & Depth; type is where it is met most often, so the type-specific half is here. Every
class above is declared unlayered in `globals.css`, so a `leading-`, `text-`, or `font-` utility
beside a class that already declares that property **does nothing**, in silence. Which property each
class owns:

| Class | Owns | So a utility beside it that is dead |
|---|---|---|
| `.font-display` | family, weight, letter-spacing | `font-semibold` (18 inert sites, left alone) |
| `.font-display-xl` | family, weight, letter-spacing, **line-height** | `leading-*` |
| `.font-scene-hero` / `.font-scene-display` | all of the above **and font-size** | `text-*`, `leading-*` |
| `.scene-prose` | font-size, line-height | `text-*`, `leading-*` |

It has bitten four times: line-height, font-size, display utilities, and a `--font-display` key in
`@theme inline` whose generated utility collided **by name** with the unlayered `.font-display`
class — two rules on one selector, resolved by layer order rather than by anyone. That key was
removed; `--font-sans` and `--font-mono` are real utilities and stay.

**The Fluid-Type-Is-Scoped Rule.** `html` is a flat `16px`. A viewport-derived root
(`clamp(16px, 1.13vw, 20px)`) was removed deliberately: `clamp()` with absolute px bounds overrides
the visitor's own browser font-size at every width, so someone who set their default to 20px was
served 16px regardless. Fluidity lives in `.font-scene-display` and `.font-scene-hero`, where it can
be reasoned about, while body copy and dense instrument panels hold a stable step.

**The World-Face Boundary is retired, and deliberately.** There used to be two typefaces reachable
only from the marker layer — Orbitron for the day badges, Rajdhani for stop names — fenced by a rule
that said labels standing on the globe are objects in the *world* rather than surfaces in the
interface. The argument was real. The result was not: a square techno face with a glowing chip read
as a sci-fi HUD dropped into a restrained product. Both faces are gone; the globe sets its labels in
the product's own display and text faces.

**What that cost, recorded so nobody rediscovers it.** Rajdhani was *condensed*, and the marker
declutter budget (`MIN_SEPARATION_X_PX` in `StopMarkerLayer`) is measured in the horizontal pixels a
name occupies — so a wider face means marginally fewer stop names survive the separation scan at a
given zoom. If the label field ever reads too sparse, lower that constant. Do not reintroduce a
fourth typeface for it.

The **colour** half of the boundary stands unchanged: route colour is map-native and must never
appear in a panel, chip or button, and interface colour stays off the globe — with `--accent`
marking a hovered or selected stop as the one documented exception.

## Layout

`AppShell` renders exactly four layers on every route and that structure never varies: the globe at
`z-0`, the floating stop markers at `z-5`, a viewport-spanning content overlay at `z-10`, and app
chrome (navbar, map controls) at `z-20`. `.app-shell` is `h-dvh overflow-hidden` — **the document
never scrolls**; `.content-overlay` does. Every scroll-driven animation in the app therefore binds to
the named `--story` timeline declared on `.content-overlay`.

Two heights are tokens because more than one thing has to clear them: `--nav-h` (`3.5rem`, read by
the navbar, `<main>`'s top padding, `ScrollStory`'s cancelling margins and `DockedPanel`'s offset) and
`--capsule-h` (`3.5rem`, the collapsed docked panel, read by the mobile map-control rule that has to
sit above it). 44px is the hard floor inside the bar and it is a touch-target floor, not a taste one:
every interactive child is `min-h-11`, and anything tighter than `3.5rem` has to drop those targets
first.

Page gutters are `px-5` rising to `sm:px-8`. Panels are `p-5 sm:p-6`. Full-bleed bands (the landing
beats, `/trips`' hero, the footer) cancel `<main>`'s padding with matching negative margins so they
reach all four viewport edges, including the top behind the fixed nav. Breakpoints are `rem`-based
and resolve against the root's *initial* 16px, so they never move.

Responsive behaviour worth knowing: below `sm` the docked panel is full-bleed and the map controls
are hidden until the panel collapses into its capsule, at which point a reduced set — the zoom pill
and the compass — appears in the space that opened up. The tilt slider and the 2D/3D toggle stay
behind `sm:`, because a 15px rotated thumb is not a touch target.

### Named Rules

**The Named-Timeline Rule (`--story`).** Every scroll-driven animation binds to
`animation-timeline: --story` — never to `scroll(nearest block)` or `scroll(root)`. `nearest` resolves
to the nearest ancestor *scroll container*, and `overflow: hidden` makes an element one: it has a
scrolling box, it simply never scrolls. The landing hero and both scene bands all carry
`overflow-hidden`, so `nearest` binds to a section pinned at `scrollTop` 0 forever and the animation
sits frozen at 0% progress with no error anywhere. `root` resolves to the document, which never
scrolls either. If a new scroll-driven animation appears not to run, check the timeline's source
before checking the range.

**The Overlay Hit-Test Rule.** `.content-overlay` is `pointer-events-none` so the globe stays
draggable, which also takes its scroller out of hit-testing. `.content-overlay:not(:has(.docked-panel))`
hands pointer events back on every route that scrolls the overlay itself. This is not a touch-only
problem: a wheel's scroll target is resolved by hit-testing first and *then* by walking the hit
element's ancestor chain, and the Cesium canvas is the overlay's **sibling**, so a wheel over any
patch of viewport with no `pointer-events-auto` box under it lands on Cesium's handler, which
consumes it as a camera zoom. The page does not move, the globe lurches, and tiles start streaming.

**The Scroll-Anchor Rule.** `.docked-panel-body` sets `overflow-anchor: none`, and it is load-bearing.
The itinerary header is in flow, so compressing it changes the height of content above the viewport —
exactly the condition Chrome's anchoring exists to correct, which it does by pulling `scrollTop` back
down by the same amount. Measured in Chromium, scrolling to 40, 80, 120 and 160px all settled back at
0 with the header at full height.

## Elevation & Depth

Depth comes from **material, not from shadow**. Every surface is the one slate at an alpha behind a
backdrop blur; what separates two surfaces is how much of the world shows through them, not how far
they appear to float. Shadows exist only to keep an object from dissolving into what is behind it, and
every one of them is soft and non-directional. There are no hard offset shadows anywhere in the
product.

Alpha and blur rise with how much content a surface carries: control pills at 0.55 / 20px, the nav bar
at 0.72 / 16px, the itinerary and card panels at 0.62 / 56px, full-viewport surfaces at alpha 1 with
no blur at all — because nothing shows through an opaque surface and a 56px blur of nothing is a
render surface for no reason.

### Shadow Vocabulary
- **Control** (`0 4px 16px 0 rgba(0,0,0,0.32)`): floating chrome over the globe — `.glass-control`.
- **Panel** (`0 8px 32px 0 rgba(0,0,0,0.37)`): `.glass-itinerary`, every card and panel.
- **Object on the map** (`0 2px 10px rgb(0 0 0 / 0.55)` plus a 1px inset white highlight): the marker
  title card, sitting on real photography.
- **Capsule** (`0 24px 58px rgb(0 0 0 / 0.55)`): the hero's entry capsule only. The one place a
  shadow is doing lift rather than separation, because it is the one light object in a dark product.
- **Hover lift** (`0 16px 34px rgba(0,0,0,0.5)` with `translateY(-3px)`): memory cards, and nothing
  else.

### Named Rules

**The Unlayered-Beats-Utility Rule.** A plain author declaration in `globals.css` outranks anything
Tailwind emits inside `@layer utilities`, **regardless of specificity**. So a `hover:bg-*` utility on
an element carrying `.glass-control` or `.glass-itinerary` does nothing at all. Four controls shipped
with no hover and no press feedback for months — the 2D/3D toggle, the reset-north compass, the
panel's collapse handle and `/trip/[id]`'s Refine button — each running a `transition` on a property
that never moved. The same trap has been met on `box-shadow`, `ring-*`, `line-height` and `font-size`.
**Define the state beside the base rule in CSS, never as a utility at the call site.** The corollary
holds in the other direction: the moment a `font-size` appears in an unlayered class like
`.font-scene-display`, it silently wins over every `text-[clamp(...)]` on every consumer.

**The Focus-Ring Rule.** `.focus-ring:focus-visible` is plain unlayered CSS with explicit
`outline-width` / `outline-style` / `outline-color` longhands — full-opacity `--accent` at a 2px
offset. Not `ring-*` (it compiles to `box-shadow` and has already silently lost here — the landing
hero's button matched `:focus-visible` while every ring slot stayed `rgba(0,0,0,0)`), and not
`focus-visible:outline-accent` (the utility generates correctly and the computed colour still stayed
at Chrome's default). The longhands are deliberate: `currentColor` is what an incomplete outline
decays to, which on a jade-filled button is a silent, invisible focus indicator.

**The Blur-Of-Nothing Rule.** A `backdrop-filter` costs a render surface, and moving a render surface
re-rasters everything behind it. Never put one on a surface with nothing behind it (`.is-opaque` on
the four globe-less routes), and never put a wide radius on a small chip (the marker cards use 8px,
not the control chrome's 20px — a wide blur on a 28px-tall chip just samples flat colour). Every map
frame in this app re-blurs every backdrop-filter panel above the canvas, so idle GPU allocation is
not free here the way it is in a document.

## Shapes

**Round what you touch, square what you read.** Anything you press or drag is a full pill
(`9999px`): buttons, the entry capsule and its go button, day tabs, chips, control pills, the nav's
menu rows. Anything you read is near-square: the map labels at 4–6px, the marker card at 5px, small
surfaces at 8px.

Borders are hairlines — one pixel of `--card-border`, or of white at 0.08–0.16 over photography. The
system draws *rules* rather than boxing things: the navbar is a ruled grid (a bottom hairline across
the bar, a vertical one closing the wordmark off from the links), the section opener is a label
against a bottom rule, and the itinerary's day rows separate with a hairline rather than a card edge.
Where a rule spans a cell, the cell must be `items-stretch` and re-centre its own content — a rule can
only span the full height if the box carrying it is that tall.

No clip-path silhouettes, no angled cuts, no decorative geometry. The one drawn mark in the system is
the asterisk family: `LogoMark`'s four arms radiating from a pinched centre, the same shape at
smaller scale as `SectionOpener`'s section rule. Every icon in the product is inline SVG, sized in
`em` so it tracks its type step.

**The Radius Drift, recorded honestly.** The Kiln edge rule is 5–8px on surfaces, and the surfaces
built under it hold that. The incumbent panels — `.glass-itinerary`, the memory cards, the confirm
dialog — are still at the previous system's 16px, because the retokenization deliberately left the
itinerary card and the map structurally untouched. `{rounded.panel}` records what those panels
actually are; new surfaces take `{rounded.surface-lg}` or tighter.

## Components

### Buttons
- **Shape:** full pill (`{rounded.full}`) on every variant.
- **Primary:** jade fill with its own dark ink, `12px 26px`. Hover is `{colors.accent-hover}` and
  nothing else; press is `scale(0.98)`. No lift, no glow, no shadow growth.
- **Focus:** the `.focus-ring` outline in full-strength jade, offset 2px clear of the fill so the
  indicator sits against the dark panel rather than jade-on-jade. On the hero's go button, which
  *is* jade, the outline flips to `--accent-foreground` — the Two Foregrounds rule again.
- **Ghost:** transparent with muted text, same pill, same padding rhythm. `BackButton` is a chevron
  plus this class list and renders a `<button>`, never a `<Link>` — two of its call sites reverse
  in-page state rather than navigating.
- **Destructive:** coral fill, the only place the app spends its alert colour on a button someone
  presses on purpose.
- **Disabled:** avoid. The hero's go button uses `aria-disabled` with a cursor change and never
  greys out, because a washed-out mint pill is what a first-time visitor would see for the first
  three seconds and no consumer product ships a greyed-out hero CTA. The empty case is handled at
  submit, where focus moves to the field.

### The Entry Capsule (signature)
**The one light surface in the product, and the only place the system inverts.** A near-white pill
(`rgb(247 245 242 / 0.97)`) on the darkened hero photograph, holding a destination cell, two date
cells and a jade go button, with hairline dividers between cells inset top and bottom so they never
touch the capsule's own curve. Everything else in the app is glass over a dark ground, which is right
for a panel you read and wrong for the single control the whole first viewport is asking you to use.
It is the highest-contrast object on the screen without being the loudest colour on it — the jade is
reserved for the button inside, so the capsule reads as a place to type and the button reads as the
action.

Focus is an *inset* 2px jade ring on the **cell**, not the field: a ring on a borderless input inside
a pill draws a rectangle floating in a curve, while on the cell it reads as the segment lighting up.
Empty date inputs render their own copy through a `::before` on the cell with the widget's text made
transparent, and the platform calendar glyph is replaced by an inline SVG — a UA glyph renders in
whatever the platform decides and cannot take a stroke weight, and two unstyled OS widgets in the
product's one light surface were the strongest template tell on the page. Below `md` the capsule
stacks and drops to an 18px radius, because a full pill on a tall stacked box renders as a lozenge;
the button keeps its own pill, because the button is still the thing you press.

### Cards / Containers
- **Corner:** `{rounded.panel}` on the incumbent glass panels (see the radius-drift note above).
- **Background:** `.glass-itinerary` — the one slate at 0.62 under a 56px blur at 180% saturation. The
  radius pair is measured: 56px is where large backdrop structures (city blocks, coastlines) stop
  reading as recognizable shapes, while 32px still leaves their edges visible.
- **Border:** a single hairline of white at 0.12.
- **Padding:** `p-5 sm:p-6`.
- **Token scoping:** the class overrides `--foreground`, `--muted` and `--card-border` *within its
  own subtree*, so every child using `text-foreground` / `text-muted` / `border-card-border` retints
  for free. That free retint is the whole reason to override a token rather than restyle a component.
- **Opaque variant:** `.glass-itinerary.is-opaque` (two classes, so it cannot lose a source-order coin
  toss) drops the blur and goes to alpha 1 on the three surfaces with nothing painted behind them.
  Fill only — the hairline, the shadow and every token override still apply.
- **Never hand-write `-webkit-backdrop-filter`.** Lightning CSS collapses the pair down to the
  prefixed property alone, which current Chrome no longer supports; that silently killed the blur
  entirely. Lightning emits the prefix itself when targets need it.

### Inputs / Fields
- **Style:** transparent or a low white wash inside a hairline trough, 16px text, generous cell
  padding rather than a drawn box per field.
- **Focus:** a jade ring or an inset jade stroke on the cell. Never a colour change alone.
- **`color-scheme: dark` is set on `:root` and is load-bearing.** Without it the UA renders native
  controls in its light scheme, and the date field's calendar indicator and the number field's
  spinners paint as dark glyphs on near-black inputs — which is where three of the four trip-form
  fields live.
- **16px minimum, always.** Below it iOS Safari zooms the viewport on focus. This includes the small
  "Actual" spend inputs, which were 12px.

### Chips
- **Style:** full pill, `2px 8px`, a low-alpha fill with a matching lifted foreground.
- **Variants:** neutral glass, positive jade-tinted, highlight gold-tinted. The positive variant is a
  real green again — under the previous single-accent rule it had to resolve to the same neutral
  glass as everything else, which made a positive and a neutral chip indistinguishable.

### Navigation
A single fixed, frosted `Navbar` spanning every route at `z-20` and `h-[var(--nav-h)]`.

- **One bar, every route — no route branch of any kind.** This is the rule the others serve. The
  header is the one component a visitor carries between pages, so it is the last thing that should
  redraw itself underneath them. Nothing about its ground, blur, rules or cell structure varies by
  path; only the middle cell's *contents* do, which is navigation rather than design.
- **`.glass-nav` is the one slate at 0.72 under a 16px blur, and the alpha is a legibility floor
  rather than a taste one.** It was 0.15 under 12px once — defensible over a photograph you chose,
  wrong over a live map. **MapLibre is the default engine, so the ordinary case is white vector
  tiles, not dark satellite.** Composited, 0.15 over a white tile renders `rgb(219,224,225)` and the
  white links measure **1.33:1** (1.51:1 over a pale road fill, 13.79:1 over dark satellite) — the
  bar was legible in exactly the configuration nobody sees by default. It went to 0.86, which was
  unarguably safe and heavier than it needed to be, and then to 0.72 when the landing's transparent
  variant was removed and one value had to serve every ground. **0.72 measures 6.86:1 over a white
  tile and 9.33:1 over the hero photograph's brightest band.** Do not go below 0.60 — that is 4.54:1
  over white, passing with nothing spare, and those tiles are not ours to control.
- **There was a transparent variant on the landing, and removing it is what set the alpha.**
  `.glass-nav.is-over-hero` gave the landing a groundless bar on the argument that its first
  viewport is a photograph we chose and darkened ourselves. The argument was true and the outcome
  was a header that changed what it *was* depending on the route. Its removal paid for itself twice:
  the bar became consistent, and the hero's top scrim — which existed solely to give a groundless
  bar something to sit on — went with it, returning roughly 140px of the photograph's brightest,
  most detailed band.
- **The bar is a ruled grid, not a padded strip.** A bottom hairline under the whole bar, a vertical
  one closing the wordmark off from the links, and a trailing cell that is never empty and never
  holds two things. The bar carries no horizontal padding; the two cells do, and the bar is
  `items-stretch` — a rule can only span the bar's full height if the box carrying it is that tall.
- **There is no route table.** There was: `isUserFacing = isHome || /trips || isTripDetail ||
  isProfile` gated both vertical rules and the trailing cell, so `/offline`, `/backend`,
  `/backend/pipeline`, `/bench` and Next's built-in 404 rendered a bare wordmark on an empty bar —
  a second bar *shape*, shipped to defend a content argument ("an internal dashboard has no business
  carrying a Profile link"). The content argument is answered by content: those routes have nowhere
  to navigate to, so their middle cell is empty. The frame does not change. A 404 is the worst place
  of all to hand someone a smaller, different header than the one they arrived with — it is the page
  they most need a way out of. The two dashboards are dev-only and 404 in production, so the Profile
  link they now inherit is only ever seen by us.
- **Mobile menu: a full-screen surface, not a dropdown.** `fixed inset-x-0 top-[var(--nav-h)] bottom-0`,
  always mounted, `inert` plus `pointer-events-none` when closed. The bar and the panel become one
  field while it is open (`.glass-nav.is-menu-open` goes opaque and drops its blur), so the only line
  in the composition is the panel's own `border-t`. The toggle icon is a custom 3-bar mark that
  morphs continuously into an X — Lucide's `Menu` and `X` share no geometry, so swapping them is
  always an instant cut however well the panel animates. Escape closes it and returns focus to the
  toggle; there is deliberately no close-on-outside-tap, because full-screen there is no outside.

### The Landing Sequence (`src/components/blue-hour/`)
Six beats composed by `ScrollStory` inside a wrapper that cancels `<main>`'s padding so every section
reaches all four viewport edges, including the top behind the transparent nav.

- **`Hero`** — a scroll-scrubbed film, a two-line proposition, and the entry capsule. See **The
  Hero Film** below for the sequence itself; what matters here is the structure it needs.
  `.hero-track` owns the height (one viewport, or 400dvh once the film can run) and **must never own
  `overflow`**; `.hero-stage` inside it is `position: sticky` and owns the `overflow-hidden`.
  `.hero-scrim` is two stacked gradients
  doing two jobs — a top wash giving the transparent navbar something to sit on, and a bottom wash
  that is the ground the headline and capsule stand in, landing on `--canvas` exactly at 100% so the
  hero dissolves into the next beat with no seam. `.hero-dusk` is a scroll-driven wash of the one
  slate that takes the whole composition down as it leaves. All three are CSS on the `--story`
  timeline and **`Hero` runs no JavaScript at all**: a Chrome trace found scrolling frames resolving
  on the main thread, and stripping this component's five GSAP tweens and its pointer parallax was
  the fix.
- **`.hero-photo` is no longer the hero's, and its crop is `SceneBackdrop`'s now.**
  `object-position: 54% 44%` at landscape, `26% 56%` below `48rem`. The frame was chosen for a
  terracotta wall in its left third and a street of people at its base; the phone crop at the
  landscape position landed on cold dusk sky behind both headline lines and pushed the warm wall to
  a left-edge sliver. The hero's own poster is frame 1 of the film at a plain centred `object-cover`
  and must stay that way — it has to register with the canvas's cover-fit to the pixel, and an
  art-directed offset there shows as a jump at the hand-off. See
  **Open Items**.
- **`SectionOpener`** — a right-aligned uppercase label at `0.6875rem` / `--tracking-label` against a bottom
  hairline, with the asterisk mark in jade. One row, one rule; there is no two-column opener.
- **`ImageRow`** — four photo cards on a scene band. The photographs are never veiled: an earlier
  pass blurred every photo at rest and cleared it on hover, which at 2x read as four out-of-focus
  images and got the *source files* blamed for it. What survives is a flat 0.16 darkening tint that
  keeps the labels legible, faded on hover and never shown on touch at all.
- **`HowItWorks`** — the mechanism explainer, no photos, a line-masked heading reveal.
- **`FeaturedPlans`** — four worked examples, text left and photograph right with zero gap and
  adjacent cells sharing one hairline. Every budget is grounded in `estimateTierTotal` within $50 of
  a real tier estimate, and each card stores a **season** (`startMonthDay` plus `days`, resolved to
  the next occurrence at or after today) rather than a date, so a card can never prefill a value the
  form's `min={todayISO()}` rejects.
- **`DestinationMap`** — the world map beat, and the one band where the *density* of the drawing is
  the argument. The heading is "Anywhere you can name" and the standfirst says there is no list of
  supported cities to be missing from; the band shipped for a week with **exactly twelve pins**,
  which states the opposite, four of them flagged `featured` and none of those four the same place
  as any plan the site actually sells. Every one of the twelve also wore an accent radial glow while
  doing nothing, against **The One Meaning Rule**'s "jade acts".
  - **The land is a stipple**, not a flat alpha: one SVG `<pattern>` (14-unit cell, a 0.028 wash
    plus a `r=1.35` mark at 0.115) used as the existing Natural Earth path's `fill`, which clips to
    the continents for free. Hundreds of faint marks across every landmass is "anywhere" stated in
    the artifact rather than only in the heading — and it needs no generated geometry, which is why
    it beat the costed alternative of rasterising the path offline to sample a grid. The hairline
    coastline stays, so the continents keep their edges rather than dissolving into texture.
  - **Ninety-odd destination marks**, from `mapPlaces.ts`, on every inhabited continent — a real
    point symbol each (hairline ring plus solid core, the same geometry as a plan marker) in the one
    slate rather than jade, unlabelled and non-interactive. The first cut carried only the four
    plans, and four marks on a world map reads as half-finished, which is the twelve-pin defect seen
    from the other side. **Quantity is what resolves it**: twelve is a countable set and reads as an
    inventory; ninety is not counted and reads as "the world is full of places". The cut after that
    drew them as faint 4px dots to avoid re-inventing `featured: true`, and **that was the wrong
    reading** — at that weight they were texture, not places, so the map still said "four locations
    plus a speckle". `featured`'s sin was flagging four *arbitrary* cities as special; the four
    shipped plans genuinely differ, by being the ones you can press. So the separation is hue, label
    and size (**ratio 1.6x at 1440, never below 1.5x above `lg`**), and nothing inside the
    destination layer is ranked: one radius, one alpha, all ninety. Its radius is **clamped above
    100rem** via CSS `r`, because SVG scales with the viewBox while the plan markers are fixed at
    13px — unclamped the ring reached 10px at 2560 and the ratio fell to 1.3x. Where CSS geometry
    properties are unsupported the `r` *attribute* still applies, so the fallback is the unclamped
    mark rather than a broken one. Four of them sit in open water on purpose — Natural Earth
    110m cannot carry Santorini, Malé, the Galápagos or Bora Bora, and dropping French Polynesia
    from a travel map to satisfy a coastline dataset has the priority backwards. The layer renders
    at every width, which is what stops the phone getting a bare stipple.
  - **Hovering a destination names it**, in the same type step and shadow as a plan marker's label,
    from one delegated listener rather than eighty-seven. **The name is all it says, and that is a
    decision rather than an omission**: there is no destination-level cost data anywhere in this
    codebase — `estimateTierTotal` is destination-independent, so a 7-day budget trip computes to
    $730 whether it is Hanoi or Zurich — so a per-city "from $X" would either be identical on every
    mark or invented. Neither belongs on the page headed "Plan a trip that costs what you said it
    would." The four real prices stay the only figures on the map, which is what makes them mean
    something. Hover-only and hover-only on purpose: these marks are `aria-hidden` decoration, and
    making them focusable would put 87 tab stops between the heading and the footer to reveal names
    a screen reader gains nothing from. No transition on the tooltip either — sweeping across
    Europe re-anchors it twenty times a second, and a fade on each is both jitter and twenty
    navbar-blur re-rasters.
  - **Four destinations are filtered out where a plan marker already occupies the pixel** — Rome
    (4.8 units from Val d'Orcia), Agra (7.4 from Jaipur), Jerusalem (7.4 from Wadi Rum), Venice
    (8.4). A plan ring is 6.5 in radius and a destination ring 4, so anything under 10.5 is two
    rings drawn through each other, which reads as a rendering fault. The threshold is that sum and
    it is **computed from `planExamples`**, not applied by deleting rows: a plan's coordinates can
    move, and a hand-pruned list would silently start colliding again or leave a hole where a plan
    used to be.
  - **Four plan marks, and each one is a control.** They are the four `planExamples` read straight from
    the data module — the coordinates now live on `PlanExample`, so the `featured` fiction cannot
    come back — and clicking one opens the wizard prefilled through the same `toPrefill` path
    `FeaturedPlans` uses one band above. Hairline jade ring, 4px solid core, place name in the label
    step, price in **gold tabular mono** because these four are read across the map to be compared.
    No halo: zero-offset coloured glow is the tell this system already records removing from the
    app's own day badges. Accent-bearing elements in the band go **24 → 4** (measured, plus
    `SectionOpener`'s asterisk either way), and all four are now buttons with accessible names —
    the only accent-bearing and only interactive things on the field, which is what keeps the two
    layers legible as "places exist" and "these four you can press". The labels carry
    `.hero-legible`'s device at a tighter radius, and that is measured rather than precautionary:
    with the destination layer in, a mark landed inside all four label boxes and one sat mid-glyph
    on Val d'Orcia's price, reading as punctuation. Both layers of the shadow are **centred**, not
    offset downward like the hero's — the hero sits over a photograph where a downward shadow reads
    as light from above, while the interference here arrives from every direction.
  - **The marks are `lg`-and-up in full, and the breakpoint is measured.** Three of the four plans
    are in western Eurasia: at 375px the map is 335px wide and Val d'Orcia, Sinaia and Wadi Rum land
    inside a 22×17px box, where three rings are a smudge and three tap targets 13px apart fail WCAG
    2.2's target spacing outright. `display: none` rather than a visual hide, so they leave the tab
    order too. Below `lg` the band is the field and the paragraph. Label anchors are hand-placed for
    the same reason a solver was not written for four things — Val d'Orcia leaves left, Sinaia up,
    the other two right; closest approach between label boxes is 48px at 1440 and 62px at 2560.
  - **Motion is one pass and it terminates.** A GSAP `ScrollTrigger` timeline resolves the field's
    opacity, then staggers the marks on **`expo.out`**, which deletes the app's only
    `back.out(1.7)` — an overshoot that ran two inches under a heading revealing on `expo.out`, and
    the wrong gesture for a claim about coverage. Deliberately **not** on the `--story` timeline:
    its offsets are absolute scroll lengths from the scroller's origin and this band is fifth of
    six, so any `animation-range` here would shift whenever a band above it changed height.
    `trigger` + `start` is element-relative and immune. Nothing loops, per **The Blur-Of-Nothing
    Rule** — the fixed navbar's `backdrop-filter` is on screen at every scroll position, so a
    pulsing marker would re-raster it at refresh rate for as long as the band were in view.
  - Its `.destination-*` rules are **unlayered in `globals.css`**, and that is deliberate rather
    than incidental: `.destination-dot` existed for a year as a GSAP selector only, with no hover or
    focus state to lose because the dots were not controls. Now that they are, a `hover:` or
    `ring-*` utility here would be emitted inside `@layer utilities` and lose to any unlayered rule
    touching the same property. Focus is `.focus-ring`, per **The Focus-Ring Rule**.
- **`HeroSearch`** — the entry capsule, documented above.

### The Hero Film (signature)
100 AVIF frames of a camera dolly out of a cave toward Al-Khazneh, drawn to a `<canvas>` at
whatever frame the scroll position asks for. `HeroFrames.tsx` is the engine;
`scripts/build-frame-sequence.mjs` produces the frames from footage kept out of the repo, and
`scripts/extract-frames.swift` pulls them from the source video via AVFoundation.

**Frames come out of the MP4 losslessly, not through a web converter.** The first two cuts read a
zip of PNGs exported by ezgif, which had written 24fps source into a 30fps container: 60 of 300
frames were byte-identical repeats on a 5n+3 stride, and every frame carried an extra compression
generation. AVFoundation decodes the original H.264 once and returns the exact frame at the exact
presentation time. `requestedTimeTolerance` is pinned to zero at both ends — without it the
generator returns the nearest *keyframe*, so asking for frame 37 can hand back frame 24, silently,
and the result looks exactly like footage that stalls.

**The arc is the whole point: you start inside the cave and it opens onto the temple.** All 240
frames of the source are used, with **nothing excluded** — see the rigidity rule below for why the
current footage needs no surgery where its predecessor did. Measured frame-by-frame on the
*previous* clip, kept because it is the reason the metric changed:

| unique | edge energy (27.2 median) | luminance | what it is |
|---|---|---|---|
| 1-57 | **34.4-35.5 — the crispest in the reel** | 88 → 99 | inside the cave, slow push |
| 59-71 | 34.2 → 22.2 | 97 → 80 | into the dark passage |
| **72-78** | **20.4-21.4** | 77 → 69 | **the double-exposure artifact — excluded** |
| 79-147 | 21.9 → 33 | 66 → 125 | out of the dark, brightening |
| 149-163 | 32 → 28 | sky peaks 12.1% | the reveal |
| 165-239 | 27.7 → 21.4 | 119 → 98 | closing on the facade |

**A cut that dropped frames 1-85 was shipped and reverted, and the reason is worth keeping.** It
was justified on the camera being nearly static through 1-57 — true, difference 1-6 against a 6.8
median — so those frames bought little scroll travel per byte. But that section *is* the cave,
which is the reason for using this footage, and it is also the highest edge energy in the reel. A
motion metric said "cheap" about the most valuable material in the shot. **If this window is ever
narrowed again, narrow it from the end.**

**The Rigidity Rule, and it exists because edge energy was the wrong metric.** The previous
footage had a zone where the render morphed and the canyon walls changed identity mid-shot. Finding
it took three attempts, because the metric in use — edge energy — is structurally blind to it:
morphing geometry keeps its *texture* sharp while its *structure* drifts, so the broken frames
scored 34-35 against a 27 median, i.e. the crispest in the reel.

The metric that sees it is rigidity. Block-match consecutive frames, fit a radial expansion (which
is what a forward dolly produces), and measure the residual. Run on both clips at identical
spacing: the old footage came in at a **median 0.541px with 94 of 120 pairs above 0.4px**, this one
at **median 0.095px with 0 of 120** — 5.7x more rigid, which is why nothing is excluded now.
**After any new footage lands, run rigidity, not edge energy.**

**Geometry.** A 400dvh `.hero-track` containing a 100dvh `position: sticky` `.hero-stage`, so the
travel is exactly 300dvh and scroll progress maps 0→1 across precisely the pinned run — the film
starts as the hero pins and finishes as it unpins, rather than approximately. At ~27px of scroll per
frame it reads as continuous.

**The 400dvh is opt-in, and that is the whole fallback story.** The track is one viewport until
`data-seq` is set, which `Hero` does only once it knows the film can run. No JavaScript, reduced
motion, **a request to move less data**, or a frame that fails to load all leave the hero exactly
one screen tall showing the poster. Nobody is ever made to scroll three empty viewports past a
still image.

**The Decoration-Is-Not-Worth-Ten-Megabytes Rule.** The film is 9.76MB and it is ornament — so it
is gated on bandwidth as well as on motion. `prefers-reduced-data: reduce`, `navigator.connection.
saveData`, and an `effectiveType` of `2g`/`slow-2g` each decline it, and declining costs nothing
because the poster hero is already the fallback. The first two are the visitor *asking*; the third
is inferred, and it is included anyway because the error is asymmetric — a false positive costs a
decorative film with a good fallback, a false negative saturates a connection somebody is trying to
use for the actual page. `3g` is deliberately excluded: the film loads progressively and is
scrubbable from a quarter of its frames, so a 3G visitor gets something rather than nothing.
`npm run verify-hero` asserts the collapse.

**Named Rules**

**The Track-Owns-Height, Stage-Owns-Overflow Rule.** They cannot be one element. `overflow: hidden`
makes an element a scroll container, so a sticky box inside one resolves against a scrollport that
never scrolls and pins at its start offset forever — indistinguishable from sticky never having
been applied, with nothing logged. The corollary is that the whole chain from `.hero-track` up to
`.content-overlay` must stay free of `overflow`, `contain` and `content-visibility`. **Adding any of
those three to `<main>` or to `ScrollStory`'s wrapper silently unpins the hero.**
`scripts/browser-matrix.mjs` asserts the pin per route per engine because the failure is invisible.

**The Sticky-Is-Not-The-Deleted-Pin Rule.** A `ScrollTrigger({ pin: true, scrub: true })` hero
shipped here once and was removed for five reasons. Three were properties of GSAP's pin, not of
pinning: `pinType: "transform"` rewriting `translateY` every frame because the scroller is an
element, a pin spacer mutating the scroller's `scrollHeight` mid-gesture, and `refreshPriority: -1`
sorting the pin *last* so every trigger below measured against a spacer-less layout and fired a
viewport early. CSS `position: sticky` has none of them. **Do not reintroduce `pin: true` here.**

**The Draw-On-Change Rule.** The rAF loop eases a float index toward the target but only calls
`drawImage` when `Math.round()` of it changes, and it terminates itself once settled. Measured: **0
draws over 3 seconds idle, and exactly one draw per frame index the scroll crosses** (36 draws for
36.6 indices), so the rate tracks scroll speed rather than refresh rate. That is the actual
mitigation for the navbar's `backdrop-filter` re-rastering, and it is why `.hero-light`'s 24s
infinite loop is *paused* while the film is live — two ambient motions at once was never the intent,
and that one kept the navbar re-rasterising at refresh rate whether or not anyone was scrolling.

**The Readiness-Is-`onload` Rule.** Not `img.decode()`. Measured in this app's own preview engine,
`decode()`'s promise **never settles** — not detached, not attached, not even after `onload` has
fired with `complete === true`. A promise that never settles deadlocks the load queue and sticks the
film near frame 1, which is the exact defect the technique exists to avoid. `onload` is the signal;
a one-pixel draw into a scratch canvas forces the decode off the scroll path.

**The Equal-Visual-Change Rule.** Frames are sampled so each carries the same amount of picture
change, not at an even frame index. The camera does not travel at a constant rate: consecutive-frame
difference across the raw sequence swings **14×**, so an even-index sample mapped linearly to scroll
crawls where the camera crawls and rips where it accelerates — most of what read as awkward.
Sampling along a cumulative-change curve leaves exactly one step above 1.6× the median, and that
one is the deliberate exclusion seam. Through the cave the sampler runs out of frames to skip and
lands *below* target, so that section is smoother than asked for rather than steppier.

**Never blank, never stuck.** If the frame the scroll asks for is not decoded, the nearest decoded
frame within ±8 is drawn instead and the last good frame is held otherwise. Frames load in a
stride-halving order (every 16th, then 8th, 4th…), so after eight requests the entire run is
coarsely scrubbable rather than being sharp at the start and empty everywhere else.

**Two tiers, and the portrait one is a different crop.** 1600×900 landscape (9.76 MB, 100 KB/frame
at q44) and 540×960 portrait (4.33 MB at q50); a visitor downloads one. No blur.

**AVIF, and the decision reversed on measurement.** AVIF was tested and rejected on the previous
footage, where it only beat WebP below q52 and was *larger* at q60 — because that clip was
noise-dominated, and noise is the one thing AVIF has no advantage on. This footage carries real
detail instead (edge energy 36 against the old 27 median), which is exactly where AVIF wins: 37%
smaller at matched quality, and at 1:1 against a q88 reference the carved frieze, the capitals and
the rock striations are indistinguishable. **Re-measure the format per clip rather than inheriting
the verdict.** The `browserslist` floor is Safari 16.4 / iOS 16.4, precisely the release AVIF landed
in, so every browser this project declares support for can decode these; one that cannot degrades
down the same path reduced-motion takes — frames fail, `data-seq` never reaches "live", the track
stays one viewport and the poster is the hero. A 16:9 frame cover-fitted into a 9:16 viewport keeps
27% of the source width, which on a phone is canyon wall and no Treasury — so portrait gets its own
centre crop, which the shot's dead-centre subject makes safe. Backing store is capped at DPR 1.25 — see above; raising it buys
no sharpness once the source is the limit and only costs fill rate.

**No pre-blur, and the version that had one is recorded because the reasoning was seductive.**
Quality alone cannot compress this footage — q72 to q36 saves only 33%, the signature of a noisy
render spending its bits on grain — so an earlier cut pre-blurred 1.0px and took 1152×648 from
123KB/frame to 44KB. A 3× win, and it read as mush, because it compounded with the canvas
upscaling a 1152px source into a 2160px retina backing store: **1.88×**. The rule out of it:
**sharpen the source and match the backing store; never soften the source to save bytes.** 1600px
against a `DPR_CAP` of 1.25 gives a 1.13× upscale at 1440 CSS — those two numbers are a pair, and
moving one alone reintroduces the problem.

**The scrim is a touch deeper while the film is live, and that is a measured fix rather than a
preference.** The film is brighter than the photograph the scrim was tuned against, and brightest
exactly where the headline sits. On the untouched scrim the worst pixel behind the headline ran
**1.92:1, with 36 of 80 frames below the 2.38:1 the outgoing photograph measured** — concentrated
in frames 23-64, the stretch a visitor reads longest. Three deeper ramps were measured and the
shallowest that clears the bar ships; the next two reach 3.33 and 4.25 but bury the imagery. Re-run
against the restored cave arc it still holds unchanged — **2.56:1 worst, 3.17:1 mean, 0 of 100 below
baseline** — so the ramp was not retuned. 41 of 100 sit below the 3:1 AA-large threshold at the
single worst pixel, which is the standing condition of type over photography on this beat and was
true of the photograph before it too. Scoped to `[data-seq="live"]`, so the poster and
every fallback keep the original. The mechanism carrying type over photography is unchanged —
`.hero-legible`'s three-layer text-shadow, which contrast-ratio maths does not model.

**The Frame-URLs-Are-Content-Addressed Rule.** Frames are served from `/scenes/petra/<hash>/`,
where the hash covers the window, the frame count, the tier config and the source archive. This is
not tidiness: `next.config.ts` serves that path `immutable`, and `immutable` means the browser
never revalidates. An earlier cut shipped `immutable` against fixed filenames on the reasoning that
the build rewrites the whole directory; the next run disproved it, serving 74,022 cached bytes
against 77,002 on disk. In production that is a returning visitor scrubbing a *mixture* of two
edits. **Never point `immutable` at a path whose contents can change.**

### Map Controls
Apple-Maps-grade chrome, and the only place `.glass-control` is used: a vertical stack of 44px targets
— a two-button zoom pill, a 2D/3D toggle labelled with the mode you'll *get*, a rotated native `range`
tilt slider in a round pill, and a compass whose needle is written directly to the DOM on `postRender`
so steady-state re-renders stay at zero. The tilt slider is a native input rotated -90°, not a library
and not `writing-mode: vertical-lr` (which only became a vertical range in Safari 17.4); its track and
thumb need explicit rules because `appearance: none` strips the platform rendering.

### The Itinerary Card (signature)
The card leads with a photograph of the destination, pinned to the top of the panel's scroller,
compressing as the plan scrolls under it and springing back on the way up. `--hero-p` is written by
`ItineraryCard` — one custom property per frame, 0 unscrolled to 1 fully compressed — and height,
padding and both title opacities derive from it, so the whole animation is one write against the
compositor rather than a re-render of a card that owns a day list. The header runs `11rem` collapsing
to `4.5rem` (`14rem` from `sm` up); at the previous `18rem` the photo was 288px of an 826px panel,
35% of the plan spent on the header before a single stop was visible.

Two mechanics worth keeping: the two titles cross-fade on non-overlapping ramps (the large one gone by
45%, the compact line arriving after 55%), and `visibility: hidden` flips at the same 0.45 the opacity
clamp reaches zero. `opacity: 0` hides a control from the eye and from nothing else — measured fully
compressed, a real pointer at the lower half of the Download link landed on an invisible `<a download>`
floating over the compact title strip, and it was still a tab stop.

The money surfaces show the palette's whole argument: costs and the day Total are gold mono figures,
the over-budget line is coral, and the day tab you are on is the only jade thing in the panel. The
Total row is no longer a filled slab in the action colour — a solid button-coloured bar whose entire
content is a number was the single clearest case of an action hue reporting a readout.

### The Globe (Cesium rendering)
The globe is the product's one piece of real imagery, so its clarity is a design decision, not a
default. Three settings carry it, all in `GlobeBackground`:

- **Detail is tiered by camera height**, because a single `maximumScreenSpaceError` does *not* mean a
  single real-world detail level. Google's tile tree is structured differently per region: measured at
  an identical pose, Cesium's default of 16 resolved to 8 m geometry in Frankfurt and 16 m — one whole
  LOD level shallower — in Mumbai, which is 166k triangles against 21k and exactly why one city's
  buildings read as buildings and the other's as flat roofs. `LOD_TIERS` buys detail only where it is
  legible: **SSE 8 with `dynamicScreenSpaceError` off below 2 km**, **12 between 2–50 km**, **16
  above**. Applied on `preRender`, written only on tier change.
- **Tint at `colorBlendAmount` 0.1**, `MIX` toward `#9BA6B4`. `MIX` toward a *mid* grey pulls
  highlights down and shadows up at once, so it crushes contrast rather than only saturation. At 0.2
  that read as mud over hazy aerial imagery and structures stopped separating. It must stay on the
  tileset and never become a CSS canvas filter — a filter would desaturate the route overlay too.
- **Above-CSS pixel density.** `useBrowserRecommendedResolution` is `false` with `resolutionScale`
  capped at **1.5×**. Cesium's default renders at CSS pixels and ignores `devicePixelRatio`, so on any
  scaled display the canvas is upscaled and building edges go soft no matter how good the mesh is. The
  cap was lowered from 2× on measurement: on a 2× / 160Hz display the old cap produced an 8.5-megapixel
  canvas and a moving camera sustained **33.7 painted fps** against a 60 target. Note the same knob
  scales every `backdrop-filter` panel, since the glass samples the canvas in device pixels.

Measured floor: at the close tier both cities reach **2.01 m** minimum geometric error at ~57 fps. SSE
4 was tested and rejected — it buys *no* further detail (2.01 m is Google's tree floor) while costing
21 fps and 1.1 GB of texture.

**The Mounted-Surface Gate.** The globe is on exactly two surfaces: `/trip/[id]`, and `/` from
generation start through the result view. It is not a page background; it is the map, and it appears
where there is a route to look at. A cold `/profile` was paying 5410ms of long tasks across 32 tasks,
a 2287KB chunk, 33 `/cesium/` asset requests and a live WebGL2 context to put a globe behind a
settings form. The gate is `globeWanted` in `mapCamera.tsx`, declared by the components that own those
surfaces — never a pathname.

**Two engines, one contract.** `src/lib/mapRenderer.ts` is the interface both CesiumJS and MapLibre
implement, and nothing above it imports either engine. The contract is in metres, degrees and CSS
pixels: no `Cartesian3` and no `LngLat` crosses it, camera aim is a target point plus a *range* rather
than a zoom, and **pitch is Cesium's convention everywhere — negative is down**. MapLibre's complement
is converted inside `maplibreRenderer.ts`; getting that backwards silently inverts the tilt slider.
The Map/Satellite toggle keeps the view by capturing `cameraState()` off the outgoing engine
synchronously in `setEngine` — not in an effect reacting to the change, because by then the outgoing
canvas may already be hidden, and a hidden canvas is a camera nobody can read.

### The Day on the Globe (signature)
The map has to be readable on its own — you should be able to take the day off it without the panel.
All of it is built in `mapRoute.ts` and floats at one sampled altitude:

- **A title card per stop** (`.marker-title-card`): the name on a small chip of map glass at 0.75, a
  hairline white edge, 5px radius, an 8px backdrop blur, and a soft dark bloom bleeding past it so the
  chip dissolves into the photography rather than sitting on it. Legibility took three passes and the
  middle one is instructive: the second removed the chip entirely and leaned on an omnidirectional
  black halo, on the argument that a box on the map is chrome. That instinct is right and it was not
  enough — the halo is a *black shadow*, and a black shadow under white text over a white plaza at
  midday has nowhere to go. The chip is the guarantee the shadow could only approximate.
  **The blur is this layer's one performance hazard and it is a deliberate trade.** The anchor's
  `transform` is rewritten every `postRender` frame, a filtered element owns a render surface, and
  moving one re-rasters everything behind it — once per frame, per card, up to fifteen at a time, over
  a streaming tileset. The fill at 0.75 already carries the contrast, so if panning a long trip ever
  stutters, the blur is the first thing to cut and costs nothing but gloss. A receded card drops it
  already, which is where most of the count is.
  It is an HTML overlay rather than a Cesium billboard (a billboard is a texture and cannot carry the
  app's CSS), and `StopMarkerLayer` reprojects each card every frame with
  `SceneTransforms.worldToWindowCoordinates` — the CSS-pixel variant, because `resolutionScale` is
  customised here and the drawing-buffer variant is a different space. It scales by distance
  (`clamp(900000 / (d + 260000), 0.55, 1)`) and hides on a dot-product horizon check against the
  geodetic surface normal, so a stop on the far side of the globe does not smear across the limb.
  **Depth focus:** the same per-frame scale is written to `--marker-depth` on the anchor, which the
  card maps to opacity — read as `var(--marker-depth, 1)` *at the point of use*, never redeclared on
  the card, since an element's own declaration always beats an inherited one and a card-level default
  silently disabled the whole effect the first time it was built. The filter half of the rack focus is
  gone: it cost a render surface per card and never exceeded 0.675px anyway. If the far end reads
  flat, widen the opacity ramp rather than bringing a filter back.
- **A day badge per cluster** (`.marker-day-label`): louder than a stop name in four ways at once —
  tracked out, uppercased, set in the map display face, and edged and lit in that day's own core and
  glow. It has to win the eye at a zoom where the stop names are at their 0.55 depth floor, and it is
  the only label drawn at all while the plan panel is shut. **Colour is never the whole message: the
  label says which day in words**, so a six-day cycle and a colour-blind reader both stay fine.
- **A light pillar** at each stop: a translucent cylinder, a wide emissive halo, and a thin hard core
  inside both. The cylinder is what makes it a beam rather than a stroke — a polyline's width is
  screen-space, so a pillar made only of polylines is the same thickness at 300m as at 30km, which is
  precisely what a shaft of light does not do. It is wider at the bottom than the top, so the light
  reads as pooling *into* the ground ring rather than being projected up out of it.
- **Radar rings** on the ground under each pillar: two translucent discs at falling alpha under three
  concentric rings that brighten in sequence from the inside out, each a third of a cycle behind the
  one within it, so the eye reads a wave travelling outward. **The rings are the figure** — discs
  alone read as a stain on the photograph, while a circle has an *edge*, which is the thing imagery
  cannot fake underneath it. They are polylines traced around the circle rather than `ellipse.outline`,
  because `outlineWidth` above 1 is silently ignored on Windows/ANGLE.
- **Raised glass ribbons** between consecutive stops: a great circle at 256 samples, lifted on a sine
  so it leaves and meets its card level. One material drawing a neon body between two dark casing
  edges — not a bright line stacked on a wider dark one, because two stacked polylines are two draws
  whose depth ordering is not guaranteed in a scene holding translucent 3D tiles, and the casing
  flickered through the core wherever they tied.
- **The ribbon is shaded like glass, by a custom shader** (`glassRibbon.ts`). Three things happen
  across the line's width at once: the dark casing at both edges, a body that shades like a rounded
  surface, and a narrow specular streak along one shoulder. Only the first is available off the shelf;
  the other two are functions of position across the width, a value that exists only inside the
  fragment shader (`materialInput.st.t`) and cannot be addressed from the entity API at all. The
  casing half is a **verbatim copy** of Cesium's PolylineOutline material, so `outlineWidth`'s "total
  across both edges" semantics still hold. The shading is computed in *interior* coordinates rather
  than raw `st.t`, which keeps the highlight proportional as the ribbon tapers.
- **The ribbon tapers** from the stop being left toward the stop being arrived at, so the shape says
  which way the day runs before any animation does. Cesium has no per-vertex width, so this is
  consecutive polylines of falling width sharing boundary vertices; the casing stays a fixed pixel
  count while the body narrows, so the colour tapers harder than the edges do.
- **A travelling pulse** along each ribbon in the direction of travel. A dash material with a
  transparent gap colour and an animated `dashPattern` — a 16-bit mask the shader tests per fragment,
  so rotating it one bit per step slides the lit band a sixteenth of a dash along the line, and
  rotating *left* moves it toward increasing vertex index, i.e. chronological. It is a uniform, so
  nothing rebuilds. The dash is measured in screen space rather than arclength, which is why the pulse
  neither stretches nor bunches as the camera moves. Static dashes stay rejected: a dash pattern
  *instead of* the line stipples one continuous shape into something with no followable line left.
- **A shimmer and a sweep** underneath all of it, both alpha-only and both held flat under
  `prefers-reduced-motion`. Alpha rather than radius on the rings for a mechanical reason: a
  `CallbackProperty` on `positions` moves that geometry into Cesium's dynamic batch and rebuilds it
  every frame for every ring of every stop, while a material colour is a uniform and animates free.

**Everything above answers to the same two pieces of state, and adding a piece that doesn't is the
failure mode this section exists to prevent.** `setDayState` sets how present a whole day is
(`baseline` / `active` / `dimmed` / `hover`) and `setEmphasis` marks the one stop being pointed at —
from a marker card or from its row in the plan, since both write the same index. Every material
multiplies by the day's `stateAlpha`, so a receded day fades as one object rather than leaving a
bright halo around a dim line; the casing follows it too, or a dimmed day would read as black lines
with a ghost of colour inside. The ribbon body, the travelling pulse and the radar rings take emphasis
through their own per-frame callbacks; the halo, the pillar and the discs are repainted imperatively
in `applyTints`. **Never write a `ConstantProperty` over the first group** — it replaces the callback
and stops the animation dead on the first hover.

Two things the layer must keep doing. It is a **sibling** of the content overlay in `AppShell`, never
a child — that overlay scrolls, and a card inside it slides off its own stem. And the cards'
`visibility` belongs to the render loop alone: React re-applies inline styles on every re-render, so a
React-managed `visibility` blanks every card for a frame each time the provider updates. For the same
reason, `.marker-title-card` transitions `color` / `background` / `border-color` / `text-shadow` and
**never `opacity`** — opacity is driven off the per-frame `--marker-depth`, so transitioning it
restarts a 400ms fade toward a target that has already moved, on every card at once.

**Names declutter, stops do not.** Cards are suppressed when they would overlap (two axes, since a
card is wide and short, scaled by the card's own scale). Losing that contest costs a stop its name, not
its presence — the stem and pool are always drawn, so a dense day still shows every stop and reveals
more names as the camera comes in. One place legitimately has one coordinate, and the preview trip's
day 1 has eight stops on six coordinates with three identical, because three things happen at the same
hotel.

**Day and night.** `.globe-tint` uses `mix-blend-mode: multiply` for every phase with only
`background-color` changing between them. `mix-blend-mode` is not animatable — it snaps — so a
per-phase blend mode would make the crossfade impossible and put a jump cut in the middle of a camera
flight. Multiply is the one mode that works for all three tinted phases, because all three are the
same operation on daylight photography, and a fully transparent multiply layer is a no-op, which is
what makes `day` free rather than a fourth case. Night is a deep blue rather than a grey: multiplying
toward neutral just underexposes the photo and reads as a dimmed screen. Alphas are tuned against the
route arcs, not just the ground — the arcs live inside the Cesium canvas and get multiplied too.

### Tier Cards (signature)
A three-up grid of 200px-tall image buttons: a full-bleed SVG illustration scaling to 1.05 on hover, a
`from-black/85 via-black/25 to-transparent` bottom-up gradient, a display headline and a two-line
clamped description at the base. Price rides in a top-right slate badge as a gold mono figure.
Selection is an inset jade ring plus a round jade check badge; hover is `ring-white/40`. Over-budget is
expressed as weight and text alpha only — the badge keeps its slate backing, because this state is
reachable mid-keystroke and the price is data. Each card carries a small cursor-driven tilt
(`perspective(800px) rotateX/rotateY`, capped at 8 degrees) on its **inner** visual layer, gated behind
a one-time `(pointer: fine)` plus reduced-motion check on mount.

### Memory Cards (signature)
`/trips`' saved trips as photo cards: `usePlacePhoto(trip.destination, "full")` resolving onto a
`next/image` `fill` layer over a permanent `--tile` base — the Constant-Ground Rule, since a slow photo
lookup must not blank the card and a resolved photo must not repaint the tile itself. The photo tile is
a **16:10 ratio**, not a fixed height: uncapped and three-up a card passes 600px, and 600x200 is a 3:1
letterbox that centre-crops straight through the landmark. `sizes` tracks the column count per The
Optimized-Photo Rule. The card is `.glass-itinerary`; `.memory-card` adds only what glass does not — a
`translateY(-3px)` lift and a deeper shadow on hover, in two separate rules so the two states never
contend over one property list. The dashed postage stamp, the paper ground and the per-card tilt are
all gone: they made this route a third visual language in a product that should have one, and a
visitor arriving from a trip detail crossed from dark glass to tilted cream stationery in one click.

### Confirm Dialog
The app's one modal, and deliberately its only one: it exists for actions that cannot be undone and
nothing else. Native `<dialog>` driven by `showModal()`, which buys the four things a modal has to get
right — a focus trap, Esc-to-close, the rest of the page going `inert`, and top-layer rendering. The
panel is `.glass-itinerary` over a real `::backdrop` (black at 0.55 with a 4px blur) rather than a
sibling overlay div, so it cannot be covered and needs no z-index in a shell that already stacks four
layers. `open` cannot be an attribute — `<dialog open>` renders *non*-modally, with no top layer, no
focus trap and no backdrop — so an effect must translate the prop into imperative calls, and Esc's
`cancel` event must be routed back through `onCancel` or the element closes while the parent still
thinks it is open.

### The Wait (signature)
Two and a half minutes with nothing to show yet. The screen answers it by stating what is already known
instead of asking for patience: the destination photographed full-bleed, its name at display scale, and
— the actual content — a rotating feed of true facts about the place. The machinery sits in a darkened
band at the foot: the four steps, one forecast line, the elapsed expectation, and a Cancel that appears
only after ten seconds.

**Only large type sits on the photograph** — see The Photograph-Is-Not-A-Surface Rule. That is why the
facts are set at display scale rather than as prose, and why every small run was pushed into the band.

**The globe is covered, not switched off.** Cesium boots at generation start and this screen is opaque
on top of it; the import and first tiles are free inside a wait this long, and the queued destination
flight replays on `setViewer` so the result opens already framed.

**Four steps, not five.** `geocode` and `context` total about three seconds of the ~150 and mean nothing
to a person waiting, so they share a column. The four that remain are the same four the landing's "How
it actually works" promises.

**Progress never enters React state.** It ticks ten times a second straight into a `--gen-progress`
custom property, because re-rendering the tree at that rate would reconcile the whole screen for a value
one bar reads. The bar's CSS transition smooths those ten writes into motion, so it is the one element
exempted from the blanket reduced-motion rule — removing its transition would make the bar jerkier, not
calmer, which is the opposite of what the setting asks for. **A segment cannot finish early**: inside
whichever stage is running the fill advances on `1 - exp(-t/tau)`, approaching its segment's end without
reaching it, so only a real `done` event completes it. Structural, not a "stop at 95%" clamp.

### Destination Facts (signature)
True facts about *this* trip, rotating every 7s directly beneath the destination name at display scale.
They are the screen's content, not its footnote.

- **The facts are real and cost nothing.** Derived from data already fetched for other reasons — the
  Step 2a bundle, the destination-context cache, and the Wikipedia extract that arrives with the photo.
  **No model call:** `runClaude` spends nearly all its wall clock on time-to-first-token, so trivia
  fetched that way would land *after* the plan it was meant to fill the time for.
- **The pool is sized to the wait, not to a screenful.** ~150 seconds at 7s is about 21 slots, so the
  cap is 30 with each family contributing at most 5. The cap is a ceiling; the data is the constraint —
  measured against a live Kyoto run the real pool is **13**, so it still wraps once.
- **Safety notes are excluded by decision, not omission.** A line about pickpocketing is useful in an
  itinerary; delivered as ambient trivia to someone who has already committed and paid, it is anxiety
  with no action attached.
- **Two copy rules the tests enforce.** Weather wording may not say "forecast", "expect" or "will be"
  unless the data really is a forecast — beyond ~16 days the app serves last year's same dates, and
  presenting that as a prediction is a lie the traveller cannot detect. And sunrise/sunset are formatted
  by string slicing, never `new Date()`: they are destination-local wall-clock with no zone suffix, so
  parsing them shifts a Kyoto sunset by hours for someone planning from London.
- **The facts sit outside the `role="status"` region.** Inside it they would be announced on every
  change. Only one line is announced — which stage is running.

## The Trip Line (Downloadable Itinerary Export)

A second, fully scoped world — additive, and narrower than anything else here. It governs exactly one
artifact: the `.html` file `renderItineraryHtml()` (`src/lib/export/itineraryHtml.ts`) produces and
`GET /api/trips/[id]/export` serves. None of the app's CSS custom properties were touched, no shared
class reaches into this file, and the export's entire stylesheet lives inside one exported template
string. It never enters `globals.css` and never shares a token name with the rest of this document.

**Why this world is light.** Every other surface is dark because it floats over a live globe — darkness
is what lets frosted glass read as glass over that scene. A downloaded file has no globe behind it and
nothing to be glass *over*, so the app's central material justification does not apply. This world
inverts deliberately, onto a cool off-white ground (`--paper: #F5F7F7`) with near-black ink
(`--ink: #0B2A32`). It is not a lighter version of the app; it is a self-consistent world built for a
static, printable, single-column document.

**The thesis: a day is a route, not a list.** The export refuses the itinerary-app default of stacked
day cards and draws the whole trip, and each day inside it, as a transit map: an 8px rounded trunk line
(`--trunk`, in `--deep: #0d2e37`) that every station and stop sits on top of.

### Colors
- **Paper** (`#F5F7F7`): the page ground, and the resting colour of every `<details>` day row.
- **Card** (`#fff`): station/stop node fill at rest, the weather badge and stay-card backing.
- **Ink** (`#0B2A32`): body text and stop names.
- **Deep** (`#0d2e37`): the trunk line at every scale — the trip-wide line and each day's own route
  line share this exact colour and weight, never two different "line" colours.
- **Muted** (`#5B7178`): dates, metadata, captions — the export's only secondary text tone.
- **Hairline** (`rgba(11,42,50,.14)`): day-row dividers, pill borders.
- **Accent** (`#28b981`) / **Accent Ink** (`#0D6042`): jade, marking only the thing currently
  active. Re-authored as its own hex rather than referencing the app's `--accent`, because this file
  cannot read the app's CSS variables and does not try to. It carried the previous system's amber
  (`#fb9826` / `#A85C05`) through two palettes, and was **re-hued by measurement rather than by
  copying the app's hex** — the export's marks are validated *all-pairs*, since on the map any two
  can sit side by side. Jade's worst pair is dE2000 18.7 (jade/transit) against a 15.5 floor where
  amber was 18.5, and the worst CVD pair (`food`/`transit`, 10.9) is untouched by the accent. Coral
  was rejected at dE 4.0 against transit under simulated protanopia; gold separated best but had the
  worst contrast, and gold means money in this system.

  **The two shades split by fills versus strokes**, and that split is also a fix. `--accent` fills,
  where dark ink sits on it (6:1 for the day number) and a white ring separates it. `--accent-ink`
  strokes and rims, where the mark *is* the colour: 7.58:1 on white for the 1.9px stay icon, 3.01:1
  against the jade fill for the open day's rim. The map's active route line used the fill shade and
  measured 1.86:1 on land as a 2.6px stroke — under the 3:1 floor for a graphical object. On the ink
  shade it is **6.48:1**, and still 4.69:1 against the inactive lines at their 17% opacity.

### Named Rules
**The Reserved-Accent Rule, re-authored.** The export's accent marks only the open day and the active
stop — never a category, a leg mode, or decoration — carrying the app's One Meaning Rule into a world
with no shared tokens to enforce it.

**The Single-Trunk Rule.** One line grammar, `--deep` at `--trunk` (8px) with a `999px` radius, draws
both the trip-wide line and every day's own route line. The day index and the day body are the same
device at two scales, not two different metaphors.

### Typography
**Display Font:** Melodrama · **Body Font:** Switzer — the app's own two, inlined as base64 `woff2`
data URIs by `exportFont.ts`, each degrading independently to the system stack if its file is
missing. ~84KB against ~420KB of photographs in the same file.

This was Archivo alone until 2026-09-09 — the face the app removed — with its own nine-size,
five-weight ramp topping out at 900, and every tracking value tuned for it. The export is the one
artifact a traveler keeps and forwards, so it looking like a different product than the one that
made it was the worst possible place for that drift. The ramp below is now the app's.

- **Destination headline** (Melodrama 400, `clamp(3.2rem, 17vw, 5rem)`, .95, `-.018em`): the one
  large moment, and the same serif that sets the app's hero.
- **Day total** (Melodrama 400, `1.5rem`, `proportional-nums lining-nums`): the document's one price,
  given the app's price treatment.
- **Stop name** (Switzer 600, `1.0625rem`, `-.012em`): the transit-map station label.
- **Body** (Switzer 400, `.9375rem`, 1.6, `0`): day summaries, stop notes.
- **Label / caption / figure** (Switzer 600, `.6875rem`–`.8125rem`, `0`, `tabular-nums` where a
  column exists): dates, meta, leg pills, times, the save note. No negative tracking at these sizes
  — Archivo's `-.03em` to `-.05em` at 11–13px was a legibility loss the whole time.

### Layout
Single column, no breakpoints. `.mast` sits above `.tripline` — a horizontally-scrollable strip with one
station per day — which sits above `.days`, a stack of native `<details>` elements each opening onto its
own vertical `.route` list. Section rhythm is `22px` side padding throughout; day rows separate with a
1px hairline, never a card boundary.

### Elevation & Depth
Flat by default — no blur, no translucency, no glass anywhere in this world. The only lift is a soft,
non-directional halo marking the active station or stop, and a plain bordered card for the lodging
block. Depth comes from the drawn trunk line and its nodes, not from shadow.

### Shapes
Circles for every node (17px stop/station dots, 30px day-number badges), full pill radius for the
weather badge and leg labels, 14px for the one card. No clip-path and no angled cuts — the metro-map
grammar is drawn with lines and circles, not silhouette.

### Components
- **The Trip Line (signature):** one row per day, each a 17px circle (plain node or a same-sized
  circular thumbnail) on the shared 8px trunk, with the day number beneath and a short date under that.
  The thumbnail mirrors the plain node's exact size, border and active treatment rather than introducing
  a second node style.
- **Day Accordion:** native `<details>`/`<summary>`, no JS disclosure widget — a circular day-number
  badge, title, date/stop-count/cost line, and a chevron rotating 90° on open.
- **The Day's Route:** an ordered list of stops on their own vertical trunk, each a 16px circular node
  with time at left and name/meta/why at right. Between stops a leg renders as a pill riding the line —
  an inline SVG icon, minutes, distance — the device a metro map uses to label a section.
- **Weather Badge / Leg Pill:** fully round white-cell pills with a 1px hairline border, an inline SVG
  icon, and muted caption text.

## Do's and Don'ts

### Do:
- **Do** build every new surface from `.glass-itinerary` with `p-5 sm:p-6`, and let its scoped
  `--foreground` / `--muted` / `--card-border` do the colour work.
- **Do** ask which of the three verbs a new coloured element is doing — act, count, or warn. If the
  answer is none, it is the one slate at an alpha.
- **Do** reserve jade for things the user acts on, and put the dark `--accent-foreground` on top of it
  — never white.
- **Do** set every money figure, time, duration, distance and count in `font-mono` with
  `tabular-nums`, and colour money `text-money`.
- **Do** compose new surface tints as `rgb(var(--surface-deep-rgb) / α)` rather than introducing a new
  grey.
- **Do** darken toward the one slate or black over photography and terrain, never toward white.
- **Do** move `ACCENT_HUE_BAND` in `src/lib/mapRoute.ts` by hand whenever `--accent` moves. A CSS sweep
  misses it and the failure is silent.
- **Do** add `pointer-events-auto` to every interactive box you place inside the shell's overlay.
- **Do** put every failed request in an `ErrorNote` — one component, one treatment, `role="alert"`, on
  every route — and check `res.ok` before reading the body. A 500 whose payload has no data key
  silently rendered `/trips`' empty state, telling the visitor their saved trips were gone.
- **Do** hide a surface with `hidden` rather than unmounting it when its state is worth keeping.
  `{!selectedStop && <ItineraryCard/>}` threw away the active day index, the panel's scroll position
  and any running tour every time someone opened a place detail. When you do this, stop side effects
  explicitly — a camera flying every 6.5s while someone reads about one place is worse than the
  accidental stop it replaced.
- **Do** move focus when a panel replaces another. `PlaceDetailPanel` focuses its own `tabIndex={-1}`
  heading, because selecting a stop unmounts the row that had focus and it otherwise lands on `<body>`.
- **Do** make custom controls answer to the keyboard: the day tabs are a real `tablist`/`tab`/`tabpanel`
  with `aria-selected`, a roving `tabIndex` and arrow/Home/End traversal, and the tier cards are a
  `radiogroup` labelled by their own heading. Colour alone never carries selection.
- **Do** print what a badge knows rather than hiding it in `title`. The weather badge reads the real
  forecast for its icon, range, rain chance and typical-weather caveat, and the fallback returns **no**
  label rather than a guess — "Windy and grey" used to come back as a sun captioned "Clear".
- **Do** scroll the one element that should move. `element.scrollIntoView()` walks *every* scrollable
  ancestor, so even `block: "nearest"` on a day tab scrolled the docked panel and hid the surface's own
  top row; set `scrollLeft` on the strip instead. The overspend banner is the deliberate exception — it
  is inserted above what you were reading, and scroll anchoring would otherwise push it off the top.
- **Do** keep targets at 44px, and reach it with `min-h-11` plus horizontal padding rather than by
  growing type. Where the layout genuinely cannot — the floating marker cards are map labels pinned to
  world coordinates — the affordance has a 44px equivalent elsewhere, and those cards are `aria-hidden`
  with `tabIndex={-1}` because they duplicate the panel's focusable rows.
- **Do** keep any field the user types into at 16px, including the small "Actual" spend inputs.
- **Do** call `resetToHome()` on mount on every route that shows the globe but doesn't itself fly the
  camera anywhere specific. The globe never unmounts, so a flight from any prior route survives until
  something explicit undoes it.
- **Do** keep `HERO_VIEW` identical in `GlobeBackground`'s initial `setView` and in `mapCamera.tsx` —
  the two are mirrored by hand. `flyTo`'s `height` is a `HeadingPitchRange` *range*, not an altitude.
- **Do** assume the scene is **asleep** before any measurement that depends on where the camera is, and
  call `scene.requestRender()` to get a frame at all rather than waiting for one that will never come.
  Under `requestRenderMode` nothing renders unless something asked.
- **Do** judge globe detail by **minimum geometric error**, not triangle count. Two regions can hit an
  identical error with a 10× triangle difference; error is what a setting controls, triangles are not.
- **Do** let the globe be the page's ongoing motion. Everything else moves on one curve,
  `cubic-bezier(0.16, 1, 0.3, 1)`, in a small set of sizes, all `backwards`-filled so the resting state
  is the finished composition and all gated behind `prefers-reduced-motion: no-preference`:
  `.hero-rise` (600ms, 12px) for a surface arriving; `.settle-in` (420ms, 6px + `blur(5px)`) for the
  trip console's cells, applied to the cells and never the console, since a `filter` on the container
  rasterizes its hairline dividers; `.value-in` (260ms, 4px) for a part settling inside a surface that
  is already arriving, or a figure just recalculated; `.pop-in` (320ms, scale 0.55) for a control that
  appears under the cursor.
- **Do** set a stagger delay as an inline `style={{ animationDelay }}`, never as `[animation-delay:90ms]`.
  That Tailwind arbitrary property generates no rule in this project — the Hero shipped with the class
  form for months and the stagger never once ran.
- **Do** leave the reduced-motion blanket rule alone. The keyframe gates cover *animations*; the
  `@media (prefers-reduced-motion: reduce)` block near the top of `globals.css` is what covers every
  Tailwind `transition-*` in the app. Durations go to `0.01ms`, not `none`, so `transitionend` /
  `animationend` still fire and nothing waiting on them hangs.
- **Do** key an element on its own value (`key={priceLabel}`) when a figure has to acknowledge a change.
  React reuses the DOM node otherwise and a CSS animation only plays on mount.
- **Do** keep the export's stylesheet entirely inside `itineraryHtml.ts`'s template string, and draw its
  trip-wide line and every day's route line with the same trunk grammar at whatever scale the context
  needs.

### Don't:
- **Don't** use a second colour for a job one of the three roles already owns, and don't let one of the
  three take a second job. Gold is money, not "highlight"; coral is over-plan and failure, not
  "important"; jade is action, not "on".
- **Don't** put a scrim, panel, gradient or blur *between* the landing hero headline and its
  photograph. The darkening belongs to `.hero-scrim` under the type and to `.hero-legible`'s three-layer
  text-shadow, which hugs the glyphs: a 1px/3px hard edge at 0.9, a 3px/14px local pool at 0.75, and a
  6px/44px halo at 0.5 that reads as depth rather than as a box. Known and accepted cost: text-shadow
  does not count toward a WCAG ratio, so over worst-case bright content the subline's computed ratio can
  fall below 4.5:1. Reinstating a measurable scrim is the fix if that ever has to be countable; it is
  not a question to reopen otherwise.
- **Don't** put a `hover:`, `active:`, `focus-visible:` or any other state utility on an element
  carrying a `.glass-*` class, or on any property a `globals.css` component rule already sets. It will
  not apply — see The Unlayered-Beats-Utility Rule. Define the state beside the base rule in CSS.
- **Don't** write a class name as a token inside a comment. Tailwind's scanner reads comments and emits
  it as a real rule; name it in words. (`@source not "../../**/*.md"` closes the markdown half of this,
  which was shipping two dead rules quoted out of a bug log.)
- **Don't** pair a base utility with a variant override for the same property and trust the order.
  Tailwind v4 sorts by *utility*, not by variant, so the override can be emitted first and lose at equal
  specificity no matter which media query wraps it. **Emit one declaration per property per range** —
  disjoint ranges, never a rule plus a guess. This has bitten five times.
- **Don't** hand-write `-webkit-backdrop-filter` next to `backdrop-filter`.
- **Don't** unmount, re-key, or conditionally render `GlobeBackground`.
- **Don't** introduce a solid, opaque card surface as a new colour. If a panel needs to be more legible,
  raise its alpha within the one slate; do not leave the material for `--canvas`.
- **Don't** put a kicker, eyebrow, or all-caps label above a headline. The uppercase label step exists
  for a control label or a section rule, never as a line standing over a heading.
- **Don't** use a hard offset shadow, and don't use glyph or icon-font icons — every icon in the system
  is inline SVG.
- **Don't** let map-native colours or the two map-native faces into the interface. Interface colours stay
  off the globe too, with the single documented exception of `--accent` marking the hovered or selected
  stop — and `emphasisColorFor` swapping that to white on the one day whose core falls inside the
  accent's hue band.
- **Don't** ship a control that only appears on hover. Pair every `:hover` reveal with `:focus-within`
  so it is reachable by keyboard, and with `@media (hover: none)` so it is simply always visible on
  touch. The memory card's delete button does all three; `ImageRow`'s cards hand touch the resolved
  state outright.
- **Don't** verify that an overlay is clickable with `element.click()`. It dispatches straight at the
  node and skips hit-testing, so it passes on a control no human pointer can reach — which is exactly
  how a `pointer-events: none` dialog once shipped looking fine.
- **Don't** animate anything on the globe from JS without checking `prefers-reduced-motion` yourself.
  The blanket rule in `globals.css` reaches CSS only; a WebGL material driven from `performance.now()`
  pulses straight through the preference.
- **Don't** mark the selected stop with a ring, halo or pulse on the ground. Selection is the accent on
  that stop's stem, pool and adjoining arcs, plus the thin rule under its own name card.
- **Don't** add geometry to a route without routing it through `RouteGeometry.reposition`. The route is
  drawn before its real altitude is known, and anything that misses the correction detaches at an
  oblique angle.
- **Don't** trust what the model sends. `normalizeDays` in `src/lib/itinerary.ts` runs on every itinerary
  entering the app, because `Stop.category` and `cost: number` were contracts the types asserted and
  nothing enforced — an unrecognised category landed in no budget bucket (printing `$NaN`) and turned
  `CATEGORY_ICON[category]` into `<undefined />`, which throws a white screen.
- **Don't** sum money anywhere but `src/lib/itinerary.ts`. Three components used to sum the same figures
  independently and disagreed, so entering a real spend on `/trip/[id]` moved the overspend banner but
  not the budget bar — two totals for one number, on screen together.
- **Don't** print an unformatted date or figure. `formatDate` / `formatDateWithWeekday` /
  `formatDateRange` / `formatMoney` in `src/lib/format.ts` are the only ways.
- **Don't** show a tile, heading, chip or label for a value that isn't there.
  `Food $0 · Entry $0 · Transit $0 · Stay $0 · Total $160` was the shape of getting this wrong.
- **Don't** signal a state with colour alone. Over budget carries the word "over" and the amount,
  because the bar clamps at 100% and 300% over looked identical to exactly on budget. Day identity on
  the globe carries the day in words for the same reason.
- **Don't** ship a development tool to a visitor. The LLM trace viewer mounts only when
  `NODE_ENV === "development"`, and it is drawn on this system's own tokens rather than a second
  palette — `dev` is the mode the app is demoed in.
- **Don't** add blur, translucency, or a card-on-page treatment to the export. That world is flat by
  design; glass belongs to the live-globe app.
- **Don't** promote the export's palette or type stack into the shared frontmatter tokens above. It is
  deliberately unregistered there — a separate, single-file world, not a new global token set.

## Open Items

Recorded because a finish review scored the build and left these unresolved. They are findings, not
rules, and nothing here should be inherited by a new surface.

1. ~~**The map's foreign register on `/trip/[id]`.**~~ **Closed 2026-09-08.** A finish review found
   the five-hue neon day ramp and the Orbitron/Rajdhani map labels reading as a different design
   language inside the Kiln one, on the product's core screen. It sat outside the scope the user had
   set (tokens plus the landing world, map and itinerary card structurally untouched), so it was put
   to them as its own decision rather than corrected silently — and they funded it. The ramp was
   re-derived as five earth pigments, the badge is printed rather than lit, and both map faces are
   gone; see **The Day on the Globe** and **The World-Face Boundary is retired**. Kept in this list
   as a record of how it was handled, not as an open item.
2. **The hero photograph's warm/cool split.** The frame reads warm on the left third and cool across the
   right two thirds at desktop widths. The crop was made viewport-dependent (`object-position: 54% 44%`
   landscape, `26% 56%` below `48rem`) to fix the phone case, where the warm terracotta wall the
   photograph was sourced for was cropped to a left-edge sliver. The desktop split remains. Partial,
   open.
3. ~~**The export still carries the previous system's amber.**~~ **Closed 2026-09-09, both halves.**
   The type half went first: the export was entirely in Archivo, the face the app had removed, and now
   ships Melodrama + Switzer on the app's tracking steps (`archivo-latin-var.woff2`, 88KB, was its last
   reference and is deleted). The colour half followed: `#fb9826` / `#A85C05` became jade `#28b981` /
   `#0D6042`, re-hued by re-running the export's own all-pairs and CVD validation rather than by
   copying the app's hex — and the fills/strokes split it introduced lifted the map's active route line
   from 1.86:1 to 6.48:1, fixing a graphical-object contrast shortfall the amber had. See
   **The Trip Line → Colors**. Kept in this list as a record of how a divergence was tracked rather
   than quietly aligned.
4. **Radius drift on incumbent panels.** The Kiln edge rule is 5–8px on surfaces; `.glass-itinerary` and
   its descendants are still at 16px from the previous system. Recorded as `{rounded.panel}` so the
   frontmatter tells the truth about what the build is, not as a second doctrine.

## History

- **Kiln II type revision** (current; 2026-09-09). Kiln II's colour, layout and component decisions
  stand unchanged; only the type system moved. Three strategies were comped at 1440 and 390 against
  the real hero, a real price and a real day row — 1 *Quiet* (Switzer alone, hierarchy from size and
  space), 2 *Contrast* (a display serif at a light weight against a neutral grotesk), 3
  *Numerals-first* (a restrained sans with every figure re-set by role). The user took **2 + 3**.

  A role-by-role census ran first and changed the order of work: **the ramp was not coherent enough
  for any face choice to read as premium.** It found 20 letter-spacing values, six label sizes in a
  3px range written four ways, five body sizes, `.font-display` spanning 16→72px on one tracking
  value while its own comment claimed the opposite, and prose running to 96–110ch in three places.
  It also found the figure rule honoured in about a quarter of cases. Phase 1 fixed the foundation;
  the faces landed on top of it. Face payload went 115KB (three Google families) to 104KB, of which
  22KB no longer preloads, and `archivo-latin-var.woff2` (88KB) left the repo with the export.

- **"Kiln II"** (current; approved 2026-09-08, comp `.impeccable/comps/2026-09-08-kiln-ii-APPROVED.md`,
  direction seed `02f66ad0`). Three systems were comped first — A Basalt (cool graphite / azure), B Clay
  (warm clay / jade), C Negative (warm near-black, colour reserved for data). The user asked for "B + C",
  so D Kiln was built as the fusion and rejected as "muddy and dull", which was correct and measurable:
  D inherited Clay's brown card at `rgb(32,24,20)`. E Kiln II moved the ground to Negative's near-neutral
  `#121110`. What it replaced: a single amber accent painting 55 elements on one screen, one typeface
  reaching every register through tracking, a fluid `clamp()` root that overrode the visitor's own font
  size, a two-layer alpha-cut photographic hero, and a two-column section opener. The globe, the map
  renderer contract, the marker layer, the route geometry and the export were left structurally
  untouched by design.
- **"The Trip Line"** (additive, still current): the downloadable export's own world. Did not replace
  anything — no app custom property was touched and no route's rendered output changed.
- **"The Blue Hour Expedition"** (superseded by Kiln II's landing): a scoped cobalt-teal alternate
  identity over the pre-generation flow, with its own scene faces, a `.scene-band` gradient, two
  interlocking alpha-cut hero photographs and a closing poster that withheld the CTA to the very end.
  The retint went because switching palette mid-app reads as a different product rather than a different
  surface; the poster went because a reveal that lands softer than the evidence before it is not a
  reveal, and the ask moved into the hero.
- **"The Lit Cockpit Over a Turning Earth"** (superseded): one slate `rgb(15 23 42)`, one amber accent,
  Archivo throughout. Its material argument survives intact in the One Slate Rule; its colour and type
  strategy did not.
- **"Overcast"** (superseded): full-bleed globe with steel-blue translucent cards. The steel-blue
  register never resolved and legibility over a moving map was inconsistent.
- **"Roamly"** (superseded): a true split layout with warm cream/teal solid surfaces beside a boxed-in
  globe pane. Warm cream on cool slate read as two design systems, and the split pane surrendered the
  globe as the thing that carries the product.
