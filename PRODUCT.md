# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router, TypeScript) + Tailwind CSS. SQLite (`better-sqlite3`) for persistence, no accounts/auth. Itinerary and place-detail generation both run through the local Claude CLI (Haiku) instead of a metered LLM API. Map is a persistent, full-viewport 3D globe: CesiumJS + Google's Photorealistic 3D Tiles (via a free Cesium ion account/token, no Google Cloud billing account required — this was a deliberate choice over Google's native `gmp-map-3d` component, which mandates a billed GCP project). Weather via Open-Meteo. The project moved from a 3-hour hackathon build to an ongoing personal project, so later choices (Cesium, the visual redesigns) accept more setup/complexity than the original build did, but still avoid mandatory billing where a free alternative exists.

## Users

A traveler planning an upcoming trip: enters a destination, date range, and total budget, and wants a realistic day-by-day plan back, not a generic checklist. Same person may later revisit the plan while actually traveling to track real spending against it.

## Product Purpose

TripMate turns a destination + dates + budget into an AI-generated day-by-day itinerary (stops, lodging, weather-aware activity choices) that actually reflects the traveler's intended spending level, then lets them refine it conversationally, save it, and revisit it later — including tracking real spend against the plan while traveling.

## Positioning

Most trip planners either hand back generic top-10 lists or ignore the budget entirely. TripMate anchors generation to a chosen spending tier (Budget/Mid-range/Luxury) with real lodging costs included, explicitly instructs the model to spend close to the stated budget rather than lowballing it, and folds live weather into stop selection (indoor vs. outdoor by day). The screen is one persistent scene rather than a dashboard: a full-bleed, always-live 3D globe that physically flies to your destination and to each place you tap, with the itinerary — real times, durations, tag pills, per-day category budget breakdowns — floating above it as dark frosted glass, never a separate opaque pane. Tapping a stop swaps in a real guidebook-style entry instead of a one-line description. It is also the only one of its kind to route generation through the user's own Claude Code CLI session instead of a paid LLM API.

## Operating Context

Two distinct moments of use: (1) planning — fill in trip details, pick a spending tier, generate, give feedback and regenerate until satisfied, save; (2) during-trip — revisit the saved trip, click a stop to fly the map to it and open a detailed guidebook-style view (history, best time to visit, tips), and log actual spend per stop/lodging so the remaining days can be rebalanced if a day runs over.

## Capabilities and Constraints

- No user accounts — trips are stored in a single shared local SQLite file, addressable by a generated id/URL, not scoped per-user.
- Itinerary, place-detail, and place-photo lookups all depend on external services being reachable (`claude` CLI for the first two; Wikipedia's public API for photos) — there is no fallback LLM provider, and a photo miss falls back to a category icon rather than failing.
- Weather is a real forecast within ~16 days of the trip start, otherwise a "typical weather" estimate from the same calendar dates a year prior.
- Trip length is capped at 30 days, enforced both client-side (before generation is attempted) and server-side (the generation endpoint itself rejects a longer range) — no LLM call is ever attempted for a longer trip.
- Screen layout is a persistent full-bleed 3D globe (Cesium + Google Photorealistic 3D Tiles) with every other surface — itinerary, place detail, forms, saved-trip list — floating above it as a translucent glass panel, not a separate opaque pane; the panel and the globe occupy the same screen space rather than splitting it. Google's tiles are regional/city-scale data, so the whole-earth idle view has little to render and isn't meant to look like a polished "Blue Marble" globe.
- On phones, the glass panel can collapse to a bottom sheet, revealing a reduced map control set (zoom, compass/reset-north) in the space it frees; the full control set (zoom, 2D/3D, tilt, compass) is desktop/tablet-only.
- Real per-stop/lodging "actual spend" tracking and automatic remaining-day rebalancing on overspend are shipped, working end-to-end.
- Per-place detail content (history, best time to visit, tips, duration) and per-stop photos are both generated/fetched on-demand only when a stop is clicked/rendered, not persisted — reopening the same stop regenerates the detail text (photos are cached in-memory per browser session).

## Brand Commitments

Product name is "TripMate." No logo — a drawn six-point asterisk mark beside the wordmark, no wordmark
lockup beyond that.

The visual identity is "Kiln", shipped 2026-09-08 and documented in DESIGN.md: a warm near-neutral
near-black ground with translucent glass floating over the persistent globe, and **three named colour
roles rather than one accent** — jade for action, gold for money, coral for alert. Edges follow one
rule: round what you touch, square what you read.

**The type system is Melodrama + Switzer + Tabular, shipped 2026-09-09**, replacing the Wix Madefor
superfamily Kiln launched with. See DESIGN.md § Typography; the short version is a high-contrast
display serif at a single light weight against a neutral grotesk, with the landing price re-set as
the serif's own moment rather than as a monospace figure.

**Standing preference, recorded because it governs future design work: the arrangement is
conventional on purpose.** Offered a choice between four distinct visual worlds and the category
standard played straight, the user chose the standard. So this product competes on execution rather
than on concept: a photo hero, a marketing scroll page, a search capsule in the first viewport. Do
not "differentiate" the arrangement on a later pass — sharpen the execution instead. **That
instruction stands. The bar it is measured against has moved.**

**The craft bar is now Aman, Belmond, Loro Piana and Aesop — not Airbnb and Vercel.** Changed
2026-09-09 at the user's direction, and the distinction is the whole point: Airbnb and Vercel are a
bar for *competence*, and the build cleared it while still reading as well-made SaaS. The luxury
references are a bar for *restraint* — fewer weights, more space, a figure treated as the subject
rather than as metadata.

**One tension, stated once so nobody resolves it by accident.** This product's thesis is budget
realism — "a trip that costs what you said it would", with a $900 Jaipur plan on the landing.
Luxury *language* on a budget-honest product reads as a mismatch, and chasing expensive would be the
wrong move. The target is **considered**: precision, restraint, material quality. Every reference
above is on the list for restraint, not for price.

Kiln superseded three earlier looks: a steel-blue glass treatment, a warm cream/teal split-pane
system, and "The Lit Cockpit Over a Turning Earth" (teal-black, one amber accent, a single Archivo
face). The last of those had its palette, root scale, type system and several landing devices
measured off an external reference site and adopted verbatim; replacing that layer is what Kiln is
for, and `docs/design-history.md` records it.

Treat DESIGN.md, not this section, as the source of truth for anything visual; this section exists
only to record that the identity is settled, not in progress.

## Evidence on Hand

No real user content, testimonials, or case studies. All itinerary content shown during development (e.g. Kyoto examples) is live LLM-generated output, not fixture/sample data to preserve.

## Product Principles

- Budget realism over generic optimism: the plan should cost what the traveler said they want to spend, not the cheapest defensible itinerary.
- Weather and place are inputs to the plan, not decoration — they should visibly change what gets suggested.
- Refinement is a conversation, not a form: feedback in plain language should visibly change the next version of the plan.
- Keep the stack dependency-light and signup-free wherever a free/local alternative exists (no paid API keys, no accounts).
