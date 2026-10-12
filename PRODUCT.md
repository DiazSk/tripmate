# Product

<!-- impeccable:product-schema 1 -->

## Platform

web, ios, android

## Stack

Next.js (App Router, TypeScript) + Tailwind v4 for the web client and the server every client shares. **SQLite via `libsql`** — a single local `tripmate.db` by default, or a hosted Turso database by setting `TURSO_DATABASE_URL`; the API stayed synchronous through that swap, which is why it was a constructor change rather than a port. Accounts are email and password (Better Auth). Until someone signs in, identity is an owner id in a cookie, and signing in moves that owner's trips, places and profile onto the account.

**A React Native client (`mobile/`, Expo SDK 57 + expo-router) targets iOS and Android from one codebase** and talks to the same REST routes unchanged. It ships the plan wizard end to end, SSE generation with stops appearing as they stream, Keep, a trip screen with map/chat/spend, a memories wall and a profile tab. **The earlier SwiftUI app in `ios/` is frozen rather than deleted** — `ios/TripMateKit` remains the reference both later clients were ported from.

Model calls go through one chokepoint with **two interchangeable transports**: the local `claude` CLI (the default — free under an existing subscription, no key) or the Anthropic API (`LLM_TRANSPORT=api`, used where there is no CLI, i.e. the deployed container). Model choice differs by transport and lives in one file.

**The map has two engines behind one interface, and MapLibre is now the default** — MapLibre GL JS with OpenFreeMap vector tiles, terrain and extruded buildings, deliberately no satellite imagery. CesiumJS + Google Photorealistic 3D Tiles is one flag away and fully wired; it was the original choice, made via a free Cesium ion token specifically to avoid Google's `gmp-map-3d`, which mandates a billed GCP project. MapLibre became the default on measured cost: under a drag Cesium issues 3.4× the draw calls and streams roughly twice the bytes, and every map frame re-blurs the glass panels above it.

Weather, geocoding, holidays, POI hours and highway geometry come from free sources (Open-Meteo, Nager.Date, Overpass/OSM, GDELT). Four API keys are **optional** and each degrades to "no suggestions" rather than an error: OpenTripMap, Yelp, Brave Search, Google Places.

## Users

A traveler planning an upcoming trip: enters a destination, date range, and budget, and wants a realistic day-by-day plan back, not a generic checklist. The same person may revisit the plan while actually traveling — to track real spending against it, ask for changes in plain language, or have the day read aloud while the map flies it. Planning happens on a laptop or a phone; the phone client is the one likelier to be open mid-trip.

## Product Purpose

TripMate turns a destination + dates + budget into an AI-generated day-by-day itinerary (stops, lodging, weather-aware activity choices) that respects what the traveler said they'd spend, then lets them refine it conversationally, save it, and revisit it later — including tracking real spend against the plan while traveling, and watching a day play back as a narrated film over the map.

## Positioning

Most trip planners either hand back generic top-10 lists or ignore the budget entirely. TripMate's difference is that the *constraints are real*: a stated budget is a ceiling the plan stays inside rather than a number it pads out to, live weather changes which stops get picked on which day, and stated access and dietary needs outrank pace and preference rather than being appended as a note.

Behind that sits a governing rule set — a single ordered precedence for what wins when constraints collide — plus deterministic checks in code that run over the finished plan and hand what they find to a review pass. **Arithmetic is code's job and judgment is the model's:** whether a plan suits this traveler is a model question; whether 13:30 + 90min + 28min reaches a 15:15 reservation is not.

The screen is one persistent scene rather than a dashboard: a full-bleed, always-live 3D map that flies to your destination and to each place you tap, with the itinerary — real times, durations, per-day category budget breakdowns — floating above it as dark frosted glass. Tapping a stop swaps in a guidebook-style entry instead of a one-line description. It is also the only one of its kind that can route generation through the user's own Claude CLI session instead of a paid LLM API.

## Operating Context

Three distinct moments of use:

