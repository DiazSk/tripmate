---
name: TripMate
description: Polar Interior — night under frosted glass over a live globe, ice and paper away from it, signal orange for action and nothing else.
colors:
  canvas: "#090b10"
  surface-deep: "rgb(14 17 24)"
  foreground: "#ffffff"
  muted: "#a8acb3"
  on-deep: "#ffffff"
  accent: "#ff7e15"
  accent-hover: "#ff9440"
  accent-foreground: "#1f2a44"
  accent-text: "#ff7e15"
  money: "#ffffff"
  money-soft: "rgba(255, 255, 255, 0.14)"
  alert: "#ff6b6b"
  alert-soft: "rgba(255, 107, 107, 0.16)"
  alert-on-night: "#ffb3b3"
  card-border: "rgba(255, 255, 255, 0.2)"
  tag-neutral-bg: "rgba(255, 255, 255, 0.1)"
  tag-neutral-fg: "#d6d8dc"
  tag-positive-bg: "rgba(106, 240, 255, 0.12)"
  tag-positive-fg: "#6af0ff"
  tag-highlight-bg: "#ffffff"
  tag-highlight-fg: "#1f2a44"
  tile: "rgba(255, 255, 255, 0.08)"
  tile-foreground: "#d6d8dc"
  route-casing: "#090b10"
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
  map-glass: "rgb(9 11 16)"
  map-glass-edge: "rgb(255 255 255 / 0.16)"
  city-boundary: "#ece6de"
  ice: "#ffffff"
  snow: "#f5f5f5"
  paper: "#f3f1ec"
  mushroom: "#e9e7e1"
  ink: "#1f2a44"
  ash: "#2c374b"
  charcoal: "#535353"
  stone: "#a4a29c"
  stone-text: "#6e6c66"
  ember: "#a64c09"
  route: "#6af0ff"
  alert-text: "#d10f0f"
  accent-text-light: "#a64c09"
  positive-light: "#0e6670"
  night-text-2: "#a8acb3"
  rule: "rgba(31, 42, 68, 0.12)"
  gridline: "rgba(31, 42, 68, 0.07)"
  frost-20: "rgba(255, 255, 255, 0.2)"
  veil-05: "rgba(31, 42, 68, 0.05)"
  veil-15: "rgba(31, 42, 68, 0.15)"
  veil-50: "rgba(31, 42, 68, 0.5)"
typography:
  root:
    fontSize: "16px"
    note: "html stays at a flat 16px, so rem breakpoints and the browser's own text size hold. Polar's fluid scale lives on `.tm` (polar-base below), never on the root."
  polar-base:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(14px, 1.111vw, 18px)"
    fontWeight: 500
    note: "`--wd-base` on `.tm` (src/components/polar/PolarLanding.css:3). Every Polar size below is an em of it, so a whole screen scales with the viewport width as one; 16px at 1440."
  tracking:
    display: "0.005em"
    heading: "0em"
    body: "0em"
    label: "0.18em"
    note: "`--tracking-*` in globals.css. Polar's uppercase labels still carry their own literals (0.12–0.175em, see Open Items), the condensed monuments run slightly negative (-0.005 / -0.01em), and map labels over imagery keep their own legibility values."
  monument:
    fontFamily: "Oswald, Arial Narrow, Arial, sans-serif"
    fontSize: "clamp(5.5em, min(21vw, 37svh), 20em)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.005em"
    note: "`.tm-monument` (the landing hero's place name) and `.tm-fb-monument` (`min(22.5vw, 37svh)`, the closing TRIPMATE). Always uppercase. Line height 1 with no negative margin, so Oswald's baseline sits ~0.05em above the box and an overflow-hidden parent never crops the word. The planner's and the writing screen's monuments are smaller cuts of the same rule."
  display:
    fontFamily: "Cormorant Garamond, ui-serif, Georgia, serif"
    fontSize: "clamp(2.4em, 5.2vw, 3.75em)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.005em"
    note: "`.tm-display`, uppercase: section titles and the /trips and /profile mastheads. Larger cuts: `.tm-fb-title` clamp(3em, 7vw, 6.25em) closing the landing, `.pp-title` clamp(2.6em, 5.4vw, 4.6em) on the planner."
  title:
    fontFamily: "Cormorant Garamond, ui-serif, Georgia, serif"
    fontSize: "1.9em"
    fontWeight: 400
    lineHeight: 1.1
    note: "Sentence case. The trip's day title (`.tb-day-titles h2`) and the sample-plan names (`.tm-strip-title`, clamp(2em, 3.6vw, 2.9em))."
  voice:
    fontFamily: "Cormorant Garamond, ui-serif, Georgia, serif"
    fontSize: "1.375em"
    fontWeight: 500
    lineHeight: 1.2
    note: "Italic. The product speaking in a line rather than labelling: `.tm-hero-lead` (max 17ch), `.tm-kicker` (1.125em), `.pp-lead`, the writing screen's facts."
  city:
    fontFamily: "Oswald, Arial Narrow, Arial, sans-serif"
    fontSize: "2.5em"
    fontWeight: 400
    letterSpacing: "-0.005em"
    note: "Uppercase. `.tb-city`, the trip's name on its board."
  wordmark:
    fontFamily: "Oswald, Arial Narrow, Arial, sans-serif"
    fontSize: "1.15rem"
    letterSpacing: "0.06em"
    note: "Uppercase TRIPMATE beside the LogoMark in the nav (`.polar-wordmark`)."
  body:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95em"
    fontWeight: 500
    lineHeight: 1.5
    note: "`.tm-body`. `.tm` itself sets weight 500; there is no 400 body on Polar surfaces."
  ui:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875em"
    fontWeight: 600
    note: "`.tm-ui` — chips and nav chips. The signal button sets its own size (typography.button)."
  button:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9em"
    fontWeight: 600
    note: "`.tm-signal`; `.tm-signal-lg` is 0.95em."
  caption:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8em"
    lineHeight: 1.4
  eyebrow:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875em"
    fontWeight: 600
    letterSpacing: "0.175em"
    note: "Uppercase. `.tm-eyebrow`."
  label:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    letterSpacing: "0.16em"
    note: "Uppercase. The label floor: 11px. `.tb-label`, `.tb-day-when`, the leg tags, the budget unit and the cost footnote are `max(0.6875rem, 0.6875em)`: it scales with the base above the floor and never renders under 11px (a bare em bottoms out near 9.6px on phones)."
  coord:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75em"
    letterSpacing: "0.06em"
    note: "`.tm-coord` — the `[ 30° 19′ 20″ N, 35° 27′ 07″ E ]` readouts. Never wraps."
  figure:
    fontFamily: "Oswald, Arial Narrow, Arial, sans-serif"
    fontFeature: "tabular-nums"
    note: "Money and times compared in a column on the board (`.tb-budget b` 1.2em, `.tb-total dd`). `--font-mono` resolves to Inter Tight with tabular figures for the older surfaces; there is no separate figure face."
  field:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    note: "16px is a floor, not a step: below it iOS Safari zooms the viewport on focus."
  map-day-label:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    note: "`.marker-day-label` only — uppercase day badges standing on the map."
  map-stop-label:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    note: "Map-native. `.marker-title-card` and `.marker-place-label` only. Keeps a literal tracking value: this is a legibility register over imagery, not the interface one."
rounded:
  hairline: "0.125em"
  sm: "0.25em"
  card: "0.375em"
  nav: "2px"
  pill: "999px"
