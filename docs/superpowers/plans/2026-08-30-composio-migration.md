# Drop Composio: 6-Task Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Composio (the CLI-subprocess tool proxy behind `src/lib/composio.ts`) is moving to
wallet-based billing on 2026-09-10. One of 7 Composio-backed integrations (Yelp dietary venues)
was already migrated to a direct API call in a prior session (`docs/superpowers/plans/2026-08-30-yelp-direct-api.md`)
— that swap was a pure transport change, since Composio had been passing Yelp's own response
through untouched. This plan covers the remaining 6, which are NOT uniform transport swaps: each
proxies a different underlying vendor, and two of them (flights, lodging) turn out to have **no
viable free or affordable replacement at all** — their only realistic paid option (Amadeus's
self-service tier) was discontinued 2026-07-17. Destination festivals' candidate replacement
(Brave Search) also had its free tier quietly removed in 2025-2026, same as Yelp's. Treat every
vendor's advertised free tier as unverified until curled live — three separate assumed-shapes/
assumed-pricing claims already turned out wrong across this and the prior session (Yelp, Amadeus,
Brave).

**Architecture:** No single transport swap covers all 6 — this is 6 independent replacements
sharing only the fail-soft calling convention and the "don't touch composio.ts until your own
task" constraint. Two (route matrix → OSRM, destination safety → GDELT) are genuine free
transport swaps. Two (flights, lodging) are full end-to-end feature removals, including their UI
and prompt-layer surface, not stubs. One (place facts) reuses an Overpass client this repo already
has (`poiDetails.ts`) rather than adding a new vendor, at the cost of dropping 5 of 7 fields this
app used to get from Google Maps. One (destination festivals → Brave Search) is a real design
adaptation: Brave's plain web-search response has no synthesized "answer" field the way Composio's
apparently did, so the extraction prompt's input has to be synthesized from a results list instead.

**Tech Stack:** TypeScript, `fetch` with `AbortSignal.timeout`, `node --test` for the existing
pure-function test suite.

**Spec:** none — approved via an interactive plan-mode review in this session rather than a
written `docs/superpowers/specs/` file (the harness's plan-approval gate served that role). Full
plan content is committed here; treat this document as the sole source of requirements.

## Global Constraints

- **Fail-soft house convention, precisely:** a fetch function returns `null` to mean "the fetch
  itself failed or can't be trusted" (missing key, network error, timeout, non-ok HTTP status,
  malformed payload); `[]`/`{}` means "the fetch succeeded and genuinely found nothing." Preserve
  this distinction at the point it's produced even where a downstream caller collapses both into
  one default later (e.g. `destinationContext.ts` already does this once, deliberately — don't
  collapse it earlier by accident).
- **No git commit trailers of any kind** — no `Co-Authored-By`, no "Generated with Claude Code."
- **Test files import their subject with an explicit `.ts` extension** even though the test file
  itself is `.mjs`; run only via `npm test` (double-quoted glob), never bare `node --test`.
- **Node ≥ 22** (`.nvmrc` pins it) — global `fetch`/`AbortSignal.timeout` are safe to use directly.
- **`AGENTS.md` is rewritten by `next dev`.** If it's dirty after a task's dev/test run, commit it
  alongside that task's work.
- **Don't touch `src/lib/composio.ts`** itself, or any of the 6 modules' Composio calls before
  that module's own task.
- **Every new outbound fetch gets an explicit `AbortSignal.timeout(...)`.**
- **Live-curl every new vendor's exact response shape before writing its distiller.** Each task
  below names exactly what to verify — do not write a `distilX()` against an assumed shape.
- Tasks are independently shippable and independently revertible. Nothing in a later task depends
  on an earlier task's specific implementation — only on that earlier task's module's Composio
  call having already been removed, or not yet reached.

## File Structure

**Delete entirely (across all tasks):**
| Path | Removed in |
|---|---|
| `src/lib/flights.ts`, `src/lib/flights.test.mjs` | Task 3 |
| `src/lib/originAirport.ts` (+ test file, if any) | Task 3 |
| `src/app/api/flight-estimate/route.ts` | Task 3 |
| `src/lib/lodging.ts`, `src/lib/lodging.test.mjs` | Task 4 |

