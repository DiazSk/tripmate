# TripMate — Project Crux

The single-page source of truth for what this project *is*. Detailed, living
trackers for each layer live in their own doc — this page just orients you and
rolls up the timeline across all of them.

| Doc | Covers |
|---|---|
| [`backend.md`](./backend.md) | API routes, SQLite storage, weather lookup |
| [`frontend.md`](./frontend.md) | Pages, components, theme |
| [`llm.md`](./llm.md) | Prompting, the `claude` CLI integration, trace logging |
| [`system-design.md`](./system-design.md) | Diagrams for the preference step + LLM trace viewer |
| [`itinerary-quality.md`](./itinerary-quality.md) | Rubric audit of plan quality, and what's data-blocked |
| [`branch-comparison-globe-and-llm.md`](./branch-comparison-globe-and-llm.md) | `dev-aryan` vs `feat/ui-optimization` — the two overlapping globe/LLM implementations, and which evidence backs which |

## What it is

TripMate is a Next.js app that plans a day-by-day trip itinerary: you give it a
destination, dates, and a budget (optionally a vibe/interest preference) via a
liquid-glass form floating over a 3D CesiumJS globe, it calls Claude to
generate a plan, overlays real weather, and renders it as a split-view
dashboard (3D map + budget bar + day-by-day list). Itineraries can be refined
with free-text feedback and saved to a local SQLite database, where they're
viewable later via a Leaflet-based map at `/trip/[id]`.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS v4, `framer-motion` |
| Map | Leaflet / react-leaflet (saved-trip view at `/trip/[id]`) |
| 3D globe | CesiumJS (home page only) — ion world imagery/terrain if `NEXT_PUBLIC_CESIUM_ION_TOKEN` is set, else bundled offline Natural Earth II + ellipsoid terrain |
| Storage | SQLite via `better-sqlite3` (requires Node ≥ 22) |
| LLM | `claude` CLI, spawned as a one-shot subprocess (Sonnet 5, no tools) |
| Weather | Open-Meteo geocoding + forecast |

## How to maintain the tracker docs

Each of `backend.md` / `frontend.md` / `llm.md` has three tables: **Features**,
**Enhancements**, **Bugs** — each with a **Developer** column. The convention:

- **New feature** → add a row with a `Since` date and the `Developer` who
  built it.
- **Feature grows/tweaks but is still the same thing** → just edit its row in
  place (e.g. update its Notes). No new row, no date churn. If someone else
  picks up the tweak, that's fine to note, but the `Developer` cell stays
  whoever owns/built the feature unless it's a full rewrite (see below).
- **Feature is completely replaced/removed** (not just tweaked) → collapse its
  `Status` cell into a `<details>` dropdown reading `Eliminated` with the date
  and what replaced it, e.g.:

  ```md
  <details><summary>Eliminated — 2026-08-05 (Aryan)</summary>Replaced by PageHeader component</details>
  ```

  Then add the replacement as its own new row with its own `Since` date and
  `Developer`.
- **Bugs** get `Found` and `Fixed` dates in the same row once resolved, plus
  whoever fixed it in `Developer`.

Current contributors: **Aryan**, **Zaid**, **Claude**. Everything logged so far
was built by Aryan — new rows added by Zaid, Claude, or anyone else should
carry their own name in the `Developer` column rather than defaulting to Aryan.

## Timeline (rolled up across all three docs)

