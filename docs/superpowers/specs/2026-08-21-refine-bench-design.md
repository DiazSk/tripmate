# Extending the model benchmark to cover the refine path

**Date:** 2026-08-21
**Author:** Zaid (design), Claude (drafting)
**Status:** Approved design, not yet implemented

## Context

"Refine with AI" — the chat that edits a saved itinerary — feels slow. Investigating it turned up
two problems, and the second is the reason this spec exists.

**The feature is effectively unmeasured.** `llm_traces` holds exactly **one** `chat` row and **zero**
`element-edit` rows. That single sample:

| | |
|---|---|
| wall clock | 35,690 ms |
| API time | 31,482 ms |
| cache **write** | 43,791 tokens (to the 1-hour cache) |
| cache **read** | **0** |
| output tokens | 1,318 |
| cost | $0.307 |

**And the obvious explanation is wrong.** Prompt size is not the bottleneck. `place-detail` is a
clean control — 41 samples, same `runClaude` path, ~430-char prompt — and it happens to have run at
two different input sizes:

| input tokens | n | median wall |
|---|---|---|
| ~3,400 | 7 | ~8.4 s |
| ~32,700 | 33 | ~10.3 s |

An extra 29k prefill tokens buys ~2 s. So the 26.9k-char `SKILL.md` re-injected on every turn —
65% of the 41,265-char chat prompt — is a **cost** problem, not a latency one. What tracks latency
is output tokens at ~8-11 ms each, plus ~4.2 s of fixed CLI process overhead per call.

That leaves three candidate fixes: swap to a cheaper/faster model, make the 43.8k-token cache
actually get read, or stream the reply so the wait is not dead time. **Only the first needs
evidence we don't have.** The production model is `claude-sonnet-4-5`, hardcoded at
`src/lib/claude.ts:29`. The one benchmark that ruled Haiku out (0.842 vs 0.959 composite) measured
the **generation** path — a whole itinerary from scratch. Refine is a narrow, scope-locked JSON
patch with the rules handed to it. Nobody knows whether the tier gap survives that change of task.

**Intended outcome:** a repeatable, dev-only measurement of refine quality across models, so a
model swap on this path becomes an evidenced decision instead of a guess. Speed and cost fixes
follow from it; this spec covers only the measurement.

## Why extend the existing bench rather than build alongside it

Aryan's benchmark (`/bench`, `/api/bench`, `src/lib/bench/`, commit `4c42c95`, 2026-08-17) already
provides everything except the call type: 7 frozen fixtures, 12 deterministic scorers, an optional
blinded judge, Pareto and radar charts, per-model aggregation, and a `balancedPanel` guard that
refuses to average across fixtures not every model has completed.

It is currently hardwired to whole-itinerary generation by four independent constraints:

1. `runBenchCell` calls `generateItinerary()` with no branch (`src/lib/bench/runBenchmark.ts:145`)
2. `POST /api/bench` `run-cell` accepts `{fixtureId, model}` only (`src/app/api/bench/route.ts:143`)
3. `BenchFixture` is `{id, title, covers, reconciled, poiDetails}` — a *generation input*, with no
   starting itinerary and no edit instruction (`src/lib/bench/fixtures.ts:38`)
4. Every scorer consumes `ParsedItinerary`, produced by a markdown parser for the skill's §11
   output format. A trip-edit response is a JSON patch.

Constraint 4 looked like it forced a whole new scorer family. It does not. `ParsedEntry` maps
almost 1:1 onto `Stop`:

| `ParsedEntry` | `Stop` |
|---|---|
| `name`, `category`, `lat`, `lng`, `why`, `note` | identical fields; same four-value category enum |
| `costUsd` | `cost` |
| `window`, `durationMin`, `slot` | derivable from `time` + `durationLabel` |
| `transport` | parsed out of `note`, as the markdown parser already does |

`ParsedDay` ← `DayPlan` is likewise close: `theme` ← `summary`, `weather` ← `weather`,
`stayNear` ← `lodging.name`, `entriesBySlot` ← stops grouped by derived slot.

So one adapter unlocks all 12 scorers on a patched itinerary, and the new work reduces to that
adapter plus four patch-specific metrics.

## Goals

- Measure refine quality per model on the real `mode: "chat"` path, holding everything but `model` constant
- Reuse the existing scorers, aggregation, charts and panel logic rather than duplicating them
- Leave the generation benchmark's behaviour byte-identical
- Produce latency, token and cost figures for refine as a side effect (they already flow through `llm_traces`)

## Non-goals

- **The `element-edit` call type** (the per-stop sparkle button). Chat only for this pass; element-edit
  is a follow-up once the adapter and delta scoring have proven out.
