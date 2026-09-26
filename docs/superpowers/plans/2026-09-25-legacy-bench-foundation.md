# Legacy-Path Bench Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scripts/skill-ab.mjs` measure the `/api/itinerary` path travellers actually get. That means N repeats per fixture, fair scoring, a dietary check, and a hard-failure gate whose headline is the critical-trip failure rate.

**Architecture:** Pure scoring logic lives in `src/lib/bench/`, where `node --test` can reach it:
- a coordinate fallback in the route scorers;
- `scoreDietary` in `scorers/context.ts`;
- a new `criticalFailures.ts` gate;
- a new `sweep.ts` with run-aggregation helpers.

`scripts/skill-ab.mjs` stays the only driver. It still stores raw output only and still scores at report/compare time. It gains `AB_RUNS`, a `node:http` transport for the legacy arm, captured weather, and a `--report` mode.

**Tech Stack:** Node ≥ 22 ESM, TypeScript modules loaded through `scripts/ts-resolve.mjs`, `node:test` + `node:assert/strict`, and `node:http`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-25-legacy-bench-foundation-design.md`

**Worktree:** `/Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app` (branch `react-native-app`). Run every command from there.

## Global Constraints

- **No new dependencies.** Undici's `Agent` is not importable without adding the package; use `node:http`.
- **`COMPOSITE_WEIGHTS` is frozen.** `dietary` is a reported field and is never added to `compositeGroups`.
- **`AB_RUNS` defaults to 1**, so existing `skill-ab.mjs` usage is unchanged. Old arm files (cells with no `runs`) must still load.
- **Commit messages carry no trailer of any kind:** no `Co-Authored-By`, no "Generated with". This is per CLAUDE.md.
- **`.test.mjs` import specifiers carry an explicit `.ts` extension.**
- **Other sessions edit sibling checkouts.** Stage files by explicit path only, never `git add -A`.
- **Test run command:** `node --import ./scripts/ts-resolve.mjs --test <file>`. Full suite: `npm test`.
- **Critical codes, exactly:** `closed_or_hours`, `pace`, `mobility`, `overlap`, `commitment`, `must_include`, `excluded`, `missing_anchor`, `over_budget`, `duplicate`, `dietary`, `travel_leg`, `generation_failed`.

## Review Focus

1. **An arm file written before this change**: `cells[]` with no `runs` field. `--report` and `--compare` must read each cell as one run, not crash or report 0 runs. Tested in Task 4 (`runsOf`).
2. **A fixture where every run failed.** The summary must print `n/a` for mean and worst, `N/N` critical, and no `NaN`. Tested in Task 4.
3. **Stops the legacy path could not resolve arrive at `0,0`.** The coordinate fallback must not turn those into a located stop in the Gulf of Guinea. Tested in Task 1.
4. **Word boundaries in dietary deny lists.** "Hamburg Hauptbahnhof" must not read as ham, and "Almond Blossom Café" does count for a nut allergy. Tested in Task 2.
5. **A trip with no dietary answer, or no logistics.** Every related check is unmeasured or a no-op, never a failure. Tested in Tasks 2 and 3.

---

### Task 1: Route scorers fall back to the stop's own coordinates

**Files:**
- Modify: `src/lib/bench/scorers/domain.ts` (add `locateEntry` after `findPoi` at ~line 101; use it in `scoreGeoCoherence` at ~line 228)
- Modify: `src/lib/bench/scorers/route.ts` (`locatedStops` ~line 147, `scoreMealProximity` ~lines 262-263)
- Test: `src/lib/bench/bench.test.mjs`

**Do NOT change** the `findPoi` calls at `domain.ts:~432` (crowd bias) or `domain.ts:~614` (grounding). Those ask "is this a known landmark / listed candidate", not "where is it". A fallback there would make every stop a landmark. The spec listed `domain.ts:432` in error; this plan corrects it.

**Interfaces:**
- Produces: `export function locateEntry(entry: ParsedEntry, pois: LocatedPoi[]): LocatedPoi | null` in `scorers/domain.ts`

- [ ] **Step 1: Write the failing tests.** Append to `src/lib/bench/bench.test.mjs`:

```js
// --- coordinate fallback (legacy-path stops are rarely in the fixture's POI list) ---

const located = (name, lat, lng, startMin) => ({
  raw: name,
  name,
  window: { startMin, endMin: startMin + 60 },
  durationMin: 60,
  category: "entry",
  costUsd: null,
  lat,
  lng,
  why: null,
  note: null,
  transport: null,
  areaLevel: false,
  slot: startMin < 12 * 60 ? "Morning" : startMin < 17 * 60 ? "Afternoon" : "Evening",
});

const locatedDay = (...entries) => ({
  headingRaw: "## 2026-09-19",
  date: "2026-09-19",
  dayOfWeek: "Saturday",
  theme: null,
  weather: null,
  lodging: null,
  entriesBySlot: {
    Morning: entries.filter((e) => e.slot === "Morning"),
    Afternoon: entries.filter((e) => e.slot === "Afternoon"),
    Evening: entries.filter((e) => e.slot === "Evening"),
  },
  stayNear: null,
  note: null,
});

// Names deliberately absent from the Kyoto fixture, so only their own coordinates can place them.
const OFF_LIST = () =>
  ({ days: [locatedDay(
    located("Tiny Tea House North", 35.04, 135.73, 9 * 60),
    located("Back Alley Gallery", 35.0, 135.77, 11 * 60),
    located("Riverside Noodle Bar", 34.97, 135.77, 13 * 60),
  )], preamble: "", hadCodeFence: false });

test("unlisted stops are located by their own coordinates", () => {
  const geo = scoreGeoCoherence(OFF_LIST(), KYOTO);
  assert.equal(geo.matchedLegs, 2);
  assert.notEqual(geo.normalized, null);
  assert.equal(scoreBacktrack(OFF_LIST(), KYOTO).scoredDays, 1);
});

