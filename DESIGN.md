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
- The Cesium `Viewer` (mounted once, unchanged from the prior direction) resizes to whatever box it's given — confining it to a pane instead of the full viewport needed no Cesium-side change.
- The persistent header ("TripMate"/destination title + "My trips") lives at the top of the content pane now, plain text — no floating pill, since there's no map to float over anymore.

## The itinerary card (`ItineraryCard`)

Replaces the old "every day stacked vertically" `DayList` with a single active-day view, matching the reference:
- **Header**: `{destination}: {N} Days`, tier description + budget subtitle, a destination photo (Wikipedia, darkened) as the background.
- **Trip budget bar**: kept, sits under the header — the whole-trip view.
- **Day-pill row**: horizontal, scrollable, one pill per day (up to the 30-day cap). Active = filled dark teal.
- **Active day**: lodging row (no inline cost — editable "Actual" input only in the revisit/editable context, since lodging has no detail view to move it to), then stop rows (circular photo avatar or category icon, time + duration, tag pills, no inline cost), a stacked photo column (desktop only), and a **Day N — Budget Breakdown** footer: Food/Entry/Transit/Stay/Total terracotta tiles, summing that day's stops by `category` plus lodging.

## Place detail — swaps the pane, doesn't overlay it

`PlaceDetailPanel` is a normal (non-fixed) view now: clicking a stop swaps the content pane from `ItineraryCard` to the detail view, with a **Back** control. Cost now lives here for stops (with the actual-cost input alongside "Estimated cost") since stop rows in the day view show no `$` at all.

## Photos

`/api/place-photo` resolves a stop name to a Wikipedia thumbnail via full-text search (not exact-title lookup — real stop names like "Kiyomizu-dera Temple" rarely match a page title exactly), gated by a containment check (the resolved title, diacritics folded, must appear inside the stop name) to reject unrelated top hits for generic phrases like "Lunch at Kyoto Station area." A miss falls back to a category icon (food/entry/transit/pin) — expected and common for non-landmark stops, not an error state.

## Duration cap

30 days, enforced client-side before the tier step — no LLM call is made for an out-of-range date range.

## Motion

The map's `flyTo` remains the one authored moment (2.5s custom easing). Everything else in the content pane is static — no slide-ins, no blur transitions; the pane swap (itinerary ↔ detail) is an instant conditional render, not an animated transition.

## What this is not

No layered/glassmorphic panels (retired along with "Overcast" — content and map are separate panes now, not stacked). No bento grids, no massive marketing-scale whitespace, no orchestrated scroll-reveal choreography, no kicker/eyebrow labels.

## History

- **"Overcast"** (superseded): full-bleed 3D globe background with translucent glass cards floating centered on top, steel-blue palette. Replaced because layering content over a busy, moving map made text legibility inconsistent — a real usability complaint, not a taste preference.
- **"Quiet Concierge"** (superseded before that): warm-terracotta 2D-map direction, predating the 3D globe entirely.
