# Design

## Direction

"Roamly" (replaces "Overcast") — a true split layout: the 3D globe (unchanged — CesiumJS + Google Photorealistic 3D Tiles) is confined to its own pane rather than a full-bleed background, and the itinerary is a solid warm-cream card in a separate pane beside it, cloned closely from a specific Dribbble reference ("Travel.Ai"/"Roamly"). The map and the card no longer layer on top of each other — that was the direct fix for a real complaint that glassmorphism over a busy, moving map was hard to read. Still Operate mode; the warmth lives in color and imagery, not in layout invention.

## Palette (Restrained strategy, warm register)

- `--background` `#f2eee6` (cream/"paper") — the content pane's base.
- `--foreground` `#2b2620` (ink), `--muted` `#7a7266` — text on cream.
- `--accent` `#1f3a34` (dark teal) / `--accent-hover` `#16302b` — the card header band, active day-pill, primary buttons. `--accent-foreground` `#f5f1e8`.
- `--card` `#faf7f1` on `--card-border` rgba(ink, 0.1) — solid (not translucent) card surfaces; there is no glass tier anymore, since content and map are spatially separate, not layered.
- Tag pills: `--tag-neutral-*` (tan, default), `--tag-positive-*` (sage — tags implying "recommended/local/free/must-see"), `--tag-highlight-*` (coral — tags mentioning "AI").
- `--tile` `#c17a52` (terracotta) — the per-day budget-breakdown tiles.
- Semantic red (over-budget/overspend) unchanged in family, tuned to sit on cream.

## Typography

Unchanged: Source Serif 4 (`--font-display`) for the wordmark, page titles, and card/day headings; system sans for body/UI/data; `tabular-nums` on all costs and totals.

## Layout: split panes (`AppShell`)

- `flex-col md:flex-row h-dvh` — left/top pane is the map (`h-[40vh] md:h-full md:w-[55%]`), right/bottom pane is the scrollable cream content (`md:w-[45%]`). Stacks vertically below `md`.
- **Hero mode** is the one exception, and it applies only to the home page before an itinerary exists (see "The landing hero" below). The shell swaps *only the two panes' class strings* — `GlobeBackground` stays in the same element slot, because a remount destroys the Cesium viewer, loses whatever the camera flew to, and re-fetches the 3D tiles. Hero is the shell's *default* state, ANDed with `usePathname() === "/"`, so the home route paints correctly on the first frame rather than flashing a split pane before an effect flips it.
- The Cesium `Viewer` (mounted once, unchanged from the prior direction) resizes to whatever box it's given — confining it to a pane instead of the full viewport needed no Cesium-side change.
- The persistent header ("TripMate"/destination title + "My trips") lives at the top of the content pane now, plain text — no floating pill, since there's no map to float over anymore. The trip-detail page is an exception: it shows only the "My trips" nav link, no page-level destination title or date range, since both are redundant with what the itinerary card's own header already shows.

## The landing hero

The home page opens on a globe band across the top (`h-1/2 sm:h-[56%]`) with the trip form card overlapping its lower edge, rather than the split panes. It holds through the **form and tier steps** — so you type a destination, the globe flies there, and you pick your style over a live shot of the actual place — then hands off to the split panes once an itinerary exists, since the itinerary is far too dense to layer over imagery.

Two gradients do the work. A **scrim** covers only the top strip behind the header, not the whole band: legibility must not depend on what the camera is pointed at, because by the tier step the backdrop is bright daytime aerial imagery rather than space. It's calibrated so `--accent-foreground` clears 4.5:1 against *worst-case white* imagery — teal at 0.70 gives 4.36:1, at 0.75 it gives 5.06:1, and the header sits where alpha is ≥0.766 (measured 5.26:1). Don't lower it; the 14px "My trips" link needs the full 4.5:1, not the 3:1 that the large wordmark would get away with. A **seam** dissolves the band's bottom into the cream. Both write their zero-alpha stop as the tinted color at `/ 0` — `transparent` is `rgba(0,0,0,0)` and would fade through a gray halo.

This narrowly reverses the "no layered panels" rule below. The reversal is deliberate and bounded: it's the home page only, pre-itinerary; the card stays the solid cream `.card`, never glass; and only the header text layers, over a scrim with a proven contrast floor. That's the same "darken, don't lighten" reasoning already used for the budget-breakdown tiles.

Cesium's attribution is relocated per mode (`creditContainer`, settable only at Viewer construction). In hero mode the card overlaps where Cesium would draw it, so it's pinned to the page corner instead — Google's terms require it stay visible, and it's recolored for cream since Cesium's default is white-on-dark.

## The itinerary card (`ItineraryCard`)

