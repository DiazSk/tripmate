---
name: TripMate
description: Dark frosted glass over a live photorealistic globe, with one warm accent reserved for interaction.
colors:
  canvas: "#0b0f19"
  surface-deep: "rgb(15 23 42)"
  foreground: "#f4f7fa"
  muted: "#97a3b6"
  on-deep: "#f4f7fa"
  accent: "#ffb340"
  accent-hover: "#ffc266"
  accent-foreground: "#3d2600"
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
  marker-glass: "rgb(15 23 42 / 0.58)"
  marker-border: "rgba(255, 255, 255, 0.16)"
typography:
  hero:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 8vw, 6rem)"
    fontWeight: 800
    lineHeight: 0.88
    letterSpacing: "-0.035em"
    fontVariation: "font-stretch: 125%"
  display:
    fontFamily: "Source Serif 4, ui-serif, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Source Serif 4, ui-serif, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  field:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.025em"
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

The whole application is one scene: a full-bleed, slowly auto-rotating CesiumJS globe rendered from Google Photorealistic 3D Tiles, with every piece of interface floating above it as dark frosted glass. There is no page background, no content pane, no second world. `AppShell` renders exactly four layers on every route — the globe at z-0, the floating stop markers at z-5, a viewport-spanning content overlay at z-10, and app chrome (wordmark, map controls) at z-20 — and that structure never varies by route or by step. What changes between screens is which glass boxes are on stage, not what is behind them.

The material is deliberately singular. One slate, `rgb(15 23 42)`, is the substance of every panel, control pill, badge, photo scrim and loader disc; only its alpha and its blur radius change. That shared origin is what keeps a 56px-blurred itinerary panel, a 20px-blurred zoom pill and a near-opaque loader reading as one system instead of four similar greys. Against that cool, neutral field sits exactly one warm colour — amber `#ffb340` — and it is reserved for interaction: primary buttons, the active day tab, the budget bar fill, focus rings, category icons, the Total tile. Nothing decorative is amber.

The home page's first viewport is the sharpest statement of the thesis: it is a poster, not a form. A four-line Archivo statement in 800 weight at 125% width sits directly on the live globe with exactly two pills beneath it, and nothing between the type and the Earth. The category default — hero photo plus an inline booking-form card — is explicitly refused. The form exists, but it arrives as a second step, as one glass card that holds destination, dates, budget and the three spending tiers together, with tier prices recomputing live from what was just typed.

**Key Characteristics:**
- One slate at many alphas is the only surface material; there is no opaque card tier.
- One warm accent, interaction-only, on a cool neutral field.
- Depth comes from blur, translucency and a single ambient shadow — never from a border-only card sitting on a flat page.
- Serif display type (Source Serif 4) for headings; a wide grotesque (Archivo) reserved for the one poster headline; system sans for everything else.
- The globe is always live and always moving; no other ambient motion competes with it.
- `tabular-nums` on every cost, total and temperature.

## Colors

A cool near-black slate carrying the entire surface layer, one warm amber for anything the user can act on, and two map-native colours that deliberately sit outside the brand palette.

### Primary
- **Signal Amber** (`{colors.accent}`): the only saturated colour in the system. Primary buttons, the active day tab, the budget bar fill, the selected-tier ring and check badge, focus rings, category and weather icons, the Total budget tile. It is a *light* colour, so anything printed on it takes the dark **Espresso** foreground (`{colors.accent-foreground}`), never white.
- **Signal Amber Bright** (`{colors.accent-hover}`): hover state for every amber fill, and the second stop in the generation loader's rotating sweep.
- **Amber Wash** (`{colors.tag-highlight-bg}` / `{colors.tag-highlight-fg}`): the one tinted chip, carried only by AI-attributed tags. Every other chip stays neutral glass.

