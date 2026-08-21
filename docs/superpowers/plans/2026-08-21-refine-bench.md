# Refine-Path Model Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the dev-only model benchmark at `/bench` to measure the "Refine with AI" chat path, so a model swap on that path becomes an evidenced decision.

**Architecture:** A pure `Itinerary → ParsedItinerary` adapter lets the twelve existing scorers run on a *patched* itinerary, so no new scorer family is needed. Each refine cell scores the frozen starting plan and the patched result, and reports the **delta** — absolute score is dominated by the days a patch never touches. Four cheap deterministic patch metrics cover what the scorers can't see. `bench_results` gains a nullable `task_id`; `NULL` means a generation row, so every existing path is untouched.

**Tech Stack:** TypeScript, Next.js 16 App Router, `better-sqlite3`, `node --test` (no framework), the `claude` CLI as a subprocess via `runClaude()`.

**Spec:** `docs/superpowers/specs/2026-08-21-refine-bench-design.md`

## Global Constraints

- **Node ≥ 22 mandatory.** `.nvmrc` pins 22; run `nvm use` if the shell drifts. `better-sqlite3` silently kills the dev server on Node 20.
- **Git commits carry NO trailer of any kind.** No `Co-Authored-By`, no "Generated with Claude Code". Write the message and stop. This overrides the harness default.
- **`AGENTS.md` is rewritten by `next dev`.** If it shows up dirty, commit it with the work — deleting it from a diff just recreates it.
- **Everything here is dev-only.** `/bench` and `/api/bench` gate on `process.env.NODE_ENV !== "development"` (`notFound()` for pages, a 404 `NextResponse` for routes). New surfaces keep that gate.
- **Test files import with an explicit `.ts` extension** (`import { x } from "./foo.ts"`). Modules *under* test may use extensionless value imports — `scripts/ts-resolve.mjs` resolves those. Run with `npm test`, never bare `node --test`.
- **Calendar dates are UTC midnight.** Use `getUTC*()` / `timeZone: "UTC"` for anything date-only.
- **Fail-soft house convention:** `null` means "the fetch/parse failed", `[]`/`{}` means "worked fine, nothing found". Callers must be able to tell those apart.
- **Never widen `runClaude`'s production behaviour.** `meta.model` exists solely so the benchmark can vary the model; production callers omit it.

## File Structure

**Create:**
| Path | Responsibility |
|---|---|
| `src/lib/bench/itineraryToParsed.ts` | The adapter. Pure: `Itinerary → ParsedItinerary`. No DB, no network. |
| `src/lib/bench/itineraryToParsed.test.mjs` | Adapter fidelity + the non-empty-denominator regression guard. |
| `src/lib/bench/refineTasks.ts` | `RefineTask` type, the per-fixture task table, and `benchTripSummary()`. |
| `src/lib/bench/scorers/patch.ts` | The four patch metrics + `refineComposite()`. |
| `src/lib/bench/scorers/patch.test.mjs` | Patch-metric tests, including the holes `rejected` misses. |
| `src/lib/bench/baseItineraries.ts` | The seven frozen starting plans, as committed literals. |
| `scripts/mint-base-itineraries.mjs` | One-time generation pass that produces the file above. |

**Modify:**
| Path | Change |
|---|---|
| `src/lib/bench/fixtures.ts` | `BenchFixture` gains optional `baseItinerary` + `refineTasks`. |
| `src/lib/bench/types.ts` | `RefinePatchScore`, `RefineCellScores`, `RefineCell`. |
| `src/lib/bench/parseItinerary.ts` | Export the private `emptySlots()`. |
| `src/lib/bench/runBenchmark.ts` | Add `runRefineCell()`. `runBenchCell()` untouched. |
| `src/lib/db.ts` | `task_id` column; fix `listLatestBenchResults` grouping. |
| `src/app/api/bench/route.ts` | `run-cell` accepts optional `taskId`. |
| `src/components/bench/BenchConsole.tsx` | Call-type toggle; delta rendering. |

---

### Task 1: The `Itinerary → ParsedItinerary` adapter

This is the task that carries the design's risk. Everything downstream assumes it produces
something the twelve scorers can measure. `docs/itinerary-quality.md` records the precedent: a
format mismatch once made every scorer return ≈0 for every model, and nobody noticed for weeks.

**Files:**
- Create: `src/lib/bench/itineraryToParsed.ts`
- Create: `src/lib/bench/itineraryToParsed.test.mjs`
- Modify: `src/lib/bench/parseItinerary.ts` (export `emptySlots`)

**Interfaces:**
- Consumes: `Itinerary`, `DayPlan`, `Stop` from `src/lib/types.ts`. From `parseItinerary.ts` — all already exported and already covered by `bench.test.mjs`: `slotForStart(startMin: number | null): Slot`, `parseTransport(text: string | null): ParsedTransport | null`, `parseClock(raw: string): number | null`, `parseDuration(text: string): number | null`, `weekdayFromIso(iso: string | null): string | null`.
- Produces: `itineraryToParsed(itinerary: Itinerary): ParsedItinerary`

**Use `parseItinerary.ts`'s `parseClock`/`parseDuration`, NOT the ones in `src/lib/itinerary.ts`.**
Both files export functions by those names with different contracts (`itinerary.ts` returns `number`
for a duration, the bench one returns `number | null`). The whole point of the adapter is that both
scoring paths parse identically, so it must use the bench copies.

- [ ] **Step 1: Export `emptySlots` from the markdown parser**

`src/lib/bench/parseItinerary.ts:273` — change `function emptySlots()` to `export function emptySlots()`. Nothing else.

- [ ] **Step 2: Write the failing test**

Create `src/lib/bench/itineraryToParsed.test.mjs`:

