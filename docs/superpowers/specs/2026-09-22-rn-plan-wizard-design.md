# The plan wizard, on React Native

**Status:** approved design
**Date:** 2026-09-22
**Applies to:** the React Native app at `mobile/` (branch `react-native-app`)

## Why

The RN app can browse and read trips but cannot make one. Its Home screen says so in as many
words — *"Planning a new trip arrives in a later release."* This adds the flow that makes the app
worth opening: describe a trip, watch it get written, keep it.

The reference is the frozen SwiftUI wizard (`ios/TripMate/TripMate/Plan/`), which already solved
this on a phone and whose decisions are recorded in its own comments.

## Scope

This spec covers **the slice that makes a trip creatable**, and deliberately stops there.

**In scope**
- Input types, tier derivation, an SSE client, and three API calls
- A minimal set of form primitives (the app has none today)
- The *Where and when* step
- The generation screen — the 60–246 second wait
- The draft → keep → saved lifecycle, and discard

**Deferred to a follow-up spec**
- *Who's going*, *What you're after* and *Review* steps
- The nearby-POI picker and free-text POI additions
- Seeding the traveller profile from a completed wizard

The deferral is not arbitrary: `PlanDraft.canAdvance(from:)` gates **only** `.basics`; the Swift
app returns `true` unconditionally for every later step, with the reason recorded — *"a required
answer on a screen the traveler has nothing to say on is a wall in front of a plan."* Those steps
improve the plan the model writes. They do not enable creation, and the server degrades
gracefully without them.

## Architecture

### Pure logic

**`mobile/src/lib/tiers.ts`** — ported from `ios/TripMateKit/Sources/TripMateKit/Tiers.swift`.

`tier` is **required** by `POST /api/itinerary` (a 400 without it) and **has no picker anywhere in
the product**. The web app had one and removed it along with the stored preference, because a
stored style could only ever contradict the number the traveller just typed. So it is derived:
`closestTier(budget, days)` returns the tier whose `dailyRate × days + nightlyRate × (days − 1)`
lands nearest the budget. Rates: budget 70/40, mid-range 150/150, luxury 350/500. **Ties go to the
earlier tier** — the comparison is strictly `<`, and that is the web's behaviour at an exact
midpoint rather than an accident of it.

Also `tripDays(start, end)` — inclusive, floored at 1, **parsed as UTC**, for the reason the rest
of this codebase repeats: `2026-09-19` is UTC midnight and a local formatter rolls it back a day
west of Greenwich. And `MAX_TRIP_DAYS = 30`.

**`mobile/src/api/sse.ts`** — a frame parser over the response body stream. Three properties of
the real protocol it must handle, all verified against `src/app/api/itinerary/route.ts`:

1. The first frame is a **2048-byte `:` comment**, padding that exists to defeat WebKit's stream
   buffering.
2. A bare `:` **keepalive comment** arrives every 20 seconds.
3. Both carry no `event:` line and empty `data`. They must be **dropped by testing for empty
   data** — a parser that routes on the event name alone crashes on a nameless frame.

### API

New functions in `mobile/src/api/tripMateApi.ts`, all through `fetchWithSession`, all matching the
established fail-soft convention (`undefined` = the call failed, `null` = the server answered
"nothing", never throw):

- `generateTrip(req, handlers)` — `POST /api/itinerary?stream=1`, dispatching parsed events
- `createTripDraft(body)` — `POST /api/trips`
- `promoteTrip(id, itinerary)` — `PATCH /api/trips/[id]`
- `discardTrip(id)` — `DELETE /api/trips/[id]`
- `geocode(destination)` — `GET /api/geocode`

Four contract rules that are silent traps, each to be carried as a comment at its call site:

- **`status: "draft"` is mandatory when creating.** Omitting it creates a *saved* trip — the field
  looks optional and the mistake puts an unkept plan on the memories wall.