### Neutral
- **Void Slate** (`{colors.canvas}`): the page canvas and Cesium's own `scene.backgroundColor`. Both read the same token at Viewer init so the WebGL clear colour and the DOM around it cannot drift and show a seam at the canvas edge.
- **Deep Slate** (`{colors.surface-deep}`, authored as the channel triplet `--surface-deep-rgb: 15 23 42`): the material. Panels at 0.62, control pills at 0.55, the tier price badge at 0.85, the loader disc at 0.95, photo scrims as gradients from 0.35 to 0.88. Always consumed as `rgb(var(--surface-deep-rgb) / α)`.
- **Paper White** (`{colors.foreground}` / `{colors.on-deep}`): body text on the canvas, and all text over dark surfaces — header bands, photo overlays, the hero, the map.
- **Steel Muted** (`{colors.muted}`): secondary text on the plain canvas and on Cesium's relocated credit line.
- **Glass Muted** (`{colors.glass-muted}`): the muted value *inside* a glass panel. Slate-300 rather than slate-400, because a translucent panel over bright terrain pushes slate-400 below the floor.
- **Hairline** (`{colors.card-border}`): every glass edge, every divider, every internal rule.
- **Chip Glass** (`{colors.tag-neutral-bg}` / `{colors.tag-neutral-fg}`) and **Tile Glass** (`{colors.tile}` / `{colors.tile-foreground}`): white-wash fills for chips and budget tiles, so the amber Total tile is the only one that pops.

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

**The Darken-Never-Lighten Rule.** Anything layered over photography or terrain is tinted toward slate or black, never toward white. Over the itinerary's photo bands the budget tiles are black-tinted glass (`bg-black/25`, Total at `bg-black/40`); white-tinted tiles drop their labels to roughly 2:1 over a bright photo.

## Typography