```js
/* Run: npm test
 *
 * The adapter is what lets the twelve generation scorers grade a patched itinerary. If it produces
 * days the scorers can't read, every metric returns null and the benchmark reports a row of dashes
 * instead of a bad score — the exact silent failure docs/itinerary-quality.md records. */
import assert from "node:assert/strict";
import test from "node:test";
import { itineraryToParsed } from "./itineraryToParsed.ts";

const itinerary = {
  tier: "balanced",
  days: [
    {
      date: "2026-09-12",
      weather: "18-24C, 10% rain",
      summary: "Ease in along the old walls.",
      lodging: { name: "Palazzo Piccolomini", cost: 180, note: "Central, quiet courtyard." },
      stops: [
        {
          name: "Duomo di Pienza",
          lat: 43.0797, lng: 11.679, cost: 0,
          why: "A short, shaded first stop.",
          note: "8-minute walk from the hotel.",
          time: "9:30 AM", durationLabel: "1 hour", category: "entry",
        },
        {
          name: "Trattoria Latte di Luna",
          lat: 43.0787, lng: 11.6785, cost: 34,
          why: "Pici cacio e pepe, the local plate.",
          note: "5-minute walk. Book ahead in season.",
          time: "1:00 PM", durationLabel: "1.5 hours", category: "food",
        },
        {
          name: "Val d'Orcia viewpoint",
          lat: 43.0721, lng: 11.6702, cost: 0,
          why: "Golden hour over the valley.",
          note: "12-minute drive from town.",
          time: "6:30 PM", durationLabel: "45 min", category: "other",
        },
      ],
    },
  ],
};

test("every day survives the adapter with entries the scorers can read", () => {
  const parsed = itineraryToParsed(itinerary);
  assert.equal(parsed.days.length, 1);
  const day = parsed.days[0];
  assert.equal(day.date, "2026-09-12");
  const all = Object.values(day.entriesBySlot).flat();
  assert.equal(all.length, 3, "all three stops must land in a slot");
});

test("stops land in the slot their clock time implies", () => {
  const day = itineraryToParsed(itinerary).days[0];
  assert.deepEqual(day.entriesBySlot.Morning.map((e) => e.name), ["Duomo di Pienza"]);
  assert.deepEqual(day.entriesBySlot.Afternoon.map((e) => e.name), ["Trattoria Latte di Luna"]);
  assert.deepEqual(day.entriesBySlot.Evening.map((e) => e.name), ["Val d'Orcia viewpoint"]);
});

test("fields the scorers read carry across", () => {
  const [first] = itineraryToParsed(itinerary).days[0].entriesBySlot.Morning;
  assert.equal(first.name, "Duomo di Pienza");
  assert.equal(first.category, "entry");
  assert.equal(first.costUsd, 0, "a stated 0 must stay 0, not become null");
  assert.equal(first.lng, 11.679);
  assert.deepEqual(first.window, { startMin: 570, endMin: 630 }, "9:30 AM + 1 hour");
  assert.equal(first.durationMin, 60);
});

test("the leg is read out of the note, as §3c puts it there", () => {
  const [lunch] = itineraryToParsed(itinerary).days[0].entriesBySlot.Afternoon;
  assert.equal(lunch.transport.mode, "walk");
  assert.equal(lunch.transport.minutes, 5);
});

test("day-level fields map to the parser's own names", () => {
  const day = itineraryToParsed(itinerary).days[0];
  assert.equal(day.theme, "Ease in along the old walls.", "summary is the parser's `theme`");
  assert.equal(day.stayNear, "Palazzo Piccolomini");
  assert.equal(day.lodging.costUsd, 180);
  assert.equal(day.dayOfWeek, "Saturday", "2026-09-12 is a Saturday — derived, UTC");
});

test("an itinerary the app could actually hold does not crash the adapter", () => {
  // Fields that are optional on Stop/DayPlan and absent on older saved trips.
  const sparse = {
    tier: "balanced",
    days: [{ date: "2026-09-12", weather: "", stops: [
      { name: "Somewhere", lat: 0, lng: 0, cost: 0, note: "", time: "", durationLabel: "", category: "other" },
    ] }],
  };
  const day = itineraryToParsed(sparse).days[0];
  assert.equal(day.theme, null);
  assert.equal(day.lodging, null);
  assert.equal(day.stayNear, null);
  const [only] = Object.values(day.entriesBySlot).flat();
  assert.equal(only.window, null, "no clock time means no window, not a window of zero");
});

test("the adapter never claims a preamble or a code fence", () => {
  const parsed = itineraryToParsed(itinerary);
  assert.equal(parsed.preamble, "");
  assert.equal(parsed.hadCodeFence, false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test 2>&1 | grep -A5 itineraryToParsed
```

Expected: FAIL — `Cannot find module './itineraryToParsed.ts'`.

- [ ] **Step 4: Write the adapter**

Create `src/lib/bench/itineraryToParsed.ts`:

```ts
import type { DayPlan, Itinerary, Stop } from "../types";
import {
  emptySlots,
  parseClock,
  parseDuration,
  parseTransport,
  slotForStart,
  weekdayFromIso,
} from "./parseItinerary";
import type { ParsedDay, ParsedEntry, ParsedItinerary } from "./parseItinerary";

/**
 * Lets the twelve generation scorers grade a patched itinerary.
 *
 * The scorers were written against `ParsedItinerary`, the output of the §11 *markdown* parser, and
 * the refine path returns a JSON patch instead. Rather than a second scorer family, this maps the
 * app's own `Itinerary` onto the parser's shape — `ParsedEntry` is close to 1:1 with `Stop`.
 *
 * Every derived field goes through the helpers `parseItinerary.ts` already exports, NOT the
 * same-named ones in `src/lib/itinerary.ts`. Two parsers disagreeing about what "1.5 hours" means
 * would make a delta between a markdown-scored plan and a JSON-scored plan meaningless, and the
 * disagreement would be invisible.
 */
function toEntry(stop: Stop): ParsedEntry {
  const startMin = stop.time ? parseClock(stop.time) : null;
  const durationMin = stop.durationLabel ? parseDuration(stop.durationLabel) : null;

  return {
    // Reconstructed rather than captured: `scoreLexical` reads the raw text, so it needs something
    // representative of what the model wrote, and a JSON patch has no source line.
    raw: [stop.time, stop.name, stop.why, stop.note].filter(Boolean).join(" — "),
    name: stop.name,
    window: startMin === null ? null : { startMin, endMin: startMin + (durationMin ?? 0) },
    durationMin,
    category: stop.category ?? null,
    costUsd: stop.cost,
    lat: stop.lat,
    lng: stop.lng,
    why: stop.why ?? null,
    note: stop.note || null,
    transport: parseTransport(stop.note || null),
    // §3b's area-level idea has no representation in `Stop` — the app always stores a named place
    // with coordinates. Claiming otherwise would let `scoreGrounding` excuse stops it should count.
    areaLevel: false,
    slot: slotForStart(startMin),
  };
}

function toDay(day: DayPlan): ParsedDay {
  const entriesBySlot = emptySlots();
  for (const stop of day.stops) {
    const entry = toEntry(stop);
    entriesBySlot[entry.slot].push(entry);
  }

  return {
    headingRaw: `## ${day.date}`,
    date: day.date,
    dayOfWeek: weekdayFromIso(day.date),
    theme: day.summary?.trim() || null,
    weather: day.weather || null,
    lodging: day.lodging
      ? { name: day.lodging.name, costUsd: day.lodging.cost, note: day.lodging.note || null }
      : null,
    entriesBySlot,
    stayNear: day.lodging?.name ?? null,
    note: null,
  };
}