test("a stop at 0,0 is unresolved, not located", () => {
  const p = OFF_LIST();
  p.days[0].entriesBySlot.Morning[0].lat = 0;
  p.days[0].entriesBySlot.Morning[0].lng = 0;
  assert.equal(scoreGeoCoherence(p, KYOTO).matchedLegs, 1);
  assert.equal(scoreBacktrack(p, KYOTO).scoredDays, 0, "two located stops is no ordering to judge");
});
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/bench.test.mjs`
Expected: both new tests FAIL (`matchedLegs` 0 ≠ 2).

- [ ] **Step 3: Add `locateEntry` to `scorers/domain.ts`** directly below `findPoi`:

```ts
/**
 * Where an entry is: the fixture's POI when the name matches, else the model's own coordinates.
 *
 * The legacy path picks stops from memory and never sees a candidate list, so most of its stops
 * miss `findPoi` — but their lat/lng were already resolved against Overpass by
 * `resolveNamedPlaceCoords`. Without this, backtrack, geo coherence and meal proximity go
 * unmeasured on the path travellers actually get. 0,0 is the unresolved sentinel, not a place.
 */
export function locateEntry(entry: ParsedEntry, pois: LocatedPoi[]): LocatedPoi | null {
  const known = findPoi(entry.name, pois);
  if (known) return known;
  const { lat, lng } = entry;
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { name: entry.name, lat, lon: lng };
}
```

Make sure `ParsedEntry` is imported as a type in `domain.ts`. If it isn't already, add `import type { ParsedEntry } from "../parseItinerary";`.

- [ ] **Step 4: Use it at the three coordinate call sites.**

In `scoreGeoCoherence` (`domain.ts`):
```ts
      .map((e) => locateEntry(e, pois))
```

In `route.ts`, change the import to `import { findPoi, locateEntry } from "./domain";` (drop `findPoi` if it becomes unused), then in `locatedStops`:
```ts
    .map((entry) => (entry.areaLevel ? null : locateEntry(entry, pois)))
```
and in `scoreMealProximity`:
```ts
      const from = previous.areaLevel ? null : locateEntry(previous, pois);
      const to = entry.areaLevel ? null : locateEntry(entry, pois);
```

- [ ] **Step 5: Run the file and confirm it passes.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/bench.test.mjs`
Expected: all PASS, including every pre-existing test.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/bench/scorers/domain.ts src/lib/bench/scorers/route.ts src/lib/bench/bench.test.mjs
git commit -m "Place a stop by its own coordinates when the fixture does not know it"
```

---

### Task 2: Dietary scorer

**Files:**
- Modify: `src/lib/bench/types.ts` (add `DietaryScore`; add `dietary: DietaryScore` to `BenchCellScores` after `mustInclude`)
- Modify: `src/lib/bench/scorers/context.ts` (add `scoreDietary`)
- Modify: `src/lib/bench/runBenchmark.ts` (`scoreParsed`: add `dietary: scoreDietary(parsed, answers.dietary ?? null)`; add `dietary` to the "reported here but absent from compositeGroups" docstring list)
- Test: `src/lib/bench/bench.test.mjs`

**Interfaces:**
- Consumes: `DietaryNeeds` (`{ tags: string[]; note: string }`) from `src/lib/travelerProfile.ts`
- Produces:
  ```ts
  export interface DietaryScore {
    /** Entries categorised `food` — the denominator. */
    foodStops: number;
    /** Food stops whose text names something the stated diet or allergy rules out. */
    contradictions: number;
    /** Food stops that mention the diet (or a synonym) at all. Reported, never critical. */
    acknowledged: number;
    /** `"<stop name>: <term>"` for each contradiction, for the report. */
    flagged: string[];
    /** 1 − contradictions/foodStops; null when no diet was stated or there are no food stops. */
    normalized: number | null;
  }
  export function scoreDietary(itinerary: ParsedItinerary, dietary: DietaryNeeds | null): DietaryScore
  ```

- [ ] **Step 1: Write the failing tests.** Add `scoreDietary` to the existing `./scorers/context.ts` import line in `bench.test.mjs`, then append the following. They reuse `located`/`locatedDay` from Task 1.

```js
// --- dietary ---

const food = (name, why = null) => ({ ...located(name, 41.39, 2.17, 13 * 60), category: "food", why });
const onePlan = (...entries) => ({ days: [locatedDay(...entries)], preamble: "", hadCodeFence: false });

test("scoreDietary is unmeasured when no diet was stated", () => {
  assert.equal(scoreDietary(onePlan(food("Steak House")), null).normalized, null);
  assert.equal(scoreDietary(onePlan(food("Steak House")), { tags: [], note: "" }).normalized, null);
});

test("scoreDietary flags a vegan trip sent to a steakhouse", () => {
  const s = scoreDietary(onePlan(food("El Asador Steak House"), food("Veggie Garden", "fully vegan menu")), {
    tags: ["Vegan"],
    note: "",
  });
  assert.equal(s.foodStops, 2);
  assert.equal(s.contradictions, 1);
  assert.equal(s.acknowledged, 1);
  assert.equal(s.normalized, 0.5);
  assert.match(s.flagged[0], /steak/);
});

test("scoreDietary reads an allergy out of the free-text note", () => {
  const s = scoreDietary(onePlan(food("Almond Blossom Café")), { tags: [], note: "severe tree-nut allergy" });
  assert.equal(s.contradictions, 1);
});

test("scoreDietary matches whole words, so Hamburg is not ham", () => {
  const s = scoreDietary(onePlan(food("Hamburg Hauptbahnhof Food Hall")), { tags: ["Halal"], note: "" });
  assert.equal(s.contradictions, 0);
});

test("scoreDietary catches a peanut allergy stated in the note", () => {
  const s = scoreDietary(onePlan(food("Satay Street Stall")), { tags: [], note: "peanut allergy" });
  assert.equal(s.contradictions, 1);
});

