# Traveler profile — design

**Date:** 2026-08-16
**Status:** Approved, not yet implemented

> **Partly superseded by [`2026-08-16-onboarding-and-wizard-split-design.md`](./2026-08-16-onboarding-and-wizard-split-design.md).**
> The durable values are now owned by `/profile`, not by the wizard, and the automatic
> post-generate write-back was removed. The durable/per-trip boundary this spec drew is
> unchanged and still governs.

**Scope:** One of three deliverables. The others are `FUTURE-INTEGRATION.md` (done)
and the SSE progress loader (separate spec).

## Problem

The plan wizard collects seven screens of answers. `POST /api/itinerary` reads
none of them.

`PLAN_ORDER` in [`src/app/page.tsx`](../../../src/app/page.tsx) walks the
traveler through `basics → purpose → group → profile → crowds → priorities →
pois`, and `currentAnswers()` bundles the result into a `userAnswers` object sent
with the generate request. The request body destructuring in
[`src/app/api/itinerary/route.ts`](../../../src/app/api/itinerary/route.ts) does
not include `userAnswers`, and a comment in `page.tsx` confirms this is known and
unfinished. Only `preferences.tags` reaches the prompt.

So the app asks how much walking suits you, whether you are travelling with kids,
and whether you would rather avoid crowds — then plans the trip without any of it.

[`deriveFlags()`](../../../src/lib/userAnswers.ts) already turns those answers
into exactly the constraints a planner needs — pace, mobility, crowd bias, ranked
priorities, family rules — deterministically, with no LLM and no network. It is
computed and discarded.

A second, smaller problem: the answers are per-trip. A traveler who always
travels the same way re-answers the same five questions every time.

## Goals

1. The traveler's answers reach the model on the generate **and** refine paths.
2. Durable answers persist across trips and pre-fill the wizard.
3. Ownership is recorded from the first row written, so authentication can be
   added later without a data migration.

## Non-goals

- **Authentication.** Deferred; see `FUTURE-INTEGRATION.md`.
- **A profile management page.** The wizard is the editor. A second editing
  surface for the same five values is a consistency bug waiting to happen.
- **New questions.** Nothing is asked that isn't asked today.
- **The staged pipeline.** `trip-generate` has its own path through
  `trip-context.md` and the planner skill. Untouched here.

## The durable/per-trip boundary

The profile stores only what stays true between trips. Everything else is asked
fresh each time.

| Wizard screen | Durable | Per-trip |
|---|---|---|
| basics | — | destination, dates |
| purpose | — | purpose |
| group | group, explorer style | — |
| profile | energy | — |
| crowds | crowds, tier | budget amount |
| priorities | priorities, starred priorities | — |
| pois | — | selected + custom POIs |

**The governing rule: the profile supplies defaults, the wizard always wins.**
Nothing is locked. A solo traveler who usually travels with kids changes it on
the screen, and that trip's answers are what generation sees.

`purpose` is excluded deliberately — a business trip and an anniversary are the
same person. `budget` is excluded but `tier` is kept: the spending *style* is a
preference, the amount is a function of the trip.

## Architecture

Five units. Each is independently understandable and independently testable.

### 1. `traveler_profile` table

Added to [`src/lib/db.ts`](../../../src/lib/db.ts) at import time with
`CREATE TABLE IF NOT EXISTS`, matching every other table in that file. No
migration file — this project doesn't use them.

```sql
CREATE TABLE IF NOT EXISTS traveler_profile (
  owner_id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

`owner_id` is the insurance described in `FUTURE-INTEGRATION.md`. It is written
from an exported `LOCAL_OWNER = "local"` constant at every call site rather than
via a column `DEFAULT`, because on a primary key that is always written
explicitly the default never fires — the column is the insurance, not the default.

### 2. `src/lib/travelerProfile.ts`

Owns the durable-subset type and its persistence. Knows nothing about prompts or
React.

```ts
export const LOCAL_OWNER = "local";

export interface TravelerProfile {
  group: GroupType;
  explorerStyle: ExplorerStyle;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  tier: TierId;
  priorities: string[];
  topPriorities: string[];
}