export function itineraryToParsed(itinerary: Itinerary): ParsedItinerary {
  return {
    days: itinerary.days.map(toDay),
    // Structural faults of a *markdown* response. A JSON patch cannot express either, so asserting
    // them clean is honest rather than flattering.
    preamble: "",
    hadCodeFence: false,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test 2>&1 | tail -10
```

Expected: PASS, and the total test count rises from 220 by the 7 tests added.

- [ ] **Step 6: Verify the scorers actually accept the output**

This is the step that catches the failure mode the whole task exists to prevent. Append to `src/lib/bench/itineraryToParsed.test.mjs`:

```js
import { BENCH_FIXTURES } from "./fixtures.ts";
import { scoreFeasibility } from "./scorers/domain.ts";

test("a scorer given adapted output measures something rather than returning null", () => {
  const parsed = itineraryToParsed(itinerary);
  const feasibility = scoreFeasibility(parsed);
  assert.notEqual(feasibility.normalized, null, "a null here means the adapter fed an empty denominator");
  assert.equal(feasibility.perDayLoadMinutes.length, 1);
});

test("parsedOk's own definition holds for adapted output", () => {
  // Copied from runBenchCell — if this drifts, refine cells silently record parsedOk: false.
  const parsed = itineraryToParsed(itinerary);
  const parsedOk =
    parsed.days.length > 0 &&
    parsed.days.some((d) => Object.values(d.entriesBySlot).some((e) => e.length > 0));
  assert.equal(parsedOk, true);
});
```

Run `npm test`. Both must pass. If `scoreFeasibility` returns `null`, stop and fix the adapter — do not proceed to Task 2.

- [ ] **Step 7: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/bench/itineraryToParsed.ts src/lib/bench/itineraryToParsed.test.mjs src/lib/bench/parseItinerary.ts
git commit -m "Let the generation scorers read a JSON itinerary

The twelve scorers take ParsedItinerary, the markdown parser's output, and
the refine path returns a patch. ParsedEntry is nearly 1:1 with Stop, so one
adapter reuses all of them rather than growing a second scorer family.

Derived fields go through parseItinerary's own helpers, not the same-named
ones in itinerary.ts: two parsers disagreeing about '1.5 hours' would make
every before/after delta meaningless and say nothing about it."
```

---

### Task 2: The four patch metrics

**Files:**
- Create: `src/lib/bench/scorers/patch.ts`
- Create: `src/lib/bench/scorers/patch.test.mjs`
- Modify: `src/lib/bench/types.ts`

**Interfaces:**
- Consumes: `applyPatch`, `PatchOp`, `PatchResult` from `src/lib/itineraryPatch.ts`; `evaluateItinerary` from `src/lib/guardrails.ts`; `CompositeGroups` from `./types`; `itineraryToParsed` from Task 1.
- Produces: `scorePatch(args): RefinePatchScore`, `deltaGroups(before, after): CompositeGroups`, `refineComposite(scores): number | null`

- [ ] **Step 1: Add the types**

Append to `src/lib/bench/types.ts`:

```ts
/**
 * What the patch itself did, as distinct from what the patched trip looks like.
 *
 * `applyPatch` validates positions but not payloads: `add_stop` clamps its index instead of
 * rejecting, `replace_lodging` is unchecked, and `replace_stop` merges — so a near-empty payload
 * applies cleanly. `rejected` alone therefore understates a bad patch, which is why
 * `guardrailDelta` is here beside it.
 */
export interface RefinePatchScore {
  opsEmitted: number;
  opsRejected: number;
  rejectedReasons: string[];
  /** Fraction of emitted ops that landed. Null when none were emitted — nothing to measure. */
  applied: number | null;
  /** Fraction of modified days inside the task's allowed set. Null when the task allows any day. */
  scope: number | null;
  /** Did emitting-or-not match what the task asked for. */
  restraint: boolean;
  guardrailsBefore: number;
  guardrailsAfter: number;
  /** after − before. Negative is an improvement; positive means the patch broke something. */
  guardrailDelta: number;
  /** 0-1 roll-up of the four above. */
  normalized: number | null;
}

export interface RefineCellScores {
  before: BenchCellScores;
  after: BenchCellScores;
  /** after − before per weighted group. Null where either side was unmeasurable. */
  delta: CompositeGroups;
  patch: RefinePatchScore;
  operational: OperationalScore;
}

/** One (fixture × task × model) refine run. */
export interface RefineCell {
  fixtureId: string;
  taskId: string;
  model: string;
  runId: string | null;
  traceId: string | null;
  /** The model's raw JSON response, verbatim — stored so a bad patch is inspectable after the fact. */
  rawResponse: string;
  scores: RefineCellScores;
  composite: number | null;
  createdAt: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/bench/scorers/patch.test.mjs`:

```js
/* Run: npm test
 *
 * These metrics exist because applyPatch launders some bad output into plausible-looking trips:
 * add_stop clamps a wild index, replace_lodging is unchecked, replace_stop merges. Each of those
 * holes gets a test here, because `rejected` cannot see any of them. */
import assert from "node:assert/strict";
import test from "node:test";
import { deltaGroups, scorePatch } from "./patch.ts";

const stop = (name, time, cost = 10) => ({
  name, lat: 43.08, lng: 11.68, cost, why: "because", note: "5-minute walk",
  time, durationLabel: "1 hour", category: "other",
});

const base = {
  tier: "balanced",
  days: [
    { date: "2026-09-12", weather: "sunny", stops: [stop("A", "9:00 AM"), stop("B", "1:00 PM")] },
    { date: "2026-09-13", weather: "sunny", stops: [stop("C", "10:00 AM")] },
  ],
};

test("a clean in-scope patch scores well", () => {
  const ops = [{ op: "replace_stop", dayIndex: 0, stopIndex: 1, stop: stop("B2", "2:00 PM") }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true, allowedDays: [0] } }, budget: 2000 });
  assert.equal(s.opsEmitted, 1);
  assert.equal(s.opsRejected, 0);
  assert.equal(s.applied, 1);
  assert.equal(s.scope, 1);
  assert.equal(s.restraint, true);
});

test("a hallucinated day index is rejected and scored down", () => {
  const ops = [{ op: "replace_stop", dayIndex: 9, stopIndex: 0, stop: stop("X", "9:00 AM") }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true } }, budget: 2000 });
  assert.equal(s.opsRejected, 1);
  assert.equal(s.applied, 0);
  assert.match(s.rejectedReasons[0], /out of range/);
});

test("editing a day the task ruled out costs scope, even though applyPatch allows it", () => {
  const ops = [{ op: "replace_stop", dayIndex: 1, stopIndex: 0, stop: stop("C2", "11:00 AM") }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true, allowedDays: [0] } }, budget: 2000 });
  assert.equal(s.applied, 1, "it applied — applyPatch has no opinion about the task's scope");
  assert.equal(s.scope, 0, "but it touched a day the task forbade");
});

test("changing a plan that was only asked about fails restraint", () => {
  const ops = [{ op: "replace_stop", dayIndex: 0, stopIndex: 0, stop: stop("A2", "9:30 AM") }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: false } }, budget: 2000 });
  assert.equal(s.restraint, false);
  assert.ok(s.normalized < 1);
});

test("answering a question with no ops satisfies restraint", () => {
  const s = scorePatch({ base, ops: [], task: { expect: { opsExpected: false } }, budget: 2000 });
  assert.equal(s.restraint, true);
  assert.equal(s.applied, null, "no ops means applied is unmeasurable, not zero");
});

test("add_stop's clamped index is caught by the guardrail delta, not by rejection", () => {
  // stopIndex 99 on a 2-stop day: applyPatch clamps to the end and reports no rejection.
  const ops = [
    { op: "add_stop", dayIndex: 0, stopIndex: 99, stop: stop("Late", "11:30 PM") },
  ];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true, allowedDays: [0] } }, budget: 2000 });
  assert.equal(s.opsRejected, 0, "applyPatch clamps rather than rejecting — this is the hole");
  assert.ok(s.guardrailDelta > 0, "the guardrail delta is what notices the damage");
});

test("blowing the budget shows up as a new guardrail", () => {
  const ops = [{ op: "replace_stop", dayIndex: 0, stopIndex: 0, stop: stop("Gold", "9:00 AM", 99999) }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true, allowedDays: [0] } }, budget: 100 });
  assert.ok(s.guardrailsAfter > s.guardrailsBefore);
});

test("deltaGroups subtracts per group and keeps nulls null", () => {
  const d = deltaGroups(
    { routeEfficiency: 0.8, constraintAdherence: 0.9, weatherFeasibility: null, mealVibeAlignment: 0.5, coverageGrounding: 0.7 },
    { routeEfficiency: 0.6, constraintAdherence: 0.9, weatherFeasibility: 0.4, mealVibeAlignment: 0.5, coverageGrounding: 0.7 }
  );
  assert.ok(Math.abs(d.routeEfficiency - -0.2) < 1e-9);
  assert.equal(d.constraintAdherence, 0);
  assert.equal(d.weatherFeasibility, null, "unmeasurable on one side means unmeasurable in the delta");
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test 2>&1 | grep -A5 "patch.test"
```

Expected: FAIL — `Cannot find module './patch.ts'`.

- [ ] **Step 4: Write the metrics**

Create `src/lib/bench/scorers/patch.ts`:

```ts
import { evaluateItinerary } from "../../guardrails";
import { applyPatch } from "../../itineraryPatch";
import type { PatchOp } from "../../itineraryPatch";
import type { Itinerary } from "../../types";
import type { CompositeGroups, RefineCellScores, RefinePatchScore } from "../types";
import { COMPOSITE_WEIGHTS } from "../types";

export interface ScorePatchArgs {
  base: Itinerary;
  ops: PatchOp[];
  task: { expect: { opsExpected: boolean; allowedDays?: number[] } };
  budget: number;
}

/** Days the applied ops actually landed on, so scope is measured against reality, not intent. */
function touchedDays(ops: PatchOp[], rejected: PatchOp[]): number[] {
  const rejectedSet = new Set(rejected);
  const days = new Set<number>();
  for (const op of ops) {
    if (rejectedSet.has(op)) continue;
    days.add(op.dayIndex);
  }
  return [...days];
}

export function scorePatch(args: ScorePatchArgs): RefinePatchScore {
  const { base, ops, task, budget } = args;
  const { itinerary: after, rejected } = applyPatch(base, ops);

  const guardrailsBefore = evaluateItinerary(base, budget).length;
  const guardrailsAfter = evaluateItinerary(after, budget).length;
  const guardrailDelta = guardrailsAfter - guardrailsBefore;

  const applied = ops.length === 0 ? null : (ops.length - rejected.length) / ops.length;

  const allowed = task.expect.allowedDays;
  const touched = touchedDays(ops, rejected.map((r) => r.op));
  const scope =
    allowed === undefined || touched.length === 0
      ? null
      : touched.filter((d) => allowed.includes(d)).length / touched.length;

  const restraint = ops.length > 0 === task.expect.opsExpected;

  // Mean of the parts that applied. An unmeasurable part is skipped rather than scored 0 — the same
  // rule compositeGroups() uses, and for the same reason: a test that never ran is not a failure.
  const parts = [
    applied,
    scope,
    restraint ? 1 : 0,
    guardrailDelta <= 0 ? 1 : 0,
  ].filter((p): p is number => p !== null);
  const normalized = parts.length > 0 ? parts.reduce((s, p) => s + p, 0) / parts.length : null;

  return {
    opsEmitted: ops.length,
    opsRejected: rejected.length,
    rejectedReasons: rejected.map((r) => r.reason),
    applied,
    scope,
    restraint,
    guardrailsBefore,
    guardrailsAfter,
    guardrailDelta,
    normalized,
  };
}

/** after − before per weighted group; null wherever either side could not be measured. */
export function deltaGroups(before: CompositeGroups, after: CompositeGroups): CompositeGroups {
  const keys = Object.keys(COMPOSITE_WEIGHTS) as (keyof CompositeGroups)[];
  const out = {} as CompositeGroups;
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    out[key] = b === null || a === null ? null : a - b;
  }
  return out;
}

/**
 * A refine cell's headline number: half "did the trip get worse", half "was the patch well-formed".
 *
 * The delta half is `1 + mean(delta)` clamped to [0,1], so leaving the plan's quality untouched
 * scores 1.0 and degrading it subtracts. Improvement cannot push past 1.0 — an edit that
 * incidentally raises the trip's score is not evidence the model followed the instruction, and
 * rewarding it would let a model win by rewriting days nobody asked about.
 */
export function refineComposite(scores: RefineCellScores): number | null {
  if (scores.operational.failed) return null;
  const deltas = Object.values(scores.delta).filter((v): v is number => v !== null);
  const deltaScore =
    deltas.length === 0
      ? null
      : Math.max(0, Math.min(1, 1 + deltas.reduce((s, v) => s + v, 0) / deltas.length));

  const parts = [deltaScore, scores.patch.normalized].filter((p): p is number => p !== null);
  return parts.length > 0 ? parts.reduce((s, p) => s + p, 0) / parts.length : null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test 2>&1 | tail -10
```

Expected: PASS. If the `add_stop`-clamp test fails because `guardrailDelta` is 0, read `evaluateItinerary` in `src/lib/guardrails.ts` and pick a stop time in the test that genuinely trips the pace or overlap rule — the assertion is the point, the specific time is not.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/bench/scorers/patch.ts src/lib/bench/scorers/patch.test.mjs src/lib/bench/types.ts
git commit -m "Score the patch, not just the trip it produced

applyPatch validates positions but not payloads — add_stop clamps a wild
index, replace_lodging is unchecked, replace_stop merges — so `rejected`
understates a bad patch. guardrailDelta sits beside it to catch what
rejection cannot see.

The composite deliberately caps improvement at 1.0. An edit that raises the
trip's score is not evidence the model followed the instruction, and paying
for it would let a model win by rewriting days nobody asked about."
```

---

### Task 3: Fixture extension, refine tasks, and the trip-summary derivation

**Files:**
- Create: `src/lib/bench/refineTasks.ts`
- Modify: `src/lib/bench/fixtures.ts`

**Interfaces:**
- Consumes: `BenchFixture` from `./fixtures`; `TripSummary`, `UserAnswers`, `Itinerary` from `../types`.
- Produces: `RefineTask`, `REFINE_TASKS: Record<string, RefineTask[]>`, `refineTasksFor(fixtureId: string): RefineTask[]`, `findRefineTask(fixtureId: string, taskId: string): RefineTask | undefined`, `benchTripSummary(fixture: BenchFixture): TripSummary`, `benchUserAnswers(fixture: BenchFixture): UserAnswers`

**Everything `/api/trip-edit` needs derives from the fixture — no new literals.** Verified:
`buildEditContext(trip: TripSummary, itinerary: Itinerary, rawAnswers?: UserAnswers | null)`, and
`TripSummary` is `{id, destination, startDate, endDate, budget}`. `budget` is on
`UserAnswers` (`src/lib/types.ts:188`), reachable as `fixture.reconciled.userAnswers.budget`;
dates come from `fixture.reconciled.rawFetch.dateContext.days`; `destination` from
`fixture.reconciled.rawFetch.destination.region`.

- [ ] **Step 1: Extend `BenchFixture`**

In `src/lib/bench/fixtures.ts`, add two optional fields to the interface:

```ts
export interface BenchFixture {
  id: string;
  title: string;
  covers: string;
  reconciled: ReconciledTrip;
  poiDetails: PoiDetails;
  /** Frozen starting plan for refine cells, minted once by scripts/mint-base-itineraries.mjs and
   *  committed. Every model refines the byte-identical plan, so only `model` varies — the same
   *  claim the generation cells make about the trip-context bytes. Absent = generation-only. */
  baseItinerary?: Itinerary;
}
```

Add `import type { Itinerary } from "../types";` if it isn't already imported. **Optional is
load-bearing** — the seven existing literals must stay valid untouched.

`refineTasks` deliberately does NOT go on the fixture: tasks are keyed by fixture id in
`refineTasks.ts` so the 532-line `fixtures.ts` doesn't grow, and so a task edit never risks a
merge conflict with frozen fixture data.

- [ ] **Step 2: Write the failing test**

Create `src/lib/bench/refineTasks.test.mjs`:

```js
/* Run: npm test */
import assert from "node:assert/strict";
import test from "node:test";
import { BENCH_FIXTURES } from "./fixtures.ts";
import { benchTripSummary, benchUserAnswers, findRefineTask, refineTasksFor } from "./refineTasks.ts";

test("every built-in fixture has refine tasks", () => {
  for (const f of BENCH_FIXTURES) {
    assert.ok(refineTasksFor(f.id).length > 0, `${f.id} has no refine tasks`);
  }
});

test("every task's day index exists in its fixture's trip", () => {
  for (const f of BENCH_FIXTURES) {
    const dayCount = f.reconciled.rawFetch.dateContext.days.length;
    for (const t of refineTasksFor(f.id)) {
      if (t.dayIndex === undefined) continue;
      assert.ok(t.dayIndex < dayCount, `${f.id}/${t.id}: dayIndex ${t.dayIndex} >= ${dayCount} days`);
    }
  }
});

test("every fixture has exactly one restraint task, and it expects no ops", () => {
  for (const f of BENCH_FIXTURES) {
    const restraint = refineTasksFor(f.id).filter((t) => !t.expect.opsExpected);
    assert.equal(restraint.length, 1, `${f.id} should have one ask-don't-tell task`);
  }
});

test("task ids are unique within a fixture", () => {
  for (const f of BENCH_FIXTURES) {
    const ids = refineTasksFor(f.id).map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `${f.id} has duplicate task ids`);
  }
});

test("a TripSummary derives from the fixture with no invented fields", () => {
  const f = BENCH_FIXTURES[0];
  const trip = benchTripSummary(f);
  const days = f.reconciled.rawFetch.dateContext.days;
  assert.equal(trip.startDate, days[0].date);
  assert.equal(trip.endDate, days[days.length - 1].date);
  assert.equal(trip.budget, f.reconciled.userAnswers.budget);
  assert.ok(trip.destination.length > 0);
  assert.ok(trip.id.startsWith("bench-"));
});

test("userAnswers passes through, so the edit context sees the real profile", () => {
  const f = BENCH_FIXTURES[0];
  assert.equal(benchUserAnswers(f), f.reconciled.userAnswers);
});

test("findRefineTask returns undefined for an unknown id rather than throwing", () => {
  assert.equal(findRefineTask(BENCH_FIXTURES[0].id, "nope"), undefined);
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npm test 2>&1 | grep -A5 "refineTasks.test"
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write `refineTasks.ts`**

Create `src/lib/bench/refineTasks.ts`. Author three tasks per fixture from the archetypes below,
choosing day indices valid for each fixture's `dateContext.days.length`:

```ts
import type { BenchFixture } from "./fixtures";
import type { TripSummary, UserAnswers } from "../types";

/**
 * One edit to ask of every model, against the fixture's frozen `baseItinerary`.
 *
 * Three archetypes, each isolating a failure mode the generation benchmark cannot see:
 *   retime  — day-scoped index arithmetic over a compacted itinerary
 *   add     — scope adherence and the no-duplicate-stop rule
 *   ask     — restraint: editPrompt.ts:152 requires a question to return ops: []
 */
export interface RefineTask {
  id: string;
  /** What the traveler types. */
  message: string;
  /** Day-scoped chat when set, whole-trip when omitted — mirrors focus.open(dayIndex, "trip"). */
  dayIndex?: number;
  /** One line on what this probes — shown in the UI beside the fixture's `covers`. */
  covers: string;
  expect: {
    /** False for a question. Changing a plan someone only asked about is the failure. */
    opsExpected: boolean;
    /** Days the patch may touch. Omitted = any. */
    allowedDays?: number[];
  };
}

/** Keyed by fixture id so frozen fixture data and editable task data stay in separate files. */
export const REFINE_TASKS: Record<string, RefineTask[]> = {
  "kyoto-couple-mixed": [
    {
      id: "retime-day2",
      message: "Day 2 feels rushed. Can we start later and make it more relaxed?",
      dayIndex: 1,
      covers: "day-scoped retiming against real opening hours and a closed day",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "add-dinner-day3",
      message: "Add a good vegetarian dinner to day 3.",
      dayIndex: 2,
      covers: "in-scope addition without duplicating a stop already in the trip",
      expect: { opsExpected: true, allowedDays: [2] },
    },
    {
      id: "ask-day1-packed",
      message: "Is day 1 too packed?",
      dayIndex: 0,
      covers: "restraint — a question must be answered, not acted on",
      expect: { opsExpected: false },
    },
  ],
  // ... one entry per fixture in BENCH_FIXTURES, same three archetypes, day indices valid for
  // that fixture's trip length. Read each fixture's `covers` line and word the retime/add tasks
  // so they engage that fixture's specific constraint (step-free for barcelona, the pace floor
  // for rome, short daylight for reykjavik, the failed weather fetch for queenstown).
};

export function refineTasksFor(fixtureId: string): RefineTask[] {
  return REFINE_TASKS[fixtureId] ?? [];
}

export function findRefineTask(fixtureId: string, taskId: string): RefineTask | undefined {
  return refineTasksFor(fixtureId).find((t) => t.id === taskId);
}

/**
 * The TripSummary `/api/trip-edit` would have loaded from SQLite, derived from the fixture instead.
 *
 * Nothing here is invented: dates come from the frozen dateContext, budget from the frozen
 * userAnswers, destination from the frozen geocode. A literal would be a second source of truth
 * that could drift from what the generation cells saw.
 */
export function benchTripSummary(fixture: BenchFixture): TripSummary {
  const days = fixture.reconciled.rawFetch.dateContext.days;
  return {
    id: `bench-${fixture.id}`,
    destination: fixture.reconciled.rawFetch.destination.region ?? fixture.title,
    startDate: days[0]?.date ?? "",
    endDate: days[days.length - 1]?.date ?? "",
    budget: fixture.reconciled.userAnswers.budget,
  };
}

export function benchUserAnswers(fixture: BenchFixture): UserAnswers {
  return fixture.reconciled.userAnswers;
}
```

Replace the `// ...` comment with real entries for **every** fixture id in `BENCH_FIXTURES`. The
test in Step 2 fails until all seven are present — that is the check.

- [ ] **Step 5: Run tests, typecheck, lint**

```bash
npm test 2>&1 | tail -8 && npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: all pass. Existing `bench.test.mjs` must still pass — proof the optional field broke nothing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bench/refineTasks.ts src/lib/bench/refineTasks.test.mjs src/lib/bench/fixtures.ts
git commit -m "Give every fixture three edits to ask of every model

Retime, add, and ask — the third expects no ops at all, since a question
answered with a patch is the failure editPrompt.ts calls worse than being
unhelpful.

Tasks live outside fixtures.ts, keyed by fixture id: the fixture literals are
frozen data and the tasks are not, and mixing them would put an editable
table inside a 532-line file nobody should be rebasing. Trip summary and
answers derive from the fixture rather than being restated, so a refine cell
cannot disagree with the generation cell about the same trip."
```

---

### Task 4: Mint the frozen base itineraries

Real LLM calls, ~7 × 2.5 min. Run when the session is free — a usage limit hit mid-pass leaves a
partial file.

**Files:**
- Create: `scripts/mint-base-itineraries.mjs`
- Create: `src/lib/bench/baseItineraries.ts` (generated output, committed)
- Modify: `src/lib/bench/fixtures.ts` (attach the minted plans)

**Interfaces:**
- Consumes: `generateItinerary` from `src/lib/generateItinerary.ts`; `BENCH_FIXTURES`; `parseItinerary`.
- Produces: `BASE_ITINERARIES: Record<string, Itinerary>`

**The generation path emits markdown, but a refine cell needs an `Itinerary` object.** The legacy
`/api/itinerary` path produces JSON; the staged path `generateItinerary()` produces markdown. Use
`generateItinerary()` — it is what the bench already calls, so the starting plan is the same shape
of artifact the generation cells score — then convert markdown → `Itinerary` via `parseItinerary`
plus a small inverse mapping. If that conversion proves lossy in a way that matters, fall back to
`POST /api/itinerary` against a running dev server, which returns `Itinerary` JSON directly, and
record the choice in a comment.

- [ ] **Step 1: Write the minting script**

Create `scripts/mint-base-itineraries.mjs`:

```js
/* One-time: mint the frozen starting plan each refine cell edits.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/mint-base-itineraries.mjs
 *
 * Every model refines the SAME plan, so this runs once on one model and the output is committed.
 * The plan's quality ceiling is that model's, which is fine — fairness comes from the plan being
 * identical across models, not from it being optimal. Re-running it invalidates every stored
 * refine result, so don't, unless the fixtures themselves changed. */
import { writeFileSync } from "node:fs";
import { BENCH_FIXTURES } from "../src/lib/bench/fixtures.ts";
import { generateItinerary } from "../src/lib/generateItinerary.ts";
import { MODEL } from "../src/lib/claude.ts";

const out = {};
for (const fixture of BENCH_FIXTURES) {
  process.stdout.write(`${fixture.id} … `);
  try {
    const { itineraryMd } = await generateItinerary({
      reconciled: fixture.reconciled,
      poiDetails: fixture.poiDetails,
      model: MODEL,
      timeoutMs: 900_000,
    });
    out[fixture.id] = itineraryMd;
    console.log("ok");
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}

writeFileSync(
  "scratch-base-itineraries.json",
  JSON.stringify(out, null, 2)
);
console.log(`\n${Object.keys(out).length}/${BENCH_FIXTURES.length} minted -> scratch-base-itineraries.json`);
```

- [ ] **Step 2: Run it**

```bash
node --import ./scripts/ts-resolve.mjs scripts/mint-base-itineraries.mjs
```

Expected: `7/7 minted`. Anything less — stop, check `llm_traces` for `status` other than `ok`, and
re-run only the missing fixtures. A partial set silently shrinks the sweep.

- [ ] **Step 3: Convert to `Itinerary` objects and write the committed module**

Convert each markdown plan to an `Itinerary` using `parseItinerary` and hand-checking the result,
then write `src/lib/bench/baseItineraries.ts`:

```ts
import type { Itinerary } from "../types";

/**
 * The frozen plan each refine cell starts from, one per fixture.
 *
 * Minted once by scripts/mint-base-itineraries.mjs on the production model and committed verbatim.
 * Re-minting invalidates every stored refine result, because the delta a cell reports is measured
 * against these exact bytes.
 */
export const BASE_ITINERARIES: Record<string, Itinerary> = {
  /* one entry per fixture id */
};
```

- [ ] **Step 4: Attach them to the fixtures**

In `src/lib/bench/fixtures.ts`, where `BENCH_FIXTURES` is built from `SPECS`, set
`baseItinerary: BASE_ITINERARIES[id]`.

- [ ] **Step 5: Assert every fixture got one**

Append to `src/lib/bench/refineTasks.test.mjs`:

```js
test("every fixture with refine tasks has a frozen base itinerary with days", () => {
  for (const f of BENCH_FIXTURES) {
    if (refineTasksFor(f.id).length === 0) continue;
    assert.ok(f.baseItinerary, `${f.id} has tasks but no baseItinerary`);
    assert.ok(f.baseItinerary.days.length > 0, `${f.id}'s baseItinerary has no days`);
    assert.ok(
      f.baseItinerary.days.some((d) => d.stops.length > 0),
      `${f.id}'s baseItinerary has no stops — a patch against it would measure nothing`
    );
  }
});

