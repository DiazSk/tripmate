# Tell the planner when the traveller's places are open

**Date:** 2026-09-26 · **Author:** Zaid (with Claude) · **Status:** draft, awaiting review · **Branch:** `react-native-app`

## Why

The legacy-path baseline (`docs/itinerary-quality.md`, "Legacy-path baseline" and its 2026-09-26
addendum) broke an anchor's opening hours on every Kyoto and Rome run, with weather and without. The
stored prompts and traces show why. It is a data problem in two places, not a missing rule:

1. **The generator is never told the hours.** `formatAnchors()` (`src/lib/itineraryPrompt.ts`)
   writes an anchor as `- WANT: Nijo Castle (35.0142, 135.7481)`. `ANCHOR_INSTRUCTION` then asks
   for every MUST place "on a day and at a time it is open", and nothing says when that is. The
   model guesses from memory.
2. **The post-generation check cannot see most of these places.** `fetchPoiOsmTags()`
   (`src/lib/poiDetails.ts:37`) builds `nwr["name"="<requested name>"]`. Outside English-speaking
   countries OSM's `name` is the local name, so this is confirmed against Overpass on 2026-09-26:

   | Query | Result |
   |---|---|
   | `"Nijo Castle"` | nothing |
   | `"Colosseum"` | nothing |
   | `"二条城"` | `Mo-Su 08:45-17:00` |

   Results are also keyed by the element's own `name`, so a match would be filed under a key the
   caller never asks for. `detectConflicts` therefore hands the critique no closed-day conflicts.
   It also drops the step-free check, pinned admission costs and address facts for every
   non-English-named stop. This affects all three callers: post-generation enrichment
   (`generationRunner.ts:446`), the staged pipeline's `poiEnrichment.ts:21`, and the place-gallery
   card (`api/place-gallery/route.ts:73`).

A third problem is in the harness, not the product. `kyoto-couple-mixed` hard-codes Nijo Castle as
`"Tu-Su 08:45-17:00; Mo off"`, a deliberate closed-day test, while OSM says it is open daily. That
is fair on the staged path, which gets the fixture's hours in `trip-context.md`. It is not fair on
the legacy path, which is never given them: the legacy arm is judged against hours the model never
saw and reality contradicts. This is the same trap `withSeenWeather` already fixed for weather.

## Goal

A traveller's anchors reach the planner with their real opening hours and closed days whenever OSM
has them. The critique's closed-day check works for places with non-English names. The bench
judges the legacy path's hours against the facts the route actually had.

**Success, measured with the existing harness:**
- On the legacy Kyoto and Rome fixtures, the prompt shows each anchor's hours when OSM has them.
- `closed_or_hours` stops firing on anchors whose real hours were in the prompt.
- Any remaining hours miss is one the model made with the fact in front of it. That is a rule
  problem worth a rule.

## Out of scope

- **Hours for stops the model picks itself.** They are unknown until the plan exists, so the
  post-generation check (fixed here by §1) stays the only guard for them.
- **The staged pipeline's prompt.** It already carries hours through `trip-context.md`. It gains
  §1's matching fix for free through `poiEnrichment.ts`.
- **Parsing richer `opening_hours` syntax** (`PH`, seasonal ranges, `off` exceptions).
  `closedDaysFromOpeningHours` keeps returning `null` for what it cannot read. The raw string still
  reaches the prompt, and the model can read "Mo off" itself.
- **Changing the Kyoto fixture.** Its invented closure stays a valid staged-path test. The legacy
  arm stops being judged on it (§4).

## Design

### 1. `fetchPoiOsmTags` matches any name tag and answers by the requested name (root cause, all three callers)

- **Query.** Change the clause to match the requested name against every `name` or `name:*` tag,
  case-insensitively, within the existing `MATCH_RADIUS_M`:

  ```
  nwr[~"^(name|name:[a-z]{2,3}|int_name|alt_name)$"~"^<escaped name>$",i](around:R,lat,lon);
  ```

  This is still one batched query, the same cost as today. `escapeForOverpass` already exists;
  the regex needs the value escaped for regex metacharacters too. This adds a small
  `escapeForOverpassRegex`.
- **Result mapping.** Extract `matchElementsToPois(elements, pois)`: a pure function that files each
  element under the **requested** POI whose name equals any of the element's name tags
  (normalised the way `normalizeStopName` does). When several requests match, it takes the nearest
  one within radius. The return is still `Record<requestedName, PoiOsmTags>`, the contract every
  caller already reads. Today's accidental keying by local name goes away.
- `null` still means "Overpass failed" and `{}` still means "asked, matched nothing". The fail-soft
  contract is unchanged.

### 2. Look anchor hours up before generation, on the legacy path

- In `runGeneration`'s generate branch, right after `geocodeAnchors` (`generationRunner.ts:~288`),
  call `fetchPoiOsmTags` for the anchors that have coordinates. It runs concurrently with the
  existing awaits of `contextInsightPromise` and `sketchPromise`, so it adds no wall-clock time
  unless Overpass is slower than both.
