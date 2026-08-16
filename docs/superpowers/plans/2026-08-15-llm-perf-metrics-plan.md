# LLM Perf Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a recurring dev tool — a synthetic load script plus a `/backend` dashboard — that measures and compares response time, token usage, cost, and CLI-timing breakdown (CLI startup/"awake" time vs. thinking/TTFT vs. total wall time) for itinerary generation, place-detail generation, and the AI chat/edit loop.

**Architecture:** Every LLM call already stores the full CLI JSON envelope verbatim in `llm_traces.raw_response` — tokens, cost, `time_to_request_ms` (CLI awake), `ttft_ms` (thinking/planning), and `duration_api_ms` are already in there, just unparsed. This plan adds one parsing module (`perfAggregate.ts`) that reads those fields on demand and computes avg/median/p95 per feature type, a `batch_tag` column on `llm_runs` so separate benchmark runs can be tagged and compared, an aggregation API, a dashboard component on the existing `/backend` page, and a Node script that fires realistic traffic at the three features so there's always fresh, comparable data to look at.

**Tech Stack:** Next.js 16 App Router API routes, `better-sqlite3`, plain Node script (native `fetch`, no new dependencies), React 19 client component, Tailwind v4 (matching existing `/backend` dev-tool styling).

## Global Constraints

- Node ≥ 22 is mandatory (`.nvmrc` pins 22) — `better-sqlite3` breaks on Node 20.
- No new npm dependencies. Use native `fetch` and the already-installed `better-sqlite3`.
- New DB columns go through the existing `addColumnIfMissing()` PRAGMA-guard pattern in `src/lib/db.ts` — never write a migration file.
- DB rows are `snake_case`; API/type surfaces are `camelCase`, mapped by hand in each route (existing project convention).
- There is no HTTP test framework in this repo. Pure-logic modules get a `node --test` unit test (there's one existing precedent: `src/lib/itinerary.test.mjs`, run via `node --test path/to/file.test.mjs` — Node's native TypeScript stripping means `.test.mjs` files import `.ts` files directly, no build step). Routes and UI are verified manually against the running dev server (`npm run dev`, then `curl` / browser).
- Verify every task with `npx tsc --noEmit -p tsconfig.json` and `npm run lint` before committing.

---

### Task 1: `batch_tag` column + perf query helpers in `db.ts`

**Files:**
- Modify: `src/lib/db.ts:75` (add column), `src/lib/db.ts` end of file (add new exports)

**Interfaces:**
- Produces: `export interface TraceWithBatchTag extends TraceRow { batch_tag: string | null }`, `export function listTracesForPerf(batchTag?: string): TraceWithBatchTag[]`, `export function listBatchTags(): string[]`, `export function tagRunsCreatedBetween(label: string, fromIso: string, toIso: string): number`

- [ ] **Step 1: Add the nullable `batch_tag` column**

In `src/lib/db.ts`, right after the existing `addColumnIfMissing` calls (after line 75, `addColumnIfMissing("trips", "user_answers_json", "TEXT");`), add:

```ts
// Set only by scripts/perf-bench.mjs, tagging every run created during one
// benchmark invocation so the Perf Dashboard can diff two labeled batches.
// Organic/manual usage keeps this null and shows up under "All time".
addColumnIfMissing("llm_runs", "batch_tag", "TEXT");
```

- [ ] **Step 2: Add the perf query helpers**

At the end of `src/lib/db.ts` (after the existing `upsertDestinationContext` function), add:

```ts
export interface TraceWithBatchTag extends TraceRow {
  batch_tag: string | null;
}

/** Every successful trace with its run's batch tag attached, for the Perf Dashboard's
 *  aggregation. Only `status = 'ok'` rows count — a timed-out or errored call's duration
 *  and (often absent) envelope fields would skew "how long does this normally take". Only
 *  traces with a run (inner join) are included, same restriction `listGroupedTraces` already
 *  applies — a trace can't belong to a batch without a run to hang the tag off of. */
export function listTracesForPerf(batchTag?: string): TraceWithBatchTag[] {
  if (batchTag) {
    return db
      .prepare(
        `SELECT t.*, r.batch_tag as batch_tag
         FROM llm_traces t JOIN llm_runs r ON t.run_id = r.id
         WHERE t.status = 'ok' AND r.batch_tag = ?`
      )
      .all(batchTag) as TraceWithBatchTag[];
  }
  return db
    .prepare(
      `SELECT t.*, r.batch_tag as batch_tag
       FROM llm_traces t JOIN llm_runs r ON t.run_id = r.id
       WHERE t.status = 'ok'`
    )
    .all() as TraceWithBatchTag[];
}

export function listBatchTags(): string[] {
  return (
    db
      .prepare(`SELECT DISTINCT batch_tag FROM llm_runs WHERE batch_tag IS NOT NULL ORDER BY batch_tag`)
      .all() as { batch_tag: string }[]
  ).map((r) => r.batch_tag);
}

/** Tags every untagged run created in [fromIso, toIso] with `label` — how
 *  scripts/perf-bench.mjs marks the batch of runs it just generated without
 *  having to thread a tag through the production API routes. Returns the
 *  number of runs tagged. */
export function tagRunsCreatedBetween(label: string, fromIso: string, toIso: string): number {
  const result = db
    .prepare(
      `UPDATE llm_runs SET batch_tag = @label
       WHERE created_at BETWEEN @fromIso AND @toIso AND batch_tag IS NULL`
    )
    .run({ label, fromIso, toIso });
  return result.changes;
}
```

- [ ] **Step 3: Typecheck and lint**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
```
Expected: both pass with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "Add batch_tag column and perf query helpers to db.ts"
```

---

### Task 2: Split chat vs. element-edit trace type

**Files:**
- Modify: `src/lib/claude.ts:43-49` (`ClaudeCallType` union)
- Modify: `src/app/api/trip-edit/route.ts:107`
- Modify: `src/lib/runLabels.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `ClaudeCallType` now includes `"chat"` and `"element-edit"`, which Task 3/4's aggregation groups by

- [ ] **Step 1: Extend `ClaudeCallType`**

In `src/lib/claude.ts`, replace:

```ts
export type ClaudeCallType =
  | "generate"
  | "refine"
  | "rebalance"
  | "place-detail"
  | "context"
  | "critique";
```

with:

```ts
export type ClaudeCallType =
  | "generate"
  | "refine"
  | "rebalance"
  | "place-detail"
  | "context"
  | "critique"
  | "chat"
  | "element-edit";
```

- [ ] **Step 2: Give chat and element edits their own trace type**

In `src/app/api/trip-edit/route.ts`, `llm_traces.type` and `llm_runs.kind` both currently label chat turns, element edits, *and* itinerary-refine-with-feedback the same way (`"refine"`) — which would dilute the "AI chat feature" bucket with unrelated calls. Fix it at the one call site that matters for aggregation (the trace `type`, which is what Task 3 groups by); leave the `insertRun` `kind` alone since the pipeline diagram's run-grouping already depends on it staying `"refine"`.

Replace line 107:

```ts
    const { result: raw } = await runClaude(prompt, "refine", timeoutMs, { runId, effort: "low" });
```

with:

```ts
    const { result: raw } = await runClaude(
      prompt,
      mode === "chat" ? "chat" : "element-edit",
      timeoutMs,
      { runId, effort: "low" }
    );
```

- [ ] **Step 3: Add display labels**

In `src/lib/runLabels.ts`, update both label maps:

```ts
export const KIND_LABELS: Record<string, string> = {
  generate: "Generate",
  refine: "Refine",
  rebalance: "Rebalance",
  "place-detail": "Place Detail",
};

export const STEP_LABELS: Record<string, string> = {
  context: "Context Retrieval",
  generate: "Generation",
  refine: "Generation (Refine)",
  critique: "Critique/Validation",
  rebalance: "Rebalance",
  "place-detail": "Place Detail Enrichment",
  chat: "Chat Edit",
  "element-edit": "Element Edit",
};
```

(Only `STEP_LABELS` needs the two new entries — `KIND_LABELS` labels `llm_runs.kind`, which trip-edit still reports as `"refine"` per Step 2's note.)

- [ ] **Step 4: Typecheck, lint, and verify against the running dev server**

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
```

Then with `npm run dev` running, generate a trip in the app (or via `curl -X POST http://localhost:3000/api/itinerary` with a valid body) to get an `itinerary` and `trip`, and send a chat edit:

```bash
curl -s -X POST http://localhost:3000/api/trip-edit \
  -H "Content-Type: application/json" \
  -d '{"mode":"chat","trip":{"id":"smoke","destination":"Paris, France","startDate":"2026-09-19","endDate":"2026-09-21","budget":900},"itinerary":<PASTE ITINERARY JSON HERE>,"messages":[{"role":"user","content":"Make day 1 later"}]}'
```