test("every task's dayIndex exists in its fixture's base itinerary", () => {
  for (const f of BENCH_FIXTURES) {
    for (const t of refineTasksFor(f.id)) {
      if (t.dayIndex === undefined) continue;
      assert.ok(t.dayIndex < f.baseItinerary.days.length, `${f.id}/${t.id}: dayIndex out of range`);
    }
  }
});
```

- [ ] **Step 6: Run tests, delete the scratch file, commit**

```bash
npm test 2>&1 | tail -8
rm -f scratch-base-itineraries.json
git add src/lib/bench/baseItineraries.ts src/lib/bench/fixtures.ts src/lib/bench/refineTasks.test.mjs
git commit -m "Freeze the plan every model starts its edit from

Minted once on the production model and committed, because the delta a
refine cell reports is measured against these exact bytes — re-minting
invalidates every stored result. The plan's ceiling is one model's; fairness
comes from it being identical across models, not from it being optimal."
```

---

### Task 5: `task_id` on `bench_results`

**Files:**
- Modify: `src/lib/db.ts`

**Interfaces:**
- Produces: `BenchResultRow` gains `task_id: string | null`; `insertBenchResult` accepts it; `listLatestBenchResults` groups by `(fixture_id, model, task_id)`.

**`listLatestBenchResults` currently groups by `(fixture_id, model)`.** Left alone, three tasks per
fixture collapse into one row and two thirds of every sweep vanishes. This is the bug this task exists to prevent.

- [ ] **Step 1: Add the column**

In `src/lib/db.ts`, beside the other `addColumnIfMissing` calls (~line 116-124):

```ts
// Refine cells are keyed by (fixture, model, task); NULL is a generation cell. Nullable rather
// than defaulted so every row written before refine existed still reads as a generation row.
addColumnIfMissing("bench_results", "task_id", "TEXT");
```

- [ ] **Step 2: Thread it through the row type and insert**

Add `task_id: string | null;` to `BenchResultRow`. Add `task_id` to the `INSERT` column list and
its `@task_id` placeholder.

- [ ] **Step 3: Fix the grouping**

```ts
/** Most recent row per (fixture, model, task). `task_id IS NULL` is the generation cell. */
export function listLatestBenchResults(): BenchResultRow[] {
  return db
    .prepare(
      `SELECT * FROM bench_results
       WHERE rowid IN (
         SELECT MAX(rowid) FROM bench_results
         GROUP BY fixture_id, model, COALESCE(task_id, '')
       )
       ORDER BY fixture_id, model, COALESCE(task_id, '')`
    )
    .all() as BenchResultRow[];
}
```

`COALESCE` is required — `GROUP BY` treats every SQL `NULL` as distinct, so grouping on the bare
column would return every historical generation row instead of the latest per pair.

- [ ] **Step 4: Verify against the real DB**

```bash
npm test 2>&1 | tail -5
sqlite3 tripmate.db "PRAGMA table_info(bench_results);" | grep task_id
```

Expected: tests pass; the `task_id` line is present. The column is added at import time, so any
command that loads `db.ts` creates it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts
git commit -m "Key a bench result by its task as well as its model

listLatestBenchResults grouped by (fixture, model), which would have
collapsed three refine tasks into one row and silently dropped two thirds of
every sweep. Grouping uses COALESCE(task_id, '') because SQL GROUP BY treats
every NULL as distinct, and the bare column would have returned all history
instead of the latest per pair."
```