1. **Planning** — fill in trip details, answer a short profile (who's going, pace, interests, dietary and access needs, anything already booked, anything they must see or want avoided), generate, refine in plain language, Keep.
2. **During-trip** — revisit the saved trip, tap a stop to fly the map to it and open a detailed view, log actual spend per stop so remaining days can be rebalanced if a day runs over.
3. **Playback (web only)** — press Play on a day and the camera flies each stop while a voice reads a story-format script and the matching line lights up.

A plan is persisted the moment it is generated, as a `draft`, so a back press or a closed tab no longer discards a two-minute generation; Keep promotes that same row to `saved`. Unkept drafts are swept after a TTL.

## Capabilities and Constraints

**Accounts and data**
- Accounts are email and password (Better Auth). Until someone signs in, identity is an owner id in a cookie, and signing in moves that owner's trips, places and profile onto the account. The React Native client mints its own id and sends it as a header, because RN's networking owns cookies end to end and a hand-set `Cookie` was being overwritten from the native store.
- `trips` rows are not yet scoped by owner — the profile is, trips are not. Adding real auth means a `trips` migration, not just a login screen.

**What the traveler can state, and what happens to it**
- Destination, dates, budget (with a **per-person / whole-party basis** — the plan reads and prices everything as a party total), party composition down to children and infants, pace, energy, crowd tolerance, interests with up to three starred as primary.
- Dietary needs and access needs are **hard constraints**, not preferences; a stated step-free requirement outranks pace and priorities. Both persist on the traveler profile so they are not re-asked every trip.
- Named must-sees and exclusions, plus a free-text "anything already booked or off-limits" box that reaches the model verbatim.
- Arrival and departure times bound the first and last day. Departure reserves travel time to the airport **plus** a processing buffer (≈2h domestic, 3h international) — two separate figures, because collapsing them is how a traveler misses a flight.

**Generation and checking**
- Two generation paths coexist. The traveler-facing route is the incumbent; a staged pipeline (facts digested into a context file, rules held in a separate skill, the ask held separately again) is the intended direction and is where generation logic should be extended. Migration is blocked on a data contract, not on missing work.
- A review pass runs over the finished plan and can rewrite days it finds wanting. Deterministic checks — travel-time feasibility, overlapping stops, over-long days, budget ceiling, duplicate stops, booked commitments, named must-sees — run in code and are handed to that pass as fact.
- A benchmark harness scores generations against frozen fixtures on route efficiency, constraint adherence, weather/feasibility, meal and vibe fit, and coverage/grounding, with an optional blinded model judge. `docs/itinerary-quality.md` records the measured before/after of the current rule set, including the one axis that regressed.

**Known limits**
- Generation depends on a reachable model transport; there is no fallback provider.
- Weather is a real forecast within ~16 days of the trip start, otherwise a typical-weather estimate from the same dates a year prior.
- Trip length is capped at 30 days, enforced client- and server-side; no model call is attempted beyond it.
- Coordinates the model writes are corrected against OSM where a name resolves; unmatched names keep the model's guess.
- Place-detail text and photos are generated on demand and not persisted — reopening a stop regenerates the text.
- Narrated playback is web-only, and its natural voice downloads 88–326MB on first use, disclosed with a live percentage. The platform voice narrates the download and is the fallback at every level.
- Full-viewport 3D map on web; the React Native client uses a day-scoped map rather than a persistent globe.

## Brand Commitments

Product name is "TripMate." No logo — a drawn six-point asterisk mark beside the wordmark, no wordmark
lockup beyond that.

The visual identity is "Kiln", shipped 2026-09-08 and documented in DESIGN.md: a warm near-neutral
near-black ground with translucent glass floating over the persistent map, and **three named colour
roles rather than one accent** — jade for action, gold for money, coral for alert. Edges follow one
rule: round what you touch, square what you read.

**The type system is Melodrama + Switzer + Tabular, shipped 2026-09-09**, replacing the Wix Madefor
superfamily Kiln launched with. See DESIGN.md § Typography; the short version is a high-contrast
display serif at a single light weight against a neutral grotesk, with the landing price re-set as
the serif's own moment rather than as a monospace figure.

**The identity crosses to mobile under a ratified boundary** (DESIGN.md's third boundary, extended
from iOS to Android): Kiln owns the content surfaces; Profile is settings-shaped and takes each
platform's native list conventions with the palette unchanged. Melodrama and Tabular carry display
and figures, but **system sans carries all body text — that is what buys Dynamic Type and Android
font scaling**, and a custom face there would freeze it.

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

No real users, testimonials, or case studies. All itinerary content shown during development is live
model output, not fixture data to preserve.

What does exist is **measured internal evidence**: a frozen seven-fixture benchmark with a recorded
before/after of the current rule set (`docs/itinerary-quality.md`), and a side-by-side GPU cost
measurement of the two map engines (`docs/map-engine-gpu.md`). Both were produced by scripts in
`scripts/` and can be re-run. The itinerary measurement is n=7 with one generation per arm — enough
to catch a collapse or a consistent shift, not enough to call a small difference real, and it says
so.

## Product Principles

- **A stated budget is a ceiling, not a quota.** The plan stays comfortably inside it and leaves
  room for the unplanned; nothing is added to a trip because money remains. This reversed an earlier
  rule that asked the plan to consume 85–100% of the budget, which padded good cheap trips.
- Weather, daylight, opening hours and place are inputs to the plan, not decoration — they should
  visibly change what gets suggested.
- **Stated needs outrank inferred ones.** Access and dietary requirements are asked, never derived
  from proxies, and they beat pace and preference when they collide.
- **Judgment to the model, arithmetic to the code.** Whether a day suits this traveler is a model
  question. Whether the times add up is not, and should never be left to one.
- Refinement is a conversation, not a form: feedback in plain language should visibly change the
  next version — and change only what was asked about.
- Keep the stack dependency-light and signup-free wherever a free or local alternative exists. Every
  external key is optional and degrades to a smaller plan rather than an error.