spacing:
  space-1: "0.35em"
  space-2: "0.75em"
  space-3: "1.1em"
  space-4: "1.5em"
  space-5: "2em"
  space-6: "2.75em"
  space-8: "4em"
  space-10: "5.5em"
  space-12: "7em"
  gutter: "0.75em"
  pad: "1.25em"
  nav-h: "3.5rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.hairline}"
    height: "2.5em"
    padding: "0 1.15em"
    typography: "{typography.button}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-foreground}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    padding: "0.65em 0.2em"
    typography: "{typography.body}"
  button-quiet:
    backgroundColor: "{colors.veil-05}"
    textColor: "{colors.ink}"
    rounded: "{rounded.hairline}"
    typography: "{typography.ui}"
  chip-destination:
    backgroundColor: "rgba(9, 11, 16, 0.18)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.hairline}"
    height: "2.2em"
    typography: "{typography.ui}"
  chip-destination-selected:
    backgroundColor: "{colors.ice}"
    textColor: "{colors.ink}"
  nav-chip:
    backgroundColor: "rgb(14 17 24 / 0.72)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.nav}"
    height: "2.5rem"
    padding: "0 0.95rem"
  nav-cta:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.nav}"
    height: "2.5rem"
  input-night:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    height: "2.9em"
    typography: "{typography.field}"
  panel-glass-night:
    backgroundColor: "rgba(9, 11, 16, 0.45)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
  board-paper:
    backgroundColor: "{colors.ice}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  stop-card:
    backgroundColor: "{colors.ice}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    width: "14.5rem"
  stop-card-lit:
    backgroundColor: "{colors.snow}"
  day-row-selected:
    backgroundColor: "{colors.ice}"
    textColor: "{colors.ink}"
  map-control:
    backgroundColor: "rgba(9, 11, 16, 0.6)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    size: "2.75rem"
  sheet-paper:
    backgroundColor: "{colors.ice}"
    textColor: "{colors.ink}"
    width: "min(100%, 30em)"
    padding: "2em"
  chip-neutral:
    backgroundColor: "{colors.tag-neutral-bg}"
    textColor: "{colors.tag-neutral-fg}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  chip-positive:
    backgroundColor: "{colors.tag-positive-bg}"
    textColor: "{colors.tag-positive-fg}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  chip-highlight:
    backgroundColor: "{colors.tag-highlight-bg}"
    textColor: "{colors.tag-highlight-fg}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  card-glass:
    backgroundColor: "{colors.surface-deep}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "20px"
  marker-title-card:
    backgroundColor: "rgb(9 11 16 / 0.75)"
    textColor: "{colors.on-deep}"
    rounded: "5px"
    padding: "0.3rem 0.55rem 0.34rem"
    typography: "{typography.map-stop-label}"
  marker-day-label:
    backgroundColor: "rgb(9 11 16 / 0.75)"
    rounded: "6px"
    padding: "0.34rem 0.7rem 0.36rem"
    typography: "{typography.map-day-label}"
---

> **Recorded exceptions, the landing's "a day you can imagine" and the planner built from the canvas (2026-10-14, confirmed by Zaid).** These
> values are off the ramp above on purpose: they are the approved MagicPath canvas's own steps for this
> one page, and they stay recorded here rather than widening the ramp. Web only; the phone's styles are
> numbers and the design check does not read them.
>
> | Value | Where | What it is |
> |---|---|---|
> | 22, 26, 30, 36px | `polar/ImagineDay.tsx` | the story's caption and closing line, lens names, the plan's stop titles, the sheet title |
> | 21px | `polar/PlanGlobe.tsx` | stop titles in the compact plan card over the globe |
> | 10px | `polar/PlanGlobe.tsx` | the bullet glyph before a practical note (a glyph, not text) |
> | 20, 22px | `polar/PolarLanding.css` | the range calendar's month title, edge values and day numbers |
> | `#bdbab3` | `polar/PolarLanding.css` | a range-calendar day that cannot be picked; always paired with a strike-through, so colour is never the only cue |
> | MapLibre's own `#0096ff` and 12px radii | `polar/nightMapMaplibre.css` | vendored rules from `maplibre-gl`, kept as shipped |
> | 1, 2, 3px radii | `polar/planner/PlanningFlow.css` | the planner's chips, rhythm-bar blocks and time-panel cells, from the canvas design "TripMate Planning flow (web)" |
> | 20px | `polar/planner/PlanningFlow.css` | the time panel's typed readout, matching the range calendar's 20px edge values |
> | `#d64545`, `#8a8780`, `#535353` | `polar/planner/PlanningFlow.css` | the time panel's invalid-entry ring, placeholder and labels, on its white panel like the calendar's |
>
> The design check's matching ignores live in `.impeccable/config.json`, scoped to those files. That
> folder is gitignored here, so this table is the shared record.

# Design System: TripMate

## Overview

**Creative North Star: "Polar Interior"**

Night under frosted glass wherever the world shows through — the map, a destination's photograph —
and ice and paper wherever it does not. The product is a few large, quiet scenes rather than a page
of panels: the landing is a photograph with a place's name set across it in a condensed face; the
planner asks its questions over the place being planned; the plan writes itself over the night map;
the trip lays its days out on paper beside a live map. One colour acts. Everything else is ink,
night and the greys between them.

The approved MagicPath canvas (project `460590324033662976`) is the visual reference for every Polar
screen; code comments name the variant each was built from. Where the build and the latest revision
disagree, the design wins unless code or `docs/` record a deliberate deviation. The register is
**considered** rather than luxurious: precision, restraint, material quality, on a product whose whole
thesis is that a trip costs what you said it would.

The arrangement is conventional on purpose — a photo hero, a marketing scroll, the plan's first
question at the close — and the craft goes into execution: one type ramp that scales as a piece,
hairline edges, glass only where something is behind it, and the world (the photograph, the map)
always the largest thing on screen.

**Key Characteristics:**
- Two materials: night glass over the world, opaque ice and paper away from it. Never a third grey.
- One action colour, signal orange, on what you press and on the focus ring. Money has no hue.
- Three faces with one job each: Cormorant Garamond speaks, Inter Tight is read, Oswald names places.
- A whole Polar screen is an em of one fluid base, so it scales with the viewport as one piece.
- Nearly square: hairline radii on what you press, a slightly softer corner on cards and sheets.
- The world moves (the map, the photograph's scroll); the interface does not loop.

## Colors

Night and ice, ink between them, one orange that acts, and a cyan that belongs to the map.

### Primary
- **Signal** (`{colors.accent}`, `--wd-signal`): the one action colour — the primary button, the nav's
  Plan a trip, Play, Send, and every focus ring (`.tm :focus-visible`, 2px, 3px offset). It carries ink
  text (`{colors.accent-foreground}`, 5.60:1), never white (2.55:1). Hover lightens to
  `{colors.accent-hover}`. On night it may be text (7.73:1); on ice or paper it may not (2.55:1) —
  action-as-text on light surfaces is `{colors.accent-text-light}` (5.08:1 on paper), used through
  `--accent-text`.

### Secondary
- **Ember** (`{colors.ember}`, `--wd-ember`): small type on light surfaces that belongs to an action or
  a note of it — eyebrows on the trip drawer, the sign-in pass, "clears" on the memories wall. 5.08:1
  on paper and 5.74:1 on ice, the same value as `--accent-text` (it was `#b4530a`, 4.45:1 on paper).
- **Route** (`{colors.route}`, `--wd-route`): the map's own colour — routes on the night map, the
  writing screen's live stop, the planner's pace bars, positive tags on night (14.55:1). Never a
  button, never interface chrome.

### Tertiary
- **Alert** (`{colors.alert}` on night, 7.09:1; `{colors.alert-text}` on light, 4.91:1 on paper): an
  overspend, a failed request, an invalid field. Paired with words, never colour alone.
- **Positive (light)** (`{colors.positive-light}`, 5.90:1 on paper): the rare "this is fine" on a light
  surface.
- **The route pool** (`{colors.route-day-1}` … `{colors.route-day-5}` with their glows): one hue per day
  on the map and on the board's day rows, earth pigments chosen to separate from each other and from
  the basemap, cycling past five days.

### Neutral
- **Night** (`{colors.canvas}`, `--wd-night`): the ground under everything dark — the shell, the
  writing screen, the footer, the story bar.
- **Deep** (`{colors.surface-deep}`, `--wd-deep`): the glass slate, authored as channels so its alpha
  can vary.
- **Ice** (`{colors.ice}`): the brightest surface — the trip board, sheets, the spotlight, light inputs.
- **Snow** (`{colors.snow}`), **Paper** (`{colors.paper}`), **Mushroom** (`{colors.mushroom}`): steps of
  the light ground — a lit card, the memories wall and profile, a pressed segment.
- **Ink** (`{colors.ink}`): text on light (12.63:1 on paper), the dark half of every light control.
- **Ash** (`{colors.ash}`) and **Charcoal** (`{colors.charcoal}`): secondary text on light (charcoal
  6.81:1 on paper).
- **Night text 2** (`{colors.night-text-2}`, `--muted` on night): secondary text on dark (8.64:1).
- **Stone** (`{colors.stone}`): rules, disabled marks, fills. **Not text**: 2.26:1 on paper. Stone as
  text is **Stone text** (`{colors.stone-text}`, `--wd-stone-text`): 4.65:1 on paper, 5.25:1 on ice, for
  placeholders, hour labels, the cost footnote, index numbers, remove controls and drag grips.
  `src/lib/contrast.test.mjs` fails if `color: var(--wd-stone)` returns.
- **Lines**: `{colors.frost-20}` on night; `{colors.rule}` and `{colors.veil-15}` on light;
  `{colors.gridline}` for the landing's 12-column grid; the veils (`{colors.veil-05}` …
  `{colors.veil-50}`) are ink at an alpha for quiet fills and scrims on light.

