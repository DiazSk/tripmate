---
name: TripMate
description: Dark frosted glass over a live photorealistic globe, with one warm accent reserved for interaction.
colors:
  canvas: "#091b20"
  surface-deep: "rgb(13 46 55)"
  foreground: "#ffffff"
  muted: "rgba(255, 255, 255, 0.6)"
  on-deep: "#ffffff"
  accent: "#fb9826"
  accent-hover: "#fcac52"
  accent-foreground: "#091b20"
  map-dot: "#fba13a"
  card-border: "rgba(255, 255, 255, 0.12)"
  glass-foreground: "#ffffff"
  glass-muted: "#cbd5e1"
  tag-neutral-bg: "rgba(255, 255, 255, 0.13)"
  tag-neutral-fg: "#e3e9f1"
  tag-highlight-bg: "rgba(255, 179, 64, 0.2)"
  tag-highlight-fg: "#ffca7a"
  tile: "rgba(255, 255, 255, 0.1)"
  tile-foreground: "#e3e9f1"
  route-blue: "#0A84FF"
  map-pin-red: "#FF3B30"
  shadow-control: "rgba(0, 0, 0, 0.32)"
  shadow-panel: "rgba(0, 0, 0, 0.37)"
  shadow-thumb: "rgba(0, 0, 0, 0.4)"
  shadow-object: "rgba(0, 0, 0, 0.55)"
typography:
  root:
    fontSize: "clamp(16px, 1.13vw, 20px)"
    note: "Fluid root; every rem below scales with it. Floors at 16px, never shrinks."
  family:
    all: "Archivo, ui-sans-serif, system-ui, sans-serif"
    note: "One face for the whole product — see The One Face Rule. There is no second family."
  tracking:
    note: "Tightens as type grows, which is the inverse of the usual instinct. Nothing at zero or positive."
    display: "-0.076em"
    poster: "-0.075em"
    cardTitle: "-0.09em"
    heading: "-0.06em"
    label: "-0.045em"
    body: "-0.04em"
  poster:
    fontSize: "clamp(3rem, 11vw, 13rem)"
    fontWeight: 900
    lineHeight: 0.92
    letterSpacing: "-0.075em"
    note: "The two one-word posters only. No font-stretch — see The Width-Axis Rule is retired."
  sectionHeading:
    fontSize: "clamp(2rem, 5vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.076em"
  stat:
    fontSize: "2.81rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.085em"
    note: "Step numbers and footer navigation."
  cardTitle:
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.09em"
  display:
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.06em"
  title:
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "-0.04em"
  field:
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "-0.045em"
  index:
    fontSize: "0.62rem"
    fontWeight: 600
    note: "Step numbers beside an icon. An index, not a headline — see How it actually works."
rounded:
  sm: "6px"
  md: "12px"
  lg: "16px"
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
    padding: "10px 20px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-hero-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.full}"
    padding: "16px 32px"
  button-hero-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.on-deep}"
    rounded: "{rounded.full}"
    padding: "16px 28px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
  button-destructive:
    backgroundColor: "#dc2626"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    padding: "8px 16px"
    typography: "{typography.body}"
  card-glass:
    backgroundColor: "{colors.surface-deep}"
    textColor: "{colors.glass-foreground}"
    rounded: "{rounded.lg}"
    padding: "20px"
  field-console:
    backgroundColor: "rgb(15 23 42 / 0.5)"
    borderColor: "rgba(255, 255, 255, 0.1)"
    rounded: "{rounded.lg}"
    dividerColor: "rgba(255, 255, 255, 0.1)"
  field-cell:
    backgroundColor: "transparent"
    backgroundColorFocus: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.glass-foreground}"
    padding: "12px 16px"
    typography: "{typography.field}"
  chip-neutral:
    backgroundColor: "{colors.tag-neutral-bg}"
    textColor: "{colors.tag-neutral-fg}"
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
    padding: "8px 28px"
  budget-tile-total:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.md}"
    padding: "12px"
  budget-tile:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.tile-foreground}"
    rounded: "{rounded.md}"
    padding: "12px"
---

# Design System: TripMate

## Overview

**Creative North Star: "The Lit Cockpit Over a Turning Earth"**

The whole application is one scene: a full-bleed CesiumJS globe rendered from Google Photorealistic 3D Tiles, with every piece of interface floating above it as dark frosted glass. `AppShell` renders exactly four layers on every route — the globe at z-0, the floating stop markers at z-5, a viewport-spanning content overlay at z-10, and app chrome (wordmark, map controls) at z-20 — and that structure never varies by route or by step. What changes between screens is which glass boxes are on stage — and, since the globe was gated, whether anything is behind them at all.

**The globe is on exactly two surfaces: `/trip/[id]`, and `/` from generation start through the result view.** It is not a page background; it is the map, and it appears where there is a route to look at. That is a narrowing of this rule, made on measurement rather than taste: a cold `/profile` was paying 5410ms of long tasks across 32 tasks, a 2287KB chunk, 33 `/cesium/` asset requests and a live WebGL2 context to put a globe behind a settings form. `/trips`, `/profile` and the whole pre-generation flow now sit on flat `--canvas`, and the surfaces that used to float over live terrain there are opaque instead — a blur of a flat colour is a blur of nothing. The gate is `globeWanted` in `mapCamera.tsx`, declared by the two components that own those surfaces; see **The Mounted-Surface Gate** below for why it cannot be a pathname.

The material is deliberately singular. One slate, `rgb(15 23 42)`, is the substance of every panel, control pill, badge, photo scrim and loader disc; only its alpha and its blur radius change. That shared origin is what keeps a 56px-blurred itinerary panel, a 20px-blurred zoom pill and a near-opaque loader reading as one system instead of four similar greys. Against that cool, neutral field sits exactly one warm colour — amber `#ffb340` — and it is reserved for interaction: primary buttons, the active day tab, the budget bar fill, focus rings, category icons, the Total tile. Nothing decorative is amber.

The home page's first viewport used to be a single poster viewport with the CTA immediately beneath the headline. It is now the opening beat of a four-part scroll story — **"The Blue Hour Expedition"** — that runs the entire pre-generation flow (the landing scroll and the merged trip-form/tier-picker step) under a scoped alternate palette, `.blue-hour-scene`: a curated photo hero with no CTA, a compact row of four photo cards, a short mechanism explainer, and only then — as the reveal the whole sequence builds toward — the "Plan a trip" poster. The category default this refuses is the same one the original poster refused, one level up: a single immediate CTA is now itself the safe, expected shape, so the reveal is withheld across a full sequence rather than across one extra step. See **The Blue Hour Expedition** below for the full system. Once an itinerary exists, the result view (and `/trips`, `/trip/[id]`) return to the unscoped "Lit Cockpit" system described in the rest of this document — the amber accent, slate-900 material, and Source Serif 4 headings never left; they resume the moment there's a real plan to look at.

**Key Characteristics:**
- One slate at many alphas is the only surface material; there is no opaque card tier.
- One warm accent, interaction-only, on a cool neutral field.
- Depth comes from blur, translucency and a single ambient shadow — never from a border-only card sitting on a flat page.
- Serif display type (Source Serif 4) for headings; a wide grotesque (Archivo) reserved for the one poster headline; system sans for everything else.
- Where the globe is on stage it is live and moving, and no other ambient motion competes with it. It is on stage on two surfaces, not eight.
- `tabular-nums` on every cost, total and temperature.
- **Two worlds, one shell.** `.blue-hour-scene` retints the same token names (`--accent`, `--surface-deep-rgb`, `--tag-highlight-*`) for the pre-generation flow only, so every existing component built against those tokens (`TierPicker`, `Field`, `.glass-itinerary`, `.hero-legible`) retints automatically with zero component changes. It is additive, not a replacement — unlike "Overcast" and "Roamly" in History below, nothing here superseded the base system; the result view, `/trips` and `/trip/[id]` are provably untouched.

## Colors

A cool near-black slate carrying the entire surface layer, one warm amber for anything the user can act on, and two map-native colours that deliberately sit outside the brand palette.

### Primary
- **Signal Amber** (`{colors.accent}`): the only saturated colour in the system. Primary buttons, the active day tab, the budget bar fill, the selected-tier ring and check badge, focus rings, category and weather icons, the day-spend Total row. It is a *light* colour, so anything printed on it takes the dark **Espresso** foreground (`{colors.accent-foreground}`), never white.
- **Signal Amber Bright** (`{colors.accent-hover}`): hover state for every amber fill, and the second stop in the generation loader's rotating sweep.
- **Amber Wash** (`{colors.tag-highlight-bg}` / `{colors.tag-highlight-fg}`): the one tinted chip, carried only by AI-attributed tags. Every other chip stays neutral glass.

### Neutral
- **Void Slate** (`{colors.canvas}`): the page canvas and Cesium's own `scene.backgroundColor`. Both read the same token at Viewer init so the WebGL clear colour and the DOM around it cannot drift and show a seam at the canvas edge.
- **Deep Slate** (`{colors.surface-deep}`, authored as the channel triplet `--surface-deep-rgb: 15 23 42`): the material. Panels at 0.62, control pills at 0.55, the tier price badge at 0.85, the loader disc at 0.95, photo scrims as gradients from 0.35 to 0.88. Always consumed as `rgb(var(--surface-deep-rgb) / α)`.
- **Paper White** (`{colors.foreground}` / `{colors.on-deep}`): body text on the canvas, and all text over dark surfaces — header bands, photo overlays, the hero, the map.
- **Steel Muted** (`{colors.muted}`): secondary text on the plain canvas and on Cesium's relocated credit line.
- **Glass Muted** (`{colors.glass-muted}`): the muted value *inside* a glass panel. Slate-300 rather than slate-400, because a translucent panel over bright terrain pushes slate-400 below the floor.
- **Hairline** (`{colors.card-border}`): every glass edge, every divider, every internal rule.
- **Chip Glass** (`{colors.tag-neutral-bg}` / `{colors.tag-neutral-fg}`) and **Tile Glass** (`{colors.tile}` / `{colors.tile-foreground}`): white-wash fills for chips and tiles, so the amber Total row is the only thing in the band that pops.
- **Alert Red** (`text-red-400`, `border-red-500/30`, `bg-red-500/10`, and `bg-red-600` on the one solid destructive-adjacent button): not a second accent — it appears only when something failed or a day ran over budget, never as decoration or category. `red-400` and not `red-600` for text: inside `.glass-itinerary` the panel redefines `--foreground` to white, and dark red on dark slate is the wrong red. **`bg-red-500/10` is a fill only over decorative scenery, never over a live map.** The trip-form's own error block uses it correctly — it sits over the `.map-chrome-hidden`, soft-focus globe on the pre-generation steps, which is scenery, not something being read. `/trip/[id]`'s overspend banner shipped with the same class and nearly disappeared: a real, arbitrary, often-bright aerial map showed straight through a 10%-opacity tint. The fix was `.glass-itinerary`'s actual slate backing (per the One Slate Rule: a new surface takes a new alpha of the one material, not a new hue), with red kept to text, icon and border only.
- **Shadow black** (`{colors.shadow-control}` at 0.32, `{colors.shadow-panel}` at 0.37, `{colors.shadow-thumb}` at 0.4, `{colors.shadow-object}` at 0.55): the four alphas of the shadow vocabulary below, one per surface class. They are shadow, not surface — they never fill anything, and they belong to no tonal ramp. The stop marker no longer carries a box-shadow at all (nor any fill or border) — see The Day on the Globe, above.

### Tertiary (map-native, outside the brand palette)
- **Route Blue** (`{colors.route-blue}`, with `#0060DF` casing): the day's arcs, the stop stems and their glow pools.
- **Pin Red** (`{colors.map-pin-red}`, with `#C1271F` stroke): the destination teardrop pin and the compass needle.

These two are map affordances that must read against arbitrary satellite imagery at any brightness. They are not part of the interface palette and must never appear in a panel, chip or button.

**The one exception, in the other direction.** `{colors.accent}` is allowed onto the globe, and only
to mark the stop the user is *touching*: the hovered or selected stem, its glow pool, and the arcs
either side of it. Amber on the globe means "you are pointing at this" — never "this is a Tuesday".

Per-day accent colours were considered for the arcs and rejected. Only the active day is ever
drawn, so a per-day ramp has nothing to distinguish itself from; it would have meant a new
five-colour palette earning its keep on a single day's route, and `Stop` carries no day identity
anyway (the day is just the index in `Itinerary.days[]`). Keep this exception to interaction state,
or the separation between map and interface erodes one reasonable-looking case at a time.

### Named Rules

**The One Slate Rule.** Every panel, pill, badge, scrim and loader is `--surface-deep-rgb` at some alpha. If a new surface needs a background, it takes this token at a new alpha — it does not take a new grey.

**The One Accent Rule.** Amber marks interaction and nothing else. Chips gave up their green for this: `--tag-positive-*` exists but resolves to the same neutral glass as `--tag-neutral-*`, which is the deliberate cost of the surfaces cohering.

**The Two Foregrounds Rule.** `--accent-foreground` means "text on amber" and is dark. `--on-deep` means "text on something dark" and is light. They are not interchangeable; conflating them is the specific bug this palette was rebuilt to fix.

**The Darken-Never-Lighten Rule.** Anything layered over photography or terrain is tinted toward slate or black, never toward white. Over the itinerary's photo bands the budget tiles are black-tinted glass at `bg-black/25`; white-tinted tiles drop their labels to roughly 2:1 over a bright photo. The Total row keeps its amber fill, which is opaque and so unaffected by whatever is behind it.

**The Photograph-Is-Not-A-Surface Rule.** A scrim over destination photography makes *large* type
safe and small type only apparently safe. Measured across eight cities: every one resolves to a real
cityscape, but mean luminance ranges 0.040 to 0.348 and Kyoto peaks at 0.947 — near-white sky. White
body text over that peak is 2.41:1 under a 60% scrim and 3.56:1 under 75%, so no flat scrim rescues
it. The split that follows is the reference's own Combine construction: **large type on the
photograph, everything small or dense in a darkened band.** The generation screen is built on it —
a top-weighted gradient (0.94 → 0.90 at 34% → 0.55 at 60% → 0.88) under the city name and the fact,
and a `0.92` band under the steps, forecast and controls. Verified by sampling the composited pixels
behind every text run with the text itself hidden, across five cities — 40 measurements, all
passing. Worst case: 3.81:1 for large type on the photograph against its 3:1 bar, 5.10:1 for the
two small runs that remain up there (they survive only because the gradient holds 0.90+ over the
top third), and 8.56:1 for small text down in the band. The first build of that screen
violated its own rule by leaving a 14px summary line and a 14px opener label on the photo; they
measured 2.97–3.65:1 on **every** city tested. Measure the pixels — a scrim that looks generous is
routinely not. Two traps in the measuring itself: Tailwind v4 emits `oklab(...)`, so hand-rolled
rgb parsing reads the lightness as a red channel and cheerfully reports legible text as 1.00:1 —
composite through a real canvas or sample rendered pixels instead. And a photo needs *worst*-pixel
sampling, not mean: the means here were a comfortable 3.9–8.4:1 while the worst pixels failed.

**The Constant-Ground Rule.** A surface's colour must not depend on whether an image has finished loading. The day-spend band once branded its background, its border, its text colour *and* all five tiles on `headerPhoto` being truthy, so the whole band changed character a second or two after first paint. The band now paints `rgb(var(--surface-deep-rgb) / 0.7)` unconditionally and the blurred photo arrives *behind* it on `.value-in`: a photo adds texture, never a repaint. The same applies to a stop's avatar — the category tile is the base layer and never unmounts, the photo resolves over it.

