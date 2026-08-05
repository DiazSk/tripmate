# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router, TypeScript) + Tailwind CSS. SQLite (`better-sqlite3`) for persistence, no accounts/auth. Itinerary generation runs through the local Claude CLI (Haiku) instead of a metered LLM API. Map via Leaflet/OpenStreetMap. Weather via Open-Meteo. All choices were made to minimize external signup/API-key friction for a hackathon build.

## Users

A traveler planning an upcoming trip: enters a destination, date range, and total budget, and wants a realistic day-by-day plan back, not a generic checklist. Same person may later revisit the plan while actually traveling to track real spending against it.

## Product Purpose

TripMate turns a destination + dates + budget into an AI-generated day-by-day itinerary (stops, lodging, weather-aware activity choices) that actually reflects the traveler's intended spending level, then lets them refine it conversationally, save it, and revisit it later — including tracking real spend against the plan while traveling.

## Positioning

Most trip planners either hand back generic top-10 lists or ignore the budget entirely. TripMate anchors generation to a chosen spending tier (Budget/Mid-range/Luxury) with real lodging costs included, explicitly instructs the model to spend close to the stated budget rather than lowballing it, and folds live weather into stop selection (indoor vs. outdoor by day). It is also the only one of its kind to route generation through the user's own Claude Code CLI session instead of a paid LLM API.

## Operating Context

Two distinct moments of use: (1) planning — fill in trip details, pick a spending tier, generate, give feedback and regenerate until satisfied, save; (2) during-trip — revisit the saved trip, click stops to see them on the map, and (upcoming) log actual spend per stop so the remaining days can be rebalanced if a day runs over.

## Capabilities and Constraints

- No user accounts — trips are stored in a single shared local SQLite file, addressable by a generated id/URL, not scoped per-user.
- Itinerary generation depends on the `claude` CLI being installed and authenticated in the environment running the server; there is no fallback LLM provider.
- Weather is a real forecast within ~16 days of the trip start, otherwise a "typical weather" estimate from the same calendar dates a year prior.
- Map pins are destination-only by default; a specific stop's pin only appears when the user clicks that stop in the itinerary list.
- Real per-stop "actual spend" tracking and automatic remaining-day rebalancing on overspend is an in-progress capability, not yet shipped.

## Brand Commitments

Product name is "TripMate." No existing logo, palette, or typographic identity — the current implementation uses default Tailwind grays and an orange accent with no deliberate visual direction, and is being replaced with a considered one (this is a redesign, not an extension of that look).

## Evidence on Hand

No real user content, testimonials, or case studies. All itinerary content shown during development (e.g. Kyoto examples) is live LLM-generated output, not fixture/sample data to preserve.

## Product Principles

- Budget realism over generic optimism: the plan should cost what the traveler said they want to spend, not the cheapest defensible itinerary.
- Weather and place are inputs to the plan, not decoration — they should visibly change what gets suggested.
- Refinement is a conversation, not a form: feedback in plain language should visibly change the next version of the plan.
- Keep the stack dependency-light and signup-free wherever a free/local alternative exists (no paid API keys, no accounts).