### Two appearances
Night is the default on `:root`. **Polar Light** is a scope, `[data-appearance="light"]`
(`globals.css:442`), that re-points the app-level roles (`--foreground` to ink, `--muted` to charcoal,
`--accent-text`, `--alert`, `--positive`) so shared components reused inside a light surface take light
values. A Polar surface opts in on its own root: the landing's sections, the trip board, the
spotlight, the drawer, the date and time pickers. The writing screen sets `"dark"` explicitly. The
planner, sign-in, memories wall and offline page paint their `.tm` colours directly. The phone mirrors
both appearances value for value in `mobile/src/constants/palette.ts`.

### Named Rules
**The One Hand Rule.** Signal marks what you can press, and the focus ring. Not a readout, not a
total, not a selected tab, not a decoration. If it is orange and you cannot press it, it is wrong.

**The Map Owns Cyan Rule.** Route cyan and the day pool are the map's vocabulary. Interface chrome
does not borrow them, so a coloured line always means "a way through the world".

**The No-Grey-Text-On-Paper Rule.** Text on a light surface is ink, ash, charcoal, or a role colour that
measures 4.5:1 on that exact surface. Stone and signal do not (use stone-text and ember).

## Typography

**Display Font:** Cormorant Garamond (with ui-serif, Georgia)
**Body Font:** Inter Tight (with ui-sans-serif, system-ui)
**Monument Font:** Oswald (with Arial Narrow, Arial)

**Character:** a classical serif that speaks — upright for titles, italic when the product talks to
you — against a neutral, slightly tight grotesk that carries everything you read, and a condensed
sans used only to name a place at the scale of the photograph behind it.

All three are self-hosted through `next/font/local` (`src/app/layout.tsx`) as variable files with
`display: swap`, exposed as `--font-display-stack`, `--font-sans-stack` and
`--font-condensed-stack` and aliased on `.tm` as `--wd-font-display`, `--wd-font-sans` and
`--wd-font-condensed`. **Refer to them only through those variables**: `next/font` does not register
the family names, so a rule that asks for `'Oswald'` by name silently gets Arial Narrow.

### Hierarchy
Every Polar size is an em of `{typography.polar-base}` — `clamp(14px, 1.111vw, 18px)`, 16px at 1440.
- **Monument** (Oswald 400, `clamp(5.5em, min(21vw, 37svh), 20em)`, line-height 1, uppercase): the place name
  across the landing hero; TRIPMATE closing the page; smaller cuts on the planner and writing screen.
- **Display** (Cormorant 400, `clamp(2.4em, 5.2vw, 3.75em)`, line-height 1, uppercase): section titles
  and mastheads; larger cuts close the landing and open the planner.
- **Title** (Cormorant 400, 1.9em, 1.1, sentence case): a day's title on the trip, a sample plan's name.
- **Voice** (Cormorant 500 italic, 1.125–1.375em, 1.2): the lead, kickers, the writing screen's facts.
  Max 17ch on the hero.
- **City** (Oswald 400, 2.5em, uppercase): the trip's name on its board.
- **Body** (Inter Tight 500, 0.95em, 1.5): everything read.
- **UI** (Inter Tight 600, 0.875em): chips, nav. The signal button is a shade larger: 0.9em, 0.95em
  for `-lg`.
- **Caption** (Inter Tight, 0.8em, 1.4).
- **Eyebrow / Label** (Inter Tight 600, uppercase, tracked): eyebrows at 0.875em / 0.175em; labels at
  the 11px floor (`0.6875rem`, 0.16em).
- **Coordinates** (Inter Tight, 0.75em, 0.06em, never wrapping).
- **Figures** (Oswald, tabular): money and times compared in a column on the board.

### Named Rules
**The One-Base Rule.** Inside `.tm`, size in em of `--wd-base`, never in px. A px size inside a Polar
screen stops scaling with the rest of it and drifts out of proportion at both ends of the range.
Under-11px labels take `max(0.6875rem, …em)`, fields keep `{typography.field}`, and a root that is
deliberately smaller than the base says so as `calc(var(--wd-base) * n)` (the spotlight's closed
pill and its map tag). Recorded canvas exceptions are in the table above.

**The Three Jobs Rule.** Cormorant speaks, Inter Tight is read, Oswald names. A paragraph is never
set in Cormorant, a label never in Oswald, a place name never in Inter Tight at monument scale.

**The Field Floor Rule.** Inputs are 16px (`{typography.field}`) whatever the em scale says; below it
iOS Safari zooms the page on focus.

## Layout

`AppShell` renders exactly four layers on every route and that structure never varies: the map at
`z-0`, the floating stop markers at `z-5`, a viewport-spanning content overlay at `z-10`, and app
chrome (navbar, map controls) at `z-20`. `.app-shell` is `h-dvh overflow-hidden` — **the document
never scrolls**; `.content-overlay` does. Polar's scrolling pages (the landing, `/trips`, `/profile`)
run Lenis on that overlay, driven by the GSAP ticker, with ScrollTrigger scrubs bound to it
(`src/components/polar/motion.ts`); reduced motion skips both entirely and the page is its finished
layout. App screens that hold the map (the trip page, generation) keep the viewport frame and put
their panels in `position: fixed` with `pointer-events: auto`.

Two heights are tokens because more than one thing has to clear them: `--nav-h` (`3.5rem`, read by the
navbar, `<main>`'s top padding and every fixed panel's top) and `--capsule-h` (`3.5rem`, the collapsed
docked panel on the `/` result view, read by the mobile map-control rule that has to sit above it).
44px is the touch-target floor inside the bar.

**Polar spacing** is an em ladder on `.tm`: `{spacing.space-1}` … `{spacing.space-12}` (0.35em to 7em),
a `{spacing.gutter}` between columns and a `{spacing.pad}` page edge (with 3em more on the right of the
landing to clear the How it works tab). The landing draws a 12-column gridline field; sections use
`auto-fit, minmax(min(100%, 17em), 1fr)` grids. Only ImagineDay caps a width (1440px); full-bleed
photographs and the night map reach all four edges, cancelling `<main>`'s padding.

**Breakpoints are one shared set**, in rem so they track the browser's text size rather than the
`.tm` base: **40rem** (the phone navbar closes; planner and landing phone layouts; the spotlight
sheet stops drawing below it), **48rem** (landing, planner, writing screen, memories and profile
collapse; the landing's GSAP desktop motion starts at it), **60rem** (the trip page's board becomes
the column at `(width > 60rem)` and the drawer, story player and profile close at
`(width <= 60rem)`; the night map and its plan panel, sign-in and offline also turn at 60rem),
**64rem** (ImagineDay's two columns, the drawer widens, the shell), **68.75rem** (landing desktop,
the planner's trip card) and **100rem** (the shell's widest step). They match Tailwind's
`sm`/`md`/`lg` at 40/48/64rem. Queries use range syntax, `width < 48rem` below a step and
`width >= 48rem` from it, so the two sides of a step never overlap; the trip pair alone uses
`>`/`<=` because `COLUMN_QUERY` in `TripBoard.tsx` mirrors it in JS. JS that mirrors a step
(`COLUMN_QUERY`, `motion.ts`'s `DESKTOP`, PlanGlobe's `wide()`, the writing screen and the date
range picker) uses `matchMedia` with the same rem query, never an `innerWidth` number. Inside a
component, `@container tsl (width < 23rem)` is the spotlight's own query.

Height steps are separate and stay in px: the landing's short-desktop condensing at
`(max-height: 899px)` and the writing screen's at 860 and 520 tall.