**The Mounted-Surface Gate.** Cesium boots on exactly two surfaces — `/trip/[id]`, and `/` from the moment generation starts through the result view — and the gate is a boolean on `MapCameraProvider` (`globeWanted`), set by the two components that own those surfaces via `useGlobeOnScreen`. It replaced a `globeVisibility.ts` path list, and it is not a pathname for a reason a path list cannot fix: `/` serves three steps from local state, and `/trip/<unknown-id>` renders `not-found.tsx` — a glass card that wants no globe, on a path indistinguishable from a real trip's. Both would have burned the full boot for a card. Two further properties are load-bearing. The viewer is built **at most once and never destroyed**, because a swap is unrecoverable: `destroy()` takes the camera pose, the tile cache and every route entity, and nothing replays them (`showDayRoute` is a stable `useCallback` whose caller's deps don't change on a swap, and the pending queues were consumed on first registration). And leaving a globe surface hides the canvas with `visibility: hidden` rather than `display: none` or an unmount — a zero-size canvas reallocates the framebuffer and re-rasters every resident tile on the way back, where `visibility` keeps the context, the drawing buffer and layout, and costs one composite of a texture the GPU already owns. Hiding it is also what closes the stale-geometry bug for every surface at once: `.map-chrome-hidden` only ever hid two DOM layers, and route arcs are entities *inside* the canvas.