**Display Font:** Source Serif 4 (weights 500/600/700, via `--font-display`, falling back to `ui-serif, Georgia, serif`)
**Poster Font:** Archivo variable, width axis loaded (via `--font-hero`)
**Body Font:** system sans stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`)

**Character:** A warm, slightly bookish serif does the naming — wordmark, page titles, card and day headings — while an unadorned system sans carries every piece of data, label and control. The pairing keeps the interface quiet enough that the one poster voice, a very wide grotesque, lands as an event rather than as a style.

### Hierarchy
- **Poster** (`.font-hero`; Archivo 800, `font-stretch: 125%`, `clamp(2.5rem, 8vw, 6rem)`, line-height 0.88, tracking -0.035em): the landing headline only, set as four `<span class="block">` lines in a centred column. The width axis is doing as much work as the weight — 800 alone reads bold; 800 at 125% width reads like a poster. The negative tracking is what stops a wide face from sprawling at display size.
- **Display** (`.font-display`, 600, 1.25–1.5rem): the wordmark, page titles ("My memories"), and the itinerary card's `{city}: {N} Days` header.
- **Title** (`.font-display`, 600, 1–1.25rem): section headings inside a panel — "Choose your style", "Day N · MM-DD-YY", a place-detail name, a tier card headline.
- **Body** (system sans, 400, 0.875rem, relaxed leading): panel copy, stop names and notes, day summaries (italic). The hero subline is the one deliberate exception at `text-base` / `sm:text-lg`, capped at `max-w-xl` — 96px to 14px is a jump, not a scale step, and that line carries the mechanism the rest of the page only implies.
- **Field** (system sans, 500, 1rem): a value the user has typed or picked, in the trip form's console cells. 16px rather than the body step is a hard requirement, not a preference — below 16px iOS Safari zooms the viewport on focus.
- **Label** (system sans, 600, 0.75rem, tracking 0.025em, uppercase): field group labels inside the place-detail panel ("Best time to visit", "Tips", "Next up"). Uppercase labels belong *inside* a panel, beneath a heading, describing the field that follows.
- **Numeric** (`tabular-nums`): every cost, total, budget figure and temperature, without exception.

### Named Rules

**The One Poster Rule.** `.font-hero` applies to the landing headline and to nothing else, ever. A second wide-Archivo block anywhere in the app dissolves the first one's authority.

**The Width-Axis Rule.** Archivo must be loaded with `axes: ["wdth"]`. Browsers do not synthesise width, so without the axis `font-stretch: 125%` is a silent no-op and the poster quietly degrades to merely-bold.

**The No-Kicker Rule.** Nothing sits above a headline. No eyebrows, no all-caps kickers, no category labels introducing a title. Uppercase is a field-label device only.

## Layout

**The shell.** `AppShell` is a `h-dvh`, `overflow-hidden` flex container with four stacked layers: the globe absolutely positioned at z-0, `StopMarkerLayer` at z-5, a `pointer-events-none absolute inset-0 z-10 overflow-y-auto` overlay holding the route's children, and `BrandMark` + `MapControls` as z-20 siblings of that overlay. The marker layer sits *below* the content overlay deliberately — the stop cards belong to the world behind the glass, so a panel occludes them exactly as it occludes the globe. Putting them above was tried and looked wrong immediately: a stop near the right edge drew its card straddling the itinerary panel's edge. Pages never own the background and never own the wordmark.

**Two content shapes.** A surface is either a *centred column* (landing hero, plan card at `max-w-5xl`) laid out in normal flow inside `<main class="p-5 sm:p-6">`, or a *right-docked panel*: `fixed top-16 right-6 bottom-6 left-6 z-10 overflow-y-auto sm:top-6 sm:left-auto sm:w-[40%] sm:min-w-[360px] sm:max-w-[520px]`. The docked panel is the pattern for the result view, `/trips`, and `/trip/[id]`. `top-16` below `sm` is not arbitrary — the panel goes full-bleed there and has to start clear of the wordmark AppShell pins to the viewport's top-left.

**Rhythm.** Panels pad at `p-5 sm:p-6` (20/24px). Stacked panels within a docked column gap at 24px; rows within a panel at 12–16px; chips and inline metadata at 6px. Section breaks inside a panel are a `border-t border-card-border` with equal padding above and below (20px).

**Breakpoints.** Only two matter: `sm` (640px) flips the docked panel from full-bleed to right-docked and turns the map controls on, and `lg` (1024px) reveals the itinerary's stacked photo column. `md` exists in the shell's flex direction but no longer changes any composition.

**Map chrome.** `MapControls` is fixed bottom-left (`bottom-10 left-6`), hidden below `sm`, and suppressed entirely when the current surface carries `.map-chrome-hidden` — a page-level opt-out for steps that are a form over a decorative globe rather than a map being read.

### Named Rules

**The Pointer-Events Opt-In Rule.** The content overlay is `pointer-events-none` so the Cesium canvas underneath stays draggable. Every interactive box — every card, panel, button and link inside it — must opt back in with `pointer-events-auto`. A control that does nothing is almost always a missing `pointer-events-auto`.

**The Persistent Globe Rule.** `GlobeBackground` is never conditionally rendered, never re-keyed, never moved. A remount destroys the Cesium viewer, loses the camera pose and re-fetches the 3D tiles. Route-level differences are expressed by what floats above it.

**The Chrome-Not-Content Rule.** The wordmark is app chrome, rendered once by the shell at z-20 top-left on every route. A page supplies only its own top-right action link (`headerLinkClass`), and never its own wordmark.

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

**The Inheriting-Panel Rule.** `.glass-itinerary` redefines `--foreground`, `--muted` and `--card-border` inside its own subtree, so `text-foreground` / `text-muted` / `border-card-border` on any child resolve to the panel's dark-mode values automatically. Style children with the semantic tokens; do not hard-code white into a glass panel's children. `.dashboard-page` does the same job for content sitting directly on the canvas rather than inside a panel.

## Shapes

Corners are generously soft and step with the size of the box: panels and cards at 16px (`rounded-2xl`), inputs, tiles, textareas and inline rows at 12px (`rounded-xl`), small numeric inputs at 6px, and anything that reads as an action or a token — buttons, chips, day-arrow buttons, avatars, the compass, the tilt pill — fully round.

Borders are always a single hairline of white at 10–15% alpha, never a coloured or heavier rule. The only exceptions are stateful rings: the selected tier card takes `ring-2 ring-inset ring-accent`, hover takes `ring-white/40`, and focus-visible is universally `ring-2 ring-accent` (or `ring-accent/50` inside a panel).

Two silhouettes break the rounded-rectangle language deliberately. The day-tab row uses a `clip-path` polygon — an arrow point on the right edge and a matching notch on the left of every tab after the first — so a 30-day row reads as a sequence rather than as separate buttons; because `clip-path` will not trace a CSS border, those tabs are distinguished by fill alone. And the generation loader is a true circle, the only one in the system.

## Components

### Buttons
- **Shape:** fully round (`rounded-full`) at every size.
- **Primary:** amber fill, espresso text, `px-5 py-2.5` in a panel and `px-8 py-4` for the hero CTA. `shadow-sm` in a panel, `shadow-lg shadow-black/30` on bare terrain.
- **Hover / Active:** `hover:bg-accent-hover` with `transition-all duration-150`, `active:scale-[0.98]`. Disabled is `opacity-50 pointer-events-none`.
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
- **Empty dates:** `::placeholder` never applies to `input[type=date]`, so an empty date cell paints the UA's own "mm/dd/yyyy" at the input's colour and weight — two of four cells would read as filled while empty. The date inputs therefore take their tone from their own value: filled is `font-medium text-foreground`, empty drops to `font-normal text-white/65` to match the destination placeholder.
- **Error:** a separate block below the form — `border-red-500/30 bg-red-500/10 text-red-400` at 12px radius. Soft failures (a geocoder miss) are muted 12px text inside the form, not the red block.

### Chips
- **Style:** fully round, `px-2 py-0.5`, 12px medium. Neutral glass by default; the amber wash is reserved for AI-attributed tags.
- **Weather badge:** the same chip at `px-2.5 py-1` with an amber icon, a `tabular-nums` temperature, and the condition word at 70% alpha.

### Navigation
- **Wordmark:** Source Serif 4 semibold 20px in Paper White, absolutely positioned top-left at z-20 by the shell, carrying `.hero-legible` so it survives whatever the camera is pointed at. Plain type — no glass bar, no pill.
- **Page action:** a single top-right text link per surface, 14px medium Paper White with `.hero-legible` and `hover:underline`. One action per surface; the landing page supplies none, because "My memories" is already one of its two hero CTAs.
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
- **Native pixel density.** `useBrowserRecommendedResolution` is `false` with `resolutionScale`
  capped at 2×. Cesium's default renders at CSS pixels and ignores `devicePixelRatio`, so on any
  scaled display the canvas is upscaled and building edges go soft no matter how good the mesh
  is. The cap exists because fill cost grows with the square of the ratio.

Measured floor: at the close tier both cities reach **2.01 m** minimum geometric error at ~57 fps.
SSE 4 was tested and rejected — it buys *no* further detail (2.01 m is Google's tree floor) while
costing 21 fps and 1.1 GB of texture. The residual difference between regions is mesh density
inside tiles of equal declared error, which is Google's data and not a setting.

### The Day on the Globe (signature)
The map has to be readable on its own — you should be able to take the day off it without the
panel. Four pieces, all built in `mapRoute.ts` and all floating at one sampled altitude:

- **A glass name card per stop**, and it is an HTML overlay rather than a Cesium billboard. A
  billboard is a texture, so it cannot carry a backdrop blur, and every surface in this system is
  blurred glass. `StopMarkerLayer` reprojects each card every `postRender` frame with
  `SceneTransforms.worldToWindowCoordinates` — the CSS-pixel variant, because `resolutionScale` is
  customised here and the drawing-buffer variant is a different space. It scales by distance
  (`clamp(900000 / (d + 260000), 0.55, 1)`) and hides on a dot-product horizon check against the
  geodetic surface normal, so a stop on the far side of the globe does not smear across the limb.
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
A three-up grid of 200px-tall image buttons: a full-bleed SVG illustration that scales to 1.05 on hover, a `from-black/85 via-black/25 to-transparent` bottom-up gradient, a serif headline and a two-line clamped description at the base. Price rides in a top-right slate badge at 0.85 alpha. Selection is an inset amber ring plus a round amber check badge at top-left; hover is `ring-white/40`. Over-budget (above 3× the entered budget) is expressed as weight and text alpha only — the badge keeps its slate backing, because this state is now reachable mid-keystroke and the price is data. With no dates entered the badge shows a per-day rate rather than a total.

### Generation Loader (signature)
A 200px near-opaque slate disc — dark is the one axis the imagery is not — with a 1px light rim and a deep cast shadow, centred over the globe at z-30. Its rotating "gradient" is a side effect of three inset box-shadows sweeping from paper white through amber into near-black slate; there is no conic gradient and deliberately no cyan. The word "Generating" is split into ten letter spans that pulse on a staggered delay. **The word must be exactly ten letters** — globals.css hardcodes `.loader-letter:nth-child(1..10)` delays. A frosted caption pill beneath it cross-fades through fixed captions.

## Do's and Don'ts

### Do:
- **Do** build every new surface from `.glass-itinerary` at 16px radius with `p-5 sm:p-6`, and let its scoped `--foreground` / `--muted` / `--card-border` do the colour work.
- **Do** add `pointer-events-auto` to every interactive box you place inside the shell's overlay.
- **Do** reserve amber for things the user acts on, and put the dark `--accent-foreground` on top of it — never white.
- **Do** compose new surface tints as `rgb(var(--surface-deep-rgb) / α)` rather than introducing a new grey.
- **Do** darken toward slate or black over photography and terrain, and use `tabular-nums` on every figure.
- **Do** call `resetToHome()` whenever a flow returns to the landing state: `flyTo` calls `stopAutoRotate()`, which is a permanent lock, and `resetToHome()`'s flight-complete callback is the only thing that ever calls `startAutoRotate()` again. The same lock is why the destination geocode fires on blur, not on a keystroke debounce.
- **Do** keep `HERO_VIEW` identical in `GlobeBackground`'s initial `setView` and in `mapCamera.tsx` — the two are mirrored by hand. Note that `flyTo`'s `height` is a `HeadingPitchRange` *range*, not an altitude.
- **Do** call `viewer.stopAutoRotate()` before *any* measurement that depends on where the camera is. The auto-rotate listener runs on `postRender` at ~160 fps and will rotate the camera away from a `setView` for the whole settle window. This silently corrupted a tile-detail probe into reporting a 2,054 m geometric error at 900 m altitude before it was caught.
- **Do** judge globe detail by **minimum geometric error**, not triangle count. Two regions can hit an identical error with a 10× triangle difference, because mesh density inside a tile of a given declared error is Google's data. Error is the thing a setting controls; triangles are not.
- **Do** let the globe be the page's ongoing motion. Everything else moves on one curve, `cubic-bezier(0.16, 1, 0.3, 1)`, in three sizes, all `backwards`-filled so the resting state is the finished composition and all gated behind `prefers-reduced-motion: no-preference`:
  - `.hero-rise` (600ms, 12px) — a surface arriving. The landing block staggers 0 / 90 / 180ms; the plan card rises as one.
  - `.settle-in` (420ms, 6px + `blur(5px)`) — the trip console's four cells, at 80 / 140 / 200 / 260ms. Blur is this system's signature material, so resolving the cells *out* of a blur is the world's own device rather than one more translate, and it keeps the console's arrival distinct from its neighbours' instead of assembling the form in eight identical beats. Applied to the cells, never to the console: a `filter` on the container rasterizes the whole trough including its hairline dividers.
  - `.value-in` (260ms, 4px) — a part settling inside a surface that is already arriving, or a figure that has just been recalculated. The style section at 320ms, tier cards fanning at 360 / 430 / 500ms, the footer at 440ms, the error block on appearance.
  - `.pop-in` (320ms, scale 0.55) — a control that appears under the cursor, i.e. the tier check badge.
- **Do** leave the reduced-motion blanket rule alone. The three gates above cover keyframe *animations*; the `@media (prefers-reduced-motion: reduce)` block near the top of globals.css is what covers every Tailwind `transition-*` in the app, and without it the focus wipe, the tier scale and the arrow nudge all still ran. Durations go to `0.01ms`, not `none`, so `transitionend`/`animationend` still fire. The globe is exempt by nature — it's a WebGL render loop, not CSS.
- **Do** key an element on its own value (`key={priceLabel}`) when a figure has to acknowledge a change. React reuses the DOM node otherwise and a CSS animation only plays on mount, so the number would swap silently — and tier prices now change mid-keystroke.

### Don't:
- **Don't** put a scrim, panel, gradient or blur behind the landing headline. Nothing sits between the type and the globe. All darkening happens inside `.hero-legible`'s three-layer text-shadow, which hugs the glyphs: a 1px/3px hard edge at 0.9, a 3px/14px local pool at 0.75, and a 6px/44px halo at 0.5 that reads as depth rather than as a box. The known and accepted cost: text-shadow does not count toward a WCAG ratio, so over worst-case bright daytime terrain the subline's computed ratio can fall below 4.5:1. A radial scrim was built and measured (headline 6.3:1, subline 5.4:1, ghost CTA 6.4:1 against pure white) and then removed by explicit decision. Reinstating that scrim is the fix if the ratio ever has to be measurable — it is not a question to reopen otherwise.
- **Don't** hand-write `-webkit-backdrop-filter` next to `backdrop-filter`.
- **Don't** unmount, re-key, or conditionally render `GlobeBackground`.
- **Don't** introduce a solid, opaque card surface. If a panel needs to be more legible, raise its alpha within the one slate; do not leave the material.
- **Don't** use a second accent hue for status, category or sentiment. Positive/neutral chips are both neutral glass by design.
- **Don't** put a kicker, eyebrow, or all-caps label above a headline; don't use a hard offset shadow; don't use glyph or icon-font icons — every icon in the system is inline SVG.
- **Don't** let map-native colours (route blue, pin red) into the interface. Interface colours stay off the globe too, with the single documented exception of `--accent` marking the hovered or selected stop.
- **Don't** animate anything on the globe from JS without checking `prefers-reduced-motion` yourself. The blanket rule in `globals.css` reaches CSS only; a WebGL material driven from `performance.now()` pulses straight through the preference.
- **Don't** add geometry to a route without routing it through `RouteGeometry.reposition`. The route is drawn before its real altitude is known, and anything that misses the correction detaches from the rest at an oblique angle.
- **Don't** apply `.font-hero` outside the landing headline.

## History

- **"Overcast"** (superseded): full-bleed 3D globe with steel-blue translucent glass cards floating on top. Replaced because the steel-blue register never resolved and legibility over a moving map was inconsistent.
- **"Roamly"** (superseded): a true split layout — warm cream/teal solid `.card` surfaces in their own pane beside a boxed-in globe pane, with an `AppShell` hero/split mode switched on `usePathname()`, and an explicit "no layered/glassmorphic panels" rule. It was retired wholesale: warm cream on cool slate read as two different design systems, the split pane surrendered the globe as the thing that carries the product, and the route-driven shell switch was fragile around the Cesium viewer's lifetime. The current world is the return to layered glass, done properly — one slate, one accent, one persistent globe, no pane switch.
