# LLM performance metrics: benchmark script + dashboard

## Goal

Measure and compare response-time and cost characteristics of the three LLM-backed
features — itinerary generation, place-detail generation, and the AI chat/edit loop —
so that optimization work (prompt changes, model swaps, effort-level tuning) can be
judged against real before/after numbers instead of guesswork.

This is meant to be a **recurring dev tool**: run once now for a baseline, then again
after any change worth measuring, tagging each run so the two can be compared side by
side.

## Background

Every model call already goes through `runClaude()` (`src/lib/claude.ts`), which writes
a row to `llm_traces` on every outcome and groups sibling calls under an `llm_runs` row
via `runId`. Critically, the **raw CLI JSON envelope is already stored verbatim** in
`llm_traces.raw_response` — and that envelope already contains everything on the
original ask, without any new instrumentation:

- `usage.input_tokens` / `usage.output_tokens` (+ cache read/write token counts)
- `total_cost_usd`
- `time_to_request_ms` — time before the CLI subprocess even sends the request (its
  "awake"/startup overhead)
- `ttft_ms` / `ttft_stream_ms` — time to first token, i.e. thinking/planning time before
  output starts
- `duration_api_ms` vs `duration_ms` — server-side vs. total wall time

Today only tokens/cost are parsed out of that blob (via `parseUsage()` in
`src/lib/runs.ts`, used solely to render the existing trace-viewer UI at
`src/components/LlmTraceFab.tsx` and `src/components/backend/PipelineConsole.tsx`). None
of the timing fields are extracted, and there is no aggregate/average view anywhere —
only per-call and per-run detail.

A live check of `tripmate.db` at design time found only 17 `generate`, 2 `critique`, and
52 `place-detail` traces, and **zero** traces for the chat/edit path or `rebalance` —
too little and too skewed to compute meaningful averages from organic usage alone.

### A labeling collision that has to be fixed first

`llm_traces.type` (and `llm_runs.kind`) currently use the string `"refine"` for **three
different things**:

1. Itinerary regeneration with feedback (`previousItinerary && feedback` branch in
   `src/app/api/itinerary/route.ts`)
2. Whole-trip chat-edit turns (`mode === "chat"` in `src/app/api/trip-edit/route.ts`)
3. Single-element edit turns (`mode === "element"`, same route)

Since the ask is specifically to measure the "AI chat feature" on its own, this
collision has to be resolved or chat numbers will be diluted by unrelated calls. Fixed
at the source: `trip-edit/route.ts` passes a mode-specific type instead of the shared
`"refine"` literal.

## Design

### 1. Data plumbing

- `src/lib/runs.ts`: extend the existing `parseUsage()` into `parseMetrics()`, adding
  extraction of `time_to_request_ms`, `ttft_ms`, `ttft_stream_ms`, `duration_api_ms` from
  the same already-stored `raw_response` JSON. No new trace-level columns — these are
  parsed on read, exactly like tokens/cost are today.
- `src/app/api/trip-edit/route.ts:107`: change
  `runClaude(prompt, "refine", timeoutMs, { runId, effort: "low" })` to
  `runClaude(prompt, mode === "chat" ? "chat" : "element-edit", timeoutMs, { runId, effort: "low" })`.
  The `insertRun` call above it (route.ts:63) keeps `kind: "refine"` for backward
  compatibility with the pipeline diagram's run-level grouping — only the trace `type`
  (the level the new aggregation groups by) changes.
- `src/lib/db.ts`: `addColumnIfMissing("llm_runs", "batch_tag", "TEXT")` — nullable,
  populated only by the benchmark script below. Untagged (organic-usage / manual) runs
  keep `batch_tag = NULL` and show up under an "All time" bucket in the dashboard.

### 2. Synthetic load script

New `scripts/perf-bench.mjs` — plain Node (`fetch` against the running dev server, no
new dependency). Usage:

```bash
node scripts/perf-bench.mjs --label baseline --iterations 3
```

Per iteration, against a fixed set of sample scenarios (one short ~3-day trip, one
longer ~7-day trip, to capture how duration scales with day count):

1. `POST /api/itinerary` (generate) — exercises `generate` + `critique`.
2. Pick a stop from the returned itinerary → `POST /api/place-detail` — exercises
   `place-detail`.
3. Feed the same itinerary back into `POST /api/trip-edit` with `mode: "chat"` and a
   couple of fixed sample messages — exercises the newly-split `chat` type.
4. (One iteration only, to keep load light) `POST /api/itinerary` with `rebalance: true`
   against the same trip — exercises `rebalance`.

After every request in the batch completes, the script runs one SQL update:

```sql
UPDATE llm_runs SET batch_tag = @label
WHERE created_at BETWEEN @scriptStart AND @scriptEnd AND batch_tag IS NULL;
```

tagging every run created during the script's own window — no need to thread a tag
through the production API routes.

`ponytail:` known ceiling — if real app usage happens on the same dev server during the
benchmark window, those runs get swept into the tag too. Acceptable for a local dev
tool measuring one developer's own changes; not intended for a shared/staging server
with concurrent traffic.

### 3. Aggregation API + dashboard

- New route `GET /api/llm-traces/perf`. Reads `llm_traces` joined to `llm_runs`, groups
  by trace `type` (`generate`, `critique`, `rebalance`, `place-detail`, `chat`,
  `element-edit`), and for each group computes count, and avg/median/p95 of:
  `duration_ms`, `ttft_ms`, `time_to_request_ms`, input tokens, output tokens, cost.
  Percentile/median computed in plain JS (sort + index) — dataset is small (low
  hundreds of rows), no need for SQL window functions or a stats library.
  Accepts `?batchTag=` to filter to one batch (or omit for "All time"). A `?listTags=1`
  mode (or a second lightweight endpoint) returns the distinct known batch tags for a
  dropdown.
- New component `src/components/backend/PerfDashboard.tsx`, added to
  `src/app/backend/page.tsx` alongside the existing `PipelineConsole` and
  `CompareRuns`, matching their dev-facing visual conventions (not linked from the
  traveler-facing app). Two dropdowns — "Batch A" / "Batch B", each defaulting to "All
  time" or a specific tag — render each batch's per-feature stats table side by side,
  with a delta (%) shown on duration/tokens/cost between the two selections.

## Out of scope

- No alerting/thresholds, no CI integration, no export to an external metrics system
  (Grafana/Datadog, etc.) — stays a local dev tool, consistent with the project's
  existing "curl the dev server" verification convention.
- No further decomposition of "thinking" vs. "planning" time beyond what the CLI already
  reports as `ttft_ms` — that's the finest-grained timing signal the CLI envelope
  exposes; both `duration_api_ms` and `duration_ms` are surfaced as-is rather than
  reconciled into a single canonical number.
- No changes to `runClaude()`'s spawn/timeout/retry behavior itself — this is a
  measurement layer on top of what already exists, not a change to how calls are made.

## Testing

No test runner exists in this repo (`AGENTS.md`/`CLAUDE.md` convention: verify via
`tsc --noEmit`, `eslint`, and exercising real routes against a running dev server).
Verification for this work:

- `npx tsc --noEmit` and `npm run lint` after implementation.
- Run `perf-bench.mjs --label smoke-test --iterations 1` against the dev server and
  confirm rows land in `llm_traces`/`llm_runs` with the expected `type` values
  (including the new `chat`/`element-edit` split) and that `batch_tag` gets set.
- Load `/backend`, confirm `PerfDashboard` renders the `smoke-test` batch with non-zero
  stats for each feature type, and that switching Batch A/B dropdowns updates the
  delta display.