---

### Task 6: `runRefineCell()`

**Files:**
- Modify: `src/lib/bench/runBenchmark.ts`

**Interfaces:**
- Consumes: `itineraryToParsed` (Task 1); `scorePatch`, `deltaGroups`, `refineComposite` (Task 2); `benchTripSummary`, `benchUserAnswers`, `RefineTask` (Task 3); `buildChatEditPrompt` from `src/lib/editPrompt.ts`; `buildEditContext` from `src/lib/editContext.ts`; `loadSkill` from `src/lib/skill.ts`; `runClaude`, `parseJsonResponse`, `itineraryTimeoutMs` from `src/lib/claude.ts`; `applyPatch`; `insertRun`, `getTrace`, `insertBenchResult`; `parseUsage` from `src/lib/runs.ts`.
- Produces: `runRefineCell(fixture: BenchFixture, task: RefineTask, model: string): Promise<RefineCell>`

**`runBenchCell` is not modified.** A separate function, because the two share only their scoring
tail and a call-type branch inside one function would put the generation path's invariant at risk
for no gain.

- [ ] **Step 1: Add a `scoreParsed` seam**

`scoreItinerary(fixture, itineraryMd, operational)` parses markdown internally. Refine needs to
score an already-adapted `ParsedItinerary`. Extract the body without changing the existing
signature or behaviour:

```ts
/** The twelve scorers over an already-parsed itinerary. `scoreItinerary` is this plus the parse. */
export function scoreParsed(
  fixture: BenchFixture,
  parsed: ParsedItinerary,
  rawText: string,
  operational: OperationalScore
): BenchCellScores {
  return {
    geoCoherence: scoreGeoCoherence(parsed, fixture),
    constraints: scoreConstraints(parsed, fixture),
    feasibility: scoreFeasibility(parsed),
    coverage: scoreCoverage(parsed, fixture),
    grounding: scoreGrounding(parsed, fixture),
    format: scoreFormat(parsed, fixture),
    backtrack: scoreBacktrack(parsed, fixture),
    mealProximity: scoreMealProximity(parsed, fixture),
    downtime: scoreDowntime(parsed),
    weather: scoreWeatherAlignment(parsed, fixture),
    budget: scoreBudget(parsed, fixture),
    vibe: scoreVibe(parsed, fixture),
    lexical: scoreLexical(rawText),
    semantic: scoreSemantic(rawText, fixture),
    operational,
    judge: null,
  };
}

export function scoreItinerary(
  fixture: BenchFixture,
  itineraryMd: string,
  operational: OperationalScore
): BenchCellScores {
  return scoreParsed(fixture, parseItinerary(itineraryMd), itineraryMd, operational);
}
```

