# Frontend — Feature Tracker

Covers `src/app/**/page.tsx`, `src/app/globals.css`, `src/app/layout.tsx`,
`src/components/**`. See [`project-crux.md`](./project-crux.md) for how these
tables are maintained.

## Features

| Feature | Status | Since | Developer | Notes |
|---|---|---|---|---|
| Home page trip form (destination / dates / budget) | Active | 2026-08-04 | Aryan | |
| `/trips` saved trips list | Active | 2026-08-04 | Aryan | |
| `/trip/[id]` saved trip detail | Active | 2026-08-04 | Aryan | |
| `ItineraryMap` (Leaflet) | Active | 2026-08-04 | Aryan | |
| `BudgetBar` | Active | 2026-08-04 | Aryan | |
| `DayList` | Active | 2026-08-04 | Aryan | |
| `FeedbackLoop` (give feedback → regenerate, or save trip) | Active | 2026-08-04 | Aryan | |
| `PageHeader` shared component | Active | 2026-08-05 | Aryan | One component reused across all pages instead of duplicated markup — see Eliminated below |
| `PreferenceStep` (trending-tag chips + vibe chips + skip) | Active | 2026-08-05 | Aryan | Shown after the trip form, before generation |
| `TraceStatusBadge` shared component | Active | 2026-08-05 | Aryan | Shared by the LLM trace list/detail views |
| `/llm-trace` list page | <details><summary>Eliminated 2026-08-06 (Aryan)</summary>Folded into the `LlmTraceFab` widget's list view below — no route needed anymore</details> | 2026-08-05 | Aryan | |
| `/llm-trace/[id]` detail page | <details><summary>Eliminated 2026-08-06 (Aryan)</summary>Folded into the `LlmTraceFab` widget's detail view below</details> | 2026-08-05 | Aryan | |
| "View LLM trace for this call →" link on results | Active | 2026-08-05 | Aryan | Now calls `useLlmTraceWidget().openItem(traceId)` instead of navigating — see `LlmTraceFab` below |
| `LlmTraceFab` — floating action button + expandable panel for LLM traces | Active | 2026-08-06 | Aryan | Bottom-right icon (collapsed) → panel with list/detail views + a collapse button (expanded), mounted once in the root layout so it's available on every page. Content selection came from `.claude/skills/dev-analytics-fab/SKILL.md` ("LLM/AI calls" was the one catalog category that fit this app); the FAB/panel UI mechanics themselves came from the separate `.claude/skills/floating-widget-ui/SKILL.md` |
| `LlmTraceFabProvider` / `useLlmTraceWidget()` context | Active | 2026-08-06 | Aryan | Exposes `openList()` / `openItem(id)` / `close()` so any "View trace" link elsewhere in the app can open the widget pre-focused on a specific trace, without reaching into its internal state |
| `WeatherIcon` (dynamic Lucide icon per day) | Active | 2026-08-05 | Aryan | Picks Sun/CloudSun/CloudDrizzle/CloudRain/CloudSnow/CloudLightning/CloudFog/Umbrella from WMO `weatherCode` + rain probability |
| `WeatherPopover` (click-to-expand weather detail) | Active | 2026-08-05 | Aryan | Shows low/high temp, humidity, rain chance; falls back to the model's plain-text `weather` string when structured data is missing |
| Daily budget progress bar per day card | Active | 2026-08-05 | Aryan | Shows each day's spend as a % of the *overall* trip budget, in `DayList` |
| Hover-to-highlight: hovering a stop in `DayList` highlights its pin on `ItineraryMap` (and vice versa via shared state) | Active | 2026-08-05 | Aryan | Stops are keyed `${dayIndex}-${stopIndex}`; hovered marker swaps to a custom `L.divIcon` |
| Daily narrative summary line (model-written, 1-2 sentences + emoji) | Active | 2026-08-05 | Aryan | Rendered at the bottom of each `DayList` day card; optional field, so pre-existing saved trips just render without one |
| 3D CesiumJS globe landing experience (`CesiumGlobe`, `useCesiumViewer`) | Active | 2026-08-05 | Claude | Home page only. Continuously auto-rotating globe behind the search form; rotation stops on first canvas interaction or on search. Uses ion world imagery/terrain when `NEXT_PUBLIC_CESIUM_ION_TOKEN` is set, else falls back to Cesium's bundled offline Natural Earth II imagery + ellipsoid terrain |
| Liquid-glass search form (`TripSearchForm`) | Active | 2026-08-05 | Claude | Replaces the old plain white home-page form; floats over the globe |
| Cinematic camera flight on search (`useCesiumViewer.flyTo`) | <details><summary>Eliminated 2026-08-05 (Claude)</summary>Folded into the gift-box choreography below — the flight now happens after preferences are submitted, not immediately on destination resolve</details> | 2026-08-05 | Claude | |
| Split-view Trip Dashboard (`TripDashboard`) | Active | 2026-08-05 | Claude | Home page only, shown once itinerary generation completes: globe (with POI billboards) on one side, existing `BudgetBar`/`DayList`/`FeedbackLoop` on the other |
| POI billboards on the globe, hover-synced with `DayList` | Active | 2026-08-05 | Claude | Reuses the existing `${dayIndex}-${stopIndex}` hover-key convention so hovering a stop highlights the same pin on both the Leaflet map (saved-trip view) and the globe (home page) |
| "← New search" back action | Active | 2026-08-05 | Claude | Resets trip state to `IDLE` and flies the camera back out to a global view, resuming auto-rotation |
| `useTripState` state machine | <details><summary>Eliminated 2026-08-05 (Claude)</summary>Replaced by the 5-status version below (`IDLE`/`SEARCHING`/`PREFERENCES`/`GENERATING`/`DASHBOARD_ACTIVE`) — the old `FLYING` status conflated two things ("destination resolved" and "camera moving") that the gift-box choreography needed to happen at different times</details> | 2026-08-05 | Claude | |
| `useTripState` 5-status state machine (`IDLE`/`SEARCHING`/`PREFERENCES`/`GENERATING`/`DASHBOARD_ACTIVE`) | Active | 2026-08-05 | Claude | Orchestrates the home page: form submit → geocode (`SEARCHING`) → preferences interactive, box open (`PREFERENCES`) → box closes, camera pans then flies, itinerary POST concurrently (`GENERATING`) → dashboard (`DASHBOARD_ACTIVE`). `page.tsx` derives the 2D gift box's visual state directly from `status` |
| 3D Cesium gift-box choreography | <details><summary>Eliminated 2026-08-05 (Claude)</summary>The 3D primitive box (base + hinged lid, opening upward) looked distorted and its lid overlapped/obscured the preferences panel's chip text. Replaced by a plain 2D SVG box below</details> | 2026-08-05 | Claude | |
| 2D unboxing container (`GiftBox2D`) | <details><summary>Renamed/expanded 2026-08-05 (Aryan)</summary>Renamed to `UnboxingContainer` and grown from a single fixed box into 4 destination-themed containers below</details> | 2026-08-05 | Claude | |
| `UnboxingContainer` — 4 destination-themed containers (`classic_box`/`vintage_envelope`/`travel_trunk`/`furoshiki_wrap`) | Active | 2026-08-05 | Aryan | Theme (container type, title, primary color, icon) picked by a small dedicated Claude call (`GET /api/container-theme`, see `backend.md`) based on destination culture/geography — decorative and non-blocking, falls back to `DEFAULT_CONTAINER_THEME` (`classic_box`) on any failure. Each container type has its own distinct "opening" motion: box lid hinges open, envelope flap flips up, trunk lid lifts like a chest, furoshiki knot unties and the cloth corners peel back |
| Glassmorphism on the classic box container | Active | 2026-08-05 | Claude | The literal "cardboard box" theme (`ClassicBox`) got a frosted-glass treatment: translucent fills (`withAlpha` helper) instead of solid colors, light `rgba(255,255,255,0.55)` borders on each face, and a glossy diagonal highlight sweep. Since the container floats directly over the live globe canvas with nothing else behind it, the translucent fill lets that motion genuinely show through rather than faking it with a backdrop-blur (which doesn't reliably apply to SVG shapes). Scoped to the classic box only — the other 3 themes are paper/wood/cloth and a glass look wouldn't fit them |
| Motion/action lines on the preferences-card bubble collapse | Active | 2026-08-05 | Claude | 8 radiating speed-line accents fade in/out and travel downward in lockstep with the collapsing card (same spring transition) as it shrinks into the gift box on "Generate"/"Skip" |
| Camera panning shot (`useCesiumViewer.panTo`) | Active | 2026-08-05 | Claude | On "Generate"/"Skip", before the existing destination `flyTo`, the camera does a fixed-position pan: heading/yaw rotates in place (via great-circle bearing to the destination) to frame it, with camera position untouched (a "tripod" shot, not a zoom) — then `flyTo` reuses that same heading so the following descent doesn't snap to a different angle |
| `TripSearchForm`/`PreferenceStep` card-collapse + bubble-collapse animations (Framer Motion) | Active | 2026-08-05 | Claude | Submitting the search form collapses it (`scale:0, opacity:0`). `PreferenceStep`'s chips float in on mount with a fixed staggered offset (no per-frame position tracking needed now that the box is a simple fixed DOM element). On "Generate"/"Skip" the *entire* preferences card shrinks into a bubble (`scale:0`, `borderRadius:999`, translate down, fade) before the callback actually fires — replaced the earlier per-chip implosion, which no longer made sense once the box moved out of the 3D scene |
| `TripDashboard` sidebar slide-in (`x: "100%" → "0%"`) | Active | 2026-08-05 | Claude | Spring transition on the itinerary panel specifically, independent of the outer fade-in already on the dashboard's parent `motion.div` |
| Quick destination chips in `TripSearchForm` (Kyoto/Tokyo/Paris/Bali, one flagged 🔥 trending) | Active | 2026-08-05 | Aryan | Click populates the Destination field; no new state needed, just `setDestination` |
| Pin decluttering on the globe via Cesium `EntityCluster` | Active | 2026-08-05 | Aryan | POIs moved from `viewer.entities` into a dedicated `CustomDataSource` with `.clustering.enabled = true` — clustering only applies to entities that belong to a DataSource, not the default collection |
| Adaptive header contrast (`PageHeader` `variant="adaptive"`) | Active | 2026-08-05 | Aryan | Home page only. Samples the globe canvas under the "TripMate" title; dark backdrop → white text + shadow, light backdrop (terrain) → dark text in a `backdrop-blur-md` capsule badge |
| Floating top capsule ("← New search" + live budget) in `TripDashboard` | Active | 2026-08-05 | Aryan | Centered, elevated above both the map and list halves; text goes red when over budget, matching `BudgetBar`'s color language |
| Wizard seeds from the saved traveler profile | Active | 2026-08-16 | Zaid | Durable answers pre-fill on mount. Defaults only — the wizard always wins, and any failure falls back to the hardcoded defaults. No longer written back after generate — see the "Four-screen plan wizard" row below; `/profile` and the onboarding card are the only writers |
| `GenerationLoader` streams real per-stage progress | Active | 2026-08-16 | Zaid | Five real stages (geocode/context/generate/critique/placing) replace the old fixed 5-caption loop; captions rotate per-stage from `generationStages.ts`, sr-only text announces stage transitions |
| Four-screen plan wizard + "Adjust for this trip" | Active | 2026-08-16 | Zaid | Basics/purpose/group/pois only; explorer style, energy, crowds, tier and priorities sit behind one expander on basics fronted by a summary of the values in effect. One expander, never one per field — that is what keeps the worst case below the seven screens it replaced |
| `/profile` page | Active | 2026-08-16 | Claude | Owns the durable traits, reusing the wizard's own pickers. Surfaces save failures, unlike the onboarding card. Content now sits in a `.profile-glass` panel — a cobalt/teal frosted-glass variant of `.glass-itinerary` reusing Blue Hour's `--scene-cobalt-rgb`/`--scene-teal-rgb` tokens without retinting `--accent`, so pickers/Save stay amber — wrapped in a `<main>` with the standard centred-column nav clearance (it previously had none, reading as blended into the navbar) and `map-chrome-hidden` (zoom/2D-3D/tilt/compass have nothing to act on here) |
| Onboarding card on the result screen | Active | 2026-08-16 | Zaid | Offered once after the first trip, pre-filled with the answers just given plus dietary needs. Dismissing costs nothing |
| Delete a saved trip from `/trips` | Active | 2026-08-17 | Claude | Trash button on each postcard, hidden until the card is hovered or focused (and always visible under `@media (hover: none)`, since a hover-only control is unreachable on touch). It is a *sibling* of the postcard `<Link>`, never a child — HTML forbids interactive content inside an `<a>` — inside a `.memory-postcard-slot` wrapper that owns the reveal. Failures surface in their own `deleteError` state, not the page's fatal `error`, which early-returns a page with nothing but the message and would blank the very grid being reported on |
| `ConfirmDialog` shared component | Active | 2026-08-17 | Claude | The app's first modal, on the native `<dialog>` + `showModal()` rather than a hand-rolled overlay: focus trap, Esc, background `inert` and top-layer rendering all come free. Top-layer promotion only changes *paint* order, not the DOM tree — the dialog still renders as a child of AppShell's `pointer-events-none` content overlay and inherits it, so `.confirm-dialog` needs its own explicit `pointer-events: auto` same as everything else in that overlay (the Pointer-Events Opt-In Rule applies here too). Shipped once without it: every button inside was unclickable by a real pointer, but a programmatic `.click()` bypasses hit-testing and doesn't reveal that, which is how it went unnoticed until a real click was tried. Tailwind's preflight also zeroes the UA `margin: auto` that centres a modal dialog — `.confirm-dialog` restores that too, without which the panel renders hard against the top-left corner |
| `/bench` — dev-only model benchmark page | Active | 2026-08-17 | Claude | Server-component `notFound()` gate on `NODE_ENV`, same as `/backend/pipeline`. Not linked from any nav. Charts are hand-rolled SVG in `components/bench/charts.tsx` — no charting library was added; palette is validated categorical slots 1-3 (worst all-pairs CVD ΔE 9.2), with direct labels + a raw-numbers table as the documented contrast relief |
| Weighted flight-path progress in `GenerationLoader` | Active | 2026-08-17 | Claude | Replaces the five equal stage dots. Segment widths come from `STAGE_SECONDS` (kept beside `STAGE_ORDER`, with a test asserting matching keys) because the stages are wildly unequal — `generate` is ~95 of ~150 nominal seconds, so equal segments parked the indicator at 20% for a minute and a half, which reads as a hang. Inside the running stage the fill advances on `1 - exp(-t/tau)`, which structurally cannot complete a segment before the real `done` event arrives. `generationProgress()` is pure and unit-tested for monotonicity across a replay of the runner's real emission order, including the deliberate `context`/`geocode` overlap. Written to a CSS custom property through a ref at 10Hz rather than React state; `setInterval` not rAF, because rAF pauses in background tabs and returning to a frozen bar is the exact failure this exists to remove |
| Orbiting destination facts during generation | <details><summary>Eliminated 2026-08-17 (Claude)</summary>Two off-screen wheels carried the facts on arcing, tilted cards. Cut after a critique: text a person must read cannot move (the dwell was tuned 75px/s → 28px/s, optimising the wrong axis — the correct speed is zero); it was a WCAG 2.2.2 Level A failure with no pause/stop/hide and left magnification users unserved; and it broke DESIGN.md's own One Ambient Loop Rule with three stacked loops per card on four  cards outside . Simulation also found two bugs reading the code had not: with a pool of 3–4 every slot showed one fact forever, and on mobile the hidden wheel's frozen slots stayed in the exclusion set so two facts could never appear. Replaced by the static row below</details> | 2026-08-17 | Claude | |
| Destination facts during generation | Active | 2026-08-17 | Claude | True, trip-specific facts in a staggered stack beneath the caption: one card square-on and readable, neighbours fanned out either side, dimmed and tilted. Auto-advances every 7s and can be steered with arrows or by clicking a card forward; taking control resets the timer. **The front card is completely still while it is read** — motion happens only on a discrete advance, which is the whole distinction from the orbiting version it replaced and why a reader can stop the rotation by using it. Adapted from a stagger-testimonial pattern with its neobrutalist skin left behind (notched clip-path corners, hard block shadows) in favour of this system’s glass. Position comes from a cursor + modulo rather than a shifted array, because the pool grows mid-wait as the context and Wikipedia extract resolve; the fan narrows below five facts so no sentence renders twice at different depths. Also adds a line above the disc naming the trip (`Kyoto · Sep 19 – 22 · Mid-range`) — the plan form unmounts during generation, so nothing else said which trip was being built. **No model call**: `buildDestinationFacts` (pure, type-only imports, unit-tested) derives everything from data already fetched and never fabricates. Renders *outside* the `role="status"` region so a screen reader can reach the facts without their being announced |
| Cancel during generation | Active | 2026-08-18 | Claude | The wait had no exit: the form unmounts, the surface is pointer-events-none, and the only way out was a reload that destroys the run — so the most anxious user was the one most likely to kill a call that was nearly finished. A ghost Cancel appears after 10s (delayed so it never flashes on a fast path), aborts the fetch via AbortController, and returns to the form with every answer intact. An AbortError is deliberately not surfaced as an error: the user asked for this, and reporting their own decision back as a failure would be wrong. **Known limitation:** aborting the fetch closes the connection but does not kill the server-side  subprocess, so the model call still runs to completion — wiring the request signal through  to  is the follow-up |

## Enhancements

| Enhancement | Since | Developer | Notes |
|---|---|---|---|
| Landing `Hero` rebuilt with zero per-frame JS; globe render loop paused while covered | 2026-08-19 | Claude | A Chrome trace of a real session showed every scrolling frame resolving on the main thread (`SCROLL_MAIN_THREAD` on 1688 of 3426) rather than the compositor — frames were late, not dropped (2.1%). `Hero` lost all five infinite GSAP tweens, the `pointermove` cursor parallax and its `[perspective:2300px]`, and now runs no JS at all: the one ambient loop is `.hero-light` (a warm wash on `--accent` translated across the still photograph), the three fog banks are static, and the scroll cue's fade is the app's first `animation-timeline: scroll()` behind `@supports`. Fog lost `filter: blur()` and `will-change` — a moving blurred layer re-rasters forever — with the softness moved into the gradients' own falloff. `HeroPoster` now pauses Cesium's render loop (976ms of that trace, its largest entry) via IntersectionObserver while the opaque beats cover the globe. Also fixed a latent bug: `[animation-delay:Nms]` generates no CSS here, so this block's documented 0/90/180ms stagger had never run |
| Full visual theme pass: warm `stone`/`orange` palette, consistent `rounded-xl`/`rounded-lg` + `shadow-sm` card system, input focus rings | 2026-08-05 | Aryan | Replaced plain `gray`/`white`/ad-hoc-radius styling |
| `BudgetBar` uses green when under budget, red when over | 2026-08-05 | Aryan | Previously always orange regardless of budget status |
| Page `<title>`/description fixed to "TripMate" copy | 2026-08-05 | Aryan | Was still the default "Create Next App" boilerplate |
| Geist font actually renders | 2026-08-05 | Aryan | Was loaded via `next/font` but silently overridden — see Bugs |
| `DayList` day cards get a soft sky-blue tint on high-rain (≥50%) or extreme-temperature days | 2026-08-05 | Aryan | Derived client-side from `weatherDetail`, no new model-authored field needed |
| `DayList`/`ItineraryMap` prop signatures grew (`budget`, `hoveredStop`, `onHoverStop`) | 2026-08-05 | Aryan | Both `src/app/page.tsx` and `src/app/trip/[id]/page.tsx` updated to pass them through |
| Added `lucide-react` dependency | 2026-08-05 | Aryan | Used by `WeatherIcon` |
| `PreferenceStep` restyled to the `.glass-panel` treatment | 2026-08-05 | Claude | It's only ever rendered floating over the home page globe now, alongside `TripSearchForm` |
| Added `cesium` and `framer-motion` dependencies | 2026-08-05 | Claude | `cesium` needs its static Workers/Assets/ThirdParty/Widgets copied into `public/cesium` — see `scripts/copy-cesium-assets.mjs`, wired as a `postinstall` |
| `TripSearchForm` relayout: vertical centered card → wide, top-aligned horizontal glass bar (`bg-slate-900/60 backdrop-blur-xl border-white/10 shadow-2xl`), fields laid out inline on desktop (destination / start / end / budget / CTA) | 2026-08-05 | Aryan | Home page search step in `page.tsx` also moved from vertically-centered to top-aligned (`pt-2 md:pt-6`, no forced `min-h`) so the globe stays the unobscured hero backdrop instead of being covered by a centered card |
| `TripSearchForm` typography/contrast pass: heading gets a text-shadow for legibility over bright globe imagery, subheading bumped to `text-white/85`, labels to `rgba(240,240,240,0.9)`, inputs to `bg-slate-900/65` + `border-white/15` + `focus:border-orange-500/80` + `placeholder:text-white/40` | 2026-08-05 | Aryan | |
| "Plan My Trip" CTA upgraded to a gradient button (`from-orange-500 to-amber-600`) with hover scale/brightness and a glowing orange shadow | 2026-08-05 | Aryan | Previously a flat `bg-orange-600` button |
| `useCesiumViewer` gained `sampleAverageColor()`, and the viewer now sets `contextOptions: { webgl: { preserveDrawingBuffer: true } }` | 2026-08-05 | Aryan | Draws the WebGL canvas onto an offscreen 2D canvas and averages a small box via `getImageData` — needed for adaptive header contrast. `preserveDrawingBuffer` is required or the buffer is cleared before any readback sees it |
| `PageHeader` gained `variant`/`isDark` props | 2026-08-05 | Aryan | Defaults to the existing `"light"` behavior everywhere except the home page, which opts into `"adaptive"` — zero risk to `/trips`, `/trip/[id]`, `/llm-trace` |
| `BackButton` shared component; `/profile` gains a back control; "Refine with AI" moved to the top of both result panels | 2026-08-16 | Claude | The chevron + ghost-pill markup lived inline in `PlaceDetailPanel`; extracted once `/profile` needed the third copy. `/profile` pops history (`router.back()`, falling back to `/`) rather than linking a fixed destination, since it's reachable from both `/` and `/trip/[id]`. Refine moved off the panel foot, where it sat under the `LlmTraceFab` and behind a full scroll of a long trip — it now shares the home result view's existing Back row, and sits above the card on `/trip/[id]`, which has no such row |

## Bugs

| Bug | Found | Fixed | Developer | Notes |
|---|---|---|---|---|
| `body { font-family: Arial }` in `globals.css` overrode the Geist font that was loaded via `next/font`, so the custom font never actually rendered | 2026-08-05 | 2026-08-05 | Aryan | Removed the hardcoded override, wired `font-family` to the `--font-sans` variable instead |
| `eslint-plugin-react-hooks`'s `static-components` rule flagged `WeatherIcon` for "creating a component during render" | 2026-08-05 | 2026-08-05 | Aryan | Was picking a Lucide icon component reference and using it as a dynamic JSX tag; refactored to a `switch` returning an explicit icon element per condition instead |
| `TripDashboard`'s right (list) panel rendered as a sliver a few pixels tall instead of half the viewport | 2026-08-05 | 2026-08-05 | Aryan | Its `absolute inset-0` root had nothing to size against — the wrapping `motion.div` in `page.tsx` had `relative z-10` but no explicit height, and CSS auto-height ignores out-of-flow descendants. Changed the wrapper to `absolute inset-0` itself |
| Adaptive header contrast stayed white-on-light-terrain | 2026-08-05 | 2026-08-05 | Aryan | Two compounding issues: (1) sampling the header bar's exact horizontal center landed on the map/panel seam once the dashboard splits the screen, blending both sides together — moved the sample point to sit under the title specifically; (2) the luminance threshold (150) was miscalibrated against this imagery, where empirically deep space ≈ 4 and any visible terrain/ocean ≈ 140-190 — lowered to 110 |
| `eslint-plugin-react-hooks`'s `set-state-in-effect` rule flagged `LlmTraceFab`'s list/detail fetch effects | 2026-08-06 | 2026-08-06 | Aryan | List view: was calling `setLoading(true)` redundantly at the top of a mount-once effect — initial state was already `true`, just deleted the line. Detail view: was resetting `trace`/`error` to `null` synchronously before each fetch when `id` changed — switched to `key={selectedId}` on the component instead, so switching traces remounts it with fresh state rather than an in-effect reset |

## Eliminated

<details><summary>Per-page duplicated header markup — Eliminated 2026-08-05 (Aryan)</summary>

Each of the three pages (`/`, `/trips`, `/trip/[id]`) had its own inline
`<div className="flex items-center justify-between">` header block with
slightly-diverging classnames. Replaced by the shared `PageHeader` component.

</details>

<details><summary>Single-step "fill form → generate immediately" flow — Eliminated 2026-08-05 (Aryan)</summary>

Submitting the trip form used to call `/api/itinerary` directly. Replaced by a
two-step flow: submitting the form now shows the `PreferenceStep`, which is
what actually triggers generation (or skips straight to it with no
preferences, functionally identical to the old behavior).

</details>

<details><summary>Plain-text weather label in DayList — Eliminated 2026-08-05 (Aryan)</summary>

Each day card used to show `day.weather` (the model's free-text summary) as a
plain `<span>`. Replaced by `WeatherPopover`, which shows a dynamic icon +
temperature range and expands to a detail panel — falling back to the same
plain text only when structured `weatherDetail` isn't available.

</details>

<details><summary>Plain white 2-column trip form + `ItineraryMap` on the home page — Eliminated 2026-08-05 (Claude)</summary>

The home page (`/`) used to open straight onto a plain white form, and render
results with the Leaflet-based `ItineraryMap`. Replaced by the 3D Cesium globe
landing/dashboard experience: `TripSearchForm` (glass form over the globe) →
`PreferenceStep` (now also glass) → `TripDashboard` (globe + itinerary panel
split view). `ItineraryMap`/Leaflet is untouched and still active on
`/trip/[id]` (saved-trip view) — this only replaced the home page's map.

</details>

<details><summary>`/llm-trace` + `/llm-trace/[id]` pages, and the "LLM trace" header nav link — Eliminated 2026-08-06 (Aryan)</summary>

The trace viewer was a separate section of the app: a nav link in `PageHeader`
to a `/llm-trace` list page, which linked to `/llm-trace/[id]` detail pages.
Replaced by `LlmTraceFab` — a persistent bottom-right icon (mounted once in
the root layout, so it's on every page without a nav link) that expands into
a panel showing the same list/detail views inline, with a collapse button
back to just the icon. The underlying data/API routes
(`/api/llm-traces`, `/api/llm-traces/[id]`) are unchanged — this only changed
how they're presented. See `.claude/skills/dev-analytics-fab/SKILL.md` (what
to put in a widget like this) and `.claude/skills/floating-widget-ui/SKILL.md`
(the FAB/panel UI pattern itself) for the general patterns this follows.

</details>