test("scoreDietary ignores non-food stops", () => {
  const s = scoreDietary(onePlan(located("Steak Museum", 41.39, 2.17, 10 * 60)), { tags: ["Vegan"], note: "" });
  assert.equal(s.foodStops, 0);
  assert.equal(s.normalized, null);
});
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/bench.test.mjs`
Expected: FAIL with `scoreDietary` not exported.

- [ ] **Step 3: Add `DietaryScore` to `types.ts`** (the interface above, placed after `CommitmentScore`), and `dietary: DietaryScore;` in `BenchCellScores` after `mustInclude`.

- [ ] **Step 4: Implement `scoreDietary` in `scorers/context.ts`.** Add `DietaryScore` to the `../types` import, add `import type { DietaryNeeds } from "../../travelerProfile";`, then:

```ts
// --- dietary ---------------------------------------------------------------------------------

/** Words that, on a food stop, name something the diet rules out. Keys are lower-cased
 *  `DIETARY_TAGS` (src/components/DietaryPicker.tsx), plus "nut" for an allergy in the note. */
const DIET_DENY: Record<string, string[]> = {
  vegan: ["steak", "steakhouse", "bbq", "barbecue", "jamón", "jamon", "ham", "chicken", "pork", "beef", "lamb", "seafood", "fish", "sushi", "oyster", "cheese", "burger"],
  vegetarian: ["steak", "steakhouse", "bbq", "barbecue", "jamón", "jamon", "ham", "chicken", "pork", "beef", "lamb", "seafood", "fish", "sushi", "oyster", "burger"],
  pescatarian: ["steak", "steakhouse", "bbq", "barbecue", "jamón", "jamon", "ham", "chicken", "pork", "beef", "lamb", "burger"],
  halal: ["pork", "jamón", "jamon", "ham", "bacon", "brewery", "beer hall"],
  kosher: ["pork", "jamón", "jamon", "ham", "bacon", "shellfish", "oyster"],
  "gluten-free": ["bakery", "pasta", "pizza", "pizzeria", "ramen", "udon", "brewery"],
  "dairy-free": ["cheese", "gelato", "gelateria", "creamery", "fondue"],
  "nut allergy": ["almond", "pistachio", "praline", "marzipan", "hazelnut", "walnut", "pecan", "peanut", "satay", "nutella"],
};