- **Streaming, caching, or any model change.** This spec produces the evidence; acting on it is separate work.
- **Semantic grading of the reply prose.** Only the patch and the resulting itinerary are scored.
- **Widening the fixture set.** Three fixtures to start; the field is optional so more cost nothing later.

## Design

### 1. Fixture data model

Two **optional** fields on `BenchFixture`. Optional is load-bearing: the seven existing fixtures
keep working untouched and generation-only cells behave exactly as today.

```ts
export interface BenchFixture {
  id: string; title: string; covers: string;
  reconciled: ReconciledTrip;
  poiDetails: PoiDetails;
  /** Frozen starting plan for refine cells. Generated once on a fixed model and committed, so
   *  every model refines the byte-identical plan and only `model` varies. */
  baseItinerary?: Itinerary;
  refineTasks?: RefineTask[];
}

export interface RefineTask {
  id: string;
  /** What the traveler types. */
  message: string;
  /** Day-scoped chat when set, whole-trip when omitted — mirrors focus.open(dayIndex, "trip"). */
  dayIndex?: number;
  /** One line on what this probes — shown in the UI like `covers`. */
  covers: string;
  expect: {
    /** A question ("is day 1 too packed?") must return ops: []. editPrompt.ts:152 is explicit that
     *  changing a plan someone only asked about is worse than being unhelpful. */
    opsExpected: boolean;
    /** Days the patch may touch. Omitted = any. */
    allowedDays?: number[];
  };
}
```

Three task **archetypes**, each isolating a different known failure mode. These are templates, not
literals — each fixture instantiates them with day indices valid for its own trip length:

| archetype | probes | `expect` |
|---|---|---|
| Retime a day ("make day N more relaxed, later start") | day-scoped retiming; index arithmetic over a compacted itinerary | `opsExpected: true`, `allowedDays: [N]` |
| Add a constrained stop ("add a vegetarian dinner to day N") | scope adherence and the no-duplicate-stop rule | `opsExpected: true`, `allowedDays: [N]` |
| Ask, don't tell ("is day N too packed?") | restraint — the task a weaker model most often fails | `opsExpected: false` |

The first cut uses three fixtures chosen for constraint variety rather than convenience:

| fixture | why this one |
|---|---|
| `barcelona-access-dietary` | step-free + vegan — the dietary archetype has real constraints to violate |
| `kyoto-couple-mixed` | real opening hours, closed days, a mid-trip holiday, `crowd_bias` on |
| `rome-family-slow` | `family_rules`, pace floor 2/day, rain — the retime archetype has a floor to breach |

`baseItinerary` is minted by a one-time pass: run the existing generation path once per fixture on
a fixed model, commit the result. The starting plan's quality ceiling is that model's, which is
fine — fairness comes from every model refining the *same* plan, not from the plan being optimal.

`buildChatEditPrompt` additionally needs `trip: TripSummary` and `userAnswers`. Both should derive
from `reconciled`; the exact mapping is an implementation detail to verify against
`src/lib/editContext.ts`, not a design question. If some field turns out not to be derivable, it
gets added to the fixture as a literal like everything else there.

### 2. `src/lib/bench/itineraryToParsed.ts` — the one new module

Pure function, `Itinerary → ParsedItinerary`. No DB, no network, no LLM.

Reuses the tested clock and duration helpers in `src/lib/itinerary.ts` rather than reimplementing
time parsing, and reuses the markdown parser's transport-from-`note` logic so both paths read
`note` identically. Slot assignment (`Morning` / `Afternoon` / `Evening`) derives from `Stop.time`.

This file carries the design's risk, so it carries the tests. `docs/itinerary-quality.md` records
the precedent: the bench parser once required a format the skill no longer emitted, so
`format_adherence` scored ≈0 for every model regardless of quality and the §5 budget rule went
entirely unmeasured — and nobody noticed until an audit. The adapter must not repeat that silently.

### 3. Scoring — delta, not absolute

A refine cell scores **twice**: the frozen `baseItinerary` and the patched result, both through the
adapter and both through the existing 12 scorers.

The headline metric is the **per-group delta**. Absolute score is dominated by the ~90% of the trip
the patch never touched, so a model that makes one bad edit to an excellent 9-day plan would
otherwise still score excellent. Both numbers get stored; the delta is what the chart plots.

Four new deterministic patch metrics, all derived from data the route already returns:

| metric | definition |
|---|---|
| `patch_applied` | ops that landed vs `rejected` |
| `patch_scope` | modified days falling within `expect.allowedDays` |
| `patch_restraint` | `ops.length > 0` matches `expect.opsExpected` |
| `guardrail_delta` | new violations introduced, via `evaluateItinerary` (`src/lib/guardrails.ts`) before vs after |