New work reuses a step rather than adding one, and a wide-but-short laptop (about 1470×830 CSS px
on a 13" MacBook Air) is the case to check first: sizes follow width, so height runs out before
width does.

**Short screens condense, then scroll.** Type and controls keep their designed size; spacing and
decorative type may shrink with the viewport's height; what still does not fit scrolls — the page on
the landing, the panel on an app screen. Never scale a composition to fit.

### Named Rules

**The Named-Timeline Rule (`--story`).** A CSS scroll-driven animation (Polar's scrubs are GSAP, which reads the overlay directly) binds to
`animation-timeline: --story` — never to `scroll(nearest block)` or `scroll(root)`. `nearest` resolves
to the nearest ancestor *scroll container*, and `overflow: hidden` makes an element one: it has a
scrolling box, it simply never scrolls. Polar's sections carry
`overflow-hidden`, so `nearest` binds to a section pinned at `scrollTop` 0 forever and the animation
sits frozen at 0% progress with no error anywhere. `root` resolves to the document, which never
scrolls either. If a new scroll-driven animation appears not to run, check the timeline's source
before checking the range.

**The Overlay Hit-Test Rule.** `.content-overlay` is `pointer-events-none` so the globe stays
draggable, which also takes its scroller out of hit-testing. `.content-overlay:not(:has(.docked-panel))`
hands pointer events back on every route that scrolls the overlay itself. This is not a touch-only
problem: a wheel's scroll target is resolved by hit-testing first and *then* by walking the hit
element's ancestor chain, and the map canvas is the overlay's **sibling**, so a wheel over any
patch of viewport with no `pointer-events-auto` box under it lands on the map's handler, which
consumes it as a camera zoom. The page does not move, the globe lurches, and tiles start streaming.

**The Scroll-Anchor Rule.** `.docked-panel-body` sets `overflow-anchor: none`, and it is load-bearing.
The itinerary header is in flow, so compressing it changes the height of content above the viewport —
exactly the condition Chrome's anchoring exists to correct, which it does by pulling `scrollTop` back
down by the same amount. Measured in Chromium, scrolling to 40, 80, 120 and 160px all settled back at
0 with the header at full height.

## Elevation & Depth

Depth comes from **material, then from shadow**. Over the world, a surface is night at an alpha
behind a backdrop blur, and what separates two surfaces is how much of the world shows through.
Away from it, surfaces are opaque ice and paper with no blur at all, and a soft, long, low shadow is
what lifts a board or a sheet off the map. Every shadow is non-directional; there are no hard offset
shadows.

Glass, by how much it carries: 3px on the faintest chips and scrims; 5px on the destination chips and
planner steps (`rgba(9, 11, 16, 0.18)`); 7.5px on the landing's beat cards (veil-50); 10px on the trip
page's map controls (`rgba(9, 11, 16, 0.6)`); 15px on the night panels — the footer form, the planner's
panel and bar (`0.45`–`0.62`); 16px plus `saturate(1.1)` on the dark nav (`rgb(14 17 24 / 0.72)`).
The story bar uses none on purpose: it is near-opaque night (`0.96`) because it moves with a flying
map and a blur would re-raster every frame.

Photographs carry gradient scrims, not flat veils: the hero darkens at both sides and at top and
bottom, the footer runs dark-light-dark, the planner darkens from the left where the questions sit.

### Shadow Vocabulary
- **Board** (`0 -1em 4em -1.5em rgba(0,0,0,0.7)`): the trip board rising off the foot of the map.
- **Panel** (`0 2em 4em -1.5em rgba(0,0,0,0.7)`): the drawer and the split editor.
- **Spotlight** (`0 2em 5em -1.5em rgba(0,0,0,0.8)`, closed `0 1em 2.5em -1em rgba(0,0,0,0.7)`).
- **Pass** (`0 2.5em 5em -2em rgba(0,0,0,0.55)`): the sign-in boarding pass.
- **Popover** (`0 24px 64px rgba(9,11,16,0.45), 0 0 0 1px rgba(31,42,68,0.08)`): the date-range picker.
- **Object on the map** (`0 2px 10px rgb(0 0 0 / 0.55)` plus a 1px inset white highlight): marker title
  cards on real ground.
- **Pressed** (`0 1px 2px rgba(31,42,68,0.12)`): the selected segment of a light segmented control.

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
decays to, which on a signal-filled button is a silent, invisible focus indicator. Polar's
`.tm :focus-visible` is the same rule: 2px signal at a 3px offset.

**The Blur-Of-Nothing Rule.** A `backdrop-filter` costs a render surface, and moving a render surface
re-rasters everything behind it. Never put one on a surface with nothing behind it (`.is-opaque` on
the four globe-less routes), and never put a wide radius on a small chip (the marker cards use 8px,
not the control chrome's 20px — a wide blur on a 28px-tall chip just samples flat colour). Every map
frame in this app re-blurs every backdrop-filter panel above the canvas, so idle GPU allocation is
not free here the way it is in a document.

## Shapes

Nearly square, and the radius grows with the object: `{rounded.hairline}` (0.125em) on what you
press — buttons, chips, board tools; `{rounded.sm}` (0.25em) on inputs, photos and small cards;
`{rounded.card}` (0.375em) on cards, panels, the board, sheets and the pass; `{rounded.nav}` (2px) on
the nav's chips and CTA. Pills (`{rounded.pill}`) are kept for the spotlight's tokens and category row,
the story player's controls and a few profile pills — round things that are filters or toggles.
Circles are reserved for markers, Play and avatars. The older glass surfaces (`.glass-itinerary`
panels, the confirm dialog) sit outside `.tm`, so they take `{rounded.card}` as Tailwind's
`rounded-md` (0.375rem, the same 6px at the root's 16px).

Edges are hairlines: `{colors.frost-20}` on night, `{colors.rule}` on light. A selected day row is
marked by a 3px edge in that day's own route colour (left on desktop, bottom on a phone).

The one drawn mark is `LogoMark`: a glass globe, a route lifting off it and the stop it lands on — the
small cut of the Meridian app icon (masters in `mobile/assets/brand/`). Every icon is inline SVG sized
in em so it tracks its type step. No clip-path silhouettes and no decorative geometry; the landing's
inset clips are scroll effects on photographs, not shapes.

## Components

### Buttons
- **Shape:** hairline corners (`{rounded.hairline}`); the signal button is 2.5em tall (3.1em for `-lg`).
- **Primary (Signal):** ink on signal, Inter Tight 600 at 0.9em (0.95em for `-lg`), 1.15em side padding
  (1.6em for `-lg`). Hover lightens to
  `{colors.accent-hover}`; on a fine pointer the label slides 0.5em and an arrow scales in; active
  presses 1px down; disabled is 0.6 opacity.
- **Ghost:** white body text (0.95em, 500) between two frost hairlines, sized by its padding (0.65em
  0.2em, at least 12em wide) rather than a fixed height, for the secondary action over a photograph; on
  hover the gap between text and arrow opens from 2.5em to 3.5em and the rules brighten.
- **Quiet:** ink on veil-05, veil-15 on hover — the light-surface secondary.
- **Focus:** every Polar control takes `.tm :focus-visible` — a 2px signal outline at 3px offset.

### Chips
- **Destination chips:** a radio group over the hero photograph — night glass (5px blur), white text,
  frost edge brightening on hover. The checked chip turns ice with ink text, and a 2px signal bar along
  its foot fills over the rotation interval (`--rotate-ms`), pausing on hover or focus.
- **Planner chips** (`.pp-chip`): hairline corners, multi-select, filled when chosen. A chosen interest chip
  carries a star slot (`.pp-star`): ☆ in ink on white to claim a place, then its rank, 1 to 3, in ink on signal.
  With all three places taken the slot of an unstarred chip is dashed and see-through, set a gap off the chip.
- **Saved-place chips** (`.pp-anchor`): star, name, status, remove. The status is always words: found is
  "✓" plus where, in `{colors.tag-positive-fg}` with its edge tinted to match; not found is "Not found —
  try a nearby landmark" in the failure-alert text on dark glass (`--alert-on-night`, `#ffb3b3`, as `.pp-alert`; `--alert`
  drops to ~4.3:1 over the scrimmed photo) with an underlined **Edit** that turns the name into an input;
  never looked up (a library place or restored draft without coordinates) is "Not looked up yet" in
  muted night text with **Look up**.
- **Spotlight tokens and categories:** pills, each category with its dot in the map's colour for it.
- **Tags** (`chip-neutral`, `chip-positive`, `chip-highlight`): small pills on the older surfaces.

### Cards / Containers
- **The board** (`board-paper`): ice, card corners, the Board shadow; a 17.5rem trip column beside the
  day. Paper and ice cards inside it carry no shadow of their own.
- **Stop cards** (`stop-card`): 14.5rem wide, a 16:10 photo with small corners, name, duration and cost,
  a three-line "why"; hover or the stop being lit turns the card snow.
- **Beat cards** (landing): an 11:14 photograph with a night-glass card; hover or focus opens the card's
  copy and scales the photo 1.04.
- **Sample-plan strip** (landing): an accordion of photographs whose open panel grows to 4.5× the
  others; closed panels desaturate and blur slightly. Below 48rem it becomes a vertical accordion.
- **Night glass panels** (`panel-glass-night`): the landing's footer form, the planner's panel.
- **Sheets** (`sheet-paper`): How it works slides in from the right (0.8s), ice, 2em padding.

### Inputs / Fields
- **On night** (`input-night`): 2.9em, white at 0.05, small corners, frost edge; hover brightens the edge
  to 0.45; focus turns it signal with a 3px signal ring at 0.25; an error is alert red with a message.
- **On light:** snow fields with a 1px signal ring on focus; the spotlight's field takes an inset 2px
  signal underline; money fields on the board turn their border signal on focus-within.
- **Always 16px text** (`{typography.field}`).

### Navigation
One bar, `.polar-nav`, `--nav-h` tall, always the same dark glass band on every route, landing
included (the slate at 0.72, 16px blur, white text, a hairline under it; 2026-10-17 ruling: ink or
white text on a bare photograph was unreadable, so there are no `photo` or `light` themes). The
LogoMark and the Oswald wordmark sit centred in a three-column grid; route links are chips (2.5rem, `{rounded.nav}`) and the current one inverts to foreground on canvas; the landing
adds a Plan a trip CTA in signal. The bar hides on scroll down and returns on scroll up. On a phone
the links collapse into a full-screen menu (not a dropdown). The landing's CTA stays visible on phones
(2026-10-16 ruling, as the design shows): beside the menu button, 44px tall with tighter padding
below `sm`, back to the chips' 2.5rem from `sm`.

### The Monument (signature)
A place's name set in Oswald across the full width of its photograph — PETRA on the landing hero,
TRIPMATE closing the page, the destination on the planner and the writing screen. Uppercase, line
height 1, sized by the viewport's width and capped by its height; it rises and fades in once (1.4s) and never loops. It is a picture
of a word, so it is `aria-hidden`; the landing's one `h1` is a stable visually-hidden line in the hero.

### The Night Map on the landing (signature)
`PlanGlobe` — a MapLibre map in the night style, cyan route over dark ground, flying to the sample
place as its section enters the screen, with a compact plan card over it. It is the landing's only
live map.

### Writing the Plan (signature)
The generating screen: the night lens over the real map (the basemap taken down to night under the
plan), the destination's monument at the foot, a lede with Meri, "Planning {city}", the trip's span and
budget, a rotating destination fact in the voice face, a skeleton row per day that fills as the stream
names it, and a foot strip with the progress hairline, the four named steps (NOW / WAITING / DONE)
and the forecast. Cancel appears after ten seconds. `html[data-writing-plan]` stands the map's own
chrome down while it shows.

### The Trip Board (signature)
The trip page's plan, on ice, along the foot of the map (canvas "Trip page · B"): the trip column
(city, span, Play, Share, Download, draft notice, budget bar, day rows each edged in its route colour)
beside the day (title, stay, travel modes, Refine with AI, Edit day, then stop cards in a horizontal
strip with walking legs between them, then the day's total). It shuts to a one-line ticket over the
map and becomes a day strip while a stop's drawer is open. **Decided 2026-10-16:** wider than 60rem
the board becomes the right-hand column of "Trip page · A", stops first, with the map full height
beside it (see `docs/superpowers/specs/2026-10-16-web-evaluation-findings.md`). **Unsaved (2026-10-18):**
when a finished plan's draft cannot be written (after one quiet retry), `/` shows this same board
read-only: the tools that need a saved trip are gone, and the draft notice reads "Not saved yet" with
Keep this trip and the reason it didn't save beneath (copy W-16/W-17/W-17a).

### Map Search (signature)
The trip page's spotlight (canvas "Map search · 4"): ⌘K opens it over the map with the day's gaps on a
timeline, category chips, results that fit a gap ("Add at 3:35 PM") and rows that open to the place's
address and hours. A result's map callout is a card with a category-coloured pointer and a dot on its
kind line, never a coloured side border. **Since 2026-10-16** it is the left side sheet of "Map search · 3" (27rem, narrowing
to 36vw on smaller laptops), keeping every per-place detail: a row opens to it as in "Map search · 2".

### The Story Player (signature)
A film of a day (canvas "Story mode · 1 Subtitles"): the narration as subtitles above a near-opaque
night bar, 4.75rem tall, with Previous, an ice Play disc, Next, a 3px scrub track that turns signal on
hover, drag or focus. The board hides while it plays.

### The Pass, the Postcard Wall, Field Notes
Sign-in is a boarding pass on paper (canvas "Sign in · B"); `/trips` is a wall of 4:3
postcards on paper (canvas "My memories · A"); `/profile` is a field notebook (canvas "Profile · B").
All three are light Polar surfaces on the same tokens.

### Map Controls

**On the phone the same stack is 48pt, and the material is the native one.** 44 is the HIG floor
rather than the size — Apple's own map chrome measures 48, read off a column scan of the simulator
at 3x. The mobile port had dropped both halves of the separation this section depends on: there was
no blur and no shadow anywhere in that client, and an opaque slate fill stood in for both, which is
why three attempts at the geometry never made it read as floating. It uses `expo-blur`'s
`systemChromeMaterial` — UIKit's material *for floating chrome*, the one Maps itself draws with —
over the Shadow Vocabulary's **Control** entry, and `ControlShadow` in `mobile/src/constants/theme.ts`
is that entry ported. The explicit `…Light`/`…Dark` variants rather than the adaptive one, because
`app.json` pins `userInterfaceStyle: "dark"` and the adaptive value follows the *system* rather than
the app. Glyphs are neutral ink; the accent appears only while the locate button is actually
moving the camera, which is Apple's own rule for its blue arrow and The One Hand Rule's for signal.

**Three modes, named for MapKit's own and not for its `MapType` strings: Explore, Driving,
Satellite.** The sheet shipped with a fourth, `satellite`, which was a mistake made by reading the
list of available types rather than what they mean. MapKit defines imagery as photography *without*
a label layer and hybrid as the same photography "with road and road name information layers on
top", so plain satellite carries no roads, no names and no points of interest, and no prop adds
them — their absence is the mode. Apple Maps has never offered it; its own Satellite button is
hybrid, which is why ours is too. Offering both cost the map its POIs on imagery and put two tiles
in the sheet that differ only by the one layer a 100pt thumbnail cannot render. Driving is the
unmuted basemap plus `showsTraffic` — Apple's own Driving mode, driven on the simulator, drops the
muted emphasis, thickens the roads and sheds its POI pins, because the roads are the content there.
**That traffic has to be applied a render after the map type**, or it never draws at all: the view
writes `showsTraffic` onto the `MKMapView` before it writes `mapType`, and assigning `mapType`
installs a fresh configuration with traffic off. It looked exactly like an unsupported prop, and was
caught by comparing against Apple Maps on the same stretch of the A5 in the same minute. **There is
no Transit mode and
none can be built** — `MKMapConfiguration` has exactly three subclasses, and the standard one
exposes emphasis, a POI filter and traffic and nothing else. Apple Maps' transit is first-party
rather than API, so unlike Look Around this is not waiting on a native module. "Explore" rather
than "Map" because the trip screen's LIST/MAP toggle already owns that word for the surface.

**3D over imagery is a different map type, not a different camera.** `satellite` and `hybrid` are
MapKit's flat imagery types and refuse pitch outright — pressing 3D over Satellite dived, flipped
the button to "2D" and left a plan view, which is exactly what an unsupported feature looks like.
The 3D pair is `satelliteFlyover` / `hybridFlyover`, so a mode carries its tilted type beside its
flat one and the button swaps between them. **The swap has to land before the camera is asked to
tilt**, a frame apart, for the same reason traffic does: asking in the same commit asks the flat
type. Nothing in the library conditions pitch on the map type; the refusal is MapKit's.

**The compass is drawn rather than placed, because `compassOffset` is a dead prop.**
`react-native-maps` 1.27.2 declares it "Apple Maps only", bridges it on both architectures and
stores it on the view — and nothing reads it; there is no `MKCompassButton` in the package at all,
though it does implement exactly this for the legal label and the Apple logo. The only native lever
is `mapPadding`, and reaching the bottom-right with it costs the camera most of its height. So the
phone grows its own: a round glass button above the mode pill, present only while the map is turned
the way MapKit's own is, pressing to north, its heading read off `getCamera()` throttled to roughly
every fourth frame while a gesture runs — there is no heading event, and `onRegionChange` reports
that the view moved and nothing about its bearing. **The needle carries no colour.** Apple's north
half is red; here red is an alert and signal is "act on this", so the two tones of the chrome's own
ink and a tail shorter than the point do the work instead.

**The chrome rests 62pt up, and that is a floor rather than a taste.** Apple's logo and `Legal`
link are a licence condition and, read off the device at 3x, they occupy **42.3pt to 56.7pt** from
the bottom edge in the left region where the 2D/3D button stands; 62 clears them by 5.3. The stop
card takes the same number, because it is the same fact — one `MAP_FLOOR` rather than a constant
each. Lower means moving Apple's marks, which `legalLabelInsets` and `appleLogoInsets` do on the
Apple path by rewriting a private subview's frame, and which `mapPadding` would do on both
platforms at the cost of the camera's height. Both were offered and neither was wanted.

**When a stop card arrives the chrome steps aside, on the card's clock.** The lift is a
`translateY` at `Motion.settle` under `Easing.bezier(...Curve)` — the arrival's duration and the
house curve, not a control's `respond` — and the card rises from below the edge with
`SlideInDown`. Checked against Reanimated's source rather than its names, which are ambiguous:
`SlideInDown` starts a window height *below* its resting place and travels up, while
`SlideOutDown` travels down off the edge.

**Two switches sit under the thumbnails, and Apple has neither.** Its own Map Modes sheet in
iOS 26 is four tiles and an attribution line — checked, not recalled. Traffic and Points of
interest are ours because they *compose* with the modes in a way no mode can: traffic over
satellite is a pairing a single basemap cannot express, and the labels are worth dropping exactly
where imagery is already dense. **They belong to Satellite and are hidden everywhere else.** Built
global, with a mode acting as a preset, they left a state that could be set and not unset: traffic
on over imagery, move to Explore, and the switch is still on with nothing left to reach it. Off
imagery the answer comes from the mode instead, which is what a Driving mode is for, and the
preset goes with it.

**Their three native writes arrive in the wrong order, and the fix is to sequence them.**
`showsTraffic` is written at `RNMapsMapView.mm:570`, `showsPointsOfInterests` at `:574` and
`mapType` at `:598`; the POI setter does its work by *assigning* `preferredConfiguration`, which
is the same operation that loses traffic. So in any one commit, POI beats traffic and the type
beats both — measured as labels correctly gone and not one traffic pixel left on the metro area.
They are applied one commit apart instead, traffic last, **and traffic passes through off on the
way**: React does not re-send an unchanged prop, so a mode change that leaves traffic on would
wipe it natively and then skip the write that would restore it.

**The map's own overlays take the ground's material, not the appearance's.** The stop card and the
travel summary are `chrome()`'s material, like the buttons — not `Colors.bar` and `Colors.surfaceDeep`,
which are measured against a page. The caption that preceded the card proved why: in the light
appearance `bar` is the one slate at 4%, which over paper is "effectively opaque" and over satellite
imagery is nothing at all, so a stop's name rendered as bare near-black letters across Apple's
attribution. Anything the card puts on that material follows it, including the cost — `Colors.money`
darkens to `#886019` under the light appearance and is an olive smudge on dark glass, so
`OverPhotograph.money` joined the disc for the same reason the disc is there.

The web's stack, unchanged:

Apple-Maps-grade chrome, and the only place `.glass-control` is used: a vertical stack of 44px targets
— a two-button zoom pill, a 2D/3D toggle labelled with the mode you'll *get*, a rotated native `range`
tilt slider in a round pill, and a compass whose needle is written directly to the DOM on `postRender`
so steady-state re-renders stay at zero. The tilt slider is a native input rotated -90°, not a library
and not `writing-mode: vertical-lr` (which only became a vertical range in Safari 17.4); its track and
thumb need explicit rules because `appearance: none` strips the platform rendering.

**The film's panel takes the stop card's place and material, and Meri heads it.** Pressing ▶ on
the phone hands the foot of the map to a narration sheet: the same `Group` and the same `chrome()`
choice of glass and ink by whether the ground is a photograph, but **full bleed** — edge to edge,
standing on the screen's bottom edge with its top corners rounded and its bottom square, the
home-indicator inset added inside it — rising on a transform rather than `SlideInDown`, whose
frame animation could land on a position measured before the sheet grew and leave it floating. Covering the foot of the map
means covering Apple's logo and Legal link, which must stay visible, so while it plays the map's
`mapPadding` grows to the sheet's measured height: MapKit keeps its marks inside the padded area,
just above the sheet, and centres every dive in the map that is left. The sheet's lines are
spaced generously (20pt insets, 12pt beside Meri, 16pt before the narration and before the
controls, 8pt between the two lines) so the header, the narration and the controls read as three
things rather than one block. Its layout is the Frosted Meridian reference (column 02 of
`docs/superpowers/specs/assets/2026-10-11-meri-reference.webp`): Meri, the day's title — with
"Read from your plan" or "Voice unavailable" beneath it only when true — the beat count and
Close; the line being spoken and the next one in a single muted row; then three centred
controls, the middle one the panel's only fill (a 48pt disc in the ink at 14%). While it plays,
everything that is not the place being talked about leaves the shot — the control stacks, the
stop card, the route line and the travel-summary pill.

**Meri never changes colour.** It is the same frosted pearl over dark and light ground, its
states are motion only (breathing, blinking, glancing around, a speaking squash, a happy squint and
one lift for success, a jelly wobble whenever its state changes, stillness
for error), and its host always says the state in words — so no state is carried by colour or
by motion alone, and Reduce Motion loses nothing.

**On the phone Meri also heads the plan-generation screen** (56pt, above the destination): thinking
until the first stop streams in, streaming after it, and error above the notice on the failure
screen. There is no lift — the screen hands off to the trip the moment the plan is saved.

**On screen the character is "your TripMate", never "Meri".** "Meri" (from the Meridian mark) is a code
and design-doc name only: a trip mate *is* a companion, so the product's own name names it, where a
second unrelated word would read as a second brand.

**On the web Meri appears in these places**, drawn by `src/components/Meridian.tsx` from the same
`meridianMotion` table (`src/lib/meri.ts`) the phone uses:

- leading the narration stage's transport row (32px);
- heading the edit chat (28px), with "TripMate" over "● Replying" or "Ask for a change";
- beside "Planning {city}" in the generation band (40px);
- in place of the sparkle on each day's Refine with AI button (16px);
- since Polar, also in the writing screen's lede, the welcome and the offline page.

Its motion is CSS keyframes on `transform` alone, applied only under `prefers-reduced-motion:
no-preference`, so it rides the compositor over a flying map. The Refine Meri is `quiet`: still until
its own button is hovered or focused, because a trip's worth of breathing Meris would upstage the plan.

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

The card now renders only on the `/` result view, which a new plan reaches only when its draft row could not be written (a finished plan opens on its trip page); the trip page uses the board. Money is a figure in
white on night with no hue of its own, the over-budget line is alert red with the word "over", and the
day tab you are on is the only signal-coloured thing in the panel. The
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

**The Tour Faces Where It Is Going.** A stop tour that arrives at every place due north is a
slideshow: the same frame every few seconds, and nothing on screen says a journey happened. Each
step is now framed along its **leg bearing** — the direction of the next stop — so a place arrives
ahead of you. Three things this rule has to keep straight, because they look alike and are not:

- **A leg bearing is not `routeViewHeadingDeg`.** That one returns a day's principal axis ±90°,
  tie-broken toward north: "which way do I stand to see this day laid out", which is right for
  framing a whole day and wrong for travelling through it. Reusing it per-stop is also what once
  made the camera appear to spin on the spot during streaming, because a route's long axis changes
  every time a stop lands on it.
- **Only the tour gets a facing.** A marker click and an itinerary row stay north-up, because a lone
  click has no next stop and a searched place has no route at all. The same stop is therefore framed
  differently depending on how you reached it — a real inconsistency, kept because the alternative is
  inventing a direction for a journey nobody is on.
- **Distance belongs in the flight, not the hold.** The hold is reading time for a card naming a place
  and a time; it does not get more interesting because you travelled 12km. The old fixed 6.5s step was
  1.2s of flight and ~5.3s of stillness whatever the leg — and that stillness *was* the slideshow.

**Rotation is not free on a mercator map, and the two engines must still agree.** `cameraForBounds`
fits an *axis-aligned* box as seen from the camera, so a rotated MapLibre camera needs `|cos| + |sin|`
more extent for the same box — measured at exactly **1.414x at 45°**, tapering to 1.0 at 0° and 90°.
Cesium derives its range from `contextRadiusM` with no heading term at all. Left alone, the moment
anything passes a heading the same stop is framed up to 41% further out on one engine than the other,
varying per stop — which would undo what the two matched `cubicInOut` eases exist for: the
Map/Satellite toggle must not change how arriving at a stop *feels*. MapLibre therefore shrinks the
requested box by that factor before fitting, which makes the visible ground rotation-invariant
(verified: identical zoom at 0/30/45/60/90°) and still honours what `contextRadiusM` promises, since
the radius is the inscribed circle of the framed box.

**Two engines, one contract.** `src/lib/mapRenderer.ts` is the interface both CesiumJS and MapLibre
implement, and nothing above it imports either engine. The contract is in metres, degrees and CSS
pixels: no `Cartesian3` and no `LngLat` crosses it, camera aim is a target point plus a *range* rather
than a zoom, and **pitch is Cesium's convention everywhere — negative is down**. MapLibre's complement
is converted inside `maplibreRenderer.ts`; getting that backwards silently inverts the tilt slider.
The Map/Satellite toggle keeps the view by capturing `cameraState()` off the outgoing engine
synchronously in `setEngine` — not in an effect reacting to the change, because by then the outgoing
canvas may already be hidden, and a hidden canvas is a camera nobody can read.

**Imported plans hedge only what TripMate supplied.** A stop on a plan the traveller brought in
carries `estimated` — the fields TripMate filled rather than read. Those read "about 9:30 AM",
"about 1.5 h" (`stopParticulars`); the traveller's own times and durations read plainly beside
them. Cost is not hedged here: the evidence caption under the stop already says where a cost
came from, and a second way of saying "estimate" is how the two start disagreeing.

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
  tracked out, uppercased, set in the interface's text face, and edged and lit in that day's own core and
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

### Confirm Dialog
The app's modal for actions that cannot be undone and nothing else (the one other modal is the Error
dialog, below, for a failure that blocks). Native `<dialog>` driven by `showModal()`, which buys the four things a modal has to get
right — a focus trap, Esc-to-close, the rest of the page going `inert`, and top-layer rendering. The
panel is `.glass-itinerary` over a real `::backdrop` (black at 0.55 with a 4px blur) rather than a
sibling overlay div, so it cannot be covered and needs no z-index in a shell that already stacks four
layers. `open` cannot be an attribute — `<dialog open>` renders *non*-modally, with no top layer, no
focus trap and no backdrop — so an effect must translate the prop into imperative calls, and Esc's
`cancel` event must be routed back through `onCancel` or the element closes while the parent still
thinks it is open.

### Error messages: Toast, Error dialog, Inline note
Three patterns, chosen in this order: **inline** unless the failure has no place on screen, **toast**
unless it blocks, **dialog** only then. Copy is a table row each (`docs/superpowers/plans/2026-10-17-error-messages-copy.md`);
no screen shows a status code, `e.message` from a fetch, or "something went wrong". Glyph plus words,
never colour alone, at 11px or more. The alert text on dark glass is the token `--alert-on-night`
(`#ffb3b3`, 11.1:1 on deep); on a light surface it is `--wd-alert-text`; positive on night is
`{colors.tag-positive-fg}`. Shared buttons are `.err-btn` in three weights: signal, quiet, text.

- **Toast (error kind)** (`.toast-error`, from `useToast().showError`): night glass, a 2px alert rule on
  its left edge, a glyph, a title, an optional detail and at most one text action, with a dismiss ×. It
  stacks top centre under the navbar (three at most, the oldest dropped; shifted clear of the trip
  page's search sheet and board), in a polite `role="status"` region that is always mounted, and it stays
  until dismissed or resolved; success toasts keep their 3.2s fade. A **hold toast** is a limit with a
  countdown: `{mm:ss}` in the detail counts down for the eye only, a thin bar drains beneath it, and a
  screen reader hears the sentence once with the end as a clock time. At zero it swaps to its
  `resolved` copy, or goes if it has none.
- **Error dialog** (`ErrorDialog`): the Confirm dialog's native `<dialog>`, re-dressed as `role="alertdialog"`
  on night glass at 32.5rem. A warning glyph and eyebrow, the outcome as a 26px title, then **Why**
  (the cause, and what was or wasn't lost) and **Now** (what the buttons do). Two buttons: the safe
  choice is signal, takes focus on open, and is what Esc and a backdrop click pick. `pending` relabels
  it and makes both choices ignore presses. The trip page's failed save is its only user.
- **Inline note** (`InlineNote`): the failure written on the thing that failed, in three sizes. `field`
  sits under its control (`aria-describedby` from the control); `item` rides a row or chip with its own
  text action; `section` stands in for a block that could not load, a dashed frame in the block's own
  space with a "Couldn't load" tag (Oswald, as the canvas sets it: it names the state, like an
  eyebrow), the why and a retry. Polite, never moves focus, and kept mounted so
  a change is announced. `HeldNote` is its limit form, counting down and resolving to the ok tone.
- **Page error** (`PageError`): the section note in a glass card with a way forward, shared by the route
  boundaries (`error.tsx` at `/`, `/trips` and `/trip/[id]`, `not-found.tsx`). `global-error.tsx`
  renders outside the layout, so its alert colour is a literal `#ffb3b3` rather than the token.

**Two deliberate exceptions.** The hold toast draws its rule, glyph and progress bar in **signal orange**
(`--accent`), as on the approved canvas: a limit is a wait rather than a failure, and it is the one
place signal marks something that cannot be pressed — an exception to The One Hand Rule. And
`#ffb3b3` is no longer a loose hex: it is `--alert-on-night`, declared once in `globals.css`.
`ErrorNote.tsx` is kept only for the unmounted Blue Hour landing and mounts nowhere else.

### The Wait (signature)
Since Polar, a new plan is written on **Writing the Plan** (above); this band shows only while an
existing plan is being refined.

A plan takes a few minutes to write, and the map behind is where it appears. The generation stream draws
each stop as the model produces it, so the route and the pins build themselves over the wait. Everything
there is to read sits in one darkened band at the foot of the screen:

- the progress strip;
- Meri, with the "Planning {city}" label and a rotating fact beside it;
- the four steps;
- a Cancel that appears only after ten seconds.

The band is `--surface-deep` at 92%. That keeps small text at 7.1:1 over the brightest ground measured.

**Do not thin the band to let the map show.** Its opacity is the whole reason small text is allowed on
this screen.

**Meri says where the run is:** thinking until the first stop arrives (while facts are gathered and the
model starts writing), then streaming once that stop has drawn. It lifts only if every step finishes while the band is still up. Usually the
band gives way the moment the plan lands, with the check still running behind it, and the plan
opening is the success. The band unmounts on failure, so Meri never shows an error here; the form
says it instead.

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

### The Welcome (signature)
Right after an account is created, seven pages ask one thing each — name and photo, who comes along,
pace and crowds, what matters, home city — and every answer rubber-stamps the **TripMate travel card**:
a passport data page on warm paper (`#f2ece1` into `#e6ddcd`, fibre grain, a darker binding gutter, a
perforated edge, a faint guilloché rosette) — the only paper object in a dark-glass app, because it is
the reward and a reward should be a thing. Stamps are one shape and one ink per step — a blue-black
circle, an oxblood double-ruled rectangle, a bottle-green oval, a violet hexagon — each dated, each
multiplied into the paper with speckled edges, each landing with a press. Your TripMate hosts: one line
per page, a new line per answer, the success squint when an answer lands. No confetti: the bar is
restraint, so the card filling up is the celebration. On the web the card sits beside the steps, tilted
−1.4°; on the phone it is a 136pt strip — the top of the page, as if tucked into a sleeve.

### Destination Facts (signature)
True facts about *this* trip, rotating every 7s under the "Planning {city}" label.
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
**Display Font:** Melodrama · **Body Font:** Switzer — Kiln's two, kept for the export and inlined as base64 `woff2`
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
- **Do** build a new Polar surface inside `.tm`, from its tokens: em sizes off `--wd-base`, the
  `--wd-space-*` ladder, night glass over the world and ice or paper (with `data-appearance="light"`)
  away from it.
- **Do** ask of every orange element whether it can be pressed. If it cannot, it is ink, night, white
  or a role colour (The One Hand Rule).
- **Do** put ink (`--accent-foreground`) on signal, never white: 5.60:1 against 2.55:1.
- **Do** set figures compared in a column with tabular numerals (Oswald on the board, `font-mono` —
  Inter Tight tabular — on the older surfaces). A price meant to be felt is not a column.
- **Do** compose new surface tints as `rgb(var(--surface-deep-rgb) / α)` rather than introducing a new
  grey.
- **Do** darken toward the one slate or black over photography and terrain, never toward white.
- **Do** move `ACCENT_HUE_BAND` in `src/lib/mapRoute.ts` by hand whenever `--accent` moves. A CSS sweep
  misses it and the failure is silent.
- **Do** add `pointer-events-auto` to every interactive box you place inside the shell's overlay.
- **Do** put every failed request in one of the three error patterns (inline, toast, dialog), chosen
  in that order and read through `failureFromResponse`, and check `res.ok` before reading the body. A
  500 whose payload has no data key silently rendered `/trips`' empty state, telling the visitor their
  saved trips were gone.
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
  with `tabIndex={-1}` because they duplicate the panel's focusable rows. Where a canvas draws a
  control smaller than 44px (the trip board's tools, the map search's chips and gaps), the press
  reaches 44px on a coarse pointer through a transparent `::after` centred on it, at least 44px each
  way (`@media (pointer: coarse)` at the foot of `TripBoard.css` and `TripSpotlight.css`), so the
  drawn size stays the canvas's.
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
- **Do** let the world (the map, a scrolled photograph) be the motion. Interface motion is one-shot, on
  the `--wd-ease-*` curves (`--wd-ease-sheet` is the How it works sheet's), and nothing loops. Recorded
  exceptions: the sheet's backdrop fades on a sine curve, ImagineDay keeps its own `--ease`, and
  the app shell's marker and map-curtain curves in `globals.css` predate Polar.
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
- **Don't** add a second action colour, and don't give money a hue; a figure is the subject in ink or
  white.
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
- **Don't** introduce a new surface colour. Over the world, raise the glass alpha or blur; away from it,
  use ice, snow or paper.
- **Don't** add a kicker or eyebrow above a headline the canvas does not draw. The landing and planner
  carry the ones MagicPath specifies; new surfaces do not inherit them.
- **Don't** use a hard offset shadow, and don't use glyph or icon-font icons — every icon in the system
  is inline SVG.
- **Don't** let route cyan or the day pool into interface chrome (The Map Owns Cyan Rule).
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

Findings the build carries today, recorded so nothing here is inherited by a new surface. The
layout and performance findings of the 2026-10-16 evaluation (sliced text, stacks that collide on short
screens, the trip map framing a hill town off screen) are tracked in
`docs/superpowers/specs/2026-10-16-web-evaluation-findings.md`, not repeated here.

1. ~~**Muted text below AA on light surfaces.**~~ Fixed: stone as text is `--wd-stone-text`, ember is
   `#a64c09`, and the spotlight's category counts are ember rather than signal.
2. ~~**Labels under the 11px floor.**~~ Fixed: `.tb-label`, `.tb-day-when`, the leg tags and the budget unit
   are `max(0.6875rem, 0.6875em)`, 11px at the smallest base, and the map search's and the drawer's
   labels follow (2026-10-17); `src/lib/contrast.test.mjs` fails on a bare em below 0.786 only for the selectors it lists, so a new label has to be added there.
3. ~~**Faces named by family.**~~ Fixed: the time picker (`PlanningFlow.css` `.tmp-read input`,
   `.tmp-k`) now asks for `--font-display-stack` and `--font-condensed-stack`, the `next/font`
   variables, rather than the family names `next/font` never registers.
4. ~~**A keyframe that does not exist.**~~ Fixed: `@keyframes tm-in` is defined in
   `PolarLanding.css`, so the eight entrances in `WritingThePlan.css` and `PlanningFlow.css`,
   including each rotating fact's, run.
5. ~~**Sizes outside the one base.**~~ Fixed (2026-10-18): ImagineDay's `.pl` sections set their type
   in ems of `--wd-base` (`.pl` itself is `var(--wd-base)`), and their action is `--wd-signal` with
   the system's lightening `--wd-signal-hover`; `StoryPlayer.css` and `TripSpotlight.css` set every
   font size in em, labels under 11px as `max(0.6875rem, …em)`. Each is the size it was at 1440 (two story-player labels rose to the 11px floor). Box
   geometry there (bar height, control and touch-target sizes, sheet padding) stays rem, and the
   spotlight's field keeps its rem size, since a field is never on the em scale.
6. **The mark's stop is still Kiln jade** (`#28b981` in `LogoMark.tsx`), the one Kiln colour left in the
   interface.
7. ~~**The landing's only `h1` rotates.**~~ Fixed: the hero carries one stable visually-hidden `h1`,
   the rotating place name is `aria-hidden`, and the ghost CTA reads "Picture a day ↓" — it names no place,
   because `#day` is always the Petra story.
8. ~~**Breakpoints are not shared.**~~ Fixed (2026-10-18): one set, 40 / 48 / 60 / 64 / 68.75 / 100rem,
   in range syntax, with the JS mirrors on the same queries (see Layout).
9. ~~**Radius drift on the older glass surfaces.**~~ Fixed (2026-10-18): `.glass-itinerary` panels and
   the confirm dialog are `rounded-md`, `{rounded.card}` at the root's 16px, and `{rounded.panel}`
   (16px) is gone from the frontmatter.

## History

- **"Polar Interior"** (current; shipped 2026-10-13 on `feat/polar-redesign`, from the approved MagicPath
  project `460590324033662976`). Replaced Kiln's warm near-black, its three colour roles (jade acts,
  gold counts, coral warns) and its Melodrama / Switzer / Tabular faces with night and ice, one action
  colour, money without a hue, and Cormorant Garamond / Inter Tight / Oswald. The landing became the
  Polar landing (the Blue Hour landing code is kept unmounted pending a decision, `docs/frontend.md`).
  Kept from Kiln: the four-layer shell, glass over the map, the route pool and the map's day rendering,
  the focus-ring, unlayered-beats-utility and blur-of-nothing rules, and the export's own world.
  `docs/design-history.md` records Kiln.
- **Kiln II type revision** (superseded by Polar; 2026-09-09): Melodrama + Switzer + Tabular over Kiln
  II's colour system, after a role-by-role census of the ramp.
- **"Kiln II"** (superseded by Polar; approved 2026-09-08): a warm near-black `#121110` with jade, gold
  and coral roles, fused from comps B Clay and C Negative after the first fusion read as muddy.
- **"The Trip Line"** (additive, still current): the downloadable export's own world. Did not replace
  anything — no app custom property was touched and no route's rendered output changed.
- **"The Blue Hour Expedition"** (superseded by Kiln II's landing): a scoped cobalt-teal alternate
  identity over the pre-generation flow, with its own scene faces, a `.scene-band` gradient, two
  interlocking alpha-cut hero photographs and a closing poster that withheld the CTA to the very end.
  The retint went because switching palette mid-app reads as a different product rather than a different
  surface; the poster went because a reveal that lands softer than the evidence before it is not a
  reveal, and the ask moved into the hero.
- **"The Lit Cockpit Over a Turning Earth"** (superseded): one slate `rgb(15 23 42)`, one amber accent,
  Archivo throughout. Its material argument survives in glass over the map; its colour and type
  strategy did not.
- **"Overcast"** (superseded): full-bleed globe with steel-blue translucent cards. The steel-blue
  register never resolved and legibility over a moving map was inconsistent.
- **"Roamly"** (superseded): a true split layout with warm cream/teal solid surfaces beside a boxed-in
  globe pane. Warm cream on cool slate read as two design systems, and the split pane surrendered the
  globe as the thing that carries the product.