- [ ] **Step 2: Confirm the refactor changed nothing**

```bash
npm test 2>&1 | tail -6
```

Expected: the existing `bench.test.mjs` passes unchanged. If it doesn't, `scoreItinerary` was not
a pure extraction — revert and redo.

- [ ] **Step 3: Write `runRefineCell`**

Append to `src/lib/bench/runBenchmark.ts`:

```ts
/**
 * One (fixture × task × model) refine cell.
 *
 * Assembles the prompt through `buildChatEditPrompt` — the same function `/api/trip-edit` calls,
 * with the same skill and the same `buildEditContext` — so the only argument differing between
 * cells for one (fixture, task) is `model`. Nothing here may build a prompt of its own; that is
 * the harness's entire claim to attributing a difference to the model.
 *
 * A failure is recorded as a cell rather than thrown: a model that times out or returns unparseable
 * JSON is a benchmark result.
 */
export async function runRefineCell(
  fixture: BenchFixture,
  task: RefineTask,
  model: string
): Promise<RefineCell> {
  const startedAt = Date.now();
  const base = fixture.baseItinerary;
  if (!base) throw new Error(`fixture ${fixture.id} has no baseItinerary`);

  const trip = benchTripSummary(fixture);
  const answers = benchUserAnswers(fixture);

  let rawResponse = "";
  let ops: PatchOp[] = [];
  let runId: string | null = null;
  let traceId: string | null = null;
  let operational: OperationalScore;

  try {
    const skill = await loadSkill("itinerary-planner");
    const editContext = buildEditContext(trip, base, answers);
    const prompt = buildChatEditPrompt({
      skill,
      editContext,
      itinerary: base,
      dayIndex: task.dayIndex,
      messages: [{ role: "user", content: task.message }],
    });

    runId = randomUUID();
    insertRun({ id: runId, kind: "refine", destination: trip.destination, tripId: null });

    const result = await runClaude(prompt, "chat", benchTimeoutMs(), { runId, effort: "low", model });
    rawResponse = result.result;
    traceId = result.traceId;
    ops = (parseJsonResponse<{ ops?: PatchOp[] }>(rawResponse).ops ?? []);

    const usage = parseUsage(getTrace(result.traceId)?.raw_response ?? null, model);
    operational = {
      latencyMs: result.durationMs,
      inputTokens: promptTokens(usage),
      outputTokens: usage.outputTokens,
      costUsd: computeCostUsd(model, usage),
      cliReportedCostUsd: usage.costUsd,
      parsedOk: true,
      failed: false,
      errorMessage: null,
    };
  } catch (err) {
    operational = failedOperational(
      Date.now() - startedAt,
      err instanceof Error ? err.message : "refine failed"
    );
  }

  const patch = scorePatch({ base, ops, task, budget: trip.budget });
  const { itinerary: after } = applyPatch(base, ops);

  const before = scoreParsed(fixture, itineraryToParsed(base), rawResponse, operational);
  const afterScores = scoreParsed(fixture, itineraryToParsed(after), rawResponse, operational);

  const scores: RefineCellScores = {
    before,
    after: afterScores,
    delta: deltaGroups(compositeGroups(before), compositeGroups(afterScores)),
    patch,
    operational,
  };
  const composite = refineComposite(scores);

  const row = insertBenchResult({
    fixture_id: fixture.id,
    task_id: task.id,
    model,
    run_id: runId,
    trace_id: traceId,
    itinerary_md: rawResponse,
    scores_json: JSON.stringify(scores),
    composite,
  });

  return {
    fixtureId: fixture.id,
    taskId: task.id,
    model,
    runId,
    traceId,
    rawResponse,
    scores,
    composite,
    createdAt: row.created_at,
  };
}
```

Add the imports named in the Interfaces block, plus `randomUUID` from `node:crypto`. Set
`task_id: null` on the existing `insertBenchResult` call inside `runBenchCell`.

- [ ] **Step 4: Typecheck, lint, test**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint && npm test 2>&1 | tail -6
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/bench/runBenchmark.ts
git commit -m "Run one refine cell through the app's own edit prompt

Prompt assembly goes through buildChatEditPrompt and buildEditContext — the
same functions /api/trip-edit calls — so the only argument that differs
between cells for one (fixture, task) is model. A harness that built its own
prompt here could not attribute a difference to the model at all.