/** A food stop "acknowledges" the diet when it says so. Soft — reported, never critical. */
const DIET_ACK: Record<string, string[]> = {
  vegan: ["vegan", "plant-based"],
  vegetarian: ["vegetarian", "veggie", "vegan", "plant-based"],
  pescatarian: ["pescatarian", "vegetarian", "seafood", "fish"],
  halal: ["halal"],
  kosher: ["kosher"],
  "gluten-free": ["gluten-free", "gluten free", "celiac", "coeliac"],
  "dairy-free": ["dairy-free", "dairy free", "vegan"],
  "nut allergy": ["nut-free", "nut free", "allergy", "allergen"],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, Unicode-aware: "Hamburg" is not "ham", "jamón" still matches. */
const wordHit = (text: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "iu").test(text);

/**
 * dietary — do the food stops fit what the traveller can eat?
 *
 * ponytail: keyword proxy — a steakhouse with a vegan menu is a false positive; the judge spec
 * replaces this. Reported beside the composite, never inside it (see COMPOSITE_WEIGHTS).
 */
export function scoreDietary(itinerary: ParsedItinerary, dietary: DietaryNeeds | null): DietaryScore {
  const keys = (dietary?.tags ?? []).map((t) => t.toLowerCase()).filter((k) => k in DIET_DENY);
  if (dietary?.note && /(?<![\p{L}])(?:pea)?nuts?(?![\p{L}])/iu.test(dietary.note)) keys.push("nut allergy");
  const active = [...new Set(keys)];

  const foods = itinerary.days.flatMap(dayEntries).filter((e) => e.category === "food");
  const empty = { foodStops: foods.length, contradictions: 0, acknowledged: 0, flagged: [], normalized: null };
  if (active.length === 0 || foods.length === 0) return empty;

  let contradictions = 0;
  let acknowledged = 0;
  const flagged: string[] = [];
  for (const entry of foods) {
    const text = [entry.name, entry.why, entry.note].filter(Boolean).join(" ");
    const hit = active.flatMap((k) => DIET_DENY[k]).find((w) => wordHit(text, w));
    if (hit) {
      contradictions++;
      flagged.push(`${entry.name}: ${hit}`);
    }
    if (active.some((k) => DIET_ACK[k].some((w) => wordHit(text, w)))) acknowledged++;
  }
  return { foodStops: foods.length, contradictions, acknowledged, flagged, normalized: 1 - contradictions / foods.length };
}
```

- [ ] **Step 5: Wire it into `scoreParsed`** in `runBenchmark.ts`. Import `scoreDietary` from `./scorers/context`, and add after `mustInclude`:
```ts
    dietary: scoreDietary(parsed, answers.dietary ?? null),
```
Update the docstring line to: `` `duplicates`, `commitments`, `mustInclude` and `dietary` are reported here but deliberately absent from ``.

- [ ] **Step 6: Run the tests, the typecheck and the full suite.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/bench.test.mjs && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: all PASS, tsc clean. If tsc reports another `BenchCellScores` literal missing `dietary` (e.g. a UI fallback), add `dietary` there with `normalized: null`.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/bench/types.ts src/lib/bench/scorers/context.ts src/lib/bench/runBenchmark.ts src/lib/bench/bench.test.mjs
git commit -m "Score whether the food stops fit what the traveller can eat"
```
(Add any extra file tsc forced you to touch, by path.)

---

### Task 3: Hard-failure gate

**Files:**
- Create: `src/lib/bench/criticalFailures.ts`
- Test: `src/lib/bench/criticalFailures.test.mjs`

**Interfaces:**
- Consumes: `BenchCellScores` (incl. `dietary` from Task 2), `evaluateItinerary` from `src/lib/guardrails.ts`, `Itinerary`/`TransportMode` from `src/lib/types.ts`
- Produces:
  ```ts
  export type CriticalCode = "closed_or_hours" | "pace" | "mobility" | "overlap" | "commitment" | "must_include" | "excluded" | "missing_anchor" | "over_budget" | "duplicate" | "dietary" | "travel_leg" | "generation_failed";
  export function criticalFailures(
    scores: BenchCellScores,
    opts?: { itinerary?: Itinerary | null; modes?: TransportMode[] }
  ): CriticalCode[]
  ```
  (`generation_failed` is in the type for callers; this function never returns it. The sweep adds it for failed runs.)

- [ ] **Step 1: Write the failing tests** in `src/lib/bench/criticalFailures.test.mjs`:

```js
/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/bench/criticalFailures.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { criticalFailures } from "./criticalFailures.ts";

/** Only the fields the gate reads — every one set to its passing value. */
const clean = () => ({
  constraints: { byType: { opening_hours: 0, closed_day: 0, daylight: 0, pace: 0, mobility: 0, crowd_bias: 0 } },
  feasibility: { overlaps: 0 },
  commitments: { breaches: [] },
  mustInclude: { missing: [], violated: [] },
  coverage: { missingAnchors: [] },
  budget: { budgetUsedFraction: 0.9 },
  duplicates: { repeats: 0 },
  dietary: { contradictions: 0 },
});

test("a clean run passes the gate", () => {
  assert.deepEqual(criticalFailures(clean()), []);
});

const cases = [
  ["closed_or_hours", (s) => (s.constraints.byType.closed_day = 1)],
  ["closed_or_hours", (s) => (s.constraints.byType.opening_hours = 2)],
  ["pace", (s) => (s.constraints.byType.pace = 1)],
  ["mobility", (s) => (s.constraints.byType.mobility = 1)],
  ["overlap", (s) => (s.feasibility.overlaps = 1)],
  ["commitment", (s) => s.commitments.breaches.push({ dayIndex: 0, name: "x", reason: "departure" })],
  ["must_include", (s) => s.mustInclude.missing.push("Louvre")],
  ["excluded", (s) => s.mustInclude.violated.push({ term: "bar", stopName: "Bar X" })],
  ["missing_anchor", (s) => s.coverage.missingAnchors.push("Kinkaku-ji")],
  ["over_budget", (s) => (s.budget.budgetUsedFraction = 1.2)],
  ["duplicate", (s) => (s.duplicates.repeats = 1)],
  ["dietary", (s) => (s.dietary.contradictions = 1)],
];
for (const [code, breakIt] of cases) {
  test(`${code} is critical`, () => {
    const s = clean();
    breakIt(s);
    assert.deepEqual(criticalFailures(s), [code]);
  });
}

test("soft conditions never fail the gate", () => {
  const s = clean();
  s.constraints.byType.crowd_bias = 3;
  s.constraints.byType.daylight = 2;
  s.budget.budgetUsedFraction = 0.4; // under target is not a breach — §5 is a ceiling
  assert.deepEqual(criticalFailures(s), []);
  s.budget.budgetUsedFraction = null; // and unmeasurable is not a breach either
  assert.deepEqual(criticalFailures(s), []);
});

test("an unmeasured dietary score is not a failure", () => {
  const s = clean();
  s.dietary = { contradictions: 0, normalized: null };
  assert.deepEqual(criticalFailures(s), []);
});

test("travel_leg is only checked when the typed itinerary is supplied", () => {
  const tight = {
    tier: "comfort",
    days: [{
      date: "2026-09-19",
      weather: "",
      stops: [
        { name: "A", lat: 35.0, lng: 135.7, cost: 0, note: "", time: "9:00 AM", durationLabel: "1h", category: "entry" },
        { name: "B", lat: 35.1, lng: 135.9, cost: 0, note: "", time: "10:05 AM", durationLabel: "1h", category: "entry" },
      ],
    }],
  };
  assert.deepEqual(criticalFailures(clean()), [], "no itinerary, no travel check");
  assert.deepEqual(criticalFailures(clean(), { itinerary: tight, modes: ["walk"] }), ["travel_leg"]);
});
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/criticalFailures.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/bench/criticalFailures.ts`:**

```ts
import { evaluateItinerary } from "../guardrails";
import type { Itinerary, TransportMode } from "../types";
import type { BenchCellScores } from "./types";

export type CriticalCode =
  | "closed_or_hours"
  | "pace"
  | "mobility"
  | "overlap"
  | "commitment"
  | "must_include"
  | "excluded"
  | "missing_anchor"
  | "over_budget"
  | "duplicate"
  | "dietary"
  | "travel_leg"
  | "generation_failed";

/**
 * The run's hard failures — any one of them and the trip failed, whatever its composite says.
 *
 * A weighted composite averages a closed-day visit away; a traveller standing at a locked door
 * does not. So these are pass/fail, read off the scorers that already exist rather than
 * re-derived. Deliberately soft and absent here: crowd timing, daylight, budget under target
 * (§5 is a ceiling), starred-priority coverage, unacknowledged dietary stops.
 *
 * `travel_leg` needs typed stops, so it runs only for the legacy arm's JSON, through the same
 * `evaluateItinerary` rule the UI shows; staged markdown has no typed legs.
 */
export function criticalFailures(
  scores: BenchCellScores,
  opts: { itinerary?: Itinerary | null; modes?: TransportMode[] } = {}
): CriticalCode[] {
  const s = scores;
  const codes: CriticalCode[] = [];
  const by = s.constraints.byType;
  if (by.opening_hours + by.closed_day > 0) codes.push("closed_or_hours");
  if (by.pace > 0) codes.push("pace");
  if (by.mobility > 0) codes.push("mobility");
  if (s.feasibility.overlaps > 0) codes.push("overlap");
  if (s.commitments.breaches.length > 0) codes.push("commitment");
  if (s.mustInclude.missing.length > 0) codes.push("must_include");
  if (s.mustInclude.violated.length > 0) codes.push("excluded");
  if (s.coverage.missingAnchors.length > 0) codes.push("missing_anchor");
  if (s.budget.budgetUsedFraction !== null && s.budget.budgetUsedFraction > 1) codes.push("over_budget");
  if (s.duplicates.repeats > 0) codes.push("duplicate");
  if (s.dietary.contradictions > 0) codes.push("dietary");
  if (opts.itinerary) {
    const travel = evaluateItinerary(opts.itinerary, { modes: opts.modes }).some((g) => g.rule === "travel");
    if (travel) codes.push("travel_leg");
  }
  return codes;
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/criticalFailures.test.mjs`
Expected: all PASS.

If the `travel_leg` case fails because `evaluateDay` estimates the 0.2° walk leg as fitting in 5 minutes, widen the gap in the fixture: move B further, e.g. `lat: 35.3`. Do not change the guardrail. Also check that `evaluateItinerary` reads `transport` minutes from `note` before relying on straight-line estimates; read `evaluateDay` at `guardrails.ts:~168` to confirm which input it uses.

- [ ] **Step 5: Typecheck, then commit.**
Run: `npx tsc --noEmit -p tsconfig.json`
```bash
git add src/lib/bench/criticalFailures.ts src/lib/bench/criticalFailures.test.mjs
git commit -m "Fail a trip on any hard violation instead of averaging it away"
```

---

### Task 4: Sweep helpers (weather the model saw, grounding out, run aggregation)

**Files:**
- Create: `src/lib/bench/sweep.ts`
- Test: `src/lib/bench/sweep.test.mjs`

**Interfaces:**
- Consumes: `BenchFixture` (`./fixtures`), `BenchCellScores` (`./types`), `DayWeather` (`../weather`)
- Produces:
  ```ts
  export function withSeenWeather(fixture: BenchFixture, days: DayWeather[]): BenchFixture
  export function withoutGrounding(scores: BenchCellScores): BenchCellScores
  export function runsOf<T extends object>(cell: T & { runs?: T[] }): T[]
  export interface ScoredRun { failed: boolean; composite: number | null; critical: string[]; costUsd: number; wallMs: number }
  export interface RunSummary { n: number; meanComposite: number | null; worstComposite: number | null; criticalRuns: number; codes: string[]; meanCostUsd: number; meanWallMs: number }
  export function summarizeRuns(runs: ScoredRun[]): RunSummary
  export function criticalRate(runs: ScoredRun[]): { failing: number; total: number; rate: number | null }
  ```

- [ ] **Step 1: Write the failing tests** in `src/lib/bench/sweep.test.mjs`:

```js
/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/bench/sweep.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { getFixture } from "./fixtures.ts";
import { criticalRate, runsOf, summarizeRuns, withSeenWeather, withoutGrounding } from "./sweep.ts";

const KYOTO = getFixture("kyoto-couple-mixed");

test("withSeenWeather swaps only the weather, and leaves the frozen fixture alone", () => {
  const seen = [{ date: "2026-09-19", tempMaxC: 30, tempMinC: 20, precipitationProbability: 90, humidity: 80, weatherCode: 61, sunrise: null, sunset: null, historical: true }];
  const before = JSON.stringify(KYOTO.reconciled.rawFetch.weather);
  const f = withSeenWeather(KYOTO, seen);
  assert.deepEqual(f.reconciled.rawFetch.weather, { available: true, historical: true, days: seen });
  assert.equal(JSON.stringify(KYOTO.reconciled.rawFetch.weather), before);
  assert.equal(f.reconciled.rawFetch.destination, KYOTO.reconciled.rawFetch.destination);
  assert.equal(withSeenWeather(KYOTO, []).reconciled.rawFetch.weather.available, false);
});

test("withoutGrounding nulls grounding and nothing else", () => {
  const scores = { grounding: { namedStops: 5, normalized: 0.2 }, coverage: { normalized: 0.8 } };
  const out = withoutGrounding(scores);
  assert.equal(out.grounding.normalized, null);
  assert.equal(out.grounding.namedStops, 5);
  assert.equal(out.coverage.normalized, 0.8);
  assert.equal(scores.grounding.normalized, 0.2, "input untouched");
});

test("runsOf reads an arm file written before repeats existed", () => {
  const old = { fixtureId: "x", itineraryMd: "md" };
  assert.deepEqual(runsOf(old), [old]);
  const now = { fixtureId: "x", runs: [{ a: 1 }, { a: 2 }] };
  assert.equal(runsOf(now).length, 2);
});

const run = (composite, critical = [], failed = false) => ({ failed, composite, critical, costUsd: 1, wallMs: 1000 });

test("summarizeRuns reports mean, worst, and distinct codes", () => {
  const s = summarizeRuns([run(0.9), run(0.7, ["duplicate"]), run(0.8, ["duplicate", "pace"])]);
  assert.equal(s.n, 3);
  assert.ok(Math.abs(s.meanComposite - 0.8) < 1e-9);
  assert.equal(s.worstComposite, 0.7);
  assert.equal(s.criticalRuns, 2);
  assert.deepEqual(s.codes, ["duplicate", "pace"]);
});

test("summarizeRuns on all-failed runs has no NaN", () => {
  const s = summarizeRuns([run(null, ["generation_failed"], true), run(null, ["generation_failed"], true)]);
  assert.equal(s.meanComposite, null);
  assert.equal(s.worstComposite, null);
  assert.equal(s.criticalRuns, 2);
  assert.ok(!Number.isNaN(s.meanCostUsd));
});

test("criticalRate is failing runs over all runs", () => {
  assert.deepEqual(criticalRate([run(0.9), run(0.8, ["pace"]), run(null, ["generation_failed"], true), run(0.7)]), {
    failing: 2,
    total: 4,
    rate: 0.5,
  });
  assert.equal(criticalRate([]).rate, null);
});
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/sweep.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/bench/sweep.ts`:**

```ts
import type { DayWeather } from "../weather";
import type { BenchFixture } from "./fixtures";
import type { BenchCellScores } from "./types";

/**
 * The fixture, but with the weather the model was actually given.
 *
 * The legacy path fetches its own live forecast; the frozen fixture holds a different one.
 * Scoring against the frozen copy would judge the plan on facts it never received.
 */
export function withSeenWeather(fixture: BenchFixture, days: DayWeather[]): BenchFixture {
  const rawFetch = fixture.reconciled.rawFetch;
  return {
    ...fixture,
    reconciled: {
      ...fixture.reconciled,
      rawFetch: {
        ...rawFetch,
        weather: { available: days.length > 0, historical: days.some((d) => d.historical), days },
      },
    },
  };
}

/**
 * Grounding counts stops missing from the candidate list, and the legacy path is never given one —
 * so for that path it measures the pipeline, not the plan. Unmeasured, `compositeScore`
 * renormalises over the groups that remain. The raw number is still reported beside it.
 */
export function withoutGrounding(scores: BenchCellScores): BenchCellScores {
  return { ...scores, grounding: { ...scores.grounding, normalized: null } };
}

/** An arm cell's runs. Files written before `AB_RUNS` hold one run inline, as the cell itself. */
export function runsOf<T extends object>(cell: T & { runs?: T[] }): T[] {
  return cell.runs ?? [cell];
}

export interface ScoredRun {
  failed: boolean;
  composite: number | null;
  critical: string[];
  costUsd: number;
  wallMs: number;
}

export interface RunSummary {
  n: number;
  meanComposite: number | null;
  worstComposite: number | null;
  criticalRuns: number;
  codes: string[];
  meanCostUsd: number;
  meanWallMs: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Per-fixture view: the mean hides the bad run, so the worst run and the failure count sit beside it. */
export function summarizeRuns(runs: ScoredRun[]): RunSummary {
  const composites = runs.map((r) => r.composite).filter((c): c is number => c !== null);
  return {
    n: runs.length,
    meanComposite: composites.length ? mean(composites) : null,
    worstComposite: composites.length ? Math.min(...composites) : null,
    criticalRuns: runs.filter((r) => r.critical.length > 0).length,
    codes: [...new Set(runs.flatMap((r) => r.critical))].sort(),
    meanCostUsd: mean(runs.map((r) => r.costUsd)),
    meanWallMs: mean(runs.map((r) => r.wallMs)),
  };
}

/** The headline: runs with at least one hard failure, over all runs. */
export function criticalRate(runs: ScoredRun[]): { failing: number; total: number; rate: number | null } {
  const failing = runs.filter((r) => r.critical.length > 0).length;
  return { failing, total: runs.length, rate: runs.length ? failing / runs.length : null };
}
```

- [ ] **Step 4: Run the tests, the typecheck and the full suite.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/sweep.test.mjs && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/bench/sweep.ts src/lib/bench/sweep.test.mjs
git commit -m "Aggregate repeated runs so the worst one is not averaged out"
```

---

### Task 5: `skill-ab.mjs` repeats, survivable legacy arm, `--report`

**Files:**
- Modify: `scripts/skill-ab.mjs`

**Interfaces:**
- Consumes: `criticalFailures` (Task 3); `withSeenWeather`, `withoutGrounding`, `runsOf`, `summarizeRuns`, `criticalRate` (Task 4); `getGeneration(runId): GenerationRow | undefined` from `src/lib/db.ts` (`context_json: string`); `benchTimeoutMs()` from `src/lib/bench/models.ts`
- Produces the arm file shape `{ arm, path, runsPerFixture, cells: [{ fixtureId, runs: [{ itineraryMd, itineraryJson, runId, wallMs, costUsd, seenWeather?, error? }] }] }` and the CLI `--report <arm.json>`

This is script code with no unit tests. Its logic was pushed into Tasks 3–4, and it is verified end to end in Step 7.

- [ ] **Step 1: Update imports and the docblock.** Add:

```js
import { request } from "node:http";
import { getGeneration, getRunSteps } from "../src/lib/db.ts";
import { criticalFailures } from "../src/lib/bench/criticalFailures.ts";
import { criticalRate, runsOf, summarizeRuns, withSeenWeather, withoutGrounding } from "../src/lib/bench/sweep.ts";
```
(`getRunSteps` is already imported from `db.ts`; merge the two into one import line.)

Add `const RUNS = Math.max(1, Number(process.env.AB_RUNS ?? 1) || 1);` beside `PATH_KIND`.

Append to the file docblock:
```
 * **Repeats.** `AB_RUNS=3` generates each fixture three times. One run is a direction; three
 * show whether a rule holds or merely held once. `--report arm.json` prints mean, worst, and how
 * many runs broke a hard rule, per fixture, with the critical-trip failure rate as the headline.
 *
 *   AB_PATH=legacy AB_RUNS=3 node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm legacy.json
 *   node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --report legacy.json
```

- [ ] **Step 2: Replace `fetch` in `runLegacy` with a `node:http` helper** that has no headers timeout. Add above `runLegacy`:

```js
/**
 * POST JSON without undici. Node's `fetch` gives up at a 300s `headersTimeout` that no fetch
 * option exposes, and the legacy route routinely answers after 300s (312.7s on 2026-09-23).
 * `node:http` has no such ceiling; its socket timeout is set to the bench's own.
 */
function postJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, timeout: timeoutMs },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          let payload;
          try {
            payload = JSON.parse(text);
          } catch {
            payload = { raw: text.slice(0, 300) };
          }
          resolve({ status: res.statusCode ?? 0, payload });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`no answer after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end(data);
  });
}
```