The gate has a material consequence that follows automatically: a surface with no globe behind it has nothing to frost, and a 56px blur of a flat `--canvas` is a blur of nothing while still costing a render surface. So `.glass-itinerary.is-opaque` is the frost-off variant, carried by the four surfaces where `globeWanted` is false — `/trips`' memory cards, the plan step's form card, and the two dead-end cards (`/trip/latest` on an empty database, and `/trip/[id]`'s not-found). `.profile-glass` takes the same treatment inline, being single-use. **Adding a glass surface to a route means checking whether that route boots the globe first.** The two exceptions worth knowing: `.glass-nav` keeps its blur everywhere, because content scrolls under it on every route; and `ConfirmDialog`'s panel keeps its blur even on `/trips`, because it sits over its own `::backdrop` — 55% black plus a 4px blur over the live page — and blur over a dimmed page is not blur over nothing.

**The Profile Panel Tint.** `/profile`'s form sits on `.profile-glass` — `.glass-itinerary`'s material (the one slate, hairline, panel ambient shadow) with a cobalt-teal gradient laid *over* it, at alpha 1 and with no blur since the globe stopped booting on this route, reusing Blue Hour's own `--scene-cobalt-rgb`/`--scene-teal-rgb` at the same alphas `.scene-band` established. This is a tint on the one slate, not a new grey, so it stays inside the One Slate Rule rather than joining the exceptions below. What it deliberately does **not** do is retint `--accent` the way `.blue-hour-scene` does: this is a background treatment for a settings form, not a scene, so every picker's selected state and the Save button stay amber. Switching the accent to brass mid-app, on a route reachable from the amber result view, would read as a different product rather than a different surface — the sections needed separating from the globe, which is a background problem, and the accent was never the thing at fault.

**The Postcard Exception is retired.** `/trips` used to be paper: `--postcard-paper` (`#f4f1ea`), `--postcard-ink` (`#2b2620`), `--postcard-ink-muted` (`#6b6355`), each card rotated a degree or two off true on a heavy drop shadow, a dashed postage stamp in the photo's corner. It was defended here as a second scoped material exception on the grounds that a physical postcard cannot be frosted glass — which is true, and beside the point. It made this route the **third** visual language in a product that should have one, and a visitor arriving from `/trip/[id]` crossed from dark translucent slate to tilted cream stationery in a single click. The cards are `.glass-itinerary` now, like every other surface — opaque here via the shared `.glass-itinerary.is-opaque` modifier, since there is no longer a globe behind them to frost. What made the route feel like a collection was never the paper; it was the photographs, and those are untouched. `.blue-hour-scene`'s ground retint is therefore the **only** remaining scoped material exception in the app, and the bar for adding a second is now this entry.

## Typography

**Display Font:** Source Serif 4 (weights 500/600/700, upright *and italic*, via `--font-display`, falling back to `ui-serif, Georgia, serif`)
**Body Font:** Manrope (weights 400/500/600, via `--font-body`, wired to Tailwind's `--font-sans`; the system sans stack behind it is a load fallback, not the design)
**Poster Font:** Archivo variable, width axis loaded (via `--font-hero`)

**Two faces and a poster — that is the whole set.** It was five: these two, plus Playfair Display and a bare system stack, with the Blue Hour scene running its own face family. Playfair is retired — Source Serif 4's italic does the same job, and two high-contrast serifs splitting the display role *by route* was the single clearest reason the landing and the app read as different products. Manrope was the scene's body face and is now the app's; a platform default is not a typographic choice, and it was the one face here nobody had picked. Adding a fourth family needs a reason that survives being asked "which of the three can't do this."

**Character:** A warm, slightly bookish serif does the naming — wordmark, page titles, card and day headings, and in italic the scene's own headlines — while a clean geometric-humanist sans carries every piece of data, label and control. The pairing keeps the interface quiet enough that the one poster voice, a very wide grotesque, lands as an event rather than as a style.

**Tracking is on the serif now, and it is small on purpose.** `.font-display` carries `-0.01em` — the value this document has specified since it was written, and which the stylesheet never actually implemented; the serif shipped at the browser's default 0. `.font-scene-display` takes three times that, `-0.03em`, because it only ever runs at 30–63px and tracking is an optical correction rather than a constant: what reads as normal spacing at 18px reads as gaps at 60px. Neither goes near the reference site's `-0.078em`-to-`-0.106em` ramp. That is grotesk logic — a high-contrast serif's own stroke contrast and bracketed serifs already close its counters, and copying those numbers onto Source Serif 4 collides the serifs into each other. The poster face carries the large negative tracking in this system, and it is the one that should.

**Scene prose leading (`.scene-prose`, 1.8).** The reference runs body copy at 1.85 against 1.0 headings, and that contrast is a real part of why it reads as a magazine. It is also a marketing page made of short paragraphs. This app's other surfaces are dense instrument panels — day rows, budget tiles, stop lists — where the same leading costs a screenful of scanning and buys nothing, so this is a class applied to the three prose blocks on the Persuade surface (both hero sublines and the `HowItWorks` step bodies), not a change to the Body step. The headings it plays against sit at 0.88–1.2, so the contrast lands at 1.8 without needing the full 1.85.

**Load the italic; never synthesise it.** `Source_Serif_4` is loaded with `style: ["normal", "italic"]` because `.font-scene-display` sets `font-style: italic` at 60px+. A browser with no italic cut shears the upright instead, and at that size a faux italic's even stroke weights and unchanged letterforms are obvious next to a drawn one.

**The root grows; it never shrinks.** `html { font-size: clamp(16px, 1.13vw, 20px) }` is the one measurement every step below hangs off. Tailwind's whole scale is rem, so moving the root moves type, padding, gaps and radii *together* and the composition scales rather than reflows — which is what a fixed 16px root was costing: past roughly 1400px the interface stayed the same physical size and occupied a shrinking fraction of the screen, reading as a boxed web app sitting on a full-bleed globe. The `16px` floor is not a taste call and is not negotiable downward: below it the `min-h-11` targets fall under the 44px touch minimum and iOS Safari zooms the viewport on input focus, which is the same constraint the Field step already exists to satisfy. Every viewport narrower than ~1416px therefore renders exactly as it did before this rule existed; the rule only ever adds size. Sizes quoted in this section are at the 16px floor.

### Hierarchy
- **Poster** (`.font-scene-hero`; Archivo 900, `font-stretch: 125%`, `clamp(2.5rem, 10.5vw, 12rem)`, line-height 0.88, tracking -0.035em): the landing's closing headline, and **one word**. It was the sentence "Every day planned. Every dollar spent." across four centred ragged lines, which is a sentence set large rather than a poster — four lines of a claim compete with each other, none of them gets to be big, and the mechanism they state is already spelled out in the subline directly beneath and in HowItWorks above. Reducing to one word is what buys the scale: capped at 6rem across four lines, it runs to 12rem on one. The width axis does as much work as the weight (900 alone reads bold; 900 at 125% reads like a poster) and the negative tracking is what stops a wide face sprawling at that size.

  **Size the vw term against the measured glyph run, not by eye.** Archivo at 900/125% with this tracking renders at about 6.87x its font-size, so a ten-character word needs `fontSize <= available / 6.87`. A single word cannot wrap, so the failure mode is overflow, not an ugly break: `15vw` was tried and filled 93% of a 1920 viewport with 74px of total slack, which one differently-metricked fallback face would have blown straight through. `10.5vw` holds it at 66-82% of the available width from 375px to 2560px, which is where the reference's own one-word hero sits.
- **Hero Display** (`.font-display`, 700, `text-5xl`/`sm:text-7xl`, line-height 0.98): `/trips`' own hero headline over its photo collage, and the empty state's at one step down (`text-4xl`/`sm:text-6xl`). This is the serif at poster scale, and it is deliberately not `.font-hero` — the One Poster Rule keeps the wide Archivo to the landing headline alone, so a second surface that needs to open big grows the *serif* instead of borrowing the poster face. Only a full-bleed hero earns this step; a page title inside a panel stays at Display.
- **Display** (`.font-display`, 600, 1.25–1.5rem): the wordmark, page titles ("My memories"), and the itinerary card's `{city}: {N} Days` header.
- **Title** (`.font-display`, 600, 1–1.25rem): section headings inside a panel — "Choose your style", "Day N · MM-DD-YY", a place-detail name, a tier card headline.
- **Body** (system sans, 400, 0.875rem, relaxed leading): panel copy, stop names and notes, day summaries (italic). The hero subline is the one deliberate exception at `text-base` / `sm:text-lg`, capped at `max-w-xl` — the poster above it is 134px at a laptop width and 202px at 1920, so dropping to 14px is a cliff rather than a scale step, and that line carries the mechanism the rest of the page only implies.
- **Field** (system sans, 500, 1rem): a value the user has typed or picked, in the trip form's console cells. 16px rather than the body step is a hard requirement, not a preference — below 16px iOS Safari zooms the viewport on focus.
- **Label** (system sans, 600, 0.75rem, tracking 0.025em, uppercase): field group labels inside the place-detail panel ("Best time to visit", "Tips", "Next up"). Uppercase labels belong *inside* a panel, beneath a heading, describing the field that follows.
- **Numeric** (`tabular-nums`): every cost, total, budget figure and temperature, without exception.

### Named Rules

**The One Poster Rule.** `.font-scene-hero` applies to the two one-word posters — the landing's opening "Somewhere." and its closing "Elsewhere." — and to nothing else, ever. A third hyperbold block anywhere dissolves the pair's authority.

Its old subject, `.font-hero`, is deleted. It had drifted into dead CSS: defined and documented as "the landing headline", used by no component, while `.font-scene-hero` quietly did the job.

**The Width-Axis Rule is retired.** Archivo no longer loads `axes: ["wdth"]`, because nothing sets `font-stretch` any more. Widening a heavy grotesk was the single strongest template tell on the landing — the reference never touches the width axis and gets its density from negative tracking instead. The poster is weight 900 at `-0.075em` now. Loading a variable axis no rule consumes is bytes for nothing.

**The One Face Rule.** One family, Archivo, for the entire product: display, body, UI, posters. Every step in the ramp comes from size, weight and tracking, never from a second family. This replaced three faces (Source Serif 4, Archivo, Manrope) and, before those, five. What it knowingly gives up is the serif that used to mark "a real plan to look at" — `/trip/[id]` and `/trips` now speak in the same voice as the landing. Adding a second family back is a decision about the whole product, not a local one.

**Tracking tightens as type grows.** The ramp runs `-0.076em` at display, `-0.09em` on card titles, `-0.06em` on panel headings, `-0.04em` on body. Nothing sits at zero or positive. This is the inverse of the usual instinct — loosen small text for legibility — and it is measured off the reference rather than chosen: it is most of why a line reads as one packed shape instead of a row of letters. The `-0.04em` craft-floor tracking floor is deliberately exceeded above the body step; that floor is tuned for text sizes, and these are not.

**The No-Kicker Rule — amended, and narrowed to "above".** Nothing sits *above* a headline: no eyebrow stacked on top of it, no all-caps kicker, no category label introducing a title. Uppercase remains a field-label device only.

What the rule no longer forbids is a label sitting *beside* a heading, in its own column, as a running header. `SectionOpener` is that exception and the only one: a `text-sm`/600 label at `text-white/40` pinned in an 11rem left column, the heading offset into column two, a hairline across the top. It was adopted from the Vita Travels breakdown, on an explicit instruction, as the reference's most recognisable move — the thing that tells a reader a new movement has begun.

The narrowing is honest about its own cost. Below `lg` the column collapses and the label *does* stack above the heading, which is the shape this rule was written against. Two constraints keep that from being a kicker in practice: the label names the movement rather than restating the heading (never "Method" above "How it actually works" — it says "Method" above a heading that does not contain the word), and it never runs uppercase. Anything that fails either test is still banned.

Note this also contradicts the impeccable craft floor, which bans eyebrows outright and says no brief earns them back. The brief did. Recorded here rather than argued each time it comes up.

## Layout

**The shell.** `AppShell` is a `h-dvh`, `overflow-hidden` flex container with four stacked layers: the globe absolutely positioned at z-0, `StopMarkerLayer` at z-5, a `pointer-events-none absolute inset-0 z-10 overflow-y-auto` overlay holding the route's children, and `Navbar` + `MapControls` as z-20 siblings of that overlay. The marker layer sits *below* the content overlay deliberately — the stop cards belong to the world behind the glass, so a panel occludes them exactly as it occludes the globe. Putting them above was tried and looked wrong immediately: a stop near the right edge drew its card straddling the itinerary panel's edge. Pages never own the background and never own the nav.

**Three content shapes.** A surface is a *centred column*, a *right-docked panel*, or a *hero-led page*.

- **Centred column** (landing scroll story, plan card at `max-w-[84rem]`): normal flow inside `<main class="p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)]">` — only the top padding is asymmetric, to clear the fixed nav.
- **Right-docked panel**: `fixed top-[calc(var(--nav-h)+1.25rem)] right-6 bottom-6 left-6 z-10 overflow-y-auto sm:top-[calc(var(--nav-h)+1.5rem)] sm:left-auto sm:w-[40%] sm:min-w-[360px] sm:max-w-[520px]`. The pattern for the two surfaces that read a plan against the globe: the result view and `/trip/[id]`. The `--nav-h`-based top offset at both breakpoints is not arbitrary — a full-width fixed `Navbar` sits above a right-docked panel too, not just a full-bleed one, unlike the small top-left wordmark this replaced.
- **Hero-led page** (`/trips`): a full-bleed `min-h-dvh` opening section that occludes the globe outright, then an **uncapped** run of content resuming below it in the same `<main>`, bounded only by that element's gutter. Both halves are in normal flow — nothing is fixed, nothing docks. This shape is for a surface that is *about* its own content rather than about the globe: `/trips` draws no route and no markers, so docking a narrow panel against a live map left 60% of the viewport showing a globe with nothing on it, and forced a gallery of photographs through a 360–520px slot. The grid it opens onto is `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3` at a 20px gap, because the cards are the page, not a list beside a map. It carried a `max-w-5xl` cap until the full-bleed pass: even scaled by the fluid root that is 1280px, which left 320px of dead slate either side at 1920 and 640px at 2560 — a boxed gallery of photographs on a surface whose whole argument is the photographs. Extra width goes into a **third column** rather than into two enormous cards; widening a grid by inflating its cells is just a bigger box. It stops at three, because a fourth narrows the caption enough that the destination name and date row wrap again.

A page picks one shape and keeps it. The docked panel is not a container you put a hero inside; the hero-led page is not a full-bleed background you dock over.

`/profile` is a centred column at `max-w-2xl` — narrower than the plan card's `max-w-[84rem]`, because it is a settings form read top to bottom rather than a composition. It shipped with no `<main>` wrapper and therefore no nav clearance at all, so its heading collided with the fixed bar; the shape's own `pt-[calc(var(--nav-h)+1.25rem)]` is what a centred column is *for*, and the fix was adopting the shape rather than patching a margin.

**Rhythm.** Panels pad at `p-5 sm:p-6` (20/24px). Stacked panels within a docked column gap at 24px; rows within a panel at 12–16px; chips and inline metadata at 6px. Section breaks inside a panel are a `border-t border-card-border` with equal padding above and below (20px).

**Breakpoints.** Only two matter: `sm` (640px) flips the docked panel from full-bleed to right-docked and turns the full map control stack on, and `lg` (1024px) reveals the itinerary's stacked photo column — desktop-only by design, because at `sm` the panel is 360px wide and a 112px photo column leaves the stop names nowhere to wrap. `md` exists in the shell's flex direction but no longer changes any composition.

**The docked panel is one component.** `DockedPanel` owns that geometry — `top-[calc(var(--nav-h)+1.25rem)] right-5 bottom-5 left-5` full-bleed below `sm`, `top-[calc(var(--nav-h)+1.5rem)] right-6 bottom-6 w-[40%] min-w-[360px] max-w-[520px]` above it — and both surfaces that dock content use it. Gutters match the pages' own `p-5 sm:p-6` rhythm; they were hand-written per page at 24px against a 20px page padding.

**The map on a phone.** Below `sm` the full-bleed panel covers the globe completely, so two things were true at once: the day drawn on the globe was invisible on a phone, and the control stack had nowhere to sit that wasn't on top of the panel — which is why it was simply hidden, leaving a phone able to drag the camera into a disoriented pose with nothing to recover it. Both halves move together instead. `DockedPanel collapsible` renders a sticky 44px grabber below `sm` that shrinks the panel to a `--mobile-sheet-h` (45dvh) bottom sheet, and `.app-shell:has(.docked-panel-collapsed) .map-controls` brings the stack back in the corner that just opened up. One token drives the sheet's height and the stack's offset from it, so they cannot drift. The phone set is reduced to the zoom pill and the compass: pinch already covers magnification, nothing but a reset covers a lost heading, and neither a 20px slider thumb nor a camera-angle toggle belongs on a touch surface.

**Map chrome.** `MapControls` is fixed bottom-left (`bottom-10 left-6`), hidden below `sm`, and suppressed entirely when the current surface carries `.map-chrome-hidden` — a page-level opt-out for any surface where the globe is scenery rather than a map being read. Three shapes qualify so far: a form over a decorative globe (the landing and plan steps, and `/profile`), a gallery that occludes it outright (`/trips`, whose hero covers the globe on arrival and whose grid draws no route or markers over it afterwards), and the internal `/backend` dashboards. The test is whether there is anything on the globe to navigate *to* — not whether the globe is visible. `/profile` failed that test conspicuously: a zoom pill, a 2D/3D toggle, a tilt slider and a compass sat over a settings form, all of them pointing at a globe with no route, no markers and nothing to find.

### Named Rules

**The Pointer-Events Opt-In Rule.** The content overlay is `pointer-events-none` so the Cesium canvas underneath stays draggable. Every interactive box — every card, panel, button and link inside it — must opt back in with `pointer-events-auto`. A control that does nothing is almost always a missing `pointer-events-auto`.

The rule now holds unconditionally only on the two routes that mount a `DockedPanel` (`/` result and `/trip/[id]`). Everywhere else `.content-overlay:not(:has(.docked-panel))` takes `pointer-events: auto`, because `none` does not merely stop clicks — it removes the overlay from hit-testing, and a scroller that cannot be hit-tested cannot be scrolled. The Cesium canvas is the overlay's *sibling*, so a wheel or a finger landing on bare viewport walked an ancestor chain with nothing scrollable in it and reached Cesium instead, which zooms the camera and streams tiles. Keep writing `pointer-events-auto` on interactive boxes regardless: it inherits, so it is redundant on six of eight routes and load-bearing on the other two, and "redundant here" is not a reason to omit the correct default.

**The Top-Layer-Still-Inherits Rule.** Promoting an element to the browser's top layer with `showModal()` changes *paint order only*. It does not move the element in the DOM tree and it does not detach it from the CSS cascade — so a `<dialog>` rendered inside the content overlay still inherits that overlay's `pointer-events: none`, and every control in it is dead to a real pointer while looking perfectly normal. `.confirm-dialog` therefore sets `pointer-events: auto` like any other interactive box; the rule above has no top-layer exemption. What made this expensive to find is the test method, not the CSS: `HTMLElement.click()` dispatches straight at the element and skips hit-testing entirely, so a scripted click passes while every human click fails. **Verify an overlay's interactivity with a real pointer event, never `.click()`.**

**The Preflight-Beats-The-UA Rule.** Tailwind's preflight sets `margin: 0` on every element, which silently defeats the `margin: auto` the UA stylesheet uses to centre a modal `<dialog>` — the panel renders hard against the top-left corner instead. Any element whose positioning is supplied by UA defaults rather than by the design system has to have those defaults restored explicitly (`inset: 0; margin: auto`) once preflight is in play. Preflight is not a neutral reset; it is a set of opinions that outrank the UA's.

**The Persistent Globe Rule.** `GlobeBackground` is never conditionally rendered, never re-keyed, never moved. A remount destroys the Cesium viewer, loses the camera pose and re-fetches the 3D tiles. Route-level differences are expressed by what floats above it.

**The Cancel-Don't-Escape Rule.** A full-bleed section inside a padded `<main>` stays in normal flow and cancels that padding with negative margins that mirror it exactly — `-mx-5 sm:-mx-6` plus `-mt-[calc(var(--nav-h)+1.25rem)] sm:-mt-[calc(var(--nav-h)+1.5rem)]`, the same numbers the padding used. It does not go `fixed`, and it does not leave the shell's content overlay. Cancel only the sides it actually needs: `ScrollStory` takes all four because the story is the whole page, `/trips`' hero takes top and sides only because the card grid continues below it and wants its bottom padding. And when there is no padding to cancel — `/trips`' empty state, where the hero is the page's only content — `<main>` drops the padding class instead of the wrapper cancelling a value it was handed for nothing.

**The Chrome-Not-Content Rule.** `Navbar` — wordmark, section anchors, and the one route-aware action link ("My memories" / "New trip") — is app chrome, rendered once by the shell as a `z-20` sibling of the content overlay on every route. A page supplies none of it itself; the `headerLinkClass` pattern that used to let each page render its own top-right link is gone, consolidated into `Navbar`'s per-`pathname` table.

## Elevation & Depth

Depth is material, not shadow. Every surface is translucent slate with a backdrop blur and a 1px white hairline; the box-shadow underneath is a single soft ambient pool whose only job is to detach the panel's edge from the terrain behind it. There is no elevation ladder, no resting/raised/hovered shadow scale, and no offset or hard-edged shadow anywhere in the system.

Two blur strengths exist, and the choice is governed by the size of the surface, not its importance.

### Shadow Vocabulary
- **Panel ambient** (`box-shadow: 0 8px 32px 0 rgba(0,0,0,0.37)`): `.glass-itinerary` — every content panel, the loader's caption pill.
- **Control ambient** (`box-shadow: 0 4px 16px 0 rgba(0,0,0,0.32)`): `.glass-control` — the 44px map control pills.
- **Object cast** (`box-shadow: 0 24px 60px rgba(0,0,0,0.55)`): the generation loader only, which must read as a solid object floating over imagery rather than a tinted bubble.
- **Hero pill** (`shadow-lg shadow-black/30`): the landing page's amber CTA, the one button that sits on bare terrain with no panel around it.

### Named Rules

**The Blur-Scales-With-Surface Rule.** Large panels blur at 56px with `saturate(180%)` over slate at 0.62 alpha — that is where large backdrop structures (city blocks, coastlines) stop reading as recognisable shapes; 32px still leaves their edges visible. The 44px control pills blur at 20px, because a 56px blur on a surface that small just samples flat colour.

**The Never-Prefix Rule.** Never hand-write `-webkit-backdrop-filter` beside `backdrop-filter`. Lightning CSS collapses the pair down to the prefixed property alone, which current Chrome no longer supports, and the blur dies silently. Lightning emits the prefix itself when the targets need it.

**The Unlayered-Shadow Rule.** Tailwind v4 emits its utilities — including `ring-*`, which composes onto `box-shadow` — inside `@layer utilities`. Per the CSS Cascade Layers spec, an unlayered rule always beats a layered one regardless of selector specificity, so any plain custom `box-shadow` declaration in `globals.css` silently defeats a `focus-visible:ring-*` utility on the same element, leaving keyboard focus invisible. `.glass-itinerary` (which `/trips`' memory cards now compose) and `DockedPanel`'s mobile collapse button both set `box-shadow` as plain unlayered CSS and both shipped this bug; the fix in both places is `focus-visible:outline-*` — a separate property a plain rule can't shadow — instead of `ring-*`, on any element whose class also owns a plain unlayered `box-shadow`.

**The Inline-Transform Rule.** An inline `style.transform` always outranks a stylesheet rule for the same element, hover or not — specificity never enters into it. `/trips`' resting card tilt shipped as `style={{ transform: "rotate(...)" }}`, which meant the matching `:hover`/`:focus-visible` rule's own `rotate(0deg) scale(1.02)` could never win and the card never straightened. (That tilt is gone with the paper skin, but the rule it taught is not.) The fix generalizes: any per-instance value that a stylesheet state also needs to override belongs in a CSS custom property read by the resting rule (`transform: rotate(var(--tilt, 0deg))`), never written to `style.transform` directly.

**The Optimized-Photo Rule.** A `background-image` on a box that also has `overflow-hidden` and a hover `transform` — exactly what `/trips`' memory cards and hero tiles are — is a common trigger for the browser to promote that element to its own GPU-composited layer, which can rasterize/scale the photo at a visibly softer filter quality than a plain `<img>` gets on the normal paint path, independent of the source file's own resolution (measured: the underlying Wikipedia photos are genuinely ~3840px wide). Real destination photography renders through `next/image` (`fill`), the same pipeline `ImageRow` already used for the landing page's own photos — server-side resize, a real `srcset`, and no GPU-layer softening — never a CSS `background-image`, on any surface showing a photo the user is meant to actually look at.

**The Inheriting-Panel Rule.** `.glass-itinerary` redefines `--foreground`, `--muted` and `--card-border` inside its own subtree, so `text-foreground` / `text-muted` / `border-card-border` on any child resolve to the panel's dark-mode values automatically. Style children with the semantic tokens; do not hard-code white into a glass panel's children. `.dashboard-page` does the same job for content sitting directly on the canvas rather than inside a panel.

## Shapes

Corners are generously soft and step with the size of the box: panels and cards at 16px (`rounded-2xl`), inputs, tiles, textareas and inline rows at 12px (`rounded-xl`), small numeric inputs at 6px, and anything that reads as an action or a token — buttons, chips, day-arrow buttons, avatars, the compass, the tilt pill — fully round.

Borders are always a single hairline of white at 10–15% alpha, never a coloured or heavier rule. The only exceptions are stateful rings: the selected tier card takes `ring-2 ring-inset ring-accent`, hover takes `ring-white/40`, and focus-visible is universally `ring-2 ring-accent` (or `ring-accent/50` inside a panel).

Two silhouettes break the rounded-rectangle language deliberately. The day-tab row uses a `clip-path` polygon — an arrow point on the right edge and a matching notch on the left of every tab after the first — so a 30-day row reads as a sequence rather than as separate buttons; because `clip-path` will not trace a CSS border, those tabs are distinguished by fill alone. And the generation loader is a true circle, the only one in the system.

## Components

### Buttons
- **Shape:** fully round (`rounded-full`) at every size.
- **Primary, in the app:** amber fill, espresso text, `px-5 py-2.5` in a panel. `shadow-sm` in a panel, `shadow-lg shadow-black/30` on bare terrain. Hover is `hover:bg-accent-hover` with `transition-all duration-150`, `active:scale-[0.98]`; disabled is `opacity-50 pointer-events-none`.
- **Primary, on the landing: inverted — white fill at rest, amber on hover, dark text throughout.** `px-8 py-5`, label at `0.875rem / 600 / -0.0357em` tracking and `leading-[0.9]`, `transition-all duration-200`, with the four-point brand mark at `gap-4`. Read off the reference's live CSS rather than its screenshots: its button carries exactly one hover rule and it touches `background-color` only. The obvious reading is "amber fill, white text", and white on `#fb9826` measures **2.19:1** — under even the 3:1 large-text bar. `--accent-foreground` holds both states, measured at **17.66:1** on the white rest fill and **8.09:1** on the amber hover, which is precisely the job The Two Foregrounds Rule gives it. `FeaturedPlans`' card CTA is the same idea one step quieter: slate at rest, amber on hover, and it *does* invert its text, which is why its mark fills `currentColor`.
- **Focus on the landing CTAs is an `outline`, not a `ring`.** Under real keyboard focus the hero button matched `:focus-visible` while every ring slot in its composed `box-shadow` stayed `rgba(0,0,0,0)` — no indicator at all, in any colour. Three explanations were tested and all three are wrong: not the colour token (`ring-accent`, which renders correctly on the `FeaturedPlans` button, is equally invisible on the hero one), not `shadow-lg` occupying the stack, and not `transition-all` catching the measurement mid-animation. So this is **not** a general "ring loses to box-shadow" rule — rings work elsewhere here. Something element-specific defeats it on that button, unexplained. `outline-2 outline-accent-foreground` with no offset renders, and reads against both fills; offset would put the ring on the photograph where a dark line disappears.
- **Ghost:** no fill, no border, muted text, `hover:bg-white/10` (or `hover:bg-tag-neutral-bg`). Used for Back, Cancel, Give feedback.
- **Hero outline:** the landing page's second action — a `border-white/45` outline with no fill and no backdrop blur, so the globe runs clean through it. The border sits at /45 rather than /25 because without frost behind it nothing else holds the shape. It carries a transparent-bordered sibling: the amber hero pill declares `border border-transparent` so the two pills match in height and baseline.

### Cards / Containers
- **Corner Style:** 16px (`rounded-2xl`).
- **Background:** `.glass-itinerary` — slate at 0.62 with a 56px saturated blur. This is the *only* card treatment in the app; there is no solid-surface variant.
- **Shadow Strategy:** panel ambient (see Elevation).
- **Border:** 1px white hairline at 12%.
- **Internal Padding:** 20px, 24px from `sm` up.

### Inputs / Fields (signature)
Fields do not carry their own boxes. The trip form's four fields share one **console** — a single recessed trough, `bg-surface-deep/50` inside the 0.62 panel, with a `border-white/10` hairline at 16px radius — and what separates one field from the next is the divider *between* cells, not a border *around* each. This is the One Slate Rule and the Darken-Never-Lighten Rule doing exactly what they say: four `bg-white/5` boxes lightened the surface, one darker trough recesses into it.

- **Cell:** `px-4 py-3`, `flex-1` (the destination cell takes `md:flex-[1.5]`, since a place name needs more room than a date). The console is `flex-col` with `divide-y` below `md` and `flex-row` with `divide-x` above it — four cells in a row below 768px would each be narrower than the date they have to hold.
- **Label:** the system Label step — 12px semibold uppercase at `tracking-[0.025em]`, `text-muted`, preceded by a 14px lucide icon at `strokeWidth 2.25`.
- **Value:** 16px medium `text-foreground`. 16px specifically, not the 14px body step: it is what stops iOS Safari zooming the viewport on focus, and it is already a step the system uses for the hero subline. `tabular-nums` on the two dates and the budget.
- **Placeholder:** `text-white/65`. Against the console's darker ground `/55` measures 4.23:1 over worst-case bright terrain — under the floor. `/65` puts it at 5.2:1.
- **Focus:** the cell is the focus target, not the input. `focus-within` steps the cell ground to `bg-white/[0.05]`, turns the label amber, and wipes an amber hairline across the bottom edge from the left (`scale-x-0` → `scale-x-100`, 500ms). No ring, no border colour change. That wipe is the only amber that appears while typing.
- **Native controls:** `:root` sets `color-scheme: dark`. Inside `.field-console` the UA's own calendar indicator and number spinners are removed — each cell supplies its own icon, and the date cells open the picker from a click anywhere in the cell via `showPicker()` (wrapped in try/catch; it throws when the call isn't user-activated or the picker is already open, and the fallback is the input's default behaviour). This removes painting, never behaviour: typing and keyboard entry are untouched.
- **Affix:** the budget cell prints `$` inside the field in `text-muted`, not parenthesised in the label — budget is the product's mechanism, so it reads as a figure being entered rather than a number with a unit noted elsewhere.
- **Badge:** `Field` takes an optional `badge` node printed inline after the label text — used once, on the End date cell, for a day-count readout (`bg-tag-highlight-bg`/`text-tag-highlight-fg`, the amber-wash chip, not a new colour) once both dates are set. Keyed on the day count so completing or changing the range replays `.pop-in` instead of React reusing a stale node with no acknowledgement. This is the chip vocabulary's one interactive use — every other chip in the system is inert.
- **Live recompute:** once both a budget and a trip length exist, the budget cell prints a second line underneath — `{amount}/day for {N} days`, routed through `formatMoney`, `tabular-nums`, on `.value-in` keyed to `${budget}-${days}`. It answers what the total actually buys before the tier cards below get to reprice; each keystroke gets its own acknowledged figure rather than a silent swap.
- **Empty dates:** `::placeholder` never applies to `input[type=date]`, so an empty date cell paints the UA's own "mm/dd/yyyy" at the input's colour and weight — two of four cells would read as filled while empty. The date inputs therefore take their tone from their own value: filled is `font-medium text-foreground`, empty drops to `font-normal text-white/65` to match the destination placeholder.
- **Error:** a separate block below the form — `border-red-500/30 bg-red-500/10 text-red-400` at 12px radius. Soft failures (a geocoder miss) are muted 12px text inside the form, not the red block.

### Chips
- **Style:** fully round, `px-2 py-0.5`, 12px medium. Neutral glass by default; the amber wash is reserved for AI-attributed tags.
- **Weather badge:** the same chip at `px-2.5 py-1` with an amber icon, a `tabular-nums` temperature, and the condition word at 70% alpha.

### Navigation
- **Top bar:** see the dedicated **Navigation (App-Wide)** section below for the fixed `Navbar` (wordmark, section anchors, per-route action link, mobile disclosure menu) that replaced the old top-left-only wordmark.
- **Day tabs:** the clip-path arrow sequence. Active is amber fill with espresso text; inactive is `bg-white/10` with muted text, hovering to `bg-white/15`. Flanking round `h-8 w-8` arrow buttons at `bg-white/10`, disabled at 30% opacity. The scroll track is hidden via `.scrollbar-none`; the row stays reachable by arrows, by tab click, by wheel, and the active tab scrolls itself into view.

### The Globe (Cesium rendering)
The globe is the product's one piece of real imagery, so its clarity is a design decision, not a
default. Three settings carry it, all in `GlobeBackground`:

- **Detail is tiered by camera height**, because a single `maximumScreenSpaceError` does *not*
  mean a single real-world detail level. Google's tile tree is structured differently per region:
  measured at an identical pose, Cesium's default of 16 resolved to 8 m geometry in Frankfurt and
  16 m — one whole LOD level shallower — in Mumbai, which is 166k triangles against 21k and
  exactly why one city's buildings read as buildings and the other's as flat roofs. `LOD_TIERS`
  buys detail only where it is legible: **SSE 8 with `dynamicScreenSpaceError` off below 2 km**
  (place views, ≈344 m), **12 between 2–50 km** (destination overview, ≈10.6 km), **16 above**
  (the 2,500 km hero, where nothing is resolvable). Applied on `preRender`, written only on tier
  change.
- **Tint at `colorBlendAmount` 0.1**, `MIX` toward `#9BA6B4`. `MIX` toward a *mid* grey pulls
  highlights down and shadows up at once, so it crushes contrast rather than only saturation. At
  0.2 that read as mud over hazy, low-contrast aerial imagery and structures stopped separating
  from one another. Half the amount keeps the cool register and returns the separation. It must
  stay on the tileset and never become a CSS canvas filter — a filter would also desaturate the
  route overlay, and pure blue cannot survive one (`#0A84FF` returns as `rgb(36,135,234)`).
- **Above-CSS pixel density.** `useBrowserRecommendedResolution` is `false` with `resolutionScale`
  capped at **1.5×**. Cesium's default renders at CSS pixels and ignores `devicePixelRatio`, so on
  any scaled display the canvas is upscaled and building edges go soft no matter how good the mesh
  is. The cap exists because fill cost grows with the square of the ratio — and it was lowered
  from 2× on measurement, not taste: on a 2× / 160Hz display the old cap produced a 3204×2654
  canvas (8.5 megapixels, larger than 4K) and a moving camera sustained **33.7 painted fps**
  against a 60 target, i.e. fill-rate bound. 1.5× cuts that to ~4.8 megapixels. Sharpness is
  unchanged at or below 1.5× density; above it, this trades a little edge definition for the
  frame rate. Note the same knob scales every `backdrop-filter` panel, since the glass samples
  the canvas in device pixels.

Measured floor: at the close tier both cities reach **2.01 m** minimum geometric error at ~57 fps.
SSE 4 was tested and rejected — it buys *no* further detail (2.01 m is Google's tree floor) while
costing 21 fps and 1.1 GB of texture. The residual difference between regions is mesh density
inside tiles of equal declared error, which is Google's data and not a setting.

### The Day on the Globe (signature)
The map has to be readable on its own — you should be able to take the day off it without the
panel. Four pieces, all built in `mapRoute.ts` and all floating at one sampled altitude:

- **A title card per stop** (`.marker-title-card`), not a glass card — deliberately the one HTML
  overlay in the system with no fill, no border and no blur. An earlier version *was* a small glass
  chip (`.glass-marker`), matching every other surface's material; several bolder replacements
  leaning into a sci-fi HUD/targeting-reticle register were mocked and rejected as reading like
  generic "AI dashboard" styling rather than this app's own cinematic voice. The name now sits
  directly on the globe in italic `.font-display`. Legibility took two passes: the first shipped
  with only `.hero-legible`'s bottom-offset-only text-shadow, which real testing against actual
  Google Photorealistic 3D Tiles showed blending into bright, busy rooftops — `.hero-legible` was
  built for one curated, art-directed photo (DESIGN.md already accepted a known contrast risk
  there as a deliberate tradeoff for *that* surface only), not arbitrary, uncontrolled imagery a
  stop can land on anywhere. The card now also carries a zero-offset omnidirectional shadow pair
  (hugging every edge of a thin italic stroke, not only its underside) and a soft, edgeless
  radial-gradient vignette behind the text (`::before`, `z-index: -1`, no fill boundary, no
  border — not a scrim box, a guarantee for the worst case a photo-only shadow can't cover). It is
  still an HTML overlay rather than a Cesium billboard (a billboard is a texture and cannot carry
  the app's other cinematic CSS effects), and `StopMarkerLayer` still reprojects each card every
  `postRender` frame with `SceneTransforms.worldToWindowCoordinates` — the CSS-pixel variant,
  because `resolutionScale` is customised here and the drawing-buffer variant is a different
  space. It scales by distance (`clamp(900000 / (d + 260000), 0.55, 1)`) and hides on a
  dot-product horizon check against the geodetic surface normal, so a stop on the far side of the
  globe does not smear across the limb. A thin `--accent` rule draws in under the name on
  hover/selection (`transform: scaleX(0) → scaleX(1)`, `transform-origin: left`) — the entire
  activation, no lift, no glow ring. **Depth focus:** the same per-frame `scale` is also written
  to `--marker-depth` on the anchor (one line alongside the existing `transform`/`visibility`
  write, not new math), which the title card maps to opacity and a touch of blur — `var(--marker-
  depth, 1)`, the fallback read *at the point of use* rather than redeclared on the card itself,
  since a card-level default would win over the anchor's inherited value and silently disable the
  effect. A distant name recedes like a shallow depth of field instead of only shrinking; the
  focused/selected one reads sharp against it, like a rack focus.
- **A lit stem out of a soft glow pool** at each stop, replacing the flat blue dot that had
  nowhere to put a name. The stem is 150m of world space, so it grows and shrinks with everything
  else; the pool is two concentric discs at falling alpha, because a Cesium ellipse takes a flat
  fill and a soft edge has to be stacked.
- **Raised dashed arcs** between consecutive stops: a great circle at 96 samples, lifted on a sine
  so it leaves and meets the ground flat. Two polylines each — a wide low-alpha glow base and the
  dashes on top. The base is not decoration; dashes alone disappear against a mid-grey rooftop.
- **A travelling shimmer** on the dashes, each arc lagging the last by a fraction of a cycle so
  the pulse reads as moving along the day rather than every arc breathing at once.

Two things the layer must keep doing. It is a **sibling** of the content overlay in `AppShell`,
never a child — that overlay scrolls, and a card inside it slides off its own stem. And the cards'
`visibility` belongs to the render loop alone: React re-applies inline styles on every re-render,
so a React-managed `visibility` blanks every card for a frame each time the provider updates.

**Names declutter, stops do not.** Cards are suppressed when they would overlap (two axes, since a
card is wide and short, scaled by the card's own scale). Losing that contest costs a stop its name,
not its presence — the stem and pool are always drawn, so a dense day still shows every stop and
reveals more names as the camera comes in. This is not optional polish: one place legitimately has
one coordinate, and the preview trip's day 1 has eight stops on six coordinates with three of them
identical, because three things happen at the same hotel.

### Map Controls
Apple-Maps-grade chrome, and the only place `.glass-control` is used: a vertical stack of 44px targets — a two-button zoom pill, a 2D/3D toggle labelled with the mode you'll *get*, a rotated native `range` tilt slider in a round pill, and a compass whose needle is written directly to the DOM on `postRender` so steady-state re-renders stay at zero. The tilt slider is a native input rotated -90°, not a library and not `writing-mode: vertical-lr`; its track and thumb need explicit rules because `appearance: none` strips the platform rendering.

### Tier Cards (signature)
A three-up grid of 200px-tall image buttons: a full-bleed SVG illustration that scales to 1.05 on hover, a `from-black/85 via-black/25 to-transparent` bottom-up gradient, a serif headline and a two-line clamped description at the base. Price rides in a top-right slate badge at 0.85 alpha. Selection is an inset amber ring plus a round amber check badge at top-left; hover is `ring-white/40`. Over-budget (above 3× the entered budget) is expressed as weight and text alpha only — the badge keeps its slate backing, because this state is now reachable mid-keystroke and the price is data. With no dates entered the badge shows a per-day rate rather than a total. Each card also carries a small cursor-driven tilt (`perspective(800px) rotateX/rotateY`, capped at 8 degrees) on its inner visual layer, gated behind a one-time `(pointer: fine)` plus reduced-motion check on mount - a hint that the card is a physical plane, not a showpiece; the illustration and copy stay legible mid-tilt.

### Memories Hero (signature)
`/trips` opens on a full-bleed `min-h-dvh` section that occludes the globe for one viewport, then hands the page back to the card grid floating over it. It has exactly two variants and no third: there is nothing true to collage until a trip is saved, so "no photos yet" and "no trips yet" are one state, not two.

- **Collage variant** (`trips.length > 0`): up to five `HeroTile`s in a bento grid, separated by a 2px `gap-0.5` over a `--surface-deep-rgb` ground, so the seams between photographs are the system's own material rather than a border colour. **The template is a function of the tile count, not a constant** — `HERO_LAYOUTS` in `trips/page.tsx` keys the grid classes, the per-tile row-spans, and the `sizes` string off `tiles.length`, so every cell holds a photo at one through five. This is the fix for a real defect, not a flourish: the grid was previously one fixed `grid-cols-2 grid-rows-2` / `sm:grid-cols-[1.3fr_1fr_1fr]` shape with the first tile always `row-span-2`, which filled cleanly *only* at exactly five — at one saved trip, four of its cells had no tile and painted the container's bare slate, so the hero read as a single photo beside a large empty block. Two rules govern the table. The asymmetric 1.3fr hero column appears only from three tiles up, where there is something for it to be asymmetric against; at two, even columns. And at four, the *second* tile takes a row-span of its own — without it the fourth tile wraps and reopens the same corner hole. On the narrow 2×2 at five tiles the section's own `overflow-hidden` still quietly clips the two that don't fit; that clipping is deliberate and unrelated to the empty-cell defect.
- **`sizes` belongs to the layout, not the tile.** `HeroTile` takes it as a prop from the active `HERO_LAYOUTS` entry. It was hardcoded at `33vw`, so a one-trip hero spanning the full viewport still requested a 33vw candidate and rendered visibly soft — the exact failure The Optimized-Photo Rule exists to prevent, reintroduced through the layout rather than through the image pipeline.
- **Tiles follow the Constant-Ground Rule**, the same way `MemoryCard` and `ItineraryCard`'s `BlurredPhotoLayer` do: each tile is a permanent solid slate base with `usePlacePhoto(trip.destination, "full")` fading in over it on `.value-in`. A photo miss or a rate-limited lookup dims a tile; it never opens a hole in the hero back to the live globe. The photo itself is a `next/image` `fill`, not a CSS `background-image` — see The Optimized-Photo Rule — carrying a small `contrast-105 saturate-110` grade: these are real, uncurated photos of whatever the destination happens to be, no shared exposure or art direction, and the globe has the exact same problem with Google's photorealistic tiles and solves it the same way (a deliberate, small `colorBlendAmount` "to return the separation" a flat tile lost, kept just as restrained here for the same reason).
- **Scrim:** one bottom-up `linear-gradient` in the one slate — 0.95 where the heading sits, 0.5 at 38%, transparent by 70%. It is the shape `ItineraryCard`'s photo header already uses, not a new one, and it is the Darken-Never-Lighten Rule doing its job over arbitrary destination photography.
- **Type and content:** the headline is bottom-aligned (`items-end`) at the Hero Display step, with one `tabular-nums` subline at `text-foreground/75` counting the trips and naming the first and last destination. Nothing sits above the headline (The No-Kicker Rule); the count is the line *under* it.
- **Empty variant** (`trips.length === 0`): no photograph anywhere, and deliberately no stock or external imagery to stand in for one. A low-alpha amber radial (0.10) over a slate wash carries the beat instead — the system's own "one warm accent on a cool neutral field" rather than a new palette for one empty state — with the headline one step down from the collage's, centred, and the "Plan your first trip" CTA at hero scale.
- **Loading and error render no hero at all.** Both return early as plain centred states. The variant depends on the trip count, so any hero drawn before the fetch resolves is a guess that reflows into a different composition a moment later.

### Memory Cards (signature)
`/trips` restyles what was a bare text list into photo cards keyed to a real destination: `usePlacePhoto(trip.destination, "full")` — the same hook `ItineraryCard`'s header photo uses — resolves onto its own `next/image` `fill` layer (The Optimized-Photo Rule; carries the same `contrast-105 saturate-110` grade the hero tiles do) over a permanent `--tile` base, the Constant-Ground Rule again: a slow photo lookup must not blank the card, and a resolved photo must not repaint the tile itself. The photo tile is a **16:10 ratio**, not a fixed height, and the grid going uncapped is what forced that. It was `200px`, borrowed from the Tier Cards to avoid inventing a second photo aspect for the same kind of card, which held while the grid was boxed and a card was always around 490px wide. Uncapped and three-up a card passes 600px, and 600x200 is a 3:1 letterbox — a landscape photo whose whole point is one tall landmark gets centre-cropped straight through the part that made it recognizable, which is the failure the fixed height was chosen to avoid in the first place. 16:10 holds the framing at every column count: 220px tall on a 414px phone, near the 200px it replaces, growing with the card instead of stretching a slot. The Tier Cards keep their fixed height because they are still inside a capped panel. `sizes` tracks the column count (`100vw` / `50vw` / `33vw`) per The Optimized-Photo Rule — leaving it at a flat `50vw` after gaining a column is how the hero tiles once shipped visibly soft. The card is `.glass-itinerary` at the documented 16px radius; `.memory-card` adds only what the material doesn't, a `translateY(-3px)` lift and a deeper shadow on hover. The shadow deepening stays in a rule separate from the transform so the two states never contend over the same property list (see The Unlayered-Shadow Rule for the other reason that separation matters here). The dashed postage stamp and the per-card tilt both went with the paper — the stamp was the one purely representational element in the app, a drawn object standing for a physical thing this surface no longer pretends to be. The caption stacks the date range over the budget rather than one baseline row — a constraint inherited from when this grid lived in the docked panel at ~360–520px, and kept after the move because the two-up grid drops to `grid-cols-1` below `sm`, where a phone-width card still can't hold both on one line once the budget figure is kept.

### Confirm Dialog
The app's one modal, and deliberately its only one: it exists for actions that cannot be undone (today, deleting a saved trip) and for nothing else. A dialog for a task that needs neither interruption nor protected focus is a scaffold, not a design — the bar for adding a second one is that the action is irreversible.

It is built on the native `<dialog>` element driven by `showModal()`, not a hand-rolled overlay, which is what buys the four things a modal has to get right and is easy to get subtly wrong: a focus trap, Esc-to-close, the rest of the page going `inert`, and top-layer rendering. The panel is `.glass-itinerary` at the standard 16px radius and `p-5 sm:p-6` rhythm — no new material — over a real `::backdrop` (black at 0.55 with a 4px blur) rather than a sibling overlay div, so it cannot be covered and needs no z-index in a shell that already stacks four layers. `Cancel` is the standard ghost button; the confirm is the one solid `bg-red-600` destructive button the palette already documents, and this is the only place in the app that spends red on a button the user presses on purpose.

Two mechanics that are not obvious and both shipped as bugs first:

- **`open` cannot be an attribute.** `<dialog open>` renders *non*-modally — no top layer, no focus trap, no backdrop. React drives the prop, but an effect has to translate it into imperative `showModal()`/`close()` calls. Esc also fires `cancel` rather than clicking anything, so that event must be routed back through `onCancel` or the element closes while the parent still thinks it is open, leaving a dialog that can never reopen.
- **Top layer changes paint order, not the cascade.** See The Top-Layer-Still-Inherits Rule below.

**Deleting a memory.** Each card carries a trash control at the photo's top-left, at a 22px inset, the card's own padding plus the photo tile's, rather than a new spacing value. It is dark glass on the one slate (`--surface-deep-rgb` at 0.72) turning red only on hover — the Darken-Never-Lighten Rule, since it sits on an arbitrary destination photo — and it opens the Confirm Dialog rather than deleting on the spot. Two constraints shape it:

- **It is a sibling of the card, never a child.** The whole card is one `<a>`, and HTML forbids interactive content inside an anchor; a nested `<button>` is invalid markup that browsers resolve unpredictably. A `.memory-card-slot` wrapper supplies the positioning context and owns the reveal, so the button sits *beside* the link in the DOM while appearing on top of it.
- **Hidden on hover, but never hover-only.** It rests at `opacity: 0` and reveals on `:hover` *or* `:focus-within`, so a wall of cards is not a wall of trash icons and tabbing to the control still surfaces it. Under `@media (hover: none)` it is simply always visible — a hover-only control is unreachable on a touch screen, where there is no hover state to enter and the card itself is a link, so long-press offers nothing either.

### The Wait (signature)

Two and a half minutes with nothing to show yet. The screen answers it by stating what is already
known instead of asking for patience: the destination photographed full-bleed, its name at
`clamp(2.5rem, 9vw, 8rem)`, and — the actual content — a rotating feed of true facts about the
place set at `clamp(1.375rem, 3.2vw, 2.5rem)`. The machinery sits in a darkened band at the foot:
the four steps, one forecast line, the elapsed expectation, and a Cancel that appears only after
ten seconds.

**Only large type sits on the photograph.** This is measured, not stylistic — see The
Photograph-Is-Not-A-Surface Rule. It is why the facts are set at display scale rather than as
prose, and why every small run was pushed into the band.

**The globe is covered, not switched off.** `useGlobeOnScreen(generating || …)` still boots Cesium
at generation start and this screen is opaque on top of it. The 2.3MB import and first tiles are
free inside a wait this long, and the queued destination flight replays on `setViewer` so the
result opens already framed. Un-booting would move that cost to the one moment it would be felt.

**Four steps, not five.** `geocode` and `context` total about three seconds of the ~150 and mean
nothing to a person waiting, so they share a column. The four that remain are the same four the
landing's "How it actually works" promises — the page says what will happen and this shows it
happening. Progress is still computed from all five stages; only the display groups.

**Progress never enters React state.** It ticks ten times a second and is written straight to a
`--gen-progress` custom property, because re-rendering the tree at that rate would reconcile the
whole screen for a value one bar reads. The bar's CSS transition is what smooths those ten writes
into motion, so it is the one element in the app exempted from the blanket reduced-motion
`animation-duration: 0.01ms` — removing its transition there would make the bar jerkier, not
calmer, which is the opposite of what the setting asks for.

**The forecast is demoted on purpose.** `DayHeader` already prints each day's temperature, rain
chance and typical-weather flag beside every day of the finished plan, so a seven-column weather
grid here spent the screen's best space previewing something arriving thirty seconds later. One
line in the band keeps the single concrete thing known before the plan exists without pretending
it is the headline. When the dates are past Open-Meteo's 16-day horizon the line says "same dates
last year" — a figure presented as a forecast when it is last year's is a lie by omission, however
small the type.

**Eliminated: the disc, the flight path and the fanned card stack.** <details><summary>A 200px
rotating slate disc reading "Generating", a stage-weighted flight path beneath it, and facts fanned
as tilted cards — all over the live globe.</summary>

The disc's rotating "gradient" was three inset box-shadows sweeping paper white through amber into
near-black slate; the word was split into ten letter spans on staggered delays and *had* to be
exactly ten letters, because globals.css hardcoded `.loader-letter:nth-child(1..10)`. Beneath it a
`min(92vw, 380px)` rail ran from an amber origin dot to a hollow destination pin, segment widths
taken from `STAGE_SECONDS` because the stages are nowhere near equal — `generate` alone is ~95 of
the ~150 seconds, and five equal segments held the marker motionless for a minute and a half,
indistinguishable from a hang.

Three things ended it. The globe is the busiest possible ground for small text — every element
needed its own 56px-blurred glass panel just to stay legible, and the fact strip's own comment
recorded measuring **1.02:1** against sampled globe pixels without one. The orb said nothing except
"working", where naming the running stage in words is both better status feedback and needs no
reduced-motion exemption. And the screen showed almost none of what the app had already fetched: by
the time Generate is reachable, the real forecast for every one of the traveller's dates, the public
holidays, and up to twelve candidate places are all sitting in memory.

Two ideas survived into the replacement and are worth keeping distinct from the skin that carried
them. **A segment cannot finish early**: inside whichever stage is running the fill advances on
`1 - exp(-t/tau)`, approaching its segment's end without reaching it, so only a real `done` event
completes it — structural, not a "stop at 95%" clamp. And **the wait and the reveal are one
gesture**: the run settles, the screen holds briefly, and `ItineraryCard` picks up by assembling.
Peak-end weights the last half second of a two-minute wait far above the middle minute.
</details>

### Destination Facts (signature)

True facts about *this* trip, rotating every 7s directly beneath the destination name at display
scale. They are the screen's content, not its footnote — an earlier arrangement put them in small
prose at the very bottom under a seven-column weather grid, where a waiting traveller had no reason
to look, and the correction was to swap the two.

- **The facts are real and cost nothing.** Derived from data already fetched for other reasons —
  the Step 2a bundle (weather, holidays, POIs, timezone, season, sunrise/sunset), the
  destination-context cache, and the Wikipedia extract that arrives with the destination photo.
  **No model call.** `runClaude` spends nearly all its wall clock on time-to-first-token, so trivia
  fetched that way would land *after* the plan it was meant to fill the time for.
  `buildDestinationFacts` is pure, type-only-imports, and unit-tested; it never fabricates, so a
  thin bundle yields fewer facts rather than filler.
- **The pool is sized to the wait, not to a screenful.** ~150 seconds at 7s is about 21 slots, so
  the cap is 30 and each family may contribute 5 (was 12 and 2, tuned for a much smaller feed).
  Every festival and every shopping area surfaces rather than just the first of each, candidate
  places are named in trios past the first three, and a `trend` family reads the context cache.
  Tests assert the widened cap did not let weather flood the feed: at most 5, and never half.
- **The cap is a ceiling; the data is the constraint.** Measured against a live Kyoto run, the real
  pool is **13** — about 91 seconds of a 150-second wait, so it still wraps once. Raising the cap
  further would change nothing. What actually moved the number was fixing a silent gap: the
  Wikipedia reader took only the *first* sentence and returned nothing at all if it was too long,
  so Kyoto — whose opening sentence runs 146 characters, over `MAX_LEN` once attribution is
  attached — contributed **zero** Wikipedia facts while thinner extracts contributed theirs.
  Reading every sentence that fits took the pool from 10 to 13. The remaining shortfall is the POI
  family, which needs `OPENTRIPMAP_API_KEY`; without it `candidatePois` comes back
  `{ available: false }` and up to five facts never exist. That is the documented degrade, not a
  bug — but it means a keyless environment sees a visibly shorter feed.
- **Safety notes are excluded by decision, not by omission.** A line about pickpocketing or a
  neighbourhood to avoid is true and useful in an itinerary; delivered as ambient trivia to someone
  who has already committed and paid, it is anxiety with no action attached. The test asserts they
  stay out so nobody restores them as a "missing family".
- **Two copy rules the tests enforce.** Weather wording may not say "forecast", "expect" or "will
  be" unless the data really is a forecast — beyond ~16 days the app silently serves last year's
  same dates, and presenting that as a prediction is a lie the traveller cannot detect. And
  sunrise/sunset are formatted by string slicing, never `new Date()`: they are destination-local
  wall-clock with no zone suffix, so parsing them would shift a Kyoto sunset by hours for someone
  planning from London.
- **The facts sit outside the `role="status"` region.** Inside it they would be announced on every
  change. Only one line is announced — which stage is running — and the feed stays reachable on
  demand without interrupting.

**Eliminated: the fanned stack, and the orbiting wheels before it.** <details><summary>Facts as
tilted glass cards, first riding two off-screen circles, then fanned in a still stack.</summary>

The **orbit** carried these sentences on the rim of two large circles whose centres sat off-screen,
counter-rotating, with time mapped non-linearly onto angle to produce a slow "dwell" at the
readable apex. Three things killed it. *Text a person must read cannot move* — the dwell was tuned
from ~75px/s down to ~28px/s, which was optimising the wrong axis, and a card stayed rotated up to
9° through most of its legible window, which disables subpixel antialiasing on 14px prose.
*WCAG 2.2.2 (Pause, Stop, Hide), Level A*: motion over five seconds alongside other content needs a
stop mechanism, and `aria-hidden` does not exempt visual motion — it only removed the alternative
route to the content. And it ran three stacked loops per card on four cards, the largest violation
of the One Ambient Loop Rule in the codebase. Measured at replacement: **23 infinite CSS animations
→ 11**.

The **fanned stack** that replaced it was still: one card square-on, neighbours tilted and dimmed
behind it, advancing every 7s, steerable by arrow or click. It was correct about motion and wrong
about weight — five cards of glass at 16px radius made a component out of what should have been a
sentence, it needed a five-fact pool before the wings stopped duplicating the front card, and every
card was a 56px `backdrop-filter` surface. Setting one line at display scale says the same thing,
carries no glass, and degrades to a single fact without looking broken.
</details>
## The Blue Hour Expedition (Landing & Pre-Generation Flow)

A scoped alternate identity for the two steps before an itinerary exists — the landing scroll and the merged trip-form/tier-picker step (`page.tsx`'s `step !== "result"`, wrapped in `.blue-hour-scene`). It exists because the base system's amber-on-slate is tuned for *reading a plan*: dense data, budget figures, day tabs. Before there is a plan to read, the job is to sell the idea of one, and a richer, more cinematic register earns that without touching a single component the result view depends on.

**Retint the ground, not the accent.** `.blue-hour-scene` (`globals.css`) overrides `--surface-deep-rgb` (deep cobalt-teal `8 33 48`, replacing slate-900's `15 23 42`), plus two net-new hues consumed only by scene components: `--scene-teal-rgb` (`45 125 130`) and `--scene-cobalt-rgb` (`30 60 110`).

It also used to swap `--accent`/`--accent-hover`/`--accent-foreground` to a brass/copper `#c9905a` family and retint `--tag-highlight-*` to match. That is gone, on the strength of the argument **The Profile Panel Tint** rule above already makes: switching the accent mid-app, on surfaces reachable from the amber result view, reads as a different product rather than a different surface — the sections needed separating from the globe, which is a background problem, and the accent was never the thing at fault. That reasoning was written for `/profile` while the landing was still doing the thing it warns against. Amber also simply survives its backdrop better here: the poster's CTA lands on live desert terrain, where brass on tan was the lowest-contrast primary button in the app. The scene keeps its distinct register through ground, scale and motion — which is where a mood belongs.

Every component that already reads `--surface-deep-rgb` — `TierPicker`, `Field`, `.glass-itinerary`, `.hero-legible`'s shadow — retints for free; that free retint is the whole point of overriding a token rather than restyling a component. `--canvas` is deliberately **not** overridden here: `GlobeBackground` reads it once via `getComputedStyle(document.documentElement)` at Viewer construction, so a scoped override would be silently inert.

**Typography is the system's, in the scene's voice.** This used to read "a separate face family, not a re-skin" — Playfair Display for display, Manrope for body, loaded so the landing could have its own faces. Both are gone as *scene* faces: Playfair retired outright, Manrope promoted to the app's body face (see **Typography**, above). `.font-scene-display` is now Source Serif 4 in italic — the app's own serif, set the scene's way. It stays its own class rather than folding into `.font-display` because the italic belongs to the scene and an upright is still what a panel heading wants. `.font-scene-body` is deleted; Manrope is the default now, so the class was a no-op that would have misled the next reader into thinking the scene still had a body face of its own. `.font-scene-hero` (Archivo at weight 900 / `font-stretch: 125%` / `letter-spacing: -0.035em`, sharing `--font-hero` with the base system's `.font-hero`) is the closing poster's voice — hyperbold and wide. It shipped at `+0.035em`, deliberately airy as the counterpart to `.font-hero`'s tightly-packed `-0.035em`, and was reversed to match it: at 900 weight and 125% width the face already carries every bit of width the poster needs, and letter-space on top of the width axis read as a stock big-sans hero rather than as one authored word. Width comes from the axis; tracking's job is to pack what the axis widened. Both display faces now sit at `-0.035em`, just inside the `-0.04em` floor. `.font-scene-hero` is deliberately not an indirection through `.font-hero` — the One Poster Rule already says `.font-hero` means one specific typeface, and making that context-dependent would trap the next person to touch this file.

### The Sequence (`src/components/blue-hour/`)

Four beats, composed by `ScrollStory` inside a wrapper that cancels `<main>`'s own padding (`-mx-5 -mb-5 -mt-[calc(var(--nav-h)+1.25rem)]`, matching breakpoints) so every section reaches all four viewport edges, including the top, behind the transparent fixed nav.

- **`Hero`** — the opener: one word, a support line, and "Plan a trip". **Two photographs with the headline between them.** A back layer hangs from the top edge, a front layer stands on the bottom, they overlap in the middle, and "Somewhere." sits at `z-2` — behind the front layer, in front of the back one. So the steppe's horizon cuts across the bottom of the word rather than stopping beneath it. The subline and CTA sit at `z-4`, deliberately above the front layer, so the support copy stays fully legible while the headline is the only thing occluded. This is the reference's own construction, read off its live DOM rather than inferred.
  - **`aspect-ratio` is the mechanism, not a viewport height.** The section is `1440/922` landscape, `375/812` portrait, so its height follows its *width*. That is what lets both layers sit at natural size — `h-auto`, no `object-cover` crop, which is why the scene reads zoomed-out and uncropped — and still always overlap, by a fixed `0.201·W`. Pinned to the viewport instead they come apart: at 768x1024 the two landscape layers total 646px against a 1024px section, opening a 378px band of bare canvas. Measured across ten viewports the ratios hold to three decimal places (back `0.377·W`, front `0.469·W`, section `0.640·W`) with overlap 155–693px and never a gap.
  - **The known cost of that model:** the hero is no longer exactly one screen. It is shorter than the viewport on a portrait tablet (768x1024 gives 492px, so `ImageRow` peeks) and taller on wide displays (1229px at 1920x1080, 2203px at 3440x1440). On very short-and-wide windows — 2560x900 — the CTA falls below the fold. The reference behaves the same way; it is the price of layers that always interlock.
  - **The reference's `max-height` cap could not come with it.** A `max-height` against an `aspect-ratio` does not clamp height alone — it shrinks the box on *both* axes to preserve the ratio, so `max-h-[50rem]` on the portrait branch produced a 369px-wide section inside a 390px viewport and left a strip of the page showing down the right edge. Unclamped, 390px gives 845px, which is the viewport anyway.
  - **Three Tailwind ordering traps, all in the layer sizing.** A base `w-full` beats a media-query `w-[100.65%]`, because the two `w-*` utilities sort as one group with the unprefixed one last. Dropping `w-full` is worse: an absolutely positioned *replaced* element with `width: auto` takes its **intrinsic** width, not the left/right gap, so every viewport rendered the layers at a flat 750px. And Preflight's `img { max-width: 100% }` clamps the widened layer straight back, which needs `max-w-none` — Preflight is a set of opinions that outrank what you wrote, the same lesson as The Preflight-Beats-The-UA Rule. The arrangement that holds is both width branches inside mutually exclusive media queries, plus `max-w-none`.
  - **Both landscape files carry transparent margins** — 5px left, 14px right, 11px bottom — which at full bleed showed as slivers of bare canvas down each edge and a strip along the screen's foot (measured at 1440x900 as five rows dropping to mean RGB 23 under grass at 58). The layers are widened by 0.65% and pulled left 0.17%, and the front layer nudged down 0.4vw. The portrait pair measures zero on every edge and is left alone.
  - **Alpha is load-bearing.** All four crops are WebP with a real alpha channel: the back layer's sky is intact but its lower edge is torn away, the front layer's sky is absent entirely. They arrived first as JPEG, where a missing sky is stored as opaque white and reads as a white slab over a dark page. A replacement shipped as JPEG breaks the hero in exactly that way.
  - **No veil, by decision.** A `--surface-deep` layer at 0.55 was built between the back photograph and the headline and then removed: the token is a 76%-saturated teal, and over a near-neutral mountain range (12.3% saturation) it read as a blue cast. See the landing-headline rule for the measured figures and what it costs. The mountains are therefore undimmed and the headline rests on `.hero-legible` alone.
  - **The support line is on the reference's paragraph step, not the app's body step.** 1.75rem / 600 / line-height 1.3 / -0.0714em tracking on desktop, 1.1875rem / 1.0 / -0.028em on a phone — up from 1.125rem / 400 / 1.8 / *zero* tracking. Two things to know. `scene-prose` had to be **removed from the element**, not overridden: it is an unlayered `line-height: 1.8` and an unlayered rule beats a layered one regardless of specificity, so Tailwind's `leading-*` utility would have silently lost (The Unlayered-Shadow Rule, met on line-height rather than box-shadow). And the mobile size is 19px rather than the reference's 18px, deliberately: at 600 weight that crosses WCAG's 18.66px large-text threshold, dropping this line's bar from 4.5:1 to 3:1, which is what lets it pass on a phone. Discovering that this element computed `letter-spacing: normal` also means the body tracking documented in the ramp had never actually reached it.
  - **The light still moves and the photographs still do not.** The single ambient loop is `.hero-light`, an oversized soft warm wash on `--accent` crossing the frame over 24s at `z-1`. The three white `.hero-fog-layer` banks are gone — they were drawn to hide a blown-out bokeh blob in the retired `hero-dawn`, and over this composition they would have washed haze across the one edge it depends on.
  - **The scroll cue is gone**, and with it `.hero-cue` / `.hero-cue-bob` and both keyframes. A bouncing chevron over a full-bleed landscape read as distracting and as an affordance — it looked pressable and was decorative. `.hero-dusk` is now the only scroll-driven animation on the surface, which also simplified the note on `--story`: three CSS comments used the cue as their worked example and now point at the wash instead.
- **`ImageRow`** — a compact row of four photo cards on a `.scene-band` (see below), each with a bold label and a fact-grounded stat above it (Vita Travels' own "Label / Stat" pattern), flying in from the left on scroll. The description sentence lives *inside* the card, hidden until hover.
- **`HowItWorks`** — the mechanism explainer, no photos, a `SplitText`-staggered heading reveal on a matching `.scene-band`.
- **`FeaturedPlans`** — four worked examples, and the one beat that states figures rather than claims. Text left, photograph right, zero gap, adjacent cells sharing one hairline; `md:auto-rows-fr` plus `h-full` is what keeps every image frame identical so only the text reflows. The four cards **mirror `ImageRow`'s four beats** — the blue hour, real prices, live weather, three ways to travel — so the section reads as evidence for the claims made just above it rather than as four arbitrary trips. That mapping is the constraint to preserve if they are ever rewritten.
  - **Real destinations, real photography.** The photos were reused scene imagery for a while — thematic, not places, and the desert on the Marrakesh card was not Marrakesh, which made it the weakest thing on an otherwise honest card. Every card now shows the place it names. `alt` stays empty deliberately: the title and the "Where" row beside the image already name it, so alt text would make a screen reader say it three times. Known limitation — the sources are 600–800px against 2400px for the app's other scene photos, which measures fine to 1.04x at 1440@2x and 0.97x at 2560@1x but reaches **1.95x on a 430@3x phone**. Nothing to fix in markup: `sizes` and `srcset` are correct and the optimizer rightly refuses to upscale. ~1200px sources would clear every case.
  - **Every budget is grounded in `estimateTierTotal`, not chosen for looks.** Each figure is within $50 of a real tier estimate for its own day count, and `closestTier` resolves each to the tier its copy is about — Jaipur and Wadi Rum to `budget` (one *is* the budget story; the other quotes a "from" price, which has to be the cheapest of the three ways it advertises), Tuscany and Sinaia to `midrange`.
  - **The cards store a season, not a date, and this is load-bearing.** `startMonthDay: "02-06"` plus `days`, resolved to the next occurrence at or after today, so "Sinaia in February" means the next February forever. The reason is the prefill below: the date inputs carry `min={todayISO()}`, so a card whose date has passed fills a value the form rejects — and the nearest hardcoded date was 22 days out when the prefill was built. The displayed When / Length / Party rows are *derived* from the structured fields, so what the card shows and what it fills cannot disagree. The roll is pure arithmetic with no value imports, which is what keeps `planExamples.test.mjs` able to load it; its central test asserts that no card resolves behind "today" across six different todays, including each card's own season day.
  - **"Plan a trip like this" fills the wizard.** `onPlan` takes an optional `PlanPrefill`; `Hero` calls the same prop with nothing. Six fields are written — destination, both dates, budget, and the party counts — and two more are *derived* rather than carried, because `closestTier` already owns the budget-to-tier mapping and `GroupType` falls out of the counts. Everything else keeps the traveller's saved profile: a marketing example has no business overwriting a stated preference. It lands on `planStep: "basics"` even when fully filled, so the traveller sees what a card decided for them before it prices anything. Not geocoded — that fires on the destination field's blur and a programmatic set fires none, but these destinations are curated, the globe does not boot on this step, and a missed geocode is non-blocking by design.
  - **A bare `onClick={onPlan}` is a bug here, and it typechecks.** React hands a click handler a `MouseEvent` as its first argument, which is now the `prefill` position — so the bare form posts a MouseEvent into the form state. TypeScript says nothing, because `Hero` declares the prop as `() => void` and a wider handler assigns cleanly to a narrower one. Every landing CTA wraps it: `onClick={() => onPlan()}`.
- **`HeroPoster` is retired, and with it the withheld CTA.** It was the closing beat: one word on `.scene-void`, a lit emptiness rather than a surface, and the sequence's organising idea was that "Plan a trip" arrived only there. That held while the page was four beats and the poster was the densest thing in it. The page is six beats now — a method strip, four priced plans and a world map arrived in front of it — and against those the poster was the *least* substantial screen on the page, arriving last and asking for the click. A reveal that lands softer than everything before it is not a reveal, so the ask moved into `Hero`, which is also where the reference puts it. Everything after the hero is evidence, and a visitor convinced by the evidence should not have to scroll back up to act on it.

### Named Rules

**The One Clock Rule (`--scene-hover`).** Every property in the image card's hover treatment — the frost sheet fading out, the edge frost fading in, the photo's zoom, the shadow, the in-card caption — references one shared `700ms cubic-bezier(0.16, 1, 0.3, 1)` token with zero delays. An earlier pass staggered these to answer a "too snappy" complaint, which was the wrong fix: offsetting the starts made the zoom visibly finish before the edges frosted, so it read as two animations racing rather than one surface responding. Duration makes motion feel unhurried; delay makes it feel sequential. When a hover state has more than one moving part, they get one clock, not a queue.

**The Fresh-Tween-State Rule.** Every scroll-triggered reveal in this sequence uses `gsap.context(() => { gsap.fromTo(...) }, ref)` with `ctx.revert()` on cleanup — never a bare `gsap.from()`. React's Strict Mode double-invokes effects in dev; a `from()` tween re-created on the second run reads the element's *current* (already-hidden) state as its own destination, so the element animates from invisible to invisible and never appears. This cost real debugging time before the root cause was clear, because the symptom — "the animation just doesn't play" — is identical to a `prefers-reduced-motion` gate correctly doing its job, which was the actual, unrelated cause of most of the original bug reports during this build.

**The Transform-Ownership Rule.** GSAP's CSSPlugin folds every transform sub-property (`x`, `y`, `xPercent`, `rotationY`, ...) it touches on an element into one matrix per tick, so a looping ambient tween and a pointer-driven write on the *same* element silently overwrite each other. `Hero`'s ambient drift and its cursor parallax therefore live on two different nested DOM nodes (`driftRef` wrapping `photoRef`/`textRef`), and the pointer writes go through `gsap.quickTo()` rather than a raw inline `style.transform`, so nothing is fighting over the same property. The tier cards' cursor-tilt reuses the same split for the same reason: the tilt transform lives on an inner absolutely-positioned layer wrapping the card's image/gradient/badges, never on the outer `<button>`, so the JS-driven `rotateX`/`rotateY` write never fights the button's own `transition-all` on hover/selection scale.

**The Clip-Path-Clips-Shadow Rule.** `clip-path` hard-clips everything that visually bleeds past the clipped box, including a descendant's `box-shadow` blur — not just its content. This was learned on `HeroPoster`, now retired: its mask-wipe reveal had to be scoped to the text only, because sharing the mask wrapper with the CTA row cut the button's soft `shadow-lg` into a hard rectangle permanently, even once the reveal finished fully open — zero margin still clips anything beyond zero. Kept here because the next clip-path reveal will hit it too.

**The Cobalt-Teal Band (`.scene-band`).** `ImageRow` and `HowItWorks` sit on a full-width gradient of `--scene-cobalt-rgb`/`--scene-teal-rgb` layered *over* `--surface-deep-rgb`, never the two scene hues at raw full strength — both are far too light to carry body copy alone. This is also what stops the live globe from showing through those two sections; before it existed, "How it actually works" sat directly on the globe and dropped below readable contrast over bright terrain.

**The One Ambient Loop Rule.** The base system's "no other ambient motion competes with the globe" characteristic is loosened, not dropped, inside `.blue-hour-scene`: a scene beat may carry exactly one authored ambient loop of its own — `.hero-light` on the opener is the first, `.console-sheen` on the trip-form card is the second. One loop per surface, never stacked, and always behind the same `prefers-reduced-motion: no-preference` gate as every other keyframe class in the file. The Hero originally ran four (a photo drift plus three drifting fog bands) counted collectively as one instance; it now honours the rule literally, with a single moving element and the fog held static. **"One loop" means one, and a loop must be a `transform`/`opacity` animation the compositor can own** — a moving `filter: blur()` is not an ambient loop, it is a permanent re-raster. This is still narrower than the base system allows anywhere else; it does not license ambient motion on `.glass-itinerary` generally.

**The Named-Timeline Rule (`--story`).** Every scroll-driven animation in this app binds to `animation-timeline: --story`, a named scroll timeline declared once on `.content-overlay` — never to `scroll(nearest block)`. `nearest` resolves to the nearest ancestor **scroll container**, and `overflow: hidden` makes an element one: it has a scrolling box, it simply never scrolls and shows no bar. The landing hero and both scene bands all carry `overflow-hidden` for their own reasons (the light wash and fog banks bleed past the frame; the cards animate in from negative X), so `nearest` bound to a section pinned at `scrollTop` 0 forever, and the animation sat frozen at 0% progress with no error anywhere. `.hero-cue`'s scroll fade shipped this way and **had never run once** — its `ScrollTimeline.currentTime` read `0%` at every scroll offset, which is indistinguishable at a glance from a cue that simply hasn't reached its range yet. A named timeline is referenceable by any descendant of the element that declares it, and `.content-overlay` is an ancestor on every route, so this needs no `timeline-scope`. If a new scroll-driven animation appears not to run, check the timeline's `source` before checking the range.

**The Story's One Exit (`.hero-dusk`).** Every beat in the Blue Hour sequence arrives; the hero is the only thing that *leaves*, and it leaves by performing the thing it is named after. A full-bleed wash of `--surface-deep-rgb` ramps from transparent to **0.8** across `25vh`–`85vh` of scroll, over the photograph, the ambient light, the fog and the type together, so the seam into `ImageRow` is a dissolve rather than the hard cut it was. It sits at `z-10`, above the type, deliberately: covering only the ground leaves the headline surviving its own photograph, reading as text pasted onto a dark rectangle. It ends before `100vh` because at exactly one viewport `ImageRow`'s top edge is already at the top of the screen and the tail of the ramp would play unseen.

**The cap is the point, and it is 0.8 rather than 1 because the hero is no longer pinned.** Held full-screen for a viewport, the wash had to *become* the band or the visitor sat looking at a half-dimmed still; scrolling freely, its visible extent shrinks as it deepens — at `85vh` only the hero's bottom `15vh` is on screen — so full opacity buys a flat rectangle nobody has time to see, at the cost of the photograph. What the wash has to hide is the fog: the three banks composite to ~0.68 white across the bottom edge, a ~9.8:1 step against `.scene-band`'s top. Seam contrast by cap — `1.0` → 1.24:1, `0.8` → 1.26:1, `0.7` → 1.64:1, `0.0` → 9.8:1 — so 0.8 costs 0.02 against full opacity and keeps a fifth of the photograph, while 0.7 costs 0.40 for another tenth. Worth knowing that the wash was never actually the band's colour: `--surface-deep-rgb` is darker and less saturated than the gradient laid over it, so "dissolve into the band" was always approximate and the cap is not a new inaccuracy.

This is **CSS and not a ScrollTrigger scrub**, and that is not a style preference: a Chrome trace found scrolling frames resolving on the main thread, and stripping this component's five tweens and pointer parallax was the fix. One element, `opacity` only, resting state fully transparent — so a reduced-motion visitor, or a browser with no scroll-driven animation, gets the composition unobscured rather than a hero behind a wash that never lifts. **That second group now includes desktop Safari below 26 and Firefox below 144, which is a widened degrade taken knowingly:** they get no wash and the hard cut, where before `lg` they would have had the GSAP version. Every one of them already got that cut below `lg`. A static bottom-anchored gradient would cover it and is rejected for being permanently visible — the exact thing the transparent resting state exists to avoid.

**The hero is not pinned, and a pin is the wrong device here.** For one commit a ScrollTrigger held the hero for a viewport (`start: "top top"`, `end: "+=100%"`, `scrub: true`, `pin: true`) while a scrubbed timeline pushed the photograph to `scale 1.12`, drifted the type up `-22%` to `opacity 0`, and took the wash to 1. The audit that asked for it asked for the hero to *collapse into the band below instead of hard-cutting* — which a pin does not do. It stops the page on the first pixel of scroll, so the first thing a visitor learns is that the page does not move, and what they look at while it does not move is a flat `#082130` rectangle, the wash having reached 1 as the type reached 0. **A hand-off is a dissolve, not a hold.** The wash alone, on the CSS timeline above, is the whole effect on every viewport now.

Three costs came free with the pin and are worth recording, because none of them is visible in the code that creates it:

- **An element scroller means transform pinning.** GSAP resolves `pinType` to `"fixed"` only when the scroller is the viewport. Here it is `.content-overlay`, so the section was held by GSAP rewriting `translateY` on it every frame, and the pin spacer changed the scroller's `scrollHeight` mid-gesture.
- **`refreshPriority: -1` did the opposite of what it says.** ScrollTrigger's sort key is `refreshPriority * -1e6`, so a negative value sorts a trigger *last* — and it is also the only reason the sort runs at all. The pin therefore refreshed after everything below it, and every one of those triggers measured against a layout with no pin spacer in it: ImageRow, HowItWorks and the closing poster all fired a full viewport early and finished before they were on screen. This is the trap to remember. Higher priority is a *higher* number.
- **A scrub is not a loop, but it is not free either.** The trace that stripped this component's JavaScript was measuring four infinite tweens; a scrub does work only while the wheel turns, which is what made it defensible. It stops being defensible when what it drives is an opaque veil the composition does not need.

**The One Text Entrance (`useLineReveal`).** Every heading in the sequence — the Hero headline, "How it actually works.", and `/trips`' "My memories" — arrives a line at a time, each line rising out from behind its own bottom edge. `SplitText` with `type: "lines"` and `mask: "lines"` (GSAP 3.13+) wraps each measured line in its own `overflow: hidden` box, so translating from `yPercent: 100` reads as type being *uncovered* rather than sliding into place: a fade says an element appeared, a mask says it was always there and something moved off it. `expo.out` over 0.9s at a 0.09 stagger, which is the app's documented `cubic-bezier(0.16, 1, 0.3, 1)` under its GSAP name rather than a second easing vocabulary for text. It is now the only text entrance in the sequence: `HeroPoster` used to run a parallel `clip-path` mask wipe, and retiring that beat left one mechanism instead of two doing the same job.

Three non-obvious requirements, all of which have broken this codebase before: **`fromTo`, never `from`** (Strict Mode's double-invoked effects make a `from()` tween treat the already-hidden state as its destination); **revert the split on cleanup** (SplitText rewrites innerHTML, and re-splitting over a previous split nests wrappers until line measurement is garbage); and **build after `document.fonts.ready`** — line breaks are a function of font metrics, so a split measured against the fallback face wraps at the wrong words, and this app loads three webfonts.

**Scrolling is native, and that is a decision.** `.content-overlay` scrolls itself with no JavaScript in the path — no wheel listener, no `scrollTop` animation, no smooth-scroll library. It briefly had one (`useSmoothScroll`: `preventDefault()` on a non-passive `wheel`, easing `scrollTop` toward a wheel-accumulated target in rAF) and it is deleted, because the mechanism cannot produce the effect it was reaching for. **Trailing render reads as softness; delayed input reads as lag.** GSAP's ScrollSmoother — the reference site's own choice, at `smooth: 1.2` — never touches the wheel: the browser scrolls natively and instantly and the plugin lags the *rendered content* behind it, so ~700ms of trailing costs nothing in responsiveness. A hook that moves the page itself has no such split; every millisecond of its glide is a millisecond of real input latency, and it also moves every scrolling frame onto the main thread, behind Cesium's tile work. Same duration, opposite result, and only the first one scales.

ScrollSmoother is not the fix either, and cannot be: it makes `#smooth-wrapper` `position: fixed` and translates `#smooth-content` inside it, with the *window* as its scroller always. This app has no window scroll — `.app-shell` is `h-dvh overflow-hidden` because a full-viewport Cesium canvas sits behind every route — and handing the scroll back to the window would scroll the globe away with the page. There is no smooth-scroll shape that fits this layout, so the layout keeps the browser's. A macOS trackpad already has real compositor-owned momentum; the hook replaced it with a worse copy on a busier thread. `overscroll-behavior: contain` on `.content-overlay` and `.docked-panel` stays — nothing above them scrolls, so a wheel running off their end has nowhere legitimate to chain.

One thing the reference measurement did settle: vita-travel.webflow.io has **no** `data-speed` or `data-lag` on any element — `effects: true` is enabled and unused — so none of its feel comes from per-element parallax. There is nothing to chase there.

## Navigation (App-Wide)

A single fixed, frosted `Navbar` — replacing the old plain-text top-left wordmark — spans the full width on every route and stays through the entire scroll (`z-20`, `h-[var(--nav-h)]`, `.glass-nav`: blur with a whisper of the one slate, since unlike a curated reference photo this nav sits over an arbitrary live 3D globe that idles anywhere from open ocean to a snowfield). `--nav-h` (`4rem`) is read wherever something needs to clear the bar — `<main>`'s top padding, `ScrollStory`'s cancelling margins, `DockedPanel`'s top offset — so none of them can drift out of sync with the bar's own height, the same one-token pattern `--mobile-sheet-h` already established.

The wordmark now carries the brand mark beside it — `LogoMark`, four arms radiating from a pinched centre, the widest member of the same asterisk family as `SectionOpener`'s section rule and the landing CTAs' four-point star. It is inlined rather than loaded from `public/scenes/image-logo.svg` for two reasons that matter: the file fills `white`, which cannot follow a wordmark whose colour changes by state and surface, so inline it binds to `currentColor`; and the file bakes `opacity="0.4"` onto its group, which is right for a watermark and wrong for an identity mark on frosted glass over photography, where it disappears. Sized in `em` so it tracks the type step. The mark is `aria-hidden`, so the link's accessible name stays "TripMate" rather than becoming "graphic TripMate".

It is also the one place per-route utility links live now: the wordmark (`href="/"`), section anchors ("The Journey" → `ImageRow`, "How It Works" → `HowItWorks`, landing only), and the route-aware actions — "My memories" on `/` and `/trip/[id]`, "New trip" on `/trips`, and "Profile" on every user-facing route except `/profile` itself. These used to be four separate bare-canvas links (the closing poster's CTA row, a lone link on the plan step, `/trips`, `TripView.tsx`), each floating in and out with its own page's layout; consolidating them removed the `headerLinkClass` pattern entirely; a page no longer supplies its own top-right link.

**The route table is an explicit list, not a negation.** "Profile" renders on `pathname === "/trips" || isTripDetail` (plus its own block on `/`), rather than on a `!isHome && pathname !== "/profile"` catch-all that reads cleaner and is shorter. The catch-all silently swept in `/backend` and `/backend/pipeline` — internal dashboards that render this same `Navbar` over their own stone-50 pages and have no business carrying a user-facing profile link. A nav predicate that describes *where a link belongs* survives a new route being added; one that describes *where it doesn't* quietly adopts every future route.

**Back is a component, not a link.** `BackButton` (a chevron plus the ghost-pill class list) is shared by `PlaceDetailPanel` and `/profile`. It renders a `<button>`, never a `<Link>`, deliberately: two of its call sites reverse in-page state (closing a stop detail) rather than navigating, and the third pops history. On `/profile` it calls `router.back()` with a fallback to `/`, because that page is reachable from both `/` and `/trip/[id]` — a fixed `href` would send half its visitors somewhere they weren't, and a bare `back()` would be a dead control on a direct link or a refresh.

**Mobile disclosure menu.** Below `sm`, the section anchors and "My memories" move behind a hamburger toggle rather than being hidden outright. Two things distinguish it from a naive show/hide toggle:
- **The icon is one continuous shape, not a cut.** Lucide's `Menu` and `X` glyphs share no geometry, so swapping between them is always an instant cut regardless of how the surrounding panel animates. A custom 3-bar mark — top and bottom bars translate and rotate into an X, the middle bar fades — morphs continuously instead, on the same `cubic-bezier(0.16, 1, 0.3, 1)` the rest of the app's motion already uses.
- **The panel stays mounted and animates its own height.** Instead of conditionally rendering the dropdown (which pops in and simply vanishes on close, animating only one direction), the panel is always in the DOM and its wrapper's `grid-template-rows` transitions between `0fr` and `1fr` — the CSS grid auto-height trick — so both opening and closing play. Rows inside it fade and slide in with a 60ms-per-row stagger, and `tabIndex={-1}` on every link while collapsed keeps a visually hidden menu out of the keyboard tab order. The panel itself is `.glass-nav-menu`, a higher-alpha step of the one slate than the bar's own whisper-thin tint — the same more-alpha-for-more-content step `.glass-control`/`.glass-itinerary` already take over `.glass-nav`, because a real tappable surface with rows on it wants more of the material than a bar does.

## Do's and Don'ts

### Do:
- **Do** build every new surface from `.glass-itinerary` at 16px radius with `p-5 sm:p-6`, and let its scoped `--foreground` / `--muted` / `--card-border` do the colour work.
- **Do** add `pointer-events-auto` to every interactive box you place inside the shell's overlay.
- **Do** put every failed request in an `ErrorNote`. One component, one treatment, `role="alert"`, on every route. Soft failures that block nothing — a geocoder miss — stay as muted 12px text where they happened. And check `res.ok` before reading the body: a 500 whose payload has no data key silently rendered `/trips`' empty state, which told the visitor their saved trips were gone.
- **Do** give every long model call the `GenerationLoader`, not a changed word on a button, and make the surface underneath `pointer-events-none` + `aria-busy` while it runs. **Every `LOADER` word must be exactly 10 letters** — globals.css hardcodes `.loader-letter:nth-child(1..10)`, and a dev-only assertion beside the constant now says so out loud.
- **Do** hide a surface with `hidden` rather than unmounting it when its state is worth keeping. `{!selectedStop && <ItineraryCard/>}` threw away the active day index, the panel's scroll position and any running tour every time someone opened a place detail — a stop on day 5 came back as day 1. A `display:none` sibling contributes no box, so nothing else moves. When you do this, stop side effects explicitly: the tour's interval survives the hide, and a camera flying every 6.5s while someone reads about one place is worse than the accidental stop it replaced.
- **Do** move focus when a panel replaces another. `PlaceDetailPanel` focuses its own `tabIndex={-1}` heading, because selecting a stop unmounts the row that had focus and it otherwise lands on `<body>`.
- **Do** make custom controls answer to the keyboard: the day tabs are a real `tablist`/`tab`/`tabpanel` with `aria-selected`, a roving `tabIndex` and arrow/Home/End traversal, and the tier cards are a `radiogroup` labelled by their own heading rather than three independent `aria-pressed` toggles. Colour alone never carries selection.
- **Do** print what a badge knows rather than hiding it in `title`. The weather badge reads the real forecast (`day.weatherDetail`) for its icon, range, rain chance and typical-weather caveat, and falls back to parsing the model's prose only for trips saved before that field existed. The fallback returns **no** label rather than a guess — "Windy and grey" used to come back as a sun captioned "Clear".
- **Do** scroll the one element that should move. `element.scrollIntoView()` walks *every* scrollable ancestor, so even `block: "nearest"` on a day tab scrolled the docked panel and hid the surface's own top row; set `scrollLeft` on the strip instead. The exception is deliberate: the overspend banner *does* call `scrollIntoView`, because it is inserted above what you were reading and the browser's scroll anchoring would otherwise hold that content still and push the alert off the top.
- **Do** keep targets at 44px, and reach it with `min-h-11` plus horizontal padding rather than by growing type. Where the layout genuinely cannot give it — the floating stop marker cards are map labels pinned to world coordinates — the affordance has a 44px equivalent elsewhere: those cards are `aria-hidden` with `tabIndex={-1}`, because they duplicate the panel's focusable stop rows and put up to eight redundant tab stops between the wordmark and the content.
- **Do** keep any field the user types into at 16px. Below that, iOS Safari zooms the whole viewport on focus. This applies to the small "Actual" spend inputs too, which were 12px.
- **Do** reserve amber for things the user acts on, and put the dark `--accent-foreground` on top of it — never white.
- **Do** compose new surface tints as `rgb(var(--surface-deep-rgb) / α)` rather than introducing a new grey.
- **Do** darken toward slate or black over photography and terrain, and use `tabular-nums` on every figure.
- **Do** call `resetToHome()` on mount, on *every* route that shows the globe but doesn't itself fly the camera anywhere specific — which, since the globe was gated to two surfaces, is a much shorter list than it was. The stale-geometry class of bug this guards against is now closed structurally: the canvas takes `visibility: hidden` wherever `globeWanted` is false, so a paused globe carrying the last trip's arcs cannot be seen through anything. The globe never unmounts, so a flight from any prior route survives until something explicit undoes it — which is what this clears, along with the destination pin. `page.tsx` has had this since the pre-generation flow existed; `/trips` shipped without it and a visit from `/trip/[id]` left the globe stuck on that trip's destination, visible through the card grid's own gaps. (That specific gap is closed twice over now — `/trips` no longer boots the globe at all.) The destination geocode still fires on blur rather than on a keystroke debounce, but for the surviving half of the original reason: overlapping 2.5s flights visibly lurch the camera through every prefix match on the way to the real destination.
- **Do** keep `HERO_VIEW` identical in `GlobeBackground`'s initial `setView` and in `mapCamera.tsx` — the two are mirrored by hand. Note that `flyTo`'s `height` is a `HeadingPitchRange` *range*, not an altitude.
- **Do** assume the scene is **asleep** before any measurement that depends on where the camera is, and call `scene.requestRender()` (or move the camera) to get a frame at all rather than waiting for one that will never come. Under `requestRenderMode` nothing renders unless something asked. This replaces an older rule that said to call `viewer.stopAutoRotate()` first: an idle auto-rotate drift used to run on `postRender` and would rotate the camera away from a `setView` for the whole settle window, which once corrupted a tile-detail probe into reporting a 2,054 m geometric error at 900 m altitude. That drift is deleted — with the globe gated to two surfaces, both of which command the camera on arrival, it could never be seen — and `stopAutoRotate`/`startAutoRotate` no longer exist. A camera parked with `setView` now stays exactly where it was put.
- **Do** judge globe detail by **minimum geometric error**, not triangle count. Two regions can hit an identical error with a 10× triangle difference, because mesh density inside a tile of a given declared error is Google's data. Error is the thing a setting controls; triangles are not.
- **Do** let the globe be the page's ongoing motion. Everything else moves on one curve, `cubic-bezier(0.16, 1, 0.3, 1)`, in three sizes, all `backwards`-filled so the resting state is the finished composition and all gated behind `prefers-reduced-motion: no-preference`:
  - `.hero-rise` (600ms, 12px) — a surface arriving. The landing block staggers 0 / 90 / 180ms; the plan card rises as one. **Set the delay as an inline `style={{ animationDelay }}`, never as `[animation-delay:90ms]`.** That Tailwind arbitrary property generates no rule in this project: scanning every stylesheet for an `animation-delay` declaration finds none, and an element carrying both `hero-rise` and `[animation-delay:90ms]` computes `0s` where an inline value computes `0.09s`. The Hero shipped with the class form for months, so this stagger never actually ran — both lines arrived together. Every stagger that does work (TierPicker, HomeView, TripFormConsole) uses the inline form.
  - `.settle-in` (420ms, 6px + `blur(5px)`) — the trip console's four cells, at 80 / 140 / 200 / 260ms. Blur is this system's signature material, so resolving the cells *out* of a blur is the world's own device rather than one more translate, and it keeps the console's arrival distinct from its neighbours' instead of assembling the form in eight identical beats. Applied to the cells, never to the console: a `filter` on the container rasterizes the whole trough including its hairline dividers.
  - `.value-in` (260ms, 4px) — a part settling inside a surface that is already arriving, or a figure that has just been recalculated. The style section at 320ms, tier cards fanning at 360 / 430 / 500ms, the footer at 440ms, the error block on appearance.
  - `.pop-in` (320ms, scale 0.55) — a control that appears under the cursor, i.e. the tier check badge.
  - `.console-sheen` — the trip-form card's one ambient loop: a single slow diagonal light sweep across its own glass, 7s ease-in-out infinite. Not a fourth entrance timing — it never stops — and scoped to this one panel; see The One Ambient Loop Rule (Blue Hour Expedition, above) for why a form step gets an ambient loop of its own.
- **Do** leave the reduced-motion blanket rule alone. The three gates above cover keyframe *animations*; the `@media (prefers-reduced-motion: reduce)` block near the top of globals.css is what covers every Tailwind `transition-*` in the app, and without it the focus wipe, the tier scale and the arrow nudge all still ran. Durations go to `0.01ms`, not `none`, so `transitionend`/`animationend` still fire. The globe is exempt by nature — it's a WebGL render loop, not CSS.
- **Do** key an element on its own value (`key={priceLabel}`) when a figure has to acknowledge a change. React reuses the DOM node otherwise and a CSS animation only plays on mount, so the number would swap silently — and tier prices now change mid-keystroke.

### Don't:
- **Don't** put a scrim, panel, gradient or blur behind the landing *hero* headline — the one over the photograph. Nothing sits between that type and the image. (This rule used to cover the closing poster too, on the premise that a live globe was behind it. That globe is gone: the poster sits on `.scene-void`, its ratio is now measurable at about 12:1, and it correspondingly dropped `.hero-legible` — which is what this rule wanted all along.) All darkening on the hero happens inside `.hero-legible`'s three-layer text-shadow, which hugs the glyphs: a 1px/3px hard edge at 0.9, a 3px/14px local pool at 0.75, and a 6px/44px halo at 0.5 that reads as depth rather than as a box. The known and accepted cost: text-shadow does not count toward a WCAG ratio, so over worst-case bright daytime terrain the subline's computed ratio can fall below 4.5:1. A radial scrim was built and measured (headline 6.3:1, subline 5.4:1, ghost CTA 6.4:1 against pure white) and then removed by explicit decision. Reinstating that scrim is the fix if the ratio ever has to be measurable — it is not a question to reopen otherwise.
  - **Tried once more, and reversed on sight.** Layering the hero put a snow-capped range behind the headline, and a full-bleed veil of `--surface-deep-rgb` at 0.55 was added to make it legible — measured, it took the headline from 1.63:1 to 3.75:1 on a phone. It came straight back out: `--surface-deep` is a 76%-saturated teal, and at that alpha it tripled the saturation of a near-neutral photograph (12.3% → 36.8%), reading as an awkward blue cast over the mountains. A neutral black veil was measured as the alternative (better contrast at a lighter alpha — 4.33:1 at 0.5, saturation held near 6%) and also declined. **So the rule stands unamended, and the cost is now on the headline too, not just the subline:** the shortfall is now on the headline too, and it is a phone problem rather than a general one. Worst pixel against mean, with the share of the headline's own area falling below 3:1: **390x844 1.10:1 / 4.73:1 / 14.5%**, 430x932 1.18 / 5.41 / 9.4%, 768x1024 1.15 / 8.54 / 4.5%, 1024x768 1.32 / 11.61 / **0.4%**, 1440x900 4.08 / 12.89 / **0%**. So from 1024px up it is noise; on a phone roughly one seventh of the word crosses lit snow. Accepted by explicit decision, on the same terms as the subline — `.hero-legible` carries it and WCAG will not count that. Two known-good fixes if it ever has to be measurable, neither reintroducing a tint: a neutral **black** veil at 0.5 (measured 4.33:1, saturation held near 6% against the teal's 36.8%), or a hue-preserving `filter: brightness()` on the back layer alone, which darkens without shifting hue or saturation at all.
- **Don't** hand-write `-webkit-backdrop-filter` next to `backdrop-filter`.
- **Don't** unmount, re-key, or conditionally render `GlobeBackground`.
- **Don't** introduce a solid, opaque card surface. If a panel needs to be more legible, raise its alpha within the one slate; do not leave the material.
- **Don't** use a second accent hue for status, category or sentiment. Positive/neutral chips are both neutral glass by design.
- **Don't** put a kicker, eyebrow, or all-caps label above a headline; don't use a hard offset shadow; don't use glyph or icon-font icons — every icon in the system is inline SVG.
- **Don't** let map-native colours (route blue, pin red) into the interface. Interface colours stay off the globe too, with the single documented exception of `--accent` marking the hovered or selected stop.
- **Don't** ship a control that only appears on hover. Pair every `:hover` reveal with `:focus-within` so it is reachable by keyboard, and with `@media (hover: none)` so it is simply always visible on touch, where there is no hover state to enter. The memory card's delete button does all three. So do the four `ImageRow` beat cards, as of the pass that found them failing it: their frost sheet, edge frost and hover caption were all `.group:hover`-only, so every phone visitor got four permanently-frosted photographs and none of the caption copy. `@media (hover: none)` now hands touch the resolved state outright. The keyboard half is still open there and is recorded as such — the card is a `<div>` performing no action, so there is no `:focus-within` to hang it on without inventing a control; the real fix is for the beat to stop putting a sentence of real copy behind hover at all.
- **Don't** verify that an overlay is clickable with `element.click()`. It dispatches straight at the node and skips hit-testing, so it passes on a control no human pointer can reach — which is exactly how a `pointer-events: none` dialog shipped looking fine. Use a real pointer event, or read the computed `pointer-events` up the ancestor chain.
- **Don't** animate anything on the globe from JS without checking `prefers-reduced-motion` yourself. The blanket rule in `globals.css` reaches CSS only; a WebGL material driven from `performance.now()` pulses straight through the preference.
- **Don't** mark the selected stop with a ring, halo or pulse on the ground. Selection is the accent on that stop's stem, pool and adjoining arcs, plus the thin rule under its own name card. A pulsing blue circle at the stem's base was built and removed: it drew a second marker for a stop that already had one, and put the emphasis at the bottom of the stem where nothing else is.
- **Don't** add geometry to a route without routing it through `RouteGeometry.reposition`. The route is drawn before its real altitude is known, and anything that misses the correction detaches from the rest at an oblique angle.
- **Don't** apply `.font-hero` outside the landing headline.
- **Don't** trust what the model sends. `normalizeDays` in `src/lib/itinerary.ts` runs on every itinerary entering the app — both `parseJsonResponse` calls and the saved-trip `GET` — because `Stop.category: StopCategory` and `cost: number` were contracts the types asserted and nothing enforced. An unrecognised category landed in no budget bucket at all (printing `$NaN`) and turned `CATEGORY_ICON[category]` into `<undefined />`, which throws a white screen. Normalize at the door; keep the render-site `?? PinIcon` as a crash guard, not as a second validation layer.
- **Don't** sum money anywhere but `src/lib/itinerary.ts`. `dayPlanned` is the plan, `daySpendByCategory` is what was actually spent (`actualCost ?? cost`), `daySpend` is *defined as* that breakdown's total, and `tripSpend` sums those. Three components used to sum the same figures independently and disagreed on both `actualCost` and non-numeric guards, so entering a real spend on `/trip/[id]` moved the overspend banner but not the budget bar — two totals for one number, on screen together. The Total row *is* the budget bar's per-day contribution; that is what makes it unrepeatable.
- **Don't** print an unformatted date or figure. `formatDate` / `formatDateWithWeekday` / `formatDateRange` / `formatMoney` in `src/lib/format.ts` are the only ways. Three date formats were once on screen at once — an ambiguous un-localized `09-01-26`, a raw ISO string, and the native picker's — and money was localized in exactly one component, so `$1200` and `~$1,200` appeared in the same session.
- **Don't** show a tile, heading, chip or label for a value that isn't there. The day-spend band drops any category that cost nothing and always shows Total; an empty note, an empty tips array and a day with no stops each render nothing or say so in words. `Food $0 · Entry $0 · Transit $0 · Stay $0 · Total $160` was the shape of getting this wrong.
- **Don't** signal a state with colour alone. Over budget carries the word "over" and the amount, because the bar clamps at 100% and 300% over looked identical to exactly on budget.
- **Don't** ship a development tool to a visitor. The LLM trace viewer is mounted only when `NODE_ENV === "development"`; it is a `z-50` FAB on every route that opens raw prompts and raw model responses, drawn in the light stone palette this system replaced.

## History

- **Overspend banner: real glass backing** (component-level, visual only): `TripView.tsx`'s "Day N ran $X over plan. Rebalance?" banner nearly disappeared over a busy live map — it had shipped with the trip-form's `border-red-500/30 bg-red-500/10 text-red-400` error-block classes, which read fine over that step's decorative, soft-focus globe but not over `/trip/[id]`'s real, arbitrary aerial imagery. Fixed by giving it `.glass-itinerary`'s actual slate backing (see the Alert Red entry, above), a `TriangleAlert` icon, and a split headline/question instead of one run-on sentence. No change to `handleRebalance`, `handleActualCostChange`, or either button's handlers — visual only.
- **Stop marker: "Location Title Card"** (component-level, additive): replaced the glass-chip stop-name card (`.glass-marker`) with a card-less treatment — italic display serif directly on the globe, legible via a text-shadow rather than a scrim, a thin `--accent` rule that draws in on hover/selection, and a depth-of-field effect (`--marker-depth`, reusing the existing distance-scale value) that softens distant names. Chosen after several sci-fi HUD/targeting-reticle directions were mocked and explicitly rejected as reading like generic "AI dashboard" styling rather than this app's own restrained cinematic register (the same register Blue Hour already established). Scoped to `.marker-title-card`/`.marker-anchor` only — the stem, glow pool and arcs in `mapRoute.ts`, and the `postRender` reprojection/decluttering/scale math in `StopMarkerLayer.tsx`, are unchanged. See **The Day on the Globe**, above.
- **"The Blue Hour Expedition"** (additive, not superseding): a scoped alternate identity (`.blue-hour-scene`) layered over the pre-generation flow only — the landing scroll story and the merged trip-form/tier-picker step. Replaces what used to be a single static poster viewport with a four-beat scroll sequence (curated photo hero → image row → mechanism copy → the "Plan a trip" reveal, withheld until the very end) and consolidates four scattered per-page "My memories"/"New trip" links into one persistent, route-aware `Navbar`. Unlike every other entry in this History section, this did not replace the base "Lit Cockpit" system — the result view, `/trips`, and `/trip/[id]` are unchanged and provably so (their `--accent`, `--surface-deep-rgb` etc. never repaint). See **The Blue Hour Expedition** above for the full system.
- **"Overcast"** (superseded): full-bleed 3D globe with steel-blue translucent glass cards floating on top. Replaced because the steel-blue register never resolved and legibility over a moving map was inconsistent.
- **"Roamly"** (superseded): a true split layout — warm cream/teal solid `.card` surfaces in their own pane beside a boxed-in globe pane, with an `AppShell` hero/split mode switched on `usePathname()`, and an explicit "no layered/glassmorphic panels" rule. It was retired wholesale: warm cream on cool slate read as two different design systems, the split pane surrendered the globe as the thing that carries the product, and the route-driven shell switch was fragile around the Cesium viewer's lifetime. The current world is the return to layered glass, done properly — one slate, one accent, one persistent globe, no pane switch.