scoreItinerary is split into a scoreParsed seam so both a markdown plan and
an adapted JSON one reach the identical twelve scorers. runBenchCell keeps
its own function rather than growing a branch."
```

---

### Task 7: `run-cell` accepts a task

**Files:**
- Modify: `src/app/api/bench/route.ts`

**Interfaces:**
- Consumes: `runRefineCell` (Task 6), `findRefineTask` (Task 3).
- Produces: `POST { action: "run-cell", fixtureId, model, taskId?: string }`. `taskId` absent → generation, exactly as today. `GET` snapshot gains `refineTasks`.

- [ ] **Step 1: Branch the handler**

In the `run-cell` block, after the existing fixture lookup:

```ts
if (body.action === "run-cell") {
  const fixture = findFixture(body.fixtureId);
  if (!fixture) return NextResponse.json({ error: "Unknown fixture" }, { status: 400 });

  // Absent taskId keeps the generation path byte-identical for every existing caller.
  if (body.taskId) {
    const task = findRefineTask(body.fixtureId, body.taskId);
    if (!task) return NextResponse.json({ error: "Unknown task" }, { status: 400 });
    const cell = await runRefineCell(fixture, task, body.model);
    return NextResponse.json({ ok: true, cell });
  }

  const cell = await runBenchCell(fixture, body.model);
  return NextResponse.json({ ok: true, cell });
}
```

Add `taskId?: string` to the POST body type. Keep `devOnly()` untouched.

- [ ] **Step 2: Expose the tasks on the snapshot**

In `snapshot()`, add `refineTasks: Object.fromEntries(allFixtures().map((f) => [f.id, refineTasksFor(f.id)]))` so the UI can render the toggle without a second request.

- [ ] **Step 3: Exercise it against a running server**

Per CLAUDE.md, a route is not verified by typecheck. Start `npm run dev`, then:

```bash
curl -s localhost:3000/api/bench | python3 -m json.tool | head -30
```

Expected: `refineTasks` present, keyed by fixture id.

```bash
curl -s -X POST localhost:3000/api/bench -H 'Content-Type: application/json' \
  -d '{"action":"run-cell","fixtureId":"kyoto-couple-mixed","model":"claude-haiku-4-5","taskId":"ask-day1-packed"}' \
  | python3 -m json.tool | head -40
```

Expected: a cell with `taskId`, a populated `scores.patch`, and `scores.patch.restraint` telling you whether Haiku answered the question instead of editing. This is the first real signal — note it.

- [ ] **Step 4: Confirm the generation path is unaffected**

```bash
curl -s -X POST localhost:3000/api/bench -H 'Content-Type: application/json' \
  -d '{"action":"run-cell","fixtureId":"kyoto-couple-mixed","model":"claude-haiku-4-5"}' \
  | python3 -m json.tool | head -20
```

Expected: a normal generation cell, no `taskId`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/bench/route.ts
git commit -m "Let a bench cell name the edit it is running

taskId is optional and its absence takes the generation path unchanged, so
every existing caller keeps working. The snapshot carries the task table so
the console can render the toggle without a second request."
```

---

### Task 8: Call-type toggle and delta rendering in the console

**Files:**
- Modify: `src/components/bench/BenchConsole.tsx`

**Interfaces:**
- Consumes: `refineTasks` from the `GET /api/bench` snapshot; `RefineCell`.

`BenchConsole.tsx` is 1048 lines. Add to it following its existing patterns — do not restructure it
as part of this work.

- [ ] **Step 1: Add call-type state and a toggle**

A two-value toggle, `"generate" | "refine"`, defaulting to `"generate"` so the page opens exactly as
it does today. In refine mode, render a task picker from the snapshot's `refineTasks` for the
selected fixture.

- [ ] **Step 2: Send `taskId` when sweeping in refine mode**

The existing sweep issues one POST per cell and `await load()`s between them. Keep that. In refine
mode the cell loop becomes (fixture × task × model); include `taskId` in each body.

- [ ] **Step 3: Render deltas, signed**

Refine cells carry `scores.delta`, where negative means the patch made the trip worse. Show the
sign explicitly and colour negative as the bad direction — the opposite of `PerfDashboard`'s
convention, where lower latency is good. Getting this backwards would invert the benchmark's
conclusion, so label the column "Δ vs base (negative = worse)".

Also surface `scores.patch`: `opsEmitted`, `opsRejected`, `restraint`, `guardrailDelta`, and
`rejectedReasons` on the detail panel.

- [ ] **Step 4: Verify in the browser**

With `npm run dev` running, open `/bench`. Confirm:
- generation mode looks **identical** to before this task
- refine mode lists the tasks for the selected fixture
- one refine cell renders a signed delta and the patch metrics
- no console errors

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/components/bench/BenchConsole.tsx
git commit -m "Show the refine sweep beside the generation one

Deltas render signed, negative-is-worse, labelled as such: PerfDashboard's
convention is that lower is better, and carrying that habit over here would
invert what the benchmark says."
```

---

### Task 9: Run the sweep and read it

Not a code task. ~63 calls, ~37 min, ~2.8M input tokens. Run when the session is free.

- [ ] **Step 1: Sweep**

`/bench`, refine mode, all fixtures × all tasks × all models.

- [ ] **Step 2: Check for throttling BEFORE reading any score**

```bash
sqlite3 tripmate.db "SELECT model, status, count(*) FROM llm_traces WHERE type='chat' GROUP BY model, status;"
```

Any `error` or `timeout` row means the sweep is contaminated — `listTracesForPerf` filters to
`status='ok'`, so a throttled cell reads as a *missing score*, not a failure. Re-run before reading.

- [ ] **Step 3: Read latency per model**

```bash
sqlite3 tripmate.db "SELECT model, count(*), cast(avg(duration_ms) as int) avg_ms FROM llm_traces WHERE type='chat' AND status='ok' GROUP BY model;"
```

- [ ] **Step 4: Answer the question**

Off the radar and Pareto charts: **does Haiku 4.5 degrade a refine patch, and by how much?** Check
`patch.restraint` on the ask-don't-tell tasks specifically — that is where a weaker model is
expected to fail first.

- [ ] **Step 5: Write the findings into `docs/itinerary-quality.md`**

Add a dated section with the composite per model, the latency per model, and the recommendation.
Note that the *generation* numbers in that file are still stale — pre-format-fix and
pre-model-change, as its own closing line says — and this sweep does not refresh them.

- [ ] **Step 6: Commit**

```bash
git add docs/itinerary-quality.md
git commit -m "Record what the refine sweep found

First measurement of the edit path across models. The generation numbers
above remain stale — they predate both the format fix and the model change,
and this sweep did not touch them."
```

---

## Self-Review

**Spec coverage** — every section maps to a task: fixture data model → Task 3; adapter → Task 1;
delta scoring → Task 2 (`deltaGroups`, `refineComposite`) and Task 6 (`scoreParsed` seam); the four
patch metrics → Task 2; execution/API → Tasks 6-7; UI → Task 8; testing → Tasks 1-3 inline; cost and
the throttling trap → Task 9. `baseItinerary` minting, which the spec asserts but does not detail,
is Task 4.

**Placeholder scan** — one intentional ellipsis survives, in Task 3 Step 4's `REFINE_TASKS`: the
remaining six fixtures' tasks must be authored against each fixture's own `covers` line and trip
length, and inventing day indices here for fixtures whose lengths I did not read would be worse than
naming the requirement. The test in Task 3 Step 2 fails until all seven exist, so it cannot be
skipped silently.

**Type consistency** — `RefinePatchScore`, `RefineCellScores`, `RefineCell` are defined once in Task
2 Step 1 and used unchanged in Task 6. `scorePatch` takes `{base, ops, task, budget}` in both its
test and its caller. `itineraryToParsed` has one signature throughout. `task_id` is snake_case at
the DB boundary and `taskId` in camelCase API/type surfaces, matching the house split.

**Two risks worth naming.** Task 1 Step 6 is a hard gate — if a scorer returns `null` on adapted
output, everything downstream reports dashes instead of scores, which is the exact silent failure
`docs/itinerary-quality.md` records. And Task 4's markdown → `Itinerary` conversion is the least
certain step in the plan; its fallback (`POST /api/itinerary`, which returns `Itinerary` JSON
directly) is stated in the task rather than left to be rediscovered.