In `runLegacy`, replace the `fetch(...)`/`res.json()` block with:
```js
  const { status, payload } = await postJson(`${BASE}/api/itinerary`, {
    destination: fixture.reconciled.rawFetch.destination.region ?? fixture.title,
    startDate,
    endDate,
    budget: answers.budget,
    tier: closestTier(answers.budget, days.length),
    userAnswers: answers,
    preferences: { tags: answers.priorities ?? [] },
  }, benchTimeoutMs());
  const wallMs = Date.now() - startedAt;
  if (status < 200 || status >= 300 || !payload.itinerary) {
    throw new Error(`HTTP ${status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
```
Then, before the `return`, capture the weather the model was given, and add `seenWeather` to the returned object:
```js
  // The legacy route fetched its own live forecast; score against that, not the fixture's.
  const context = getGeneration(payload.runId)?.context_json;
  const seenWeather = context ? JSON.parse(context).weather ?? [] : null;
```
```js
    seenWeather,
```

- [ ] **Step 3: Repeat each fixture in `runArm`.** Replace the per-fixture body with:

```js
  const cells = [];
  for (const fixture of fixtures) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`  ${fixture.id} [${i + 1}/${RUNS}] … `);
      try {
        const run = PATH_KIND === "legacy" ? await runLegacy(fixture) : await runStaged(fixture);
        runs.push(run);
        console.log(`${(run.wallMs / 1000).toFixed(1)}s  $${run.costUsd.toFixed(6)}`);
      } catch (err) {
        // One run failing must not lose the runs that already finished — each costs minutes.
        console.log(`FAILED: ${err.message}`);
        runs.push({ fixtureId: fixture.id, itineraryMd: null, itineraryJson: null, runId: null, wallMs: 0, costUsd: 0, error: String(err.message) });
      }
    }
    cells.push({ fixtureId: fixture.id, runs });
  }

  writeFileSync(out, JSON.stringify({ arm: out, path: PATH_KIND, runsPerFixture: RUNS, cells }, null, 2));
  const ok = cells.flatMap((c) => c.runs).filter((r) => !r.error).length;
  console.log(`\nwrote ${out} — ${ok}/${cells.length * RUNS} runs`);
