# TripMate — Split-Layout Itinerary Redesign

## Context

TripMate currently renders the 3D globe (CesiumJS + Google Photorealistic 3D Tiles) as a full-bleed background behind every page, with translucent glass cards ("Overcast" direction) floating centered on top of it. After using it, three problems came back:

1. **No sanity check on trip length.** A user can enter a multi-year date range and the app will try (and likely fail or produce garbage) to generate that many days.
2. **The centered floating-card layout is hard to read.** The frosted glassmorphism over a busy, colorful, moving map makes text legibility inconsistent, and the map and the itinerary compete for the same screen space instead of being clearly separated.
3. **The itinerary itself should visually match a specific reference** — a Dribbble shot ("Travel.Ai" / "Roamly") showing a warm cream itinerary card with a dark teal header, horizontal day-pill navigation, per-stop photo avatars with time/duration/tags, a stacked photo column, and a per-day "Budget Breakdown" footer with category tiles (Food/Entry/Transit/Stay/Total).

Decisions locked in with the user (via clarifying questions):
- **Duration cap**: 30 days maximum, enforced with inline validation before the tier-picker step — no wasted LLM call on an unreasonable range.
- **Layout**: a true split — map confined to a left pane, itinerary content in a solid right pane (not layered glass over the map). Stacks vertically on narrow/mobile viewports.
- **Palette**: the itinerary card actually adopts the reference's warm cream/teal/terracotta palette (a deliberate contrast against the cool-toned map), not a re-skin in the existing steel-blue glass language.
- **Place detail**: clicking a stop swaps the right pane's content to a detail view (with a Back control) rather than sliding in as a separate overlay.
- **Photos**: sourced from Wikipedia's free, keyless REST API by place name, with a category-icon fallback when no match exists (expected for generic stops like "lunch near the market").

This spec supersedes the "Overcast" visual direction recorded in `DESIGN.md` for all app-chrome surfaces (forms, cards, day list, budget bar, feedback loop, trips list). The 3D map itself — Cesium, Google Photorealistic 3D Tiles, the `useMapCamera()` camera API — is unchanged; only its position on screen (confined to a pane instead of full-bleed) changes.

## 1. Duration cap