Expected: `200 OK`, and a fresh row in `llm_traces` with `type = 'chat'` (check via the `/backend` trace FAB, or `node -e` against `tripmate.db`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/claude.ts src/app/api/trip-edit/route.ts src/lib/runLabels.ts
git commit -m "Split chat and element-edit trace types out of the shared refine label"
```

---

### Task 3: `perfAggregate.ts` — pure aggregation logic (TDD)

**Files:**
- Create: `src/lib/perfAggregate.ts`
- Create: `src/lib/perfAggregate.test.mjs`
- Modify: `src/lib/types.ts` (add `MetricStats`, `FeaturePerfStats`)

**Interfaces:**
- Consumes: `MODEL` from `src/lib/claude.ts`
- Produces: `export interface CliMetrics { inputTokens, outputTokens, costUsd, ttftMs, timeToRequestMs, apiDurationMs: number | null }`, `export function parseCliMetrics(rawResponse: string | null): CliMetrics`, `export interface PerfTraceInput { type: string; durationMs: number | null; rawResponse: string | null }`, `export function aggregatePerfStats(traces: PerfTraceInput[]): FeaturePerfStats[]`

- [ ] **Step 1: Add the shared output types**

In `src/lib/types.ts`, add (near the other `Run*` interfaces, after `RunComparison`):

```ts
export interface MetricStats {
  avg: number | null;
  median: number | null;
  p95: number | null;
}

export interface FeaturePerfStats {
  type: string;
  count: number;
  durationMs: MetricStats;
  timeToRequestMs: MetricStats;
  ttftMs: MetricStats;
  apiDurationMs: MetricStats;
  inputTokens: MetricStats;
  outputTokens: MetricStats;
  costUsd: MetricStats;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/perfAggregate.test.mjs`:

```js
/* Run: node --test src/lib/perfAggregate.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { parseCliMetrics, aggregatePerfStats } from "./perfAggregate.ts";
import { MODEL } from "./claude.ts";

function envelope(overrides) {
  return JSON.stringify({
    total_cost_usd: 0.0166,
    ttft_ms: 5474,
    time_to_request_ms: 562,
    duration_api_ms: 7070,
    modelUsage: { [MODEL]: { inputTokens: 640, outputTokens: 600 } },
    ...overrides,
  });
}

test("parseCliMetrics reads tokens/cost/timing out of a real envelope", () => {
  const metrics = parseCliMetrics(envelope({}));
  assert.equal(metrics.inputTokens, 640);
  assert.equal(metrics.outputTokens, 600);
  assert.equal(metrics.costUsd, 0.0166);
  assert.equal(metrics.ttftMs, 5474);
  assert.equal(metrics.timeToRequestMs, 562);
  assert.equal(metrics.apiDurationMs, 7070);
});

test("parseCliMetrics returns all-null on missing or malformed input", () => {
  const missing = parseCliMetrics(null);
  assert.equal(missing.inputTokens, null);
  assert.equal(missing.costUsd, null);

  const malformed = parseCliMetrics("not json");
  assert.equal(malformed.ttftMs, null);

  const partial = parseCliMetrics(JSON.stringify({ total_cost_usd: 0.01 }));
  assert.equal(partial.costUsd, 0.01);
  assert.equal(partial.inputTokens, null);
  assert.equal(partial.ttftMs, null);
});

test("aggregatePerfStats groups by type and computes avg/median/p95", () => {
  const traces = [
    { type: "generate", durationMs: 1000, rawResponse: envelope({ ttft_ms: 100 }) },
    { type: "generate", durationMs: 2000, rawResponse: envelope({ ttft_ms: 200 }) },
    { type: "generate", durationMs: 3000, rawResponse: envelope({ ttft_ms: 300 }) },
    { type: "place-detail", durationMs: 500, rawResponse: envelope({ ttft_ms: 50 }) },
  ];
  const stats = aggregatePerfStats(traces);
  assert.equal(stats.length, 2);

  const generate = stats.find((s) => s.type === "generate");
  assert.equal(generate.count, 3);
  assert.equal(generate.durationMs.avg, 2000);
  assert.equal(generate.durationMs.median, 2000);
  assert.equal(generate.ttftMs.avg, 200);

  const placeDetail = stats.find((s) => s.type === "place-detail");
  assert.equal(placeDetail.count, 1);
  assert.equal(placeDetail.durationMs.avg, 500);
});

test("aggregatePerfStats excludes null values from a metric's own stats rather than treating them as zero", () => {
  const traces = [
    { type: "context", durationMs: 400, rawResponse: null },
    { type: "context", durationMs: 600, rawResponse: envelope({ total_cost_usd: 0.02 }) },
  ];
  const [context] = aggregatePerfStats(traces);
  assert.equal(context.durationMs.avg, 500);
  assert.equal(context.costUsd.avg, 0.02);
  assert.equal(context.costUsd.median, 0.02);
});

test("aggregatePerfStats returns an empty array for no input", () => {
  assert.deepEqual(aggregatePerfStats([]), []);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test src/lib/perfAggregate.test.mjs`
Expected: FAIL — `perfAggregate.ts` does not exist yet.

- [ ] **Step 4: Implement `perfAggregate.ts`**

Create `src/lib/perfAggregate.ts`:

```ts
import { MODEL } from "./claude";
import { FeaturePerfStats, MetricStats } from "./types";

export interface CliMetrics {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  ttftMs: number | null;
  timeToRequestMs: number | null;
  apiDurationMs: number | null;
}

const EMPTY_METRICS: CliMetrics = {
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  ttftMs: null,
  timeToRequestMs: null,
  apiDurationMs: null,
};

/** Pulls tokens/cost/timing back out of the CLI's raw JSON envelope — the same
 *  envelope `runs.ts`'s `parseUsage` already reads for the trace-viewer UI, but this
 *  additionally surfaces the timing fields (`ttft_ms`, `time_to_request_ms`,
 *  `duration_api_ms`) that only the Perf Dashboard needs, kept in a separate function
 *  so the existing trace-viewer's `RunStepUsage` type/consumers stay untouched. */
export function parseCliMetrics(rawResponse: string | null): CliMetrics {
  if (!rawResponse) return EMPTY_METRICS;
  try {
    const envelope = JSON.parse(rawResponse);
    const modelUsage = envelope.modelUsage?.[MODEL];
    return {
      inputTokens: typeof modelUsage?.inputTokens === "number" ? modelUsage.inputTokens : null,
      outputTokens: typeof modelUsage?.outputTokens === "number" ? modelUsage.outputTokens : null,
      costUsd: typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : null,
      ttftMs: typeof envelope.ttft_ms === "number" ? envelope.ttft_ms : null,
      timeToRequestMs:
        typeof envelope.time_to_request_ms === "number" ? envelope.time_to_request_ms : null,
      apiDurationMs: typeof envelope.duration_api_ms === "number" ? envelope.duration_api_ms : null,
    };
  } catch {
    return EMPTY_METRICS;
  }
}

// ponytail: index-based median/p95 (no interpolation) — simplest thing that
// works for a dev benchmarking tool with dozens-to-low-hundreds of samples.
// Switch to interpolated percentiles if this ever needs to be precise at
// small-n or feed an external metrics system.
function computeStats(values: number[]): MetricStats {
  if (values.length === 0) return { avg: null, median: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { avg, median: at(0.5), p95: at(0.95) };
}

function numbersOnly(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v != null);
}

export interface PerfTraceInput {
  type: string;
  durationMs: number | null;
  rawResponse: string | null;
}

/** Groups traces by `type` (generate/critique/rebalance/place-detail/chat/element-edit/
 *  context) and computes avg/median/p95 for wall-clock duration, CLI-awake time,
 *  time-to-first-token, API-side duration, tokens, and cost. Each metric's stats are
 *  computed only from the rows that actually have that field — a step with no cost data
 *  doesn't drag its median toward zero. */
export function aggregatePerfStats(traces: PerfTraceInput[]): FeaturePerfStats[] {
  const byType = new Map<string, PerfTraceInput[]>();
  for (const trace of traces) {
    const rows = byType.get(trace.type) ?? [];
    rows.push(trace);
    byType.set(trace.type, rows);
  }

  const result: FeaturePerfStats[] = [];
  for (const [type, rows] of byType) {
    const metrics = rows.map((r) => parseCliMetrics(r.rawResponse));
    result.push({
      type,
      count: rows.length,
      durationMs: computeStats(numbersOnly(rows.map((r) => r.durationMs))),
      timeToRequestMs: computeStats(numbersOnly(metrics.map((m) => m.timeToRequestMs))),
      ttftMs: computeStats(numbersOnly(metrics.map((m) => m.ttftMs))),
      apiDurationMs: computeStats(numbersOnly(metrics.map((m) => m.apiDurationMs))),
      inputTokens: computeStats(numbersOnly(metrics.map((m) => m.inputTokens))),
      outputTokens: computeStats(numbersOnly(metrics.map((m) => m.outputTokens))),
      costUsd: computeStats(numbersOnly(metrics.map((m) => m.costUsd))),
    });
  }

  return result.sort((a, b) => a.type.localeCompare(b.type));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test src/lib/perfAggregate.test.mjs`
Expected: PASS, all 5 tests green.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/perfAggregate.ts src/lib/perfAggregate.test.mjs src/lib/types.ts
git commit -m "Add perfAggregate: parse CLI timing/token fields and compute per-feature stats"
```

---

### Task 4: Aggregation API routes

**Files:**
- Create: `src/app/api/llm-traces/perf/route.ts`
- Create: `src/app/api/llm-traces/perf/tags/route.ts`

**Interfaces:**
- Consumes: `listTracesForPerf`, `listBatchTags` (Task 1, `src/lib/db.ts`), `aggregatePerfStats` (Task 3, `src/lib/perfAggregate.ts`), `FeaturePerfStats` (`src/lib/types.ts`)
- Produces: `GET /api/llm-traces/perf?batchTag=<tag>` → `{ features: FeaturePerfStats[] }`; `GET /api/llm-traces/perf/tags` → `{ tags: string[] }`

- [ ] **Step 1: Write the aggregation route**

Create `src/app/api/llm-traces/perf/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { listTracesForPerf } from "@/lib/db";
import { aggregatePerfStats } from "@/lib/perfAggregate";

export async function GET(req: NextRequest) {
  const batchTag = new URL(req.url).searchParams.get("batchTag") || undefined;
  const traces = listTracesForPerf(batchTag);
  const features = aggregatePerfStats(
    traces.map((t) => ({ type: t.type, durationMs: t.duration_ms, rawResponse: t.raw_response }))
  );
  return NextResponse.json({ features });
}
```

- [ ] **Step 2: Write the batch-tags route**

Create `src/app/api/llm-traces/perf/tags/route.ts`:

```ts
import { NextResponse } from "next/server";
import { listBatchTags } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ tags: listBatchTags() });
}
```

- [ ] **Step 3: Typecheck, lint, and verify against the running dev server**

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
```

With `npm run dev` running:

```bash
curl -s http://localhost:3000/api/llm-traces/perf | head -c 2000
curl -s http://localhost:3000/api/llm-traces/perf/tags
```

Expected: the first returns `{"features":[...]}` with entries for whatever trace types already exist in `tripmate.db` (at minimum `generate`, `place-detail` per the earlier DB check); the second returns `{"tags":[]}` since nothing has been tagged yet (Task 5 populates this).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/llm-traces/perf
git commit -m "Add perf aggregation API routes"
```

---

### Task 5: Synthetic load script

**Files:**
- Create: `scripts/perf-bench.mjs`
- Modify: `package.json` (add script entry)

**Interfaces:**
- Consumes: `tagRunsCreatedBetween` (Task 1, `src/lib/db.ts`); the real `POST /api/itinerary`, `POST /api/place-detail`, `POST /api/trip-edit` routes
- Produces: a `batch_tag`-labeled set of rows in `llm_runs`/`llm_traces` for the dashboard (Task 6) to read

- [ ] **Step 1: Write the script**

Create `scripts/perf-bench.mjs`:

```js
// Fires a fixed set of sample requests at the three LLM-backed features
// (itinerary generate+critique, place-detail, chat edit, plus one rebalance
// per invocation) against a running dev server, then tags every llm_runs row
// created during the run so /backend's Perf Dashboard can diff two labeled
// batches (e.g. "baseline" vs. "after-prompt-tweak").
//
// Usage: node scripts/perf-bench.mjs --label baseline --iterations 3
//
// Each iteration makes several real `claude` CLI calls (real cost, real
// latency) — keep --iterations modest for routine checks.
import { tagRunsCreatedBetween } from "../src/lib/db.ts";

const BASE_URL = process.env.PERF_BENCH_BASE_URL ?? "http://localhost:3000";

function todayISO(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const SCENARIOS = [
  {
    destination: "Paris, France",
    startDate: todayISO(30),
    endDate: todayISO(32),
    budget: 900,
    tier: "midrange",
  },
  {
    destination: "Tokyo, Japan",
    startDate: todayISO(60),
    endDate: todayISO(66),
    budget: 3500,
    tier: "midrange",
  },
];

const CHAT_MESSAGES = [
  { role: "user", content: "Can we make day 1 a bit more relaxed, with a later start?" },
];

function parseArgs(argv) {
  const args = { label: null, iterations: 3 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--label") args.label = argv[++i];
    if (argv[i] === "--iterations") args.iterations = Number(argv[++i]);
  }
  if (!args.label) {
    console.error("Usage: node scripts/perf-bench.mjs --label <name> [--iterations <n>]");
    process.exit(1);
  }
  return args;
}

async function postJson(pathname, body) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}: ${data.error ?? "unknown error"}`);
  return data;
}

async function runScenario(scenario) {
  console.log(`[perf-bench] generate: ${scenario.destination}`);
  const { itinerary } = await postJson("/api/itinerary", scenario);

  const firstStop = itinerary.days[0]?.stops?.[0];
  if (firstStop) {
    console.log(`[perf-bench] place-detail: ${firstStop.name}`);
    await postJson("/api/place-detail", {
      name: firstStop.name,
      destination: scenario.destination,
      lat: firstStop.lat,
      lng: firstStop.lng,
    });
  }

  console.log(`[perf-bench] chat edit: ${scenario.destination}`);
  await postJson("/api/trip-edit", {
    mode: "chat",
    trip: {
      id: "perf-bench",
      destination: scenario.destination,
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      budget: scenario.budget,
    },
    itinerary,
    messages: CHAT_MESSAGES,
  });

  return itinerary;
}

async function main() {
  const { label, iterations } = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  let lastItinerary = null;
  for (let i = 0; i < iterations; i++) {
    console.log(`[perf-bench] iteration ${i + 1}/${iterations}`);
    for (const scenario of SCENARIOS) {
      const itinerary = await runScenario(scenario);
      if (scenario === SCENARIOS[0]) lastItinerary = itinerary;
    }
  }

  // One rebalance call per script run (rarer user action than the others —
  // keeps the extra CLI-call cost down).
  console.log("[perf-bench] rebalance");
  await postJson("/api/itinerary", {
    ...SCENARIOS[0],
    rebalance: true,
    remainingDays: lastItinerary.days.slice(1),
    remainingBudget: 200,
  });

  const endedAt = new Date().toISOString();
  const tagged = tagRunsCreatedBetween(label, startedAt, endedAt);
  console.log(`[perf-bench] tagged ${tagged} run(s) as "${label}"`);
}

main().catch((err) => {
  console.error("[perf-bench]", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script entry**

In `package.json`, replace:

```json
  "scripts": {
    "postinstall": "node scripts/copy-cesium-assets.mjs",
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "node --test 'src/**/*.test.mjs'"
  },
```

with:

```json
  "scripts": {
    "postinstall": "node scripts/copy-cesium-assets.mjs",
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "node --test 'src/**/*.test.mjs'",
    "perf-bench": "node scripts/perf-bench.mjs"
  },
```

- [ ] **Step 3: Run it against the dev server and verify**

With `npm run dev` running in another terminal:

```bash
npm run perf-bench -- --label smoke-test --iterations 1
```

Expected: console logs for each generate/place-detail/chat/rebalance call, ending in `[perf-bench] tagged N run(s) as "smoke-test"` with `N` roughly matching the number of `insertRun` calls made (2 scenarios × 1 iteration × 2 kinds — `generate` and `refine`/chat — plus 1 for `place-detail` plus 1 more `generate` and 1 `rebalance` from the rebalance step ⇒ N should be > 0, not necessarily an exact fixed count since place-detail/chat append to the trip's existing run when a `tripId` was passed — here none is, so each call gets its own run).

Then confirm the tag landed:

```bash
curl -s "http://localhost:3000/api/llm-traces/perf/tags"
curl -s "http://localhost:3000/api/llm-traces/perf?batchTag=smoke-test" | head -c 2000
```

Expected: `{"tags":["smoke-test"]}` and a `features` array with non-zero `count` for `generate`, `place-detail`, and `chat` at minimum.

- [ ] **Step 4: Commit**

```bash
git add scripts/perf-bench.mjs package.json
git commit -m "Add perf-bench synthetic load script"
```

---

### Task 6: Perf Dashboard UI

**Files:**
- Create: `src/components/backend/PerfDashboard.tsx`
- Modify: `src/app/backend/page.tsx`

**Interfaces:**
- Consumes: `GET /api/llm-traces/perf`, `GET /api/llm-traces/perf/tags` (Task 4); `FeaturePerfStats`, `MetricStats` (Task 3, `src/lib/types.ts`); `formatMs`, `STEP_LABELS` (`src/lib/runLabels.ts`); `devLabel` (`src/lib/devInspector.ts`)
- Produces: `<PerfDashboard />`, rendered on `/backend`

- [ ] **Step 1: Write the component**

Create `src/components/backend/PerfDashboard.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { FeaturePerfStats } from "@/lib/types";
import { formatMs, STEP_LABELS } from "@/lib/runLabels";
import { devLabel } from "@/lib/devInspector";

const ALL_TIME = "";

function fmtTokens(n: number | null): string {
  return n == null ? "—" : `${Math.round(n)}`;
}

function fmtCost(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}

function MetricCell({
  a,
  b,
  format,
}: {
  a: number | null;
  b: number | null;
  format: (n: number | null) => string;
}) {
  if (a == null && b == null) return <span className="text-stone-400">—</span>;
  const delta = a != null && b != null && a !== 0 ? ((b - a) / a) * 100 : null;
  return (
    <span className="text-stone-700">
      {format(a)} → {format(b)}
      {delta != null && (
        <span className={delta <= 0 ? "ml-1 text-green-600" : "ml-1 text-red-600"}>
          ({delta > 0 ? "+" : ""}
          {delta.toFixed(0)}%)
        </span>
      )}
    </span>
  );
}

function BatchPicker({
  label,
  tags,
  value,
  onChange,
}: {
  label: string;
  tags: string[];
  value: string;
  onChange: (tag: string) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-stone-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-sm text-stone-800 focus:border-blue-300 focus:outline-none"
      >
        <option value={ALL_TIME}>All time</option>
        {tags.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
    </label>
  );
}

async function fetchFeatures(batchTag: string): Promise<FeaturePerfStats[]> {
  const query = batchTag ? `?batchTag=${encodeURIComponent(batchTag)}` : "";
  const res = await fetch(`/api/llm-traces/perf${query}`);
  const data = await res.json();
  return data.features ?? [];
}

/**
 * Compares average/median/p95 response time, CLI-awake time, thinking (TTFT), tokens, and
 * cost for each LLM-backed feature type across two selectable batches — "All time" (organic
 * usage) or any label `scripts/perf-bench.mjs` has tagged. A dev tool for judging whether a
 * prompt/model/effort change actually moved the needle, not a production analytics surface.
 */
export default function PerfDashboard() {
  const [tags, setTags] = useState<string[]>([]);
  const [batchTagA, setBatchTagA] = useState(ALL_TIME);
  const [batchTagB, setBatchTagB] = useState(ALL_TIME);
  const [featuresA, setFeaturesA] = useState<FeaturePerfStats[]>([]);
  const [featuresB, setFeaturesB] = useState<FeaturePerfStats[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/llm-traces/perf/tags")
      .then((res) => res.json())
      .then((data) => setTags(data.tags ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchFeatures(batchTagA).then(setFeaturesA).catch((e) => setError(e.message));
  }, [batchTagA]);

  useEffect(() => {
    fetchFeatures(batchTagB).then(setFeaturesB).catch((e) => setError(e.message));
  }, [batchTagB]);

  const allTypes = Array.from(
    new Set([...featuresA.map((f) => f.type), ...featuresB.map((f) => f.type)])
  ).sort();

  return (
    <section className="space-y-3" {...devLabel("PerfDashboard")}>
      <h2 className="text-base font-semibold text-stone-900">Perf Dashboard</h2>

      <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:flex-row">
        <BatchPicker label="Batch A" tags={tags} value={batchTagA} onChange={setBatchTagA} />
        <BatchPicker label="Batch B" tags={tags} value={batchTagB} onChange={setBatchTagB} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {allTypes.length === 0 && !error && (
        <p className="text-sm text-stone-500">No successful traces yet for either batch.</p>
      )}

      {allTypes.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs font-medium text-stone-500">
                <th className="px-3 py-2">Feature</th>
                <th className="px-3 py-2">Count (A → B)</th>
                <th className="px-3 py-2">Avg Duration</th>
                <th className="px-3 py-2">Avg API Duration</th>
                <th className="px-3 py-2">Avg CLI-Awake</th>
                <th className="px-3 py-2">Avg Thinking (TTFT)</th>
                <th className="px-3 py-2">Avg Tokens In</th>
                <th className="px-3 py-2">Avg Tokens Out</th>
                <th className="px-3 py-2">Avg Cost</th>
              </tr>
            </thead>
            <tbody>
              {allTypes.map((type) => {
                const a = featuresA.find((f) => f.type === type) ?? null;
                const b = featuresB.find((f) => f.type === type) ?? null;
                return (
                  <tr key={type} className="border-t border-stone-100">
                    <td className="px-3 py-2 font-medium text-stone-900">
                      {STEP_LABELS[type] ?? type}
                    </td>
                    <td className="px-3 py-2 text-stone-500">
                      {a?.count ?? 0} → {b?.count ?? 0}
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell a={a?.durationMs.avg ?? null} b={b?.durationMs.avg ?? null} format={formatMs} />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell
                        a={a?.apiDurationMs.avg ?? null}
                        b={b?.apiDurationMs.avg ?? null}
                        format={formatMs}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell
                        a={a?.timeToRequestMs.avg ?? null}
                        b={b?.timeToRequestMs.avg ?? null}
                        format={formatMs}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell a={a?.ttftMs.avg ?? null} b={b?.ttftMs.avg ?? null} format={formatMs} />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell
                        a={a?.inputTokens.avg ?? null}
                        b={b?.inputTokens.avg ?? null}
                        format={fmtTokens}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell
                        a={a?.outputTokens.avg ?? null}
                        b={b?.outputTokens.avg ?? null}
                        format={fmtTokens}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell a={a?.costUsd.avg ?? null} b={b?.costUsd.avg ?? null} format={fmtCost} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire it into `/backend`**

In `src/app/backend/page.tsx`, add the import and render it above `CompareRuns` (so pipeline invocation, perf, and run-diffing read top-to-bottom as "make a call → see its speed/cost trend → diff two specific calls"):

```tsx
import PerfDashboard from "@/components/backend/PerfDashboard";
```

and:

```tsx
        <PipelineConsole />

        <PerfDashboard />

        <CompareRuns />
```

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
```

- [ ] **Step 4: Verify in the browser**

With `npm run dev` running (and Task 5's `smoke-test` batch already generated), open `http://localhost:3000/backend`, confirm:
- The Perf Dashboard section renders below Pipeline Console.
- Batch A/B dropdowns list "All time" plus `smoke-test`.
- Setting Batch A to "All time" and Batch B to `smoke-test` renders a row per feature type with non-`—` values, and the count column reads `X → Y`.
- No console errors in the browser dev tools.

- [ ] **Step 5: Commit**

```bash
git add src/components/backend/PerfDashboard.tsx src/app/backend/page.tsx
git commit -m "Add Perf Dashboard to /backend"
```

---

## Self-Review Notes

- **Spec coverage:** Data plumbing (Task 3's `parseCliMetrics`, Task 1's `batch_tag`), the chat/element-edit label collision (Task 2), the synthetic load script with timestamp-window tagging (Task 5), the aggregation API + two-batch dashboard with deltas (Tasks 4 & 6) — every section of the approved design doc has a task.
- **Type consistency checked:** `FeaturePerfStats`/`MetricStats` (defined Task 3) are the exact shape both `perf/route.ts` (Task 4) and `PerfDashboard.tsx` (Task 6) consume; `tagRunsCreatedBetween`'s signature (Task 1) matches its only call site in `perf-bench.mjs` (Task 5); `ClaudeCallType`'s new `"chat"`/`"element-edit"` members (Task 2) match the strings `aggregatePerfStats` groups by and `STEP_LABELS` renders.
- **Fixed during review:** the spec's out-of-scope note says `duration_api_ms` and `duration_ms` are both "surfaced as-is" — the first draft of `PerfDashboard.tsx` computed `apiDurationMs` in `aggregatePerfStats` but never rendered it. Added an "Avg API Duration" column so both are actually visible, not just computed.
- **Out-of-scope items reaffirmed:** no alerting, no CI wiring, no external metrics export, no changes to `runClaude()`'s own spawn/timeout behavior — nothing in these tasks touches that.
