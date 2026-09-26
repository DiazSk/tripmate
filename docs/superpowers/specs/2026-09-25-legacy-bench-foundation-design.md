# Bench the itinerary users actually get: repeats and a hard-failure gate

**Date:** 2026-09-25 · **Author:** Zaid (with Claude) · **Status:** draft, awaiting review · **Branch:** `react-native-app`

## Why

The goal is to improve the quality of generated itineraries. `docs/itinerary-quality.md` (2026-09-23) already records a paired A/B of the constraint rewrite and a blind judge. It also names what that measurement cannot establish, and this spec is about those limits:

- **n=1 everywhere.** "A +0.0297 composite on seven unreplicated pairs is a direction, not a number to quote." There is no variance, no worst run, and no way to see a rule that fails one run in three.
- **The path travellers get is barely measured.** `skill-ab.mjs`'s `AB_PATH=legacy` arm has been run once, on one fixture, with no baseline. Everything quoted is the staged path, and the staged path has no critique and is not what the wizard posts to.
- **The legacy arm cannot finish through Node.** `fetch` dies at undici's 300s `headersTimeout`, which no `fetch` option exposes. The one legacy run answered 200 in 312.7s and had to be made with `curl`.
- **Hard violations are averaged or unweighted, never gated.** A closed-day visit, a missed departure buffer or a breached exclusion lowers a composite, or appears in an unweighted column. None of them marks the trip failed.
- **Four measurement faults specific to the legacy path:**
  - **Weather mismatch.** The legacy path fetches its own live weather, but `scoreWeatherAlignment` reads the fixture's frozen forecast. The model is judged on facts it never received.
  - **Grounding is unfair to it.** `scoreGrounding` (30% of the composite, shared with coverage) counts stops missing from the candidate list, and the legacy path is never given one.
  - **Route scorers skip its stops.** `findPoi` looks stops up among the fixture's POIs only (`route.ts:147,262`, `domain.ts:228,432`). Legacy stops mostly miss, so backtrack, geo coherence, meal proximity and mobility go unmeasured, and the composite silently renormalises.
  - **No dietary scorer**, though `barcelona-access-dietary` is vegan with a tree-nut allergy.

## Out of scope (each gets its own later spec)

- Sensitivity / paired-traveller variants (one answer changed on an existing fixture; weather A/B).
- A pairwise, order-swapped judge. The current judge stays as it is.
- Grounding as a POI-resolution rate against OSM.
- Human-acceptance telemetry: the draft purge that erases "not kept", per-stop keep/replace, and edit classification.
- New fixtures, `BenchConsole`, and `runBenchCell`.

## Design

All changes extend `scripts/skill-ab.mjs`, which already stores only raw output per arm and scores at `--compare` time with today's scorer code. That integrity argument carries over unchanged: repeats, the gate and the new scorer all run at scoring time, so old arm files get re-scored by the same code.

### 1. Repeats: `AB_RUNS=N` (default 1, which keeps existing usage identical)

- Each fixture is generated N times. The arm file's per-fixture record gains a `runs: [...]` array.
- Old arm files (a single record per fixture) are read as `runs.length === 1`.
- A failed run (non-2xx, timeout, no itinerary) is stored as `{ failed: true, error }` rather than aborting the arm. It counts as a critical failure (`generation_failed`).

### 2. The legacy arm survives long generations

- `runLegacy` posts with `node:http` `request` instead of `fetch`. The stdlib client has no headers timeout. Its own socket timeout is set to `benchTimeoutMs()` (900s), so the ceiling is the bench's one timeout.
- No new dependency. Undici's `Agent` is not importable without adding the package.

### 3. Score the legacy arm against what it saw, and fairly

At capture time, `runLegacy` also stores the `weather` array from `generations.context_json` for the run's `run_id`. At scoring time, the fixture is cloned with `reconciled.rawFetch.weather` replaced by that array, mapped to the rawFetch shape, before `scoreParsed`. Storing it in the arm file keeps arms portable across databases.

For JSON (legacy) records, the composite is computed with `grounding` set to its unmeasured value, and `compositeScore` renormalises. Raw grounding is still printed as its own column, so staged-vs-legacy comparisons show that grounding differs by construction.

### 4. Route scorers fall back to the stop's own coordinates

Where `findPoi` returns null and the entry has finite `lat`/`lng`, use those coordinates. This touches four call sites: `route.ts:147,262` and `domain.ts:228,432`. Legacy coordinates were already resolved against Overpass by `resolveNamedPlaceCoords`, so they are the best position available.

This moves staged numbers for unmatched stops too. The 2026-09-23 baseline arm files are raw output, so they can simply be re-scored.

### 5. Dietary scorer: `scoreDietary(parsed, dietary)` in `scorers/context.ts`