Replaces the old "every day stacked vertically" `DayList` with a single active-day view, matching the reference:
- **Header**: `{city}: {N} Days` (city only, not "City, Country"), tier description + budget subtitle, sitting on a layered blurred destination photo — a blurred/scaled photo layer, a dark-teal tint for legibility, text floating on top; falls back to flat `--accent` when no photo resolves.
- **Trip budget bar**: kept, sits under the header — the whole-trip view.
- **Day-pill row**: horizontal, scrollable, one pill per day (up to the 30-day cap), shaped as chevron/arrow tabs (`clip-path` polygon — an arrow point on the right, a matching notch on the left of every tab after the first) with a small gap between them, so the row reads as a sequence. Fill-only distinction, no border, since `clip-path` doesn't trace along a straight CSS border. Active = filled dark teal.
- **Active day**: a `Day N · MM-DD-YY` heading paired with a compact weather badge — the model's free-text forecast condensed to an icon (sun/cloud/rain), a temperature, and a one-word condition, with the full sentence kept as a tooltip. Then the lodging row full-width (no inline cost — editable "Actual" input only in the revisit/editable context, since lodging has no detail view to move it to), then stop rows (circular photo avatar or category icon, time + duration, tag pills, no inline cost) with the stacked photo column (desktop only) running alongside *the stops only*, so it starts level with the first stop rather than the lodging above it.
- **Budget Breakdown footer**: a **Day N — Budget Breakdown** strip of Food/Entry/Transit/Stay/Total tiles, summing that day's stops by `category` plus lodging, on the same layered blurred-photo band as the header. Over a photo the tiles are frosted glass; they are tinted *dark*, not white — a bright photo behind a white-tinted tile drops its label to ~2.5:1, while darkening holds above 4.5:1 whatever the photo is. With no photo the band falls back to flat tan with solid terracotta tiles, which is why the glass is conditional rather than unconditional.

## Place detail — swaps the pane, doesn't overlay it

`PlaceDetailPanel` is a normal (non-fixed) view now: clicking a stop swaps the content pane from `ItineraryCard` to the detail view, with a **Back** control. Cost now lives here for stops (with the actual-cost input alongside "Estimated cost") since stop rows in the day view show no `$` at all.

## Photos

`/api/place-photo` resolves a stop name to a Wikipedia thumbnail via full-text search (not exact-title lookup — real stop names like "Kiyomizu-dera Temple" rarely match a page title exactly), gated by a containment check (the resolved title, diacritics folded, must appear inside the stop name) to reject unrelated top hits for generic phrases like "Lunch at Kyoto Station area." A miss falls back to a category icon (food/entry/transit/pin) — expected and common for non-landmark stops, not an error state.

## Duration cap

30 days, enforced client-side before the tier step — no LLM call is made for an out-of-range date range.

## Motion

The map's `flyTo` remains the one authored moment (2.5s custom easing) — the globe never auto-rotates, including in the hero. Its default pose is a true altitude/pitch `setView` (2,500km, pitch −46°) framing the curved limb with space above it; note the hero band's wide aspect ratio drops Cesium's *vertical* FOV from 60° to ~18°, so a pose tuned in the square split pane will not read the same there. Don't CSS-transition the pane geometry between hero and split: Cesium polls `clientWidth/Height` every frame rather than using a ResizeObserver, so an animated resize reallocates the canvas on every frame. Swap instantly. It *frames* its target via `flyToBoundingSphere` rather than parking the camera on the target's own coordinates — a pitched camera positioned at a place leaves that place at nadir, outside the frustum, so you'd fly to Rome and never see Rome. Every flight also drops a single pin labelled with the place name, replacing the previous one, so what the camera flew to is unambiguous. The pin is a conventional red teardrop rather than a palette color — it's a map affordance readable against arbitrary satellite imagery, not part of the cream/teal content system, and Cesium's own `PinBuilder` only draws a squat rounded square. It ignores depth testing, since the photorealistic tiles would otherwise bury it inside nearby buildings. Everything else in the content pane is static — no slide-ins, no blur transitions; the pane swap (itinerary ↔ detail) is an instant conditional render, not an animated transition.

## What this is not

No layered/glassmorphic panels (retired along with "Overcast" — content and map are separate panes now, not stacked). No bento grids, no massive marketing-scale whitespace, no orchestrated scroll-reveal choreography, no kicker/eyebrow labels.

## History

- **"Overcast"** (superseded): full-bleed 3D globe background with translucent glass cards floating centered on top, steel-blue palette. Replaced because layering content over a busy, moving map made text legibility inconsistent — a real usability complaint, not a taste preference.
- **"Quiet Concierge"** (superseded before that): warm-terracotta 2D-map direction, predating the 3D globe entirely.