| Date | Area | Developer | What happened |
|---|---|---|---|
| 2026-08-04 | Project | Aryan | Initial scaffold: trip form, itinerary generation via `claude` CLI, weather overlay, SQLite trip storage, map/budget/day-list UI, refine-and-save loop |
| 2026-08-04 | Backend | Aryan | Fixed: `better-sqlite3` native binding requires Node ≥ 22, silently crashed dev server on Node 20 |
| 2026-08-04 | LLM | Aryan | Fixed: `claude` CLI not resolvable via PATH → `spawn ENOENT` on every generate call |
| 2026-08-05 | Frontend | Aryan | Full visual theme pass (warm palette, consistent spacing/radius/shadow system, shared `PageHeader`) |
| 2026-08-05 | Frontend, LLM | Aryan | Added preference/vibe step (trending tags + vibe chips + skip) feeding into prompt generation |
| 2026-08-05 | Backend, LLM | Aryan | Added LLM trace logging (`llm_traces` table) + `/llm-trace` viewer pages |
| 2026-08-05 | Frontend, Backend, LLM | Aryan | Daily card UI/UX pass: dynamic weather icons + detail popover (real forecast data, not model text), rain/extreme-temp card tint, per-day budget progress bar, hover-to-highlight between day list and map pins, model-written daily narrative summary |
| 2026-08-05 | Frontend, Backend | Claude | Rebuilt the home page as a 3D CesiumJS globe experience: liquid-glass `TripSearchForm`/`PreferenceStep` float over a continuously-rotating globe; submitting resolves the destination via the new `GET /api/geocode` and flies the camera to a cinematic oblique view; once `/api/itinerary` resolves, the form animates out and a split-view `TripDashboard` (globe with POI billboards + existing `BudgetBar`/`DayList`/`FeedbackLoop`) animates in; a back action resets the camera to a global view. Only touches the home page — `/trip/[id]` and `/trips` are untouched |
| 2026-08-05 | Frontend | Aryan | Dashboard layout/contrast pass on the home page: fixed the split-screen panel collapsing to a sliver (wrapping motion.div had no explicit height), added Cesium `EntityCluster`-based pin decluttering, added canvas-sampling adaptive header contrast (white text over dark backdrops, dark text in a blurred capsule over light terrain), and a floating top capsule combining the "← New search" action with a live, color-coded budget readout |
| 2026-08-05 | Frontend | Claude | Reframed the idle/reset globe camera to a Low Earth Orbit view (Earth's limb across the bottom half of the viewport, deep space above) and added a generic placeholder foreground "spacecraft" (Cesium primitive boxes, camera-relative so it doesn't drift off during idle rotation) — no licensed 3D model used or fetched |
| 2026-08-05 | Frontend | Claude | Fixed Retina/high-DPI blur: `useBrowserRecommendedResolution: false` (the true fix — the default `true` was the cause, not `resolutionScale`, which would double-apply devicePixelRatio if also set) + MSAA + lower `maximumScreenSpaceError`; swapped the no-ion-token fallback imagery from Cesium's low-res bundled Natural Earth II to free OpenStreetMap raster tiles for a real sharpness improvement, and zoomed the idle camera out slightly |
| 2026-08-05 | Frontend | Claude | Rebuilt the search→generate transition as a multi-stage gift-box choreography: submitting collapses the search card and opens a screen-center gift box (generic Cesium-primitive placeholder — no glTF asset available/sourced); preference chips float in from the box and implode back into it on submit; the box then closes with a bounce before the camera flies to the destination (`CUBIC_IN_OUT`, 3s) concurrently with the `/api/itinerary` call; on arrival the lid pops off, pins burst in with a staggered scale animation, and the dashboard's itinerary panel slides in from the right. Reworked `useTripState` from 4 to 5 statuses (`IDLE`/`SEARCHING`/`PREFERENCES`/`GENERATING`/`DASHBOARD_ACTIVE`) to give each stage a distinct moment |
| 2026-08-05 | Frontend | Claude | Bug-fix pass on the above: the 3D gift box looked distorted and its lid overlapped/obscured the preferences panel's chip text, so it's now a plain 2D SVG (`GiftBox2D`) pinned to the viewport's bottom-center, with its open/closed/hidden state derived straight from `useTripState.status` instead of imperative Cesium calls — this also let `useCesiumViewer` drop the entire 3D gift-box implementation. The lid's two halves slide apart sideways instead of tilting up. The preferences card's submit animation changed from per-chip implosion to the whole card shrinking into a bubble (`scale:0`, `borderRadius:999`, translate down, fade). Added a camera panning shot (`useCesiumViewer.panTo`): before the destination `flyTo`, the camera rotates its heading in place (great-circle bearing to the destination, position untouched — a tripod pan, not a zoom), then `flyTo` reuses that same heading so the subsequent descent doesn't snap |
| 2026-08-05 | Frontend | Claude | Second bug-fix pass on the gift box: moved it from bottom-center to true viewport center; replaced the sideways-sliding two-half lid with a single lid hinged at its top-right corner (`rotate:-35deg`, pivot at that corner) that lifts open on the left; gave it proper amber/red "flat 3D" shading, a ribbon bow, and burst/sparkle accents (matching a reference image) instead of the earlier flat two-tone blocks. Added radiating motion/action lines to the preferences card's bubble-collapse animation, sharing the card's own spring transition so they travel down with it rather than staying pinned in place |
| 2026-08-05 | Frontend, Backend | Aryan | Renamed the gift box to `UnboxingContainer` and expanded it into 4 destination-themed containers (classic box, vintage envelope, travel trunk, furoshiki wrap), each with its own opening motion; the theme (type/title/color/icon) is picked by a small dedicated Claude call (`GET /api/container-theme`), decorative-only and falling back to a default box on any failure |
| 2026-08-05 | Frontend | Claude | Gave the classic box container a glassmorphic look (translucent frosted-glass fills, light borders, glossy highlight sweep) — scoped to that one theme only, since the other 3 are paper/wood/cloth materials a glass treatment wouldn't suit |
| 2026-08-06 | Frontend | Aryan | Added the `dev-analytics-fab` skill — a pattern for picking what belongs in a floating developer/analytics widget based on what an app actually does — then applied it: replaced the `/llm-trace` pages and header nav link with `LlmTraceFab`, a bottom-right icon that expands into a list/detail panel with a collapse button, mounted once in the root layout |
| 2026-08-06 | Frontend | Aryan | Split the FAB's UI mechanics out of `dev-analytics-fab` into its own skill, `floating-widget-ui` (`.claude/skills/floating-widget-ui/SKILL.md`) — the icon/expand/collapse/list-detail pattern is identical regardless of what content a given FAB shows, so it's reusable for non-analytics floating widgets too (chat, notifications, help, cart). `dev-analytics-fab` now only covers content selection and links to this for the "how to build it" half |
| 2026-08-16 | Frontend, Backend, LLM | Zaid | Traveler profile: the plan wizard's answers now reach the model — the route read no `userAnswers`, so `deriveFlags`' pace/mobility/crowd/family constraints were computed and discarded. Added `formatTravelerProfile` (own module, so it is testable) feeding generate/refine/critique, plus a `traveler_profile` table carrying `owner_id` from the first row so authentication can be added later without a migration. Durable answers seed the wizard on a later visit; per-trip answers are still asked fresh |
| 2026-08-16 | Frontend, Backend | Zaid | Generation progress stream: the fixed-caption loader is replaced with real per-stage progress over SSE. `runGeneration()` extracted from the itinerary route into its own module so the plain-JSON and streamed responses share one implementation; opt-in via `?stream=1` keeps every existing caller unmodified |
| 2026-08-16 | Frontend, Backend, LLM | Zaid | Split the plan wizard along durable vs per-trip: four per-trip screens plus one "Adjust for this trip" expander, with the durable traits owned by a new `/profile` page and offered via a dismissible onboarding card after the first trip. Added dietary needs to the profile and the prompts. Removed the automatic post-generate profile write-back so a per-trip override can never become a permanent default |

See each linked doc for the full per-area breakdown.