`rejected` alone is not sufficient and `guardrail_delta` is what covers the gap: `applyPatch`
catches hallucinated day/stop indexes — the dominant weak-model failure — but `add_stop` clamps
its index rather than rejecting (`src/lib/itineraryPatch.ts:105`), and `replace_lodging` never
rejects at all.

### 4. Execution and API

- `runBenchCell(fixture, model, task?)` — a third parameter. Absent means generate; the generation
  path is unchanged.
- A refine cell runs `buildChatEditPrompt` → `runClaude(prompt, "chat", timeout, { model })` →
  `applyPatch`, then adapts and scores before and after.
- `POST /api/bench` `run-cell` accepts an optional `task` field. Absent means generate, so existing
  callers are unaffected. The route keeps its `devOnly()` 404 gate.
- `/bench` gains a call-type toggle. The radar re-renders on deltas. `balancedPanel` keeps refusing
  to average across cells not every model has finished.

Note that `llm_traces.model` is written on every row by `runClaude` (`claude.ts:205`), so latency,
token and cost figures split by model for free — no `batch_tag` needed. `batch_tag` is
time-windowed and would force sequential passes.

## Testing

- **`itineraryToParsed.test.mjs`** — round-trip fidelity on a real itinerary, and an explicit
  assertion that **every scorer's denominator is non-zero** after adaptation. This is the regression
  test for the `docs/itinerary-quality.md` failure mode.
- **Patch-metric tests** — each of the four metrics against hand-built before/after pairs, including
  the `add_stop`-clamps and `replace_lodging`-never-rejects cases that `rejected` misses.
- **Existing suites must stay green**, particularly `src/lib/bench/bench.test.mjs` — proof the
  generation path is untouched.

Per `CLAUDE.md`, passing tests prove little here on their own. Verification also means exercising
`/bench` against a running dev server and reading real output, not just a typecheck.

> **Correction to `CLAUDE.md` needed:** it states a `.test.mjs` may only import a `.ts` module whose
> imports are all `import type`. That constraint is **stale**. `scripts/ts-resolve.mjs` (added in
> Aryan's `4c42c95`) registers an ESM resolve hook for extensionless relative specifiers, and
> `src/lib/tripDays.test.mjs:18` already imports `applyPatch` from `itineraryPatch.ts`, which
> value-imports `./tripDays`. Worth fixing while in here.

## Cost and runtime

A refine call is ~35 s and ~$0.31.

| scope | calls | time | cost |
|---|---|---|---|
| First cut: 3 fixtures × 3 tasks × 3 models | 27 | ~16 min | ~$8 |
| Full: 7 fixtures × 3 tasks × 3 models | 63 | ~37 min | ~$19 |

Sequential, because `BenchConsole` deliberately issues one POST per cell — a full sweep in one
request would exceed any timeout (`src/app/api/bench/route.ts:31-34`). Plus a one-time generation
pass to mint the frozen `baseItinerary` values.

Starting at 3 fixtures is the plan. Widening is free later since `refineTasks` is optional.

## Verification

1. `npm test` — new adapter and patch-metric suites pass; `bench.test.mjs` still passes
2. `npx tsc --noEmit -p tsconfig.json` and `npm run lint` clean
3. `npm run dev`, open `/bench`, confirm the generation path renders **identically** to before
4. Switch to refine, run one cell, confirm: the patch applied, both before/after scores populated,
   no scorer showing a dash (a dash means the adapter fed it an empty denominator)
5. Run the 27-cell first cut; read Haiku vs Sonnet 4.5 deltas off the radar and the Pareto chart
6. Cross-check latency and cost per model with `SELECT model, count(*), avg(duration_ms) FROM
   llm_traces WHERE type='chat' GROUP BY model`

Success looks like a defensible answer to: *does Haiku 4.5 degrade a refine patch, and by how much?*

## Follow-ups this spec deliberately excludes

- `element-edit` as a second call type
- Streaming the chat reply (`--output-format stream-json` + `--include-partial-messages`; `runClaude`
  returns a buffered promise today and is shared by 8 call sites)
- Diagnosing why `cache_read_input_tokens` is 0 — `--no-session-persistence` is a suspect
- `perfAggregate.ts` reads `envelope.ttft_ms` and `envelope.time_to_request_ms`, present in **0 of 86**
  stored envelopes, so both PerfDashboard columns are null for every row. The TTFT claim in
  `claude.ts:224-226` is unsupported by this DB.
- `docs/itinerary-quality.md` says the model moved to `claude-sonnet-5`; the code says
  `claude-sonnet-4-5`. The change was reverted and the doc never caught up.
- `/api/llm-traces/perf` and `/api/llm-traces/perf/tags` have no `devOnly()` gate, unlike `/api/bench`.