- **429 (throttle) and 503 (spend cap) fire before the stream opens**, as ordinary JSON. They
  cannot be caught as stream errors and must be distinguished from one.
- **Stop consuming at `plan`, not `done`.** `plan` is terminal for interactivity; critique runs
  after it and takes ~150 s. Draining to `done` leaves a spinner up with the plan already in hand.
- **`day-coords` spells it `lon`**, not `lng`, unlike everything else on this wire.

### Screens

Pushed siblings of `(tabs)` under the root `Stack`, exactly as `trip/[id]` already is:
`mobile/src/app/plan/basics.tsx` and `mobile/src/app/plan/generating.tsx`.

**Basics** — one hairline-separated trough of four fields (destination, Arrive, Leave, Budget),
mirroring `BasicsStep`. Instead of a tier picker, a derived readout: `7 days · Mid-range`.

Generate is enabled on a non-empty destination, both dates, and budget > 0. Two cross-field
errors, copy taken from the Swift app: *"End date must be on or after the start date."* and
*"Trips over 30 days aren't supported — please choose a shorter date range."*

Geocoding runs on blur and **never blocks**. A genuine **404 miss** shows *"We couldn't find that
place, but the plan will still work."*; a **500 failure** shows nothing, because an outage is not
a claim about what the traveller typed. These are different status codes on purpose and must stay
different here.

**Generating** — the stage line above days that fill in stop by stop as `stop` events arrive.
Stage copy ported verbatim: *"Finding the place…"*, *"Reading up on it…"*, *"Writing the days…"*,
*"Checking the plan…"*, *"Putting it on the map…"*. On `plan`, POST the draft and replace the
route with `trip/[id]`.

### Draft lifecycle

A `trips` row exists the moment a plan does, at `status: "draft"` — so a back press cannot throw
a generation away. Keep promotes **that same row** with `PATCH {status:"saved"}`, which preserves
its `runId` link and any pre-save edits; the **returned** `endDate` is authoritative (the server
recomputes it from the itinerary) and must be persisted over whatever was sent. Discard is
`DELETE`. `listTrips()` already defaults to `saved`, so drafts stay off the Memories wall without
any filtering at the call site.

### Form primitives

`mobile/src/components/form/` — the app has no input components at all today. `FieldTrough`,
`TextField`, `DateField`, `PrimaryButton`. Built from Kiln tokens; `PrimaryButton` is the app's
first legitimate use of jade, which the One Meaning Rule reserves for action.

`DateField` wraps `@expo/ui/community/datetime-picker`. Verified before choosing it: it is *API
compatible with* `@react-native-community/datetimepicker`, not dependent on it — SwiftUI on iOS,
a real 126-line Jetpack Compose implementation on Android (`DatePickerView.kt`), and it renders
natively **inside Expo Go**, so it costs no new dependency and no dev-client build. Two single-date
fields rather than a range picker: the cross-platform wrapper is single-date only, the range
pickers exist solely as platform-specific modules with divergent APIs, and the Swift app uses two
fields anyway with Leave constrained to `earliest: startDate`.

## Testing

Unit tests where the logic lives, matching the existing `*.test.ts` convention (mock
`fetchWithSession`, assert each fail-soft branch):

- Tier derivation, including the documented tie-to-earlier at an exact midpoint
- `tripDays` across a UTC boundary
- The SSE parser: padding frame, keepalive, multi-line `data`, and a frame split across chunks
- Each new API function's failure branches

Screens are verified by running the app against a live backend, per this repo's convention that
passing tests prove less here than usual.

## Known risk

**Android remains unverified.** There is no Android SDK on the development machine — no emulator,
no `adb`. The date picker's Android path was read and is a real implementation, but nobody has run
it. This is the same gap the design pass recorded and it is not closed by this work.

## Out of scope

The three optional steps and the POI picker (next spec). Refine/rebalance modes of
`/api/itinerary`. Push notification on completion — the Swift app's `notify` flag is local-only
because no job record or APNs integration exists.