```

- [ ] **Step 4: Score one run fairly.** Replace `scoreCell` with the following, and add `scoreRun` beside it:

```js
/** A staged arm stores markdown; the legacy arm stores the route's JSON. Both reach the same
 *  scorers, by different doors. The legacy door is scored against the weather it was given, with
 *  grounding out of the composite — it is never handed a candidate list to be grounded in. */
function scoreCell(fixture, cell) {
  const operational = { latencyMs: cell.wallMs, inputTokens: null, outputTokens: null, costUsd: cell.costUsd, cliReportedCostUsd: null, parsedOk: true, failed: false, errorMessage: null };
  if (cell.itineraryMd) return scoreItinerary(fixture, cell.itineraryMd, operational);
  const seen = cell.seenWeather ? withSeenWeather(fixture, cell.seenWeather) : fixture;
  return scoreParsed(seen, itineraryToParsed(cell.itineraryJson), JSON.stringify(cell.itineraryJson), operational);
}

/** Composite for display: grounding out for JSON runs (see scoreCell). */
function compositeOf(cell, scores) {
  return compositeScore(cell.itineraryJson ? withoutGrounding(scores) : scores);
}

function scoreRun(fixture, run) {
  if (run.error) {
    return { failed: true, composite: null, critical: ["generation_failed"], costUsd: run.costUsd ?? 0, wallMs: run.wallMs ?? 0, grounding: null, dietaryFlags: [] };
  }
  const scores = scoreCell(fixture, run);
  return {
    failed: false,
    composite: compositeOf(run, scores),
    critical: criticalFailures(scores, { itinerary: run.itineraryJson, modes: fixture.reconciled.transportModes }),
    costUsd: run.costUsd,
    wallMs: run.wallMs,
    grounding: scores.grounding.normalized,
    dietaryFlags: scores.dietary.flagged,
  };
}
```

- [ ] **Step 5: Add `--report` and the per-fixture table.** Add:

```js
/** One arm, every run re-scored now. Mean hides the bad run, so worst and k/N sit beside it. */
function armTable(arm) {
  const all = [];
  const rows = [];
  for (const cell of arm.cells) {
    const fixture = getFixture(cell.fixtureId);
    if (!fixture) continue;
    const scored = runsOf(cell).map((r) => scoreRun(fixture, r));
    all.push(...scored);
    rows.push({ fixtureId: cell.fixtureId, summary: summarizeRuns(scored), scored });
  }
  return { rows, headline: criticalRate(all), all };
}