- **Unmeasured** (`normalized: null`) when `userAnswers.dietary` has no tags and no note.
- For each `category === "food"` entry, lower-case its `name` + `why` + `note`, then check:
  - **contradiction:** the text hits the deny list for an active tag, or for an allergen named in the note (vegan → steak, bbq, jamón, seafood, cheese; tree nut → almond, pistachio, praline, marzipan).
  - **acknowledged:** the text mentions the tag or a synonym.
- Returns `{ foodStops, contradictions, acknowledged, flagged: string[], normalized }`.
- `// ponytail: keyword proxy — a steakhouse with a vegan menu is a false positive; the judge spec replaces this.`
- Reported in `scoreParsed` beside `duplicates`/`commitments`/`mustInclude`, **not** in `COMPOSITE_WEIGHTS`. This follows the same "score the rules without touching the composite" precedent as `b50ddb9`.

### 6. Hard-failure gate: `src/lib/bench/criticalFailures.ts`

`criticalFailures(scores, itineraryJson | null): string[]` is a pure function returning distinct codes, where `[]` means the run passes. It reads existing scorer output wherever possible:

| Code | Source |
|---|---|
| `closed_or_hours` | `constraints.byType.opening_hours + closed_day > 0` |
| `pace` | `constraints.byType.pace > 0` |
| `mobility` | `constraints.byType.mobility > 0` |
| `overlap` | `feasibility.overlaps > 0` |
| `commitment` | `commitments.breaches.length > 0` (arrival, departure, prepaid) |
| `must_include` | `mustInclude.missing.length > 0` |
| `excluded` | `mustInclude.violated.length > 0` |
| `missing_anchor` | `coverage.missingAnchors.length > 0` |
| `over_budget` | `budget.budgetUsedFraction > 1` (§5 is a ceiling) |
| `duplicate` | `duplicates.repeats > 0` (§14e says "never") |
| `dietary` | `dietary.contradictions > 0` |
| `travel_leg` | JSON records only: `evaluateItinerary(itinerary)` findings with `rule === "travel"`. This is the production guardrail the UI shows. Staged markdown has no typed legs, so it is not checked there. |
| `generation_failed` | the run itself failed |

Soft, reported by their scorers and never critical:
- `crowd_bias` and `daylight`;
- budget under target;
- starred-priority coverage;
- unacknowledged dietary stops.

**Decision to confirm in review:** `duplicate` counts as critical. The 2026-09-23 staged arm had 17 repeats across 7 fixtures, so today most runs would fail the gate on that alone. That is informative, but it will dominate the headline.

### 7. Reporting

**`--report arm.json`** (new, single arm) prints one row per fixture:
- mean composite and worst composite across runs;
- critical runs `k/N` with the distinct codes;
- mean cost and wall time.

The footer has the headline, **critical-trip failure rate** = runs with ≥1 code / total runs, plus the overall mean and worst composite.

**`--compare a.json b.json`** gains the same per-fixture mean/worst/k/N columns side by side, plus the headline delta. Existing output is kept.

### 8. Baseline

- Run `AB_PATH=legacy AB_RUNS=3` over the 7-fixture A/B set (21 generations) against `npm run dev` on the default CLI transport.
- Re-score the 2026-09-23 staged arms with the new code, for the before/after view of what the fallback and the gate change.
- Record both in a new section of `docs/itinerary-quality.md`, and add a row to `docs/llm.md`.

## Testing

`node --test`, in the files where the logic lives:

- **`src/lib/bench/criticalFailures.test.mjs`** (new):
  - each code fires on a minimal synthetic scores object;
  - soft conditions return `[]`;
  - `travel_leg` is skipped for `itineraryJson === null`.
- **`src/lib/bench/bench.test.mjs`:**
  - `scoreDietary`: a vegan steakhouse is a contradiction; a vegan-mentioning stop is acknowledged; an almond pastry with a nut-allergy note is a contradiction; no dietary gives `normalized: null`.
  - The coordinate fallback: an unmatched stop with its own coordinates now counts in `scoreBacktrack` and `scoreGeoCoherence`.
- **Gates:** `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`.
- **End to end,** against the dev server: `AB_PATH=legacy AB_RUNS=1 AB_FIXTURES=kyoto-couple-mixed ... --arm k.json`, then `--report k.json`. Confirm:
  - a >300s generation completes over `node:http`;
  - weather comes from the stored context;
  - grounding sits outside the composite;
  - killing the server mid-run yields a `generation_failed` run rather than a crash.

## Risks

- **Live data drifts between sweeps** (weather, Overpass availability). The stored context keeps each run self-consistent. A/B arms should still run on the same day.
- **N=3 catches instability, not small deltas.** The report says so.
- **The CLI transport pins Sonnet 4.5 for every call.** The deployed app's API transport uses different models, so arms are only comparable on the same transport. `getRunSteps` models are recorded per run.