**Modify (most-touched first):**
| Path | Touched by |
|---|---|
| `src/lib/generationRunner.ts` | Tasks 1, 3, 4, 5 |
| `src/lib/routeMatrix.ts`, `src/lib/routeMatrix.test.mjs` | Task 1 |
| `src/lib/destinationSafety.ts`, `src/lib/destinationSafety.test.mjs` | Task 2 |
| `src/lib/types.ts`, `src/lib/userAnswers.ts`, `src/lib/guardrails.ts`, `src/components/BudgetBar.tsx`, `src/components/ItineraryCard.tsx`, `src/lib/export/itineraryHtml.ts`, `src/app/trip/[id]/print/page.tsx`, `src/app/HomeView.tsx`, `src/lib/bench/customTrip.ts`, `src/lib/bench/fixtures.ts` | Task 3 |
| `src/lib/lodgingPrompt.ts`, `src/lib/itineraryPrompt.ts` | Task 4 |
| `src/lib/placeFacts.ts`, `src/lib/placeFacts.test.mjs` | Task 5 |
| `src/lib/destinationFestivals.ts`, `src/lib/destinationFestivals.test.mjs`, `.env.local.example`, `README.md`, `CLAUDE.md` | Task 6 |

**Reused, not modified:** `src/lib/poiDetails.ts` (Task 5's Overpass client). **Read-only
reference, confirmed needing no edits:** `src/lib/placeConflicts.ts` (Task 5).

---

### Task 1: Route matrix → OSRM public demo server

**Files:** modify `src/lib/routeMatrix.ts`, `src/lib/routeMatrix.test.mjs`. No changes needed in
`generationRunner.ts:309` or `tripFetch.ts:36` — both callers already consume the same
`Map<string, RealLeg>` / `boolean` shapes, provider-agnostically.

- [ ] **Step 1: Verify OSRM's supported profiles live**

```bash
curl -s "https://router.project-osrm.org/table/v1/walking/2.3522,48.8566;2.3376,48.8606;2.3444,48.8738?annotations=duration,distance"
curl -s "https://router.project-osrm.org/table/v1/driving/2.3522,48.8566;2.3376,48.8606;2.3444,48.8738?annotations=duration,distance"
```
`driving` is reliably supported on the public demo; `walking`/`foot` needs this live check. If
`walking` 400s, fall back to `driving` as the only mode this app requests and say so in the commit
message.

- [ ] **Step 2: Rewrite `distilRouteMatrix` for OSRM's response shape**

Request: `GET /table/v1/{profile}/{lon},{lat};{lon},{lat};...?annotations=duration,distance` —
**OSRM takes `lon,lat` order**, the reverse of this app's `{lat, lon}` convention everywhere else.
This is the single easiest bug to ship in this task.

Response: `{ durations: number[][], distances: number[][], code: "Ok" }` — dense matrices in
seconds/meters; an unroutable pair is `null` in both arrays (not a per-element status field like
Google's `condition`).

Mapping:
| Old (Google via Composio) | New (OSRM) |
|---|---|
| `elements[].condition === "ROUTE_EXISTS"` | `durations[i][j] !== null` |
| `elements[].originIndex`/`destinationIndex` | array position `i`/`j` |
| `elements[].duration` (`"1305s"`, regex-parsed) | `durations[i][j]`, already a number — delete `parseSeconds` and its regex |
| `elements[].distanceMeters` | `distances[i][j]` |
| `travelMode: TRANSIT` | dropped — no transit profile on OSRM. `MODE_BY_TRANSPORT` shrinks accordingly; a transit-mode request short-circuits to an empty `Map` with no network call, using the existing fail-soft path |

```ts
export function distilRouteMatrix(raw: unknown): RealLeg[] {
  const data = raw as { durations?: unknown; distances?: unknown; code?: unknown } | null;
  if (data?.code !== "Ok" || !Array.isArray(data.durations)) return [];
  const distances = Array.isArray(data.distances) ? data.distances : [];
  const legs: RealLeg[] = [];
  data.durations.forEach((row, i) => {
    if (!Array.isArray(row)) return;
    row.forEach((seconds, j) => {
      if (i === j || typeof seconds !== "number") return;
      const distanceMeters = distances[i]?.[j];
      legs.push({
        fromIndex: i,
        toIndex: j,
        minutes: Math.round(seconds / 60),
        distanceMeters: typeof distanceMeters === "number" ? distanceMeters : null,
      });
    });
  });
  return legs;
}
```

- [ ] **Step 3: Rewrite `fetchDayTravelMinutes`**

Plain `fetch` against the Table endpoint, coordinates built as
`points.map(p => \`${p.lon},${p.lat}\`).join(";")`, `AbortSignal.timeout(10_000)`, try/catch to an
empty `Map` on any failure — same shape as today. Document OSRM's usage ceiling (≤1 req/sec, 5000
req/min service-wide, no uptime guarantee, access can be withdrawn without notice — it's a shared
public demo, not a committed SLA) as a code comment near the URL constant. `MAX_MATRIX_STOPS`
stays at 10.

- [ ] **Step 4: Simplify `probeTransitAvailable`**

```ts
/** No free transit-routing data source exists. Always false, consistent with this function's own
 *  documented contract: a negative result means "not proven," not "no transit." */
export async function probeTransitAvailable(): Promise<boolean> {
  return false;
}
```
Update the one call site in `tripFetch.ts:36` for the smaller signature (drop the `lat`/`lon`
args it no longer needs). Delete the walk-vs-transit comparison logic this enabled.

- [ ] **Step 5: Rewrite `routeMatrix.test.mjs`**

Drop the `"1305s"`-parsing tests. Add a fixture matching the real OSRM response verified in Step 1
(paste real numbers). Keep equivalent coverage for: self-pair exclusion, `null`-duration
(unroutable pair) exclusion, malformed/`code !== "Ok"` payload tolerance, and the
`MAX_MATRIX_STOPS` cap. Replace the transit-margin test with an unconditional
`probeTransitAvailable() === false` test.

- [ ] **Step 6: Run tests, typecheck, lint**

```bash
npm test 2>&1 | tail -15 && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/routeMatrix.ts src/lib/routeMatrix.test.mjs
git commit -m "Get real travel times from OSRM instead of Composio/Google

Composio's GOOGLE_MAPS_COMPUTE_ROUTE_MATRIX becomes OSRM's public demo
Table service — free, no key. OSRM has no transit profile, so
probeTransitAvailable is now permanently false (still true to its own
documented 'not proven' contract) and a transit-mode matrix request
short-circuits to an empty Map via the existing fail-soft path."
```

---

### Task 2: Destination safety → GDELT DOC 2.0 API

**Files:** modify `src/lib/destinationSafety.ts`, `src/lib/destinationSafety.test.mjs`. No change
to `destinationContext.ts:50` (signature unchanged) or `classifySeverity` (provider-agnostic,
keep verbatim).

- [ ] **Step 1: Verify GDELT's response shape live**

```bash
curl -s "https://api.gdeltproject.org/api/v2/doc/doc?query=Paris%20tourist%20safety%20advisory%20scam%20warning&mode=artlist&format=json&maxrecords=10&sort=datedesc"
```
Confirm exact field names on `articles[]` (expected: `url`, `title`, `domain`, `seendate`,
`language`) and confirm there's genuinely no snippet/body field — GDELT is a metadata index, not a
summarizer. Also check whether `query` needs a `sourcelang:english` clause appended to avoid
off-topic/foreign-language noise (the old code's `hl: "en"` had no direct GDELT equivalent) —
add it to the query string if so.

- [ ] **Step 2: Rewrite `distilSafetyNotes`**

| Old (`news_results[]`) | New (`articles[]`) |
|---|---|
| `.title` | `.title` |
| `.source` | `.domain` |
| `.snippet` | **dropped, no equivalent.** `classifySeverity` runs on title text alone instead of title+snippet — a real, accepted accuracy reduction, not a defect to work around |
| `.link` | `.url` |

```ts
export function distilSafetyNotes(raw: unknown, limit = MAX_NOTES): SafetyNote[] {
  const articles = (raw as { articles?: unknown } | null)?.articles;
  if (!Array.isArray(articles)) return [];
  const notes: SafetyNote[] = [];
  for (const entry of articles) {
    const a = entry as Record<string, unknown> | null;
    const title = typeof a?.title === "string" ? a.title.trim() : "";
    if (!title) continue;
    const domain = typeof a?.domain === "string" ? a.domain.trim() : null;
    notes.push({
      note: domain ? `${title} — ${domain}` : title,
      severity: classifySeverity(title),
      sourceUrl: typeof a?.url === "string" ? a.url : null,
    });
    if (notes.length >= limit) break;
  }
  return notes;
}
```

- [ ] **Step 3: Rewrite `fetchSafetyNotes`**

```ts
export async function fetchSafetyNotes(destination: string): Promise<SafetyNote[] | null> {
  try {
    const url = new URL(GDELT_URL);
    url.searchParams.set("query", `${destination} tourist safety advisory scam warning`);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", "10");
    url.searchParams.set("sort", "datedesc");
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return distilSafetyNotes(await res.json());
  } catch {
    return null;
  }
}
```
No env var — GDELT needs no key.

- [ ] **Step 4: Rewrite `destinationSafety.test.mjs`**

Fixture → GDELT's verified real shape. `classifySeverity`'s existing tests already pass full
strings directly and shouldn't need changes — confirm and port unchanged.

- [ ] **Step 5: Run tests, typecheck, lint**

```bash
npm test 2>&1 | tail -15 && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/destinationSafety.ts src/lib/destinationSafety.test.mjs
git commit -m "Get safety notes from GDELT instead of Composio/Google News

GDELT's DOC 2.0 API is genuinely free, no key, no hard quota. It's a
metadata index, not a summarizer, so there's no snippet field —
classifySeverity now runs on title text alone, a real but accepted
accuracy reduction versus title+snippet."
```

---

### Task 3: Cut flights — full end-to-end removal

**Why full removal, not a stubbed always-null fetch:** `originCity` has exactly one consumer chain
in the whole codebase — resolving an airport, then a price. Nothing else reads it. A form field
whose price preview permanently never appears is a worse experience than no field at all, and
costs more to maintain. Every site below is a deletion, not a rewrite.

- [ ] **Step 1: Delete files**

```bash
git rm src/lib/flights.ts src/lib/flights.test.mjs src/lib/originAirport.ts src/app/api/flight-estimate/route.ts
# also remove src/lib/originAirport.test.mjs if it exists
```
Confirmed via grep: `originAirport.ts`'s only importers are `flight-estimate/route.ts` and
`generationRunner.ts`, both touched/removed in this task.

- [ ] **Step 2: Strip `flightCostUsd`/`originCity` from types**

`src/lib/types.ts` — remove `flightCostUsd?: number` from `Itinerary`; remove
`originCity: string | null` from `TripLogistics`.
`src/lib/userAnswers.ts` — remove the `originCity: sanitizeFreeText(logistics.originCity)` line
from `sanitizeLogistics`.

- [ ] **Step 3: Strip the generation pipeline**

`src/lib/generationRunner.ts` — remove the `flights`/`originAirport` imports, the
`flightEstimatePromise` construction, both `computeEffectiveBudget(...)` call sites (replace with
the plain `budget` value directly — there's no adjustment left to make), and the `flightCostUsd`
spread into the `itinerary` object literal.

- [ ] **Step 4: Strip budget/UI surfaces**

- `src/lib/guardrails.ts` — `tripSpend(itinerary.days) + (itinerary.flightCostUsd ?? 0)` becomes
  `tripSpend(itinerary.days)`.
- `src/components/BudgetBar.tsx` — remove the `flightCostUsd` prop and its "planned + flights"
  split/caption; `spent` reverts to `planned`.
- `src/components/ItineraryCard.tsx` — drop the `flightCostUsd` prop passed to `BudgetBar`.
- `src/lib/export/itineraryHtml.ts` — remove the `flightCostUsd` extraction and `flightLine` block.
- `src/app/trip/[id]/print/page.tsx` — remove the `flights` cost line.

- [ ] **Step 5: Strip `HomeView.tsx` (largest single diff in this task)**

Remove: `originCity` state, `flightCostPreview`/`flightPriceLoading`/`resolvedOriginIata` state,
the origin-airport-cache ref, both flight-pricing `useEffect` blocks, `originCity` from
persistence/dependency arrays and the outgoing `logistics` payload, the "Flying from" `Field`, the
flight-cost captions under the budget field, and the now-unused `Plane` icon import (keep
`PlaneLanding`/`PlaneTakeoff` — unrelated arrive/depart fields).

- [ ] **Step 6: Strip bench fixtures**

`src/lib/bench/customTrip.ts` — remove `originCity` from its input type and both build sites.
`src/lib/bench/fixtures.ts` — remove `originCity: null,` from its fixture literal.

- [ ] **Step 7: Verify, test, typecheck, lint**

```bash
grep -rn "flightCostUsd\|FlightEstimate\|originCity\|originAirport" src   # expect zero hits
npm test 2>&1 | tail -15 && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Cut flight price estimation entirely

No free or affordable real-time flight pricing API exists (Amadeus's
self-service tier, the only realistic option, shut down 2026-07-17).
Full removal rather than a stubbed always-null fetch: a 'Flying from'
field whose price preview permanently never appears is worse than no
field, and every downstream consumer of flightCostUsd already treats
its absence as \$0 or 'unknown' — nothing to preserve a stub for."
```

---

### Task 4: Cut lodging — full end-to-end removal, including the prompt layer

**Scope is bigger than "delete lodging.ts."** `src/lib/lodgingPrompt.ts` imports `LodgingOption`
from `lodging.ts` and has four functions (`formatLodging`, `lodgingInstruction`,
`lodgingPricingBasis`, `budgetInstruction`) that each branch on a `hasRealOptions: boolean`. Once
the fetch is gone, every call site's `hasRealOptions` computation is permanently `false` —
confirmed via grep, `hasRealOptions` has no callers outside `itineraryPrompt.ts`'s three call
sites (lines ~159-164 compute it live, ~196-197 and ~232 already hardcode `false`). So the `true`
branch of all four functions becomes permanently dead code the moment `lodging.ts` is deleted —
this needs its own cleanup, not just a file deletion.

- [ ] **Step 1: Delete `lodging.ts`**

```bash
git rm src/lib/lodging.ts src/lib/lodging.test.mjs
```

- [ ] **Step 2: Collapse `lodgingPrompt.ts` to its no-real-data path**

Delete `formatLodging` entirely (it only formats real fetched listings, which can no longer exist)
and its `LodgingOption` import. Collapse `lodgingInstruction`, `lodgingPricingBasis`,
`budgetInstruction` to drop the `hasRealOptions` parameter, keeping only the body of each
function's `false`/no-real-options branch as the function's entire behavior (inline it — no more
`if`).

- [ ] **Step 3: Update `itineraryPrompt.ts`**

Remove `import type { LodgingOption } from "./lodging"` and the `lodging?: LodgingOption[] | null`
field on the params interface. Remove the `${formatLodging(params.lodging ?? null)}` splice
(~line 157). Update every `lodgingInstruction(...)`, `lodgingPricingBasis(...)`,
`budgetInstruction(...)` call (~159-164, 196-197, 232) to the new zero-arg signatures.

- [ ] **Step 4: Strip `generationRunner.ts`**

Remove the `fetchLodgingOptions`/`reconcileLodging`/`LodgingOption` imports, the `lodgingOptions`
variable and its promise, and the `if (day.lodging) day.lodging = reconcileLodging(...)` call —
`day.lodging` is left exactly as the model wrote it, which was already the fallback path.

- [ ] **Step 5: Verify, test, typecheck, lint**

```bash
grep -rn "LodgingOption\|hasRealOptions\|reconcileLodging\|fetchLodgingOptions" src   # expect zero hits
npm test 2>&1 | tail -15 && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Cut hotel price/listing search entirely

Same reasoning as flights: no free or affordable real-time hotel
pricing API exists after Amadeus's shutdown. lodgingPrompt.ts's four
hasRealOptions branches all collapse to their no-real-data text now
that real options can never exist — dead code removed alongside the
fetch, not left behind as an unreachable path."
```

---

### Task 5: Place facts → OSM/Overpass, hours-only

**Files:** modify `src/lib/placeFacts.ts` (near-total rewrite), `src/lib/placeFacts.test.mjs`,
`src/lib/generationRunner.ts` (signature change at the enrichment call site, ~line 287). No
changes to `src/lib/placeConflicts.ts` — already verified null/false/empty-safe at every relevant
field access (`hoursByDay`, `crowdByDay`, `accessibility`, `bookAhead`, `admissionUsd`).

- [ ] **Step 1: Rewrite `fetchPlaceFacts` to reuse `poiDetails.ts`'s Overpass client**

No new network code — `src/lib/poiDetails.ts` already exports `fetchPoiOsmTags` and
`closedDaysFromOpeningHours`, used elsewhere in this app. New signature drops `destination:
string` in favor of `lat`/`lon` (OSM matching is coordinate-radius-based, not geocoded-by-name):

```ts
export async function fetchPlaceFacts(name: string, lat: number, lon: number): Promise<PlaceFacts | null> {
  const tagsByName = await fetchPoiOsmTags([{ name, lat, lon }]);
  if (tagsByName === null) return null; // network/HTTP failure
  const tags = tagsByName[name];
  if (!tags) return null; // queried fine, no OSM match — same null contract as before

  const hoursByDay = mapClosedDaysToHoursByDay(closedDaysFromOpeningHours(tags.openingHours));
  if (hoursByDay === null) return null; // nothing usable at all — same "empty payload" contract

  return { hoursByDay, admissionUsd: null, accessibility: [], bookAhead: false, rating: null, title: null, crowdByDay: null };
}
```

- [ ] **Step 2: Write `mapClosedDaysToHoursByDay`**

```ts
/** OSM only tells us which days are CLOSED, never open/close clock times — see
 *  closedDaysFromOpeningHours's own doc: it deliberately won't parse PH/off/quoted syntax. So
 *  every entry here is "Closed"; every other weekday is omitted, meaning "presumed open, hours
 *  unknown" rather than a guessed time range. Accepted capability loss: detectConflicts's
 *  publishedHours time-of-day check in placeConflicts.ts (the one needing an actual "9–11 AM,
 *  12–3 PM" string) will never fire under this path — not a bug to fix later. */
const OSM_DAY_TO_WEEKDAY: Record<string, string> = {
  Mo: "monday", Tu: "tuesday", We: "wednesday", Th: "thursday",
  Fr: "friday", Sa: "saturday", Su: "sunday",
};

function mapClosedDaysToHoursByDay(closedDays: string[] | null): Record<string, string> | null {
  if (closedDays === null || closedDays.length === 0) return null;
  const out: Record<string, string> = {};
  for (const day of closedDays) {
    const weekday = OSM_DAY_TO_WEEKDAY[day];
    if (weekday) out[weekday] = "Closed";
  }
  return Object.keys(out).length > 0 ? out : null;
}
```
This shape satisfies both verified downstream readers: `closedOnDate` reads
`facts.hoursByDay[weekday]` then tests `/closed/i` — matches `"Closed"` exactly.
`detectConflicts`'s `publishedHours` line reads `f.hoursByDay?.[weekday] ?? null` — returns
`"Closed"` on a closed day and `null` (never a fabricated hours string) on every other day.

- [ ] **Step 3: Delete dead code from `placeFacts.ts`**

Delete `normalizeHours` (Google's two-shape hours parser), `extensionValues`, `pickAdmission`,
`normalizeCrowd`, the `WEEKDAYS` constant, the `TOOL_SLUG` constant and `runComposioTool` import,
and `titleMatches`/`normalizeForMatch` — confirmed via grep, `titleMatches`'s only caller was
`fetchPlaceFacts`'s own now-removed title-mismatch rejection (OSM matches by exact name+radius,
not fuzzy title matching); it has zero other callers in the codebase.

- [ ] **Step 4: Update the caller in `generationRunner.ts`**

Build a `Map<string, {lat, lng}>` from `itinerary.days`' stops once, look up each enrichment name
against it, and skip (don't call `fetchPlaceFacts`) for any name whose stop has no numeric
`lat`/`lng` — matching the existing `typeof s.lat === "number"` filter pattern already used a few
lines below for the route-matrix fetch. Keep `selectStopsToEnrich` in `placeConflicts.ts`
untouched (still a pure name-set function) — do the coordinate lookup at this call site instead.

- [ ] **Step 5: Rewrite `placeFacts.test.mjs`**

Delete every test for `normalizeHours`, `pickAdmission`, `normalizeCrowd`, `bookAhead` extraction,
and `titleMatches` (all gone). Add tests for `mapClosedDaysToHoursByDay`: a closed-day list →
`{tuesday: "Closed"}`; `null` input → `null`; `[]` (24/7) input → `null`. Don't attempt to test
`fetchPlaceFacts` itself (would need mocking `fetch`) — matches this repo's existing convention of
unit-testing only the pure distiller and leaving the network wrapper untested.

- [ ] **Step 6: Verify, test, typecheck, lint**

```bash
npm test 2>&1 | tail -15 && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/placeFacts.ts src/lib/placeFacts.test.mjs src/lib/generationRunner.ts
git commit -m "Rebuild place facts on the Overpass client this repo already has

Composio's COMPOSIO_SEARCH_GOOGLE_MAPS becomes a thin wrapper over
poiDetails.ts's existing fetchPoiOsmTags — no new vendor, no new
network code. admissionUsd, accessibility, rating, and crowdByDay are
dropped permanently: crowd/'popular times' has no free source
anywhere, and OSM's admission/accessibility tag coverage is too sparse
to be a real signal. Only a closed-days-derived hoursByDay survives.
placeConflicts.ts needs no changes — every field it reads was already
independently nullable."
```

---

### Task 6: Destination festivals → Brave Search API

**Files:** modify `src/lib/destinationFestivals.ts`, `src/lib/destinationFestivals.test.mjs`,
`.env.local.example`, `README.md`, `CLAUDE.md`. No change to `destinationContext.ts:51` (signature
unchanged).

**Requires a `BRAVE_API_KEY`** — sign up at brave.com/search/api before this task can be
live-verified. No free tier as of 2026: $5/month prepaid credit, card required, then metered
~$0.003-0.005/query. This app's real volume (~1 search per trip generation) keeps expected cost
well under $1/month.

- [ ] **Step 1: Verify Brave's response shape live**

```bash
curl -s -H "X-Subscription-Token: $BRAVE_API_KEY" \
  "https://api.search.brave.com/res/v1/web/search?q=festivals+events+in+Paris+September+2026"
```
Confirm `web.results[]`'s exact fields (expected: `title`, `url`, `description`) and whether an
empty-results response omits `web` entirely or returns `{web: {results: []}}`.

- [ ] **Step 2: Write the results→answer/citations adapter**

Composio's `COMPOSIO_SEARCH_WEB` apparently returned one synthesized `answer` string plus a
parallel `citations[]` array; Brave's plain web search returns only a results list, where each
item already carries both the extractable text and its own citation. Synthesize the old shape from
the results list, numbered, so `buildFestivalExtractionPrompt`'s existing tested contract (cite by
`[n]`, never invent a date, return `[]` if nothing extractable) needs no changes:

```ts
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS_FOR_EXTRACTION = 8;

interface BraveResult { title: string | null; description: string | null; url: string | null; }

function distilBraveResults(raw: unknown, limit = MAX_RESULTS_FOR_EXTRACTION): BraveResult[] {
  const results = (raw as { web?: { results?: unknown } } | null)?.web?.results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, limit).map((entry) => {
    const r = entry as Record<string, unknown> | null;
    return {
      title: typeof r?.title === "string" ? r.title : null,
      description: typeof r?.description === "string" ? r.description : null,
      url: typeof r?.url === "string" ? r.url : null,
    };
  });
}

export function hasExtractableContent(raw: unknown): boolean {
  return distilBraveResults(raw).some((r) => r.title && r.description);
}

function buildTextAndCitations(results: BraveResult[]): { text: string; citations: WebCitation[] } {
  const usable = results.filter((r) => r.title && r.description);
  return {
    text: usable.map((r, i) => `[${i + 1}] ${r.title}: ${r.description}`).join("\n"),
    citations: usable.map((r) => ({ title: r.title, url: r.url })),
  };
}
```

- [ ] **Step 3: Rewrite `fetchFestivals`**

```ts
export async function fetchFestivals(destination: string, startDate: string, runId?: string): Promise<Festival[] | null> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return null;
  try {
    const url = new URL(BRAVE_SEARCH_URL);
    url.searchParams.set("q", `festivals events in ${destination} ${monthYearLabel(startDate)}`);
    const res = await fetch(url, { headers: { "X-Subscription-Token": apiKey }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!hasExtractableContent(data)) return [];
    const { text, citations } = buildTextAndCitations(distilBraveResults(data));
    const prompt = buildFestivalExtractionPrompt(text, citations);
    const { result: raw } = await runClaude(prompt, "context", DEFAULT_TIMEOUT_MS, { runId });
    return parseJsonResponse<Festival[]>(raw);
  } catch {
    return null;
  }
}
```
`buildFestivalExtractionPrompt`'s signature and its 5 existing tests are unchanged — they build
`WebCitation[]` by hand already, not via a Composio-shaped helper. Remove the now-unused
`runComposioTool`/`SEARCH_SLUG`/`distilCitations` code.

- [ ] **Step 4: Document `BRAVE_API_KEY`**

`.env.local.example`, matching the `YELP_API_KEY` block's style — sign-up link, the pricing
reality (no free tier, $5/month prepaid credit, card required, ~$0.003-0.005/query metered after),
this app's low real volume, and the fail-soft degrade.

`README.md`'s degrade-soft table — one row, same style as the `YELP_API_KEY` row.

`CLAUDE.md`'s "Data sources" paragraph — append Brave Search with its purpose and env var, and
recount the parenthetical ("most free; N need keys") against the running total (Tasks 1, 2, 5 add
no keys; this makes Yelp + OpenTripMap + Brave = 3 keyed sources).

- [ ] **Step 5: Rewrite `destinationFestivals.test.mjs`**

`hasExtractableContent`'s fixtures → the Brave shape (`{web: {results: [...]}}`), including the
verified real empty-results shape from Step 1. `buildFestivalExtractionPrompt`'s tests port
unchanged.

- [ ] **Step 6: Verify, test, typecheck, lint**

```bash
npm test 2>&1 | tail -15 && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/destinationFestivals.ts src/lib/destinationFestivals.test.mjs .env.local.example README.md CLAUDE.md
git commit -m "Get festival search results from Brave instead of Composio

Brave's plain web search returns a results list, not Composio's
apparent single synthesized answer string, so the extraction prompt's
input is now synthesized from the results list itself (numbered,
doubling as its own citation list) rather than changing
buildFestivalExtractionPrompt's tested contract. Brave's free tier is
also gone as of 2026 — accepted as small pay-as-you-go, same tradeoff
already made for Yelp."
```

---

## Whole-plan verification

After all 6 tasks: `grep -rln "composio" src` should return exactly one file —
`src/lib/composio.ts` itself, now with zero callers left in this codebase (it stays per the
global constraint of not touching it in this plan).