function printArmTable(label, { rows, headline, all }) {
  console.log(`\n${label}`);
  console.log(`${"fixture".padEnd(28)}${"mean".padEnd(8)}${"worst".padEnd(8)}${"crit".padEnd(7)}${"ground".padEnd(8)}${"cost".padEnd(11)}wall   codes`);
  for (const { fixtureId, summary: s, scored } of rows) {
    const g = scored.map((r) => r.grounding).filter((x) => x !== null);
    const ground = g.length ? g.reduce((a, b) => a + b, 0) / g.length : null;
    console.log(
      `${fixtureId.padEnd(28)}${fmt(s.meanComposite).padEnd(8)}${fmt(s.worstComposite).padEnd(8)}${`${s.criticalRuns}/${s.n}`.padEnd(7)}${fmt(ground).padEnd(8)}${`$${s.meanCostUsd.toFixed(4)}`.padEnd(11)}${`${(s.meanWallMs / 1000).toFixed(0)}s`.padEnd(7)}${s.codes.join(",") || "—"}`
    );
    for (const r of scored) for (const f of r.dietaryFlags) console.log(`${"".padEnd(30)}dietary: ${f}`);
  }
  const overall = summarizeRuns(all);
  const rate = headline.rate === null ? "n/a" : `${(headline.rate * 100).toFixed(0)}%`;
  console.log(`\ncritical-trip failure rate  ${rate}  (${headline.failing}/${headline.total} runs broke a hard rule)`);
  console.log(`composite  mean ${fmt(overall.meanComposite)}  worst ${fmt(overall.worstComposite)}`);
}