export function readProfile(ownerId?: string): TravelerProfile | null;
export function writeProfile(profile: TravelerProfile, ownerId?: string): void;
```

`readProfile` returns `null` for both "no row" and "row failed to parse". The
caller's response is identical in either case — fall back to the wizard's
built-in defaults — so the distinction the fail-soft convention normally demands
between `null` and empty would be a distinction without a consequence here. This
departure from the house rule is deliberate and should carry a comment saying so.

### 3. `GET` / `PUT /api/profile`

A thin route. `GET` returns the profile or `null`; `PUT` validates and persists.
Maps `snake_case` row fields to `camelCase` API fields by hand, per the
convention in the existing routes.

Validation on `PUT` rejects unknown enum values rather than storing them, since a
bad value would silently propagate into every future trip's prompt.

### 4. Wizard seeding in `page.tsx`

- On mount, `GET /api/profile`. On a profile, seed the initial state for the
  seven durable fields. On `null` or any error, leave today's hardcoded defaults
  in place.
- After a **successful** generate, `PUT` the durable subset of `currentAnswers()`.

The write is deliberately after success, not on each screen advance: a wizard the
user abandoned halfway is not a statement about how they travel.

### 5. The prompt wiring — where the value lands

In `route.ts`, read `userAnswers` from the body, pass it through the existing
`deriveFlags()`, and hand the resulting `ResolvedFlags` to the prompt builders.

A new `formatTravelerProfile(flags)` in
[`src/lib/itineraryPrompt.ts`](../../../src/lib/itineraryPrompt.ts) sits
alongside the existing `formatPreferences()` / `formatWeather()` /
`formatContextBlock()` helpers and follows their shape: it returns `""` when
there is nothing to say, so an absent `userAnswers` leaves the prompt byte-for-byte
as it is today.

It emits, conditionally:

- Target stops per day, and the resolved pace label.
- When `mobilityProfile.walkLegCap` is `"tight"`: short walking legs, minimize
  stairs, build in rest breaks, prefer transit over long walks.
- When `crowdBias.preferOffpeakTiming`: schedule icons off-peak, favour offbeat
  POIs. When `crowdBias.marketsAndLivelyOk`: busy markets welcome, peak timing fine.
- When `familyRules` is non-null: kid-friendly bias, no late nights, short legs.
- The `prioritiesRanked` split — starred priorities drive the plan, the rest are
  tiebreakers only.

**Deliberate division with `formatPreferences`.** Interests reach the prompt
through two request fields that carry the same array: `preferences.tags` and
`userAnswers.priorities`. To avoid saying the same thing twice in one prompt,
`formatPreferences` is left exactly as it is and keeps sole ownership of the
interest list and its per-tag `INTEREST_GUIDANCE`. `formatTravelerProfile` adds
only what is genuinely new, including the starred/unstarred ranking, which
`formatPreferences` has no notion of.

**Also wired:**

- `buildRefinePrompt` receives the same block. Without this, refining a trip
  silently discards the profile that generated it — the plan would drift back
  toward a generic itinerary on the first edit.
- `buildCritiquePrompt` gains pace and mobility to its review criteria. The
  critique pass is what catches budget and timing violations before the traveler
  sees them; a stated pace of two stops a day is exactly that kind of checkable
  constraint.

## Data flow

```
traveler_profile row
        │ seeds defaults on mount
        ▼
   wizard state ──(user edits freely)──▶ currentAnswers()
        │                                      │
        │ PUT after successful generate        │ POST /api/itinerary
        ▼                                      ▼
traveler_profile row                     deriveFlags()
                                               │
                                               ▼
                                    formatTravelerProfile()
                                               │
                                               ▼
                            buildGeneratePrompt / Refine / Critique
```

The profile never reaches the model directly. Only the trip's answers do. One
path into the prompt, so a stale profile and a fresh answer can never disagree
inside a single generation.

## Failure handling

Matching the fail-soft convention: external and optional data degrades, it does
not throw.

| Failure | Behaviour |
|---|---|
| No profile row, or unparseable | Wizard uses today's hardcoded defaults |
| `GET /api/profile` fails | Same — the wizard renders normally |
| `PUT /api/profile` fails after generate | Swallowed and logged. It must never fail a trip the traveler just waited two minutes for |
| `userAnswers` absent from request | `formatTravelerProfile` returns `""`; prompt is unchanged from today |
| `userAnswers` present but malformed | Treated as absent. A bad shape must not throw inside a generation that is otherwise fine |

The "absent" case is what keeps `PipelineConsole` and any other existing caller
working without modification — none of them send `userAnswers`.

## Verification

Per `CLAUDE.md`, typecheck alone does not count as verified here.

1. **`npm test`** — a new `src/lib/itineraryPrompt.test.mjs` using `node:test`,
   matching the no-framework style of the two existing suites:
   - a low-energy family traveler emits the tight-walking and kid-friendly lines
   - absent answers return `""`
   - starred priorities split correctly into primary and tiebreakers
   - a crowd-loving, high-energy traveler emits neither the off-peak nor the
     mobility lines
2. **`npx tsc --noEmit -p tsconfig.json`**
3. **`npm run lint`**
4. **Live route exercise** against `npm run dev`: `curl` a generate with a
   low-energy family `userAnswers` payload and confirm from the `llm_traces` row
   (via the trace FAB) that the profile block is present in the prompt actually
   sent. Repeat without `userAnswers` and confirm the prompt is unchanged.

## Documentation to update

- `docs/backend.md` and `docs/llm.md` — one Features row each, `Since 2026-08-16`,
  Developer `Zaid`, per the convention in `docs/project-crux.md`.
- `docs/project-crux.md` — a timeline row.
- **`CLAUDE.md` correction.** It states "There is no test suite (no runner, no
  test files)". This is false: `package.json` defines
  `"test": "node --test 'src/**/*.test.mjs'"`, and `src/lib/itinerary.test.mjs`
  and `src/lib/perfAggregate.test.mjs` both exist. Left uncorrected it will keep
  steering contributors away from the runner this spec adds a test to.
- `AGENTS.md` is rewritten by `next dev` — commit it with the work rather than
  reverting it.

## Open risk

The prompt grows by roughly six lines. `buildGeneratePrompt` is already long, and
generation timeouts scale with trip length via `itineraryTimeoutMs()`. The
addition is small relative to the itinerary JSON the model produces, so no
timeout change is expected — but if generation latency moves measurably after
this lands, this block is the first suspect and `PER_DAY_TIMEOUT_MS` is the knob.