- It is **bounded**: a budget of about 15s rather than the batch default of 45s, because this runs
  on the critical path before the plan exists. Any failure or timeout leaves the anchors
  unchanged. That is fail-soft, and the prompt then reads exactly as it does today.
- Each located anchor gains `openingHours: string | null` and `closedDays: string[] | null`, the
  latter from `closedDaysFromOpeningHours`. Both go on the `Anchor` type as optional fields, so
  imported, refined and stored itineraries stay valid.
- **Refine** (`isRefine`) skips this, the same way it skips the geocode: it reuses the previous
  plan's anchors, which carry whatever hours the first pass fetched.

### 3. `formatAnchors` writes the hours beside the anchor

```
- MUST: Nijo Castle (35.0142, 135.7481) — open Mo-Su 08:45-17:00 (OpenStreetMap)
- WANT: Uffizi Gallery (43.7678, 11.2553) — open Tu-Su 08:15-18:30; closed Mo (OpenStreetMap)
- WANT: Kiyomizu-dera (34.9949, 135.785)
```

- **Hours known:** show the raw `opening_hours` string, plus a plain "closed <days>" whenever
  `closedDays` is a non-empty list. The raw string is kept because the parser is deliberately
  narrow.
- **Hours unknown:** nothing is appended. The line reads as today, so "no data" never looks like
  "no hours".
- `ANCHOR_INSTRUCTION` gains one clause: *"Where a place's hours are given, they are OpenStreetMap
  data — schedule inside them; where none are given, do not state hours."*

  This goes into `ANCHOR_INSTRUCTION` because this legacy path never loads the skill. SKILL.md §15
  must be kept in step, per the comment above `ANCHOR_INSTRUCTION`.
- The anchors, hours included, are already part of `contextPayload`. `generations.context_json`
  therefore records exactly what the model was told, which §4 needs.

### 4. The bench judges the legacy arm's anchor hours against what the route had

- Add `withSeenAnchorHours(fixture, contextAnchors)` in `src/lib/bench/sweep.ts`, beside
  `withSeenWeather`. It works on the fixture's `poiDetails.pois` anchors:
  - where the route's context carries hours for that anchor (matched by name), the fixture's
    `openingHours` is replaced with it;
  - where the context carries none, it is set to `null`. The existing scorer already reads `null`
    as "unchecked", never as compliant or failed.
- `skill-ab.mjs`'s `runLegacy` already stores `seenWeather` from `context_json`. It stores
  `seenAnchors` beside it, and `scoreCell` applies both.
- Staged runs are untouched: their fixture hours are what the model was given.

## Error handling

All four parts fail soft, following the house convention:
- An Overpass failure, timeout or no match leaves the anchors with no hours, and the prompt then
  reads as today.
- A malformed `opening_hours` value passes through raw, with `closedDays: null`.
- An old arm file with no `seenAnchors` is scored as before.

## Testing

`node --test`, in the files where the logic lives. No test calls Overpass or a model.

- **`matchElementsToPois`** (in `src/lib/poiDetails.test.mjs`, created if absent):
  - an element whose `name` is 二条城 and whose `name:en` is "Nijo Castle" is filed under the
    requested "Nijo Castle";
  - a case difference still matches;
  - when two requests share a name, the element goes to the nearer one;
  - an element beyond the radius is not filed;
  - an element matching no request is dropped.
- **The query builder:** the clause matches `name`/`name:*` and escapes regex metacharacters, so
  "St. Peter's (Basilica)" does not break the query.
- **`formatAnchors`** (`itineraryPrompt` tests):
  - an anchor with hours prints them and the closed days;
  - one with `closedDays: []` prints no "closed";
  - one with no hours prints the old line byte-for-byte.
- **`withSeenAnchorHours`** (`src/lib/bench/sweep.test.mjs`):
  - hours from the context replace the fixture's;
  - an anchor missing from the context becomes `null`;
  - the frozen fixture is not mutated.
- **Gates:** `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`.
- **End to end,** kept deliberately small because every generation spends the developer's
  subscription usage. One `AB_RUNS=1` legacy run each on `kyoto-couple-mixed` and
  `rome-family-slow`, which is 2 generations. Confirm:
  - the stored prompt shows the hours for each anchor OSM knows;
  - the critique trace carries closed/conflict lines when a scheduled stop is shut;
  - `--report` shows no `closed_or_hours` on an anchor whose hours were in the prompt.

## Risks

- **A broader name match could file the wrong place.** Two different places could share a name
  within `MATCH_RADIUS_M`. The nearest-request rule and the radius bound this. It is also the same
  radius the exact-name match uses today.
- **OSM hours can be stale or wrong,** and they are the only source. Labelling them "OpenStreetMap"
  in the prompt lets the model hedge. They are still far better than the current nothing.
- **The regex query is heavier on Overpass** than an exact tag match. It is one query per
  generation over a handful of anchors, cached for `TTL.CHURNING`. Measure the latency on the two
  end-to-end runs, and fall back to `name` plus `name:en` only if it is materially slower.