function report(path) {
  const arm = JSON.parse(readFileSync(path, "utf8"));
  printArmTable(`${path} — ${arm.path} path, ${arm.runsPerFixture ?? 1} run(s) per fixture`, armTable(arm));
  console.log(`\nN=${arm.runsPerFixture ?? 1} per fixture catches instability, not small deltas. Grounding is`);
  console.log(`outside the composite for legacy runs: that path is never given a candidate list.`);
}
```

Extend the mode dispatch with `--report` (and update both usage strings to include `| --report <arm.json>`):
```js
} else if (mode === "--report") {
  const path = process.argv[3];
  if (!path) {
    console.error("usage: skill-ab.mjs --report <arm.json>");
    process.exit(1);
  }
  report(path);
```

- [ ] **Step 6: Make `--compare` run-aware and add the side-by-side gate.** In `compare`:
- Replace the pairing loop's reads of `cellA`/`cellB` with each cell's first successful run, so the existing axis printing and the judge are unchanged in meaning:
  ```js
    const firstOk = (cell) => runsOf(cell).find((r) => !r.error);
    const runA = firstOk(cellA);
    const runB = cellB && firstOk(cellB);
    if (!runA || !runB) continue;
    const fixture = getFixture(cellA.fixtureId);
    if (!fixture) continue;
    rows.push({ fixture, a: scoreCell(fixture, runA), b: scoreCell(fixture, runB), cellA: runA, cellB: runB });
  ```
  and delete the old `if (!cellB || cellA.error || cellB.error) continue;`.
- Change the composite axis to use the grounding-aware composite:
  ```js
  printAxis(rows, "composite", (s, cell) => compositeOf(cell, s));
  ```
  In `printAxis`, pass the matching cell through: replace `pick(r.a)` with `pick(r.a, r.cellA)` and `pick(r.b)` with `pick(r.b, r.cellB)` everywhere in that function. Other callers ignore the second argument.
- Add `printAxis(rows, "  dietary", (s) => s.dietary.normalized);` after the `mustInclude` line.
- Right after `console.log(`\npaired fixtures: ...`)`, print both arms' gate tables:
  ```js
  const tableA = armTable(a);
  const tableB = armTable(b);
  printArmTable(`arm A — ${aPath}`, tableA);
  printArmTable(`arm B — ${bPath}`, tableB);
  const d = tableA.headline.rate !== null && tableB.headline.rate !== null ? tableB.headline.rate - tableA.headline.rate : null;
  console.log(`\ncritical-trip failure rate delta  ${d === null ? "n/a" : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(0)} pts`}`);
  console.log(`\naxes below use each fixture's first successful run per arm`);
  ```
- Change the closing caveat's `one generation per arm per fixture` to `${a.runsPerFixture ?? 1} vs ${b.runsPerFixture ?? 1} generation(s) per fixture`.

- [ ] **Step 7: Verify end to end.**
1. Run `npm run lint`, `npx tsc --noEmit -p tsconfig.json` and `npm test`. All must be clean.
2. Check old arm files still load: `node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --report docs/superpowers/plans/baseline-2026-09-23.json`. Expected: a 7-row table with `1` run each, a critical-trip failure rate line, and no crash. Staged rows show grounding values.
3. Start the dev server with `npm run dev` in a separate terminal and wait for `Ready`. Then run:
   `AB_PATH=legacy AB_RUNS=1 AB_FIXTURES=kyoto-couple-mixed node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm /private/tmp/claude-501/legacy-kyoto.json`
   Expected: one run completes even if it takes over 300s, and the arm file has `cells[0].runs[0].seenWeather` as a non-empty array.
4. Run `--report /private/tmp/claude-501/legacy-kyoto.json`. Expected: one row, with a grounding column that is not folded into the composite. Confirm this by checking that the composite differs from `compositeScore` of the unmodified scores in a one-off `node -e`, or simply that `ground` prints a value while the composite still prints.
5. Test the failure path: stop the dev server, then rerun step 3 with `AB_RUNS=1`. Expected: `FAILED: connect ECONNREFUSED`, the file is written, and `--report` shows `1/1` critical with `generation_failed`.

- [ ] **Step 8: Commit.**
```bash
git add scripts/skill-ab.mjs
git commit -m "Repeat each fixture and report how many runs broke a hard rule"
```

---

### Task 6: Baseline sweep and docs

**Files:**
- Create: `docs/superpowers/plans/legacy-baseline-2026-09-25.json` (arm output, raw, same place as the 2026-09-23 arms)
- Modify: `docs/itinerary-quality.md` (new section before `## Still open`)
- Modify: `docs/llm.md` (one Features row, Developer: Claude, Since 2026-09-25)

- [ ] **Step 1: Run the legacy sweep.** With `npm run dev` running on the default CLI transport, run:
`AB_PATH=legacy AB_RUNS=3 node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm docs/superpowers/plans/legacy-baseline-2026-09-25.json`
This is 21 generations, roughly 1–2 hours. Run it in the background and wait for it to finish.

- [ ] **Step 2: Report the legacy arm and re-score the staged arms.**
```bash
node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --report docs/superpowers/plans/legacy-baseline-2026-09-25.json
node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --report docs/superpowers/plans/baseline-2026-09-23.json
node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --report docs/superpowers/plans/candidate-2026-09-23.json
```

- [ ] **Step 3: Write the section** `## Legacy-path baseline — 3 runs per fixture (2026-09-25, Claude)` into `docs/itinerary-quality.md`, before `## Still open`. It must contain:
- what was run: path, transport and the models from `getRunSteps`, `AB_RUNS=3`, fixture set, date;
- the pasted legacy `--report` table and headline;
- one line each for the two re-scored staged arms' headline rates. Say that the staged numbers moved because of the coordinate fallback and the new gate, not because the plans changed;
- the most frequent critical codes and which fixtures carry them;
- the caveats: N=3; the dietary check is a keyword proxy; grounding is outside the legacy composite; the CLI transport serves different models than production.

Also update the `**Needs a run, not a change:**` line under `## Still open` to point at this section.

- [ ] **Step 4: Add the `docs/llm.md` row.** Follow the Features table's existing columns: "Legacy-path bench: repeats, hard-failure gate, dietary check (`skill-ab.mjs --report`)". Set `Since` to 2026-09-25 and Developer to Claude, and link the new section.

- [ ] **Step 5: Commit.**
```bash
git add docs/superpowers/plans/legacy-baseline-2026-09-25.json docs/itinerary-quality.md docs/llm.md
git commit -m "Measure the path travellers get, three times per trip"
```