- `src/lib/tiers.ts` already exports `tripDays(startDate, endDate)`. Add a `MAX_TRIP_DAYS = 30` constant (co-located, since it's a trip-planning constraint like the tier rates) and a `isTripTooLong(startDate, endDate)` helper.
- `src/app/page.tsx`'s `chooseStyle()`: check this before geocoding/flying the camera or advancing to the tier step. On failure, set the existing `error` state to `"Trips over 30 days aren't supported — please choose a shorter date range."` and return early (stay on the form step).

## 2. Layout: split panes

- `src/components/AppShell.tsx` restructures from a fixed-inset map layer + full-page scroll container into:
  - A responsive flex container: `flex-col md:flex-row h-dvh overflow-hidden`.
  - Left/top pane: `relative w-full md:w-[55%] h-[40vh] md:h-full shrink-0` containing `GlobeBackground` (which already fills `h-full w-full` — no change needed there).
  - Right/bottom pane: `w-full md:w-[45%] flex-1 md:h-full overflow-y-auto` containing `{children}`, styled with the new cream background.
- `GlobeBackground`'s Cesium `Viewer` already resizes to its container automatically (Cesium handles container resize internally); no Cesium-side change needed beyond confirming resize behavior still works when the container is a pane instead of the full viewport.
- The `.glass-panel` / `.glass-panel-solid` utilities are retired for app-chrome surfaces (no more content layered translucently over the map — the two are now spatially separate). They may be deleted from `globals.css` once nothing references them.
- The persistent header ("TripMate" / "My trips") moves inside the right pane, at the top, styled as a plain part of the cream card language (not a floating pill).

## 3. New palette ("Roamly" direction, replaces "Overcast")

Concrete tokens (added to `globals.css`, replacing the steel-blue set):
- `--paper` (cream) `#f2eee6` — right-pane background and card surfaces.
- `--ink` `#2b2620` — primary text on cream.
- `--muted` `#7a7266` — secondary text.
- `--header` (dark teal) `#1f3a34` — card header band, active day-pill, primary buttons.
- `--header-hover` `#16302b`.
- `--tag-neutral` (tan) `#e4d9c4` bg / `#2b2620` text — generic tags.
- `--tag-positive` (sage) `#b9c9a8` bg / `#2b2620` text — "recommended/good pick" tags.
- `--tag-highlight` (coral) `#e08e6d` bg / `#fff8f2` text — "AI recommended"/highlight tags.
- `--tile` (terracotta) `#c17a52` — budget-breakdown tile backgrounds.
- Semantic red (over-budget/error) unchanged in hue family, adjusted to sit well on cream.

`DESIGN.md` gets rewritten recording this as the current direction; the "Overcast" section is retained lower in the file as a dated history note (one paragraph), not deleted outright, since it documents a real prior decision.

## 4. Data model additions

`src/lib/types.ts` — `Stop` gains:
```ts
time: string;          // e.g. "8:30 AM" — approximate start time
durationLabel: string; // e.g. "1 hour" — human label, not stored as minutes
tags: string[];        // 1-2 short descriptors, e.g. "Local Pick", "Reservation Needed"
category: "food" | "entry" | "transit" | "other"; // drives the budget-breakdown bucket
```
`Lodging` is unchanged — its `cost` maps directly to that night's "Stay" tile.

`src/lib/itineraryPrompt.ts`: `SHAPE_HINT`, `buildGeneratePrompt`, `buildRefinePrompt`, and `buildRebalancePrompt` all updated to require these fields per stop, with an instruction that times within a day should be sequential and non-overlapping, and that `category` should be assigned sensibly (a restaurant/cafe stop → `food`, a paid attraction/ticketed site → `entry`, an explicit transport leg → `transit`, everything else → `other`).

## 5. New itinerary card UI

Replaces `DayList`'s "render every day stacked vertically" behavior with a single active-day view:

- **Card header**: `{destination}: {N} Days` title, subtitle `{tier description} · ${budget} budget`, background photo (destination photo via the Wikipedia route below, darkened for contrast) — replaces the current plain bar.
- **Trip budget bar**: kept, unchanged logic (sums all days vs. total budget), now sits just under the header, above the day-pill row — this is the whole-trip view; the footer below is the per-day view. Different purposes, both kept.
- **Day-pill row**: horizontal, `overflow-x-auto`, one pill per day (up to 30). Active = filled dark teal; inactive = cream/tan outline. Selecting a pill is local UI state (`activeDayIndex`), not a data reload.
- **Active day content**:
  - Section label: `Day {n} · {date}` + weather summary (existing data, kept).
  - Lodging row (if present): icon + name + note, no `$` inline (moves to the footer).
  - Stop rows: circular photo avatar (fetched by name, category-icon fallback), connected by a thin vertical line between rows, name, `{time} · {durationLabel}`, tag pills. No `$` inline. Clicking a row calls the existing `selectStop` (camera fly + opens detail).
  - Stacked photo column (right side, desktop only — stacks are skipped on narrow layouts for space): the first 2-3 stops' already-fetched photos, larger, rounded corners.
  - **Budget-breakdown footer**: `Day {n} — Budget Breakdown`, tiles for Food / Entry / Transit / Stay / Total, summing that day's stops by `category` plus that night's lodging cost as Stay.
- Below the day view: existing `FeedbackLoop` (give feedback/regenerate, save trip), restyled to the cream palette, behavior unchanged.

`DayList.tsx` is replaced by a new `ItineraryCard.tsx` (header + budget bar + day pills + active day + footer + feedback loop composed together, since these pieces are now interdependent on shared `activeDayIndex` state). `BudgetBar.tsx` is kept as-is and reused inside it. `TierPicker.tsx` and the trip-creation form are restyled to the cream palette but keep their existing structure/props.

## 6. Place detail — replaces right-pane content

- The right pane renders either `ItineraryCard` or the place-detail view, switched on whether `useTripCamera()`'s `selectedStop` is set — a simple conditional in `page.tsx` / `trip/[id]/page.tsx`, replacing the old always-mounted slide-in overlay.
- `PlaceDetailPanel` is adapted into a normal (non-fixed, non-overlay) right-pane view: header with stop name/note and a **Back** button (calls `closeDetail()`, which already flies the camera back to destination level and clears `selectedStop`), then the existing history/best-time/duration/tips content, restyled to the cream palette.
- The actual-cost `<input>` (used by the rebalance feature) moves here — one field, next to "Estimated cost: $X" — since stop rows in the day view no longer show cost at all. `onActualCostChange` is passed down from `trip/[id]/page.tsx` same as today, just to this view instead of inline in the list.

## 7. Photo sourcing

- `src/app/api/place-photo/route.ts` (new): `GET ?name=<place name>` → calls `https://en.wikipedia.org/api/rest_v1/page/summary/{encodeURIComponent(name)}`, returns `{ thumbnailUrl: string | null }` (null on a 404/no-thumbnail, not an error — a miss is an expected, common case, not a failure).
- Client-side: a small `usePlacePhoto(name)` hook fetches lazily when a stop row/avatar actually renders (only the active day's handful of stops, not the whole trip) and caches results in a module-level `Map<string, string | null>` so switching day-pills back and forth doesn't refetch.
- Fallback: a category icon (extending the existing lodging bed-icon pattern with food/ticket/transit/generic-pin icons) shown whenever `thumbnailUrl` is `null` or still loading.

## Error handling

- Duration cap: inline form error, no network call.
- Photo fetch failure/miss: silent fallback to category icon, never a visible error — this is expected, common behavior, not a fault condition.
- Everything else (itinerary generation/refine/rebalance/save failures): unchanged existing error-banner behavior.

## Verification

- Enter a destination with a multi-year date range → confirm the inline cap message appears and no `/api/itinerary` request is made.
- Generate a 4-5 day itinerary → confirm: the map is confined to its pane (left on desktop, top on mobile) and the itinerary card is a solid cream panel beside/below it, not layered over the map; the day-pill row shows one pill per day and switching pills changes only the active day's content; each stop row shows time/duration/tags and either a real photo or a category icon; the budget-breakdown footer's category tiles sum correctly for the active day.
- Click a stop → confirm the camera flies to it and the right pane swaps to the detail view with a working Back control and an actual-cost input.
- Full regression: generate → give feedback/regenerate → save → `/trips` → revisit → edit an actual cost → trigger overspend → rebalance — all still work under the new layout and data shape.
