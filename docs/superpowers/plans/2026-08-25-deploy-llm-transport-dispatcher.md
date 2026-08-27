# LLM Transport Dispatcher + Demo Deploy Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, direct-Anthropic-API transport to `runClaude()` behind an `LLM_TRANSPORT` env var (default `"cli"`, unchanged behavior), add a demo-safe spend cap and IP throttle, fix the SSE idle-timeout gap, and add Railway deploy scaffolding — so the app can be deployed publicly for a LinkedIn demo without touching local development.

**Architecture:** `src/lib/claude.ts` splits its current `runClaude()` body into a private `runClaudeViaCli()` (verbatim, unchanged) and a new private `runClaudeViaApi()` (calls `@anthropic-ai/sdk` directly), with a thin exported `runClaude()` dispatcher choosing between them by env var. A new `src/lib/modelPricing.ts` centralizes the token-cost price table (extracted from the bench harness) so both the new API path and the existing bench code price tokens the same way. `src/lib/db.ts` gains a `cost_usd` column and an `llm_sessions` table so the API path can persist per-trip chat history the way the CLI's local JSONL file already does. `src/lib/runs.ts`/`perfAggregate.ts` learn to read either envelope shape, since both will coexist in `llm_traces` forever. A route-boundary abuse guard (`spendCap.ts` + `ipThrottle.ts`) protects public generation endpoints.

**Tech Stack:** Next.js 16 App Router, TypeScript, better-sqlite3, `@anthropic-ai/sdk` (new dependency), Node's built-in test runner (`node --test`).

**Spec:** [docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md](../specs/2026-08-25-deploy-and-direct-api-design.md)

## Global Constraints

- Node ≥ 22 required (`.nvmrc` pins 22 — `nvm use` if the shell drifts; `better-sqlite3`'s native binding needs it).
- **No commit trailers.** Never append `Co-Authored-By` or "Generated with Claude Code" to any commit message in this repo — this overrides the harness's default template (CLAUDE.md).
- Verification is never "typecheck passed" alone. Every task's tests must actually run (`node --test <file>`), and the full suite (`npm test`), `npx tsc --noEmit -p tsconfig.json`, and `npm run lint` must stay clean before the plan is done.
- `runClaude()`'s exported signature and the `ClaudeResult` shape (`{ result, traceId, model, durationMs, sessionId? }`) must not change — all 11 existing call sites depend on it unchanged and must need zero edits.
- Default `LLM_TRANSPORT` is `"cli"`. Local development must see zero behavior change and require zero new env vars.
- `runClaudeViaCli()` (the renamed existing implementation) is edited only to rename it — its body, doc comments, and the CLI-search/resolve helpers stay verbatim.
- Never compare `created_at` against SQLite's `datetime('now', ...)` — always build an ISO-string cutoff in JS (`new Date(...).toISOString()`), per the existing CLAUDE.md gotcha.
- The test glob in `package.json`'s `test` script needs double quotes (already correct) — don't touch it.

---

### Task 1: Extract the shared price table into `src/lib/modelPricing.ts`

**Files:**
- Create: `src/lib/modelPricing.ts`
- Create: `src/lib/modelPricing.test.mjs`
- Modify: `src/lib/bench/models.ts` (re-export instead of defining its own copy)

**Interfaces:**
- Produces: `computeCostUsd(model: string, usage: TokenUsage, prices?: Record<string, [number, number]>): number | null`, `promptTokens(usage: TokenUsage): number | null`, `DEFAULT_PRICES: Record<string, [number, number]>`, `CACHE_WRITE_MULTIPLIER`/`CACHE_READ_MULTIPLIER: number`, `interface TokenUsage { inputTokens: number | null; outputTokens: number | null; cacheReadInputTokens?: number | null; cacheCreationInputTokens?: number | null; }` — all consumed by Task 3 (`claude.ts`) and by `bench/models.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/modelPricing.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { computeCostUsd, promptTokens, DEFAULT_PRICES } from "./modelPricing.ts";

test("computeCostUsd prices a known model from input/output tokens", () => {
  const cost = computeCostUsd("claude-sonnet-4-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(cost, 3 + 15);
});

test("computeCostUsd applies the cache write/read multipliers", () => {
  const [inRate] = DEFAULT_PRICES["claude-sonnet-4-5"];
  const cost = computeCostUsd("claude-sonnet-4-5", {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 1_000_000,
    cacheReadInputTokens: 1_000_000,
  });
  assert.equal(cost, inRate * 1.25 + inRate * 0.1);
});

test("computeCostUsd returns null for an unpriced model, not 0", () => {
  assert.equal(computeCostUsd("some-unknown-model", { inputTokens: 100, outputTokens: 100 }), null);
});

test("computeCostUsd returns null when output tokens are missing", () => {
  assert.equal(computeCostUsd("claude-sonnet-4-5", { inputTokens: 100, outputTokens: null }), null);
});

test("computeCostUsd accepts a custom price table, e.g. a bench override", () => {
  const cost = computeCostUsd(
    "custom-model",
    { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    { "custom-model": [1, 1] }
  );
  assert.equal(cost, 2);
});

test("promptTokens sums input + cache read + cache creation", () => {
  assert.equal(
    promptTokens({ inputTokens: 10, cacheReadInputTokens: 20, cacheCreationInputTokens: 30, outputTokens: 0 }),
    60
  );
});

test("promptTokens returns null when every field is missing", () => {
  assert.equal(promptTokens({ inputTokens: null, outputTokens: null }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/modelPricing.test.mjs`
Expected: FAIL — `./modelPricing.ts` does not exist yet.

- [ ] **Step 3: Create `src/lib/modelPricing.ts`**

```ts
/**
 * USD per million tokens, [input, output], shared by the runtime cost calc (claude.ts) and the
 * dev benchmark harness (bench/models.ts, which layers its own BENCH_PRICES env override on top).
 *
 * The 5-generation rows are Anthropic's published list prices. The 4.5 rows are NOT in the current
 * published table (they're legacy models) — they're set to their tier's rate, which is an
 * assumption, not a quote.
 */
export const DEFAULT_PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5-20251001": [1, 5],
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-4-5": [3, 15],
  "claude-sonnet-4-5-20250929": [3, 15],
  "claude-opus-4-5": [5, 25],
  "claude-opus-4-5-20251101": [5, 25],
  "claude-sonnet-5": [3, 15],
  "claude-opus-5": [5, 25],
  "claude-fable-5": [10, 50],
};

/** Cache-write and cache-read multipliers on the input rate (5-minute TTL). */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
}

/**
 * Total prompt size. `inputTokens` alone can be the UNCACHED REMAINDER, not the whole prompt, when
 * the caller is caching a prefix — summing all three is the only reading that means "how big was
 * the prompt".
 */
export function promptTokens(usage: TokenUsage): number | null {
  const parts = [usage.inputTokens, usage.cacheReadInputTokens, usage.cacheCreationInputTokens];
  if (parts.every((p) => p === null || p === undefined)) return null;
  return parts.reduce((sum: number, p) => sum + (p ?? 0), 0);
}

/**
 * Cost in USD from a price table, priced per token class rather than lumping the prompt together:
 * cache writes cost more than fresh input and cache reads cost far less. Returns null rather than 0
 * when the model isn't priced or the counts are missing — a missing cost must not render as "free".
 *
 * `prices` defaults to `DEFAULT_PRICES` but accepts an override so bench/models.ts's BENCH_PRICES
 * merge doesn't need its own copy of this function.
 */
export function computeCostUsd(
  model: string,
  usage: TokenUsage,
  prices: Record<string, [number, number]> = DEFAULT_PRICES
): number | null {
  const price = prices[model];
  if (!price || usage.outputTokens === null) return null;
  const [inRate, outRate] = price;
  const perMillion = (tokens: number | null | undefined, rate: number) =>
    ((tokens ?? 0) / 1_000_000) * rate;

  return (
    perMillion(usage.inputTokens, inRate) +
    perMillion(usage.cacheCreationInputTokens, inRate * CACHE_WRITE_MULTIPLIER) +
    perMillion(usage.cacheReadInputTokens, inRate * CACHE_READ_MULTIPLIER) +
    perMillion(usage.outputTokens, outRate)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/modelPricing.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Update `src/lib/bench/models.ts` to re-export instead of duplicating**

Replace the `DEFAULT_PRICES`, `CACHE_WRITE_MULTIPLIER`, `CACHE_READ_MULTIPLIER`, `TokenUsage`, `promptTokens`, and `computeCostUsd` definitions (current lines 47-59 and 99-141) with:

```ts
import { MODEL } from "../claude";
import {
  DEFAULT_PRICES,
  computeCostUsd as computeCostUsdWithPrices,
  promptTokens,
  type TokenUsage,
} from "../modelPricing";

export { promptTokens };
export type { TokenUsage };
```
at the top of the file (merging with the existing `import { MODEL } from "../claude";` line), and add this at the bottom of the file, replacing the old `computeCostUsd` definition:

```ts
/** Delegates to the shared price table with the bench-specific BENCH_PRICES override applied. */
export function computeCostUsd(model: string, usage: TokenUsage): number | null {
  return computeCostUsdWithPrices(model, usage, benchPrices());
}
```

Keep `BenchModel`, `DEFAULT_MODELS`, `parseModelsEnv`, `benchModels()`, `benchPrices()` (still reads `BENCH_PRICES` and merges over the imported `DEFAULT_PRICES`), and `benchTimeoutMs()` exactly as they are today — only the price-table/cost-math pieces move out. `src/lib/bench/runBenchmark.ts` calls `computeCostUsd(model, usage)` at two call sites (lines ~190, ~279) with no change needed — the 2-arg signature is preserved by this wrapper.

- [ ] **Step 6: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: PASS — all prior tests (including anything touching `bench/models.ts`) still green, plus the 7 new `modelPricing.test.mjs` tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/modelPricing.ts src/lib/modelPricing.test.mjs src/lib/bench/models.ts
git commit -m "Extract the model price table into modelPricing.ts, shared by bench and the upcoming API transport"
```

---

### Task 2: `src/lib/db.ts` — sessions table, cost column, configurable DB path

**Files:**
- Modify: `src/lib/db.ts`
- Create: `src/lib/db.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createLlmSession(messages: unknown[]): string`, `getLlmSession(id: string): unknown[] | undefined`, `appendLlmSessionTurns(id: string, newTurns: unknown[]): void`, `getSpendSince(isoCutoff: string): number`, `updateTrace(id, fields)` gains an optional `costUsd?: number` field, `TraceRow` gains `cost_usd: number | null`. All consumed by Task 3 (`claude.ts`), Task 4 (`runs.ts`), and Task 5 (`spendCap.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/db.test.mjs` (this touches the real dev `tripmate.db` file, same as the existing `bench.test.mjs` already does — harmless, idempotent `CREATE TABLE IF NOT EXISTS` and a few extra rows):

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  appendLlmSessionTurns,
  createLlmSession,
  getLlmSession,
  getSpendSince,
  insertTrace,
  updateTrace,
} from "./db.ts";

test("createLlmSession/getLlmSession round-trip the messages array", () => {
  const id = createLlmSession([{ role: "user", content: "hi" }]);
  assert.deepEqual(getLlmSession(id), [{ role: "user", content: "hi" }]);
});

test("appendLlmSessionTurns adds to the stored history without dropping earlier turns", () => {
  const id = createLlmSession([{ role: "user", content: "first" }]);
  appendLlmSessionTurns(id, [{ role: "assistant", content: "reply" }]);
  assert.deepEqual(getLlmSession(id), [
    { role: "user", content: "first" },
    { role: "assistant", content: "reply" },
  ]);
});

test("getLlmSession returns undefined for an id that was never created", () => {
  assert.equal(getLlmSession("does-not-exist"), undefined);
});

test("getSpendSince sums cost_usd for traces at or after the cutoff", () => {
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const before = getSpendSince(cutoff);
  const id = insertTrace({ type: "generate", prompt: "p", model: "claude-sonnet-4-5" });
  updateTrace(id, { status: "ok", costUsd: 1.5 });
  assert.equal(getSpendSince(cutoff), before + 1.5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/db.test.mjs`
Expected: FAIL — `createLlmSession`, `getLlmSession`, `appendLlmSessionTurns`, `getSpendSince` are not exported yet, and `updateTrace` doesn't accept `costUsd`.

- [ ] **Step 3: Implement the changes in `src/lib/db.ts`**

Change line 6:
```ts
const db = new Database(process.env.DB_PATH ?? path.join(process.cwd(), "tripmate.db"));
```

Add a new table, right after the `llm_traces` table block (after line 32):
```ts
// One row per persisted API-transport chat/edit session — the LLM_TRANSPORT=api counterpart to
// the CLI's local JSONL session file. `messages` is a JSON array of Anthropic message turns (both
// user and assistant), replayed in full on every resume. See claude.ts's runClaudeViaApi and
// docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md.
db.exec(`
  CREATE TABLE IF NOT EXISTS llm_sessions (
    id TEXT PRIMARY KEY,
    messages TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);
```

Add a new `addColumnIfMissing` call alongside the existing ones (after line 133):
```ts
// Populated only by runClaudeViaApi() — the Messages API reports no cost itself, so this is
// computed from its usage block via modelPricing.ts at write time. NULL forever on
// LLM_TRANSPORT=cli traces, which keep deriving cost from the CLI envelope on read instead
// (see runs.ts/perfAggregate.ts) — both are permanent, not a migration in progress.
addColumnIfMissing("llm_traces", "cost_usd", "REAL");
```

Update the `TraceRow` interface to add the new field:
```ts
export interface TraceRow {
  id: string;
  type: string;
  prompt: string;
  raw_response: string | null;
  model: string;
  duration_ms: number | null;
  status: string;
  error_message: string | null;
  run_id: string | null;
  cost_usd: number | null;
  created_at: string;
}
```

Update `updateTrace()`:
```ts
export function updateTrace(
  id: string,
  fields: {
    status: string;
    rawResponse?: string;
    durationMs?: number;
    errorMessage?: string;
    costUsd?: number;
  }
): void {
  db.prepare(
    `UPDATE llm_traces
     SET status = @status,
         raw_response = COALESCE(@rawResponse, raw_response),
         duration_ms = @durationMs,
         error_message = @errorMessage,
         cost_usd = COALESCE(@costUsd, cost_usd)
     WHERE id = @id`
  ).run({
    id,
    status: fields.status,
    rawResponse: fields.rawResponse ?? null,
    durationMs: fields.durationMs ?? null,
    errorMessage: fields.errorMessage ?? null,
    costUsd: fields.costUsd ?? null,
  });
}
```

Add these new functions (near `getTrace`/`listTraces`, or at the end of the file):
```ts
export function createLlmSession(messages: unknown[]): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO llm_sessions (id, messages, created_at) VALUES (@id, @messages, @createdAt)`
  ).run({ id, messages: JSON.stringify(messages), createdAt: new Date().toISOString() });
  return id;
}

export function getLlmSession(id: string): unknown[] | undefined {
  const row = db.prepare(`SELECT messages FROM llm_sessions WHERE id = ?`).get(id) as
    | { messages: string }
    | undefined;
  if (!row) return undefined;
  return JSON.parse(row.messages) as unknown[];
}

export function appendLlmSessionTurns(id: string, newTurns: unknown[]): void {
  const existing = getLlmSession(id) ?? [];
  db.prepare(`UPDATE llm_sessions SET messages = ? WHERE id = ?`).run(
    JSON.stringify([...existing, ...newTurns]),
    id
  );
}

/** Sum of `cost_usd` for traces created at or after `isoCutoff`. Built from a caller-supplied ISO
 *  string, never SQLite's `datetime('now', ...)` — see the CLAUDE.md gotcha on comparing ISO
 *  ("...T...Z") timestamps against SQLite's space-separated `datetime()` output. */
export function getSpendSince(isoCutoff: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM llm_traces WHERE created_at >= ?`)
    .get(isoCutoff) as { total: number };
  return row.total;
}
```

Note: `createLlmSession`/`getLlmSession`/`appendLlmSessionTurns` deliberately type their payload as `unknown[]`, not an Anthropic SDK type — `db.ts` stores opaque JSON blobs, and `claude.ts` (Task 3) owns the Anthropic-specific typing on the way in and out. Keeps this file free of an SDK dependency.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/db.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts src/lib/db.test.mjs
git commit -m "Add llm_sessions table, cost_usd column, and a configurable DB_PATH for the API transport"
```

---

### Task 3: Split `runClaude()` into `runClaudeViaCli()` + `runClaudeViaApi()` behind a dispatcher

**Files:**
- Modify: `src/lib/claude.ts`
- Modify: `package.json` (add `@anthropic-ai/sdk`)
- Create: `src/lib/claude.test.mjs`

**Interfaces:**
- Consumes: `computeCostUsd` from `./modelPricing` (Task 1); `createLlmSession`, `getLlmSession`, `appendLlmSessionTurns`, `updateTrace(..., costUsd?)` from `./db` (Task 2).
- Produces: `runClaude(prompt, type, timeoutMs?, meta?): Promise<ClaudeResult>` — signature and `ClaudeResult` shape **unchanged** from before this task, so none of the 11 existing call sites need edits. Also exports `thinkingFor(type: ClaudeCallType, effort?: "low"|"medium"|"high"): Anthropic.Messages.ThinkingConfigParam | undefined` for testing.

- [ ] **Step 1: Add the SDK dependency**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/claude.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { thinkingFor } from "./claude.ts";

test("thinkingFor omits thinking whenever the caller passed an explicit effort", () => {
  assert.equal(thinkingFor("chat", "low"), undefined);
  assert.equal(thinkingFor("element-edit", "low"), undefined);
  assert.equal(thinkingFor("generate", "low"), undefined);
});

test("thinkingFor gives the big structured-output calls a fixed thinking budget", () => {
  for (const type of ["generate", "refine", "rebalance", "critique"]) {
    assert.deepEqual(thinkingFor(type), { type: "enabled", budget_tokens: 4096 });
  }
});

test("thinkingFor omits thinking for small lookups with no effort passed", () => {
  for (const type of ["place-detail", "context", "judge"]) {
    assert.equal(thinkingFor(type), undefined);
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/claude.test.mjs`
Expected: FAIL — `thinkingFor` is not exported yet.

- [ ] **Step 4: Rewrite `src/lib/claude.ts`**

Keep everything from the top of the file through the `ClaudeCallType` export (imports, `MODEL`, `DEFAULT_TIMEOUT_MS`, `CRITIQUE_TIMEOUT_MS`, `CLI_SEARCH_PATH`, `isExecutable`, `extensionBinaries`, `resolveCliBin`, `BASE_TIMEOUT_MS`/`PER_DAY_TIMEOUT_MS`/`MAX_TIMEOUT_MS`, `itineraryTimeoutMs`, `SessionOption`, `ClaudeResult`, `ClaudeCallType`, and every one of their doc comments) **exactly as they are today, byte-for-byte**. Add one import line near the top:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { appendLlmSessionTurns, createLlmSession, getLlmSession, insertTrace, updateTrace } from "./db";
import { computeCostUsd } from "./modelPricing";
```//replacing the existing `import { insertTrace, updateTrace } from "./db";` line.

Then replace the exported `export function runClaude(...)` (the whole function, today's lines 303-444) with the following three pieces, in this order:

```ts
/**
 * The `claude` CLI subprocess transport — unchanged from before the API transport existed. Every
 * doc comment above (spawn-vs-execFile, CLAUDECODE stripping, PATH resolution, resolveCliBin) and
 * every non-obvious behavior it describes still applies exactly as written. Kept in permanent
 * service for local development — see the `LLM_TRANSPORT` dispatcher below.
 */
function runClaudeViaCli(
  prompt: string,
  type: ClaudeCallType,
  timeoutMs: number,
  meta?: {
    runId?: string;
    effort?: "low" | "medium" | "high";
    model?: string;
    session?: SessionOption;
  }
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const { CLAUDECODE: _drop, ...env } = process.env;
    void _drop;
    env.PATH = [env.PATH, ...CLI_SEARCH_PATH].filter(Boolean).join(":");
    const cliBin = resolveCliBin(env.PATH);

    const model = meta?.model ?? MODEL;
    const traceId = insertTrace({ type, prompt, model, runId: meta?.runId });
    const startedAt = Date.now();

    const sessionArgs = meta?.session?.resume
      ? ["--resume", meta.session.resume]
      : meta?.session?.persist
        ? []
        : ["--no-session-persistence"];

    const child = spawn(
      cliBin,
      [
        "-p",
        prompt,
        "--model",
        model,
        "--output-format",
        "json",
        "--tools",
        "",
        ...sessionArgs,
        "--setting-sources",
        "",
        ...(meta?.effort ? ["--effort", meta.effort] : []),
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      updateTrace(traceId, { status: "timeout", durationMs: Date.now() - startedAt });
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      settled = true;
      const hint =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? ` — no runnable claude CLI was found (tried '${cliBin}'). If ~/.local/bin/claude is a` +
            ` symlink into a VS Code extension directory that an update has since deleted, repoint` +
            ` it at the current one; otherwise set CLAUDE_CLI_PATH to the binary's absolute path` +
            ` and restart the server.`
          : "";
      updateTrace(traceId, {
        status: "error",
        errorMessage: err.message + hint,
        durationMs: Date.now() - startedAt,
      });
      reject(new Error(`claude CLI failed to start: ${err.message}${hint}`));
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (settled) return;
      const durationMs = Date.now() - startedAt;
      if (code !== 0) {
        updateTrace(traceId, {
          status: "error",
          rawResponse: stderr || stdout,
          durationMs,
          errorMessage: `exited ${code}`,
        });
        reject(new Error(`claude CLI exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const envelope = JSON.parse(stdout);
        if (envelope.is_error) {
          updateTrace(traceId, { status: "error", rawResponse: stdout, durationMs });
          reject(new Error(`claude CLI error: ${envelope.result}`));
          return;
        }
        updateTrace(traceId, { status: "ok", rawResponse: stdout, durationMs });
        resolve({
          result: envelope.result as string,
          traceId,
          model,
          durationMs,
          sessionId: envelope.session_id as string | undefined,
        });
      } catch {
        updateTrace(traceId, {
          status: "error",
          rawResponse: stdout,
          durationMs,
          errorMessage: "non-JSON envelope",
        });
        reject(new Error(`claude CLI returned non-JSON envelope: ${stdout}`));
      }
    });
  });
}

const anthropic = new Anthropic();
const API_MAX_TOKENS = 16_000;

/**
 * Maps this app's `effort`/call-type vocabulary onto the Messages API's `thinking` param.
 *
 * Sonnet 4.5 has no `effort` parameter at all (that's a Sonnet-5+/Opus-4.5+ knob) — the only
 * thinking control available is `thinking.budget_tokens`, and *omitting* `thinking` entirely
 * means no extended thinking runs, which the CLI could never do (see its own `--effort` comment
 * above: "there is no way to turn thinking off").
 *
 * `effort: "low"` calls (chat, element-edit, the bench harness) map to no-thinking outright — a
 * genuine improvement over the CLI floor. The big structured-output calls that ran under the
 * CLI's always-on thinking (generate/refine/rebalance/critique — the model's 0.959 benchmark
 * score was measured under that regime) get a modest fixed budget to approximate it; this is a
 * ported starting point, not a measured constant. Small lookups (place-detail/context/judge) get
 * no thinking either.
 */
export function thinkingFor(
  type: ClaudeCallType,
  effort?: "low" | "medium" | "high"
): Anthropic.Messages.ThinkingConfigParam | undefined {
  if (effort) return undefined;
  const alwaysOnUnderCli: ClaudeCallType[] = ["generate", "refine", "rebalance", "critique"];
  if (alwaysOnUnderCli.includes(type)) {
    return { type: "enabled", budget_tokens: 4096 };
  }
  return undefined;
}

/**
 * The direct Anthropic Messages API transport. Used only when `LLM_TRANSPORT=api` (see the
 * dispatcher below) — there is no `claude` CLI binary or logged-in session on a deployed
 * container, so this exists to make a public deploy possible without touching local dev.
 *
 * Session continuity has no server-side primitive in the Messages API (unlike the CLI's local
 * JSONL replay) — `llm_sessions` (src/lib/db.ts) stores the growing message array ourselves and
 * replays it in full on resume, which is the same trick the CLI's file already does.
 */
function runClaudeViaApi(
  prompt: string,
  type: ClaudeCallType,
  timeoutMs: number,
  meta?: {
    runId?: string;
    effort?: "low" | "medium" | "high";
    model?: string;
    session?: SessionOption;
  }
): Promise<ClaudeResult> {
  return (async () => {
    const model = meta?.model ?? MODEL;
    const traceId = insertTrace({ type, prompt, model, runId: meta?.runId });
    const startedAt = Date.now();

    let priorMessages: Anthropic.Messages.MessageParam[] = [];
    if (meta?.session?.resume) {
      const stored = getLlmSession(meta.session.resume) as
        | Anthropic.Messages.MessageParam[]
        | undefined;
      if (!stored) {
        updateTrace(traceId, {
          status: "error",
          durationMs: Date.now() - startedAt,
          errorMessage: `llm session ${meta.session.resume} not found`,
        });
        throw new Error(`llm session ${meta.session.resume} not found`);
      }
      priorMessages = stored;
    }
    const messages: Anthropic.Messages.MessageParam[] = [
      ...priorMessages,
      { role: "user", content: prompt },
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await anthropic.messages.create(
        {
          model,
          max_tokens: API_MAX_TOKENS,
          messages,
          thinking: thinkingFor(type, meta?.effort),
        },
        { signal: controller.signal }
      );
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;

      const textBlock = response.content.find(
        (block): block is Anthropic.Messages.TextBlock => block.type === "text"
      );
      if (!textBlock) {
        updateTrace(traceId, {
          status: "error",
          rawResponse: JSON.stringify(response),
          durationMs,
          errorMessage: "no text block in response",
        });
        throw new Error("claude API response contained no text block");
      }

      const costUsd = computeCostUsd(model, {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens,
      });

      let sessionId: string | undefined;
      const newTurns: Anthropic.Messages.MessageParam[] = [
        { role: "user", content: prompt },
        { role: "assistant", content: response.content },
      ];
      if (meta?.session?.resume) {
        appendLlmSessionTurns(meta.session.resume, newTurns);
        sessionId = meta.session.resume;
      } else if (meta?.session?.persist) {
        sessionId = createLlmSession(newTurns);
      }

      updateTrace(traceId, {
        status: "ok",
        rawResponse: JSON.stringify(response),
        durationMs,
        costUsd: costUsd ?? undefined,
      });

      return { result: textBlock.text, traceId, model, durationMs, sessionId };
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      if (controller.signal.aborted) {
        updateTrace(traceId, { status: "timeout", durationMs });
        throw new Error(`claude API call timed out after ${timeoutMs}ms`);
      }
      const hint =
        err instanceof Anthropic.AuthenticationError
          ? " — ANTHROPIC_API_KEY is missing or invalid. Check Railway's environment variables."
          : "";
      const message = err instanceof Error ? err.message : String(err);
      updateTrace(traceId, { status: "error", durationMs, errorMessage: message + hint });
      throw new Error(`claude API call failed: ${message}${hint}`);
    }
  })();
}

/**
 * Dispatches to one of two transports based on `LLM_TRANSPORT` (default `"cli"`):
 * `runClaudeViaCli()` (the local subprocess, free under the existing CLI subscription — serves
 * local dev unchanged) or `runClaudeViaApi()` (a direct Anthropic API call, used only where
 * `LLM_TRANSPORT=api` is set — Railway's deployed environment, which has no CLI binary at all).
 * This is a deliberate, permanent dual-path design, not a migration in progress. See
 * docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md.
 *
 * Every call is logged to `llm_traces` regardless of transport (prompt + raw response, on every
 * outcome including errors/timeouts) — see the LLM trace FAB (src/components/LlmTraceFab.tsx).
 * `meta.runId`, when passed, groups this call with sibling calls from the same pipeline execution.
 * `meta.model` overrides which model serves the call, for the dev-only benchmark harness.
 */
export function runClaude(
  prompt: string,
  type: ClaudeCallType,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  meta?: {
    runId?: string;
    effort?: "low" | "medium" | "high";
    model?: string;
    session?: SessionOption;
  }
): Promise<ClaudeResult> {
  return (process.env.LLM_TRANSPORT ?? "cli") === "api"
    ? runClaudeViaApi(prompt, type, timeoutMs, meta)
    : runClaudeViaCli(prompt, type, timeoutMs, meta);
}
```

Leave `parseJsonResponse<T>()` at the bottom of the file exactly as it is.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/claude.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the existing CLI-timeout test to confirm no regression**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/claudeTimeout.test.mjs`
Expected: PASS — `CRITIQUE_TIMEOUT_MS` and `itineraryTimeoutMs` are untouched exports.

- [ ] **Step 7: Typecheck and reconcile against the installed SDK's exact types**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. If the installed `@anthropic-ai/sdk` version names types slightly differently than written above (e.g. `Anthropic.Messages.MessageParam` vs a differently-nested path), fix the import paths to match what the installed package actually exports — the logic and shape above stay the same, only the type import path may need adjusting.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/claude.ts src/lib/claude.test.mjs package.json package-lock.json
git commit -m "Split runClaude into CLI and API transports behind an LLM_TRANSPORT dispatcher"
```

---

### Task 4: Dual-envelope-shape support in `runs.ts` and `perfAggregate.ts`

**Files:**
- Modify: `src/lib/runs.ts`
- Create: `src/lib/runs.test.mjs`
- Modify: `src/lib/perfAggregate.ts`
- Modify: `src/lib/perfAggregate.test.mjs` (add cases, don't remove existing ones)
- Modify: `src/app/api/llm-traces/perf/route.ts`

**Interfaces:**
- Consumes: `TraceRow.cost_usd` from Task 2.
- Produces: `parseUsage(rawResponse: string | null, model?: string, storedCostUsd?: number | null): RunStepUsage` (signature gains a third optional param — existing 2-arg callers unaffected).

- [ ] **Step 1: Write the failing test for `runs.ts`**

Create `src/lib/runs.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { parseUsage } from "./runs.ts";

test("parseUsage reads a CLI envelope (modelUsage present)", () => {
  const raw = JSON.stringify({
    modelUsage: { "claude-sonnet-4-5": { inputTokens: 100, outputTokens: 50, costUSD: 0.02 } },
  });
  const usage = parseUsage(raw, "claude-sonnet-4-5");
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 50);
  assert.equal(usage.costUsd, 0.02);
});

test("parseUsage reads a Messages API envelope (usage present, no modelUsage)", () => {
  const raw = JSON.stringify({
    usage: { input_tokens: 200, output_tokens: 75, cache_read_input_tokens: 10, cache_creation_input_tokens: 20 },
  });
  const usage = parseUsage(raw, "claude-sonnet-4-5");
  assert.equal(usage.inputTokens, 200);
  assert.equal(usage.outputTokens, 75);
  assert.equal(usage.costUsd, null);
});

test("parseUsage prefers the stored cost_usd column when given one", () => {
  const raw = JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } });
  const usage = parseUsage(raw, "claude-sonnet-4-5", 0.9);
  assert.equal(usage.costUsd, 0.9);
});

test("parseUsage returns all-null on missing rawResponse", () => {
  const usage = parseUsage(null);
  assert.equal(usage.inputTokens, null);
  assert.equal(usage.costUsd, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/runs.test.mjs`
Expected: FAIL — `parseUsage` doesn't yet branch on envelope shape and ignores the third argument.

- [ ] **Step 3: Update `parseUsage` and `toRunStep` in `src/lib/runs.ts`**

```ts
export function parseUsage(
  rawResponse: string | null,
  model: string = MODEL,
  storedCostUsd?: number | null
): RunStepUsage {
  if (!rawResponse) return { inputTokens: null, outputTokens: null, costUsd: null };
  try {
    const envelope = JSON.parse(rawResponse);
    const num = (v: unknown) => (typeof v === "number" ? v : null);

    // Messages API response (LLM_TRANSPORT=api) — no `modelUsage`, has a top-level `usage`.
    // This branch is permanent, not a migration step: the CLI keeps running for local dev, so
    // both shapes coexist in llm_traces forever.
    if (!("modelUsage" in envelope) && "usage" in envelope) {
      return {
        inputTokens: num(envelope.usage?.input_tokens),
        outputTokens: num(envelope.usage?.output_tokens),
        costUsd: storedCostUsd ?? null,
        cacheReadInputTokens: num(envelope.usage?.cache_read_input_tokens),
        cacheCreationInputTokens: num(envelope.usage?.cache_creation_input_tokens),
      };
    }

    // CLI envelope (LLM_TRANSPORT=cli, the default) — unchanged from before this migration.
    const byModel = envelope.modelUsage ?? {};
    const keys = Object.keys(byModel);
    const modelUsage =
      byModel[model] ??
      byModel[keys.find((k) => k.startsWith(model) || model.startsWith(k)) ?? ""] ??
      (keys.length === 1 ? byModel[keys[0]] : undefined);
    return {
      inputTokens: num(modelUsage?.inputTokens),
      outputTokens: num(modelUsage?.outputTokens),
      costUsd: storedCostUsd ?? num(modelUsage?.costUSD) ?? num(envelope.total_cost_usd),
      cacheReadInputTokens: num(modelUsage?.cacheReadInputTokens),
      cacheCreationInputTokens: num(modelUsage?.cacheCreationInputTokens),
    };
  } catch {
    return { inputTokens: null, outputTokens: null, costUsd: null };
  }
}

export function toRunStep(trace: TraceRow): RunStep {
  return {
    id: trace.id,
    type: trace.type,
    status: trace.status,
    model: trace.model,
    durationMs: trace.duration_ms,
    createdAt: trace.created_at,
    prompt: trace.prompt,
    rawResponse: trace.raw_response,
    errorMessage: trace.error_message,
    usage: parseUsage(trace.raw_response, trace.model, trace.cost_usd),
  };
}
```

(`computeStatus`, `toRunSummary`, `toRunDetail`, `computeAllRunSummaries` are unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/runs.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test additions for `perfAggregate.ts`**

Add these two tests to the end of the existing `src/lib/perfAggregate.test.mjs` (do not remove or modify any existing test in that file):

```js
test("parseCliMetrics recognizes a Messages API envelope and returns null for CLI-only fields", () => {
  const apiEnvelope = JSON.stringify({
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 500,
    },
  });
  const metrics = parseCliMetrics(apiEnvelope);
  assert.equal(metrics.inputTokens, 120);
  assert.equal(metrics.outputTokens, 80);
  assert.equal(metrics.costUsd, null);
  assert.equal(metrics.ttftMs, null);
  assert.equal(metrics.timeToRequestMs, null);
  assert.equal(metrics.apiDurationMs, null);
});

test("aggregatePerfStats prefers a trace's own cost_usd column over the envelope for cost stats", () => {
  const traces = [
    {
      type: "generate",
      durationMs: 1000,
      rawResponse: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 10 } }),
      costUsd: 0.5,
    },
  ];
  const [generate] = aggregatePerfStats(traces);
  assert.equal(generate.costUsd.avg, 0.5);
});
```

- [ ] **Step 6: Run test to verify the new cases fail**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/perfAggregate.test.mjs`
Expected: the two new tests FAIL (existing ones still pass); `parseCliMetrics` doesn't branch on shape yet and `aggregatePerfStats` doesn't read `costUsd` off the row.

- [ ] **Step 7: Update `src/lib/perfAggregate.ts`**

```ts
/** Pulls tokens/timing back out of the raw envelope. Branches on shape: a CLI envelope
 *  (`modelUsage` present) carries `ttft_ms`/`time_to_request_ms`/`duration_api_ms` and its own
 *  `total_cost_usd`; a Messages API response (`usage` present, no `modelUsage`) has none of
 *  those — no first-token concept on a non-streaming call, no subprocess-spawn overhead, and no
 *  cost field at all, so those stay null for an API-transport trace forever (permanent, not a
 *  migration step, since the CLI keeps running for local dev). Cost for an API-transport trace
 *  comes from the trace row's own `cost_usd` column instead — see aggregatePerfStats below. */
export function parseCliMetrics(rawResponse: string | null): CliMetrics {
  if (!rawResponse) return EMPTY_METRICS;
  try {
    const envelope = JSON.parse(rawResponse);
    const num = (v: unknown) => (typeof v === "number" ? v : null);

    if (!("modelUsage" in envelope) && "usage" in envelope) {
      return {
        ...EMPTY_METRICS,
        inputTokens: num(envelope.usage?.input_tokens),
        outputTokens: num(envelope.usage?.output_tokens),
      };
    }

    const modelUsage = Object.values(envelope.modelUsage ?? {})[0] as
      | { inputTokens?: number; outputTokens?: number }
      | undefined;
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
```

Update `PerfTraceInput` and `aggregatePerfStats`:

```ts
export interface PerfTraceInput {
  type: string;
  durationMs: number | null;
  rawResponse: string | null;
  /** The trace's own `cost_usd` column — the only source of cost for an API-transport trace, and
   *  preferred over the CLI envelope's `total_cost_usd` for a CLI-transport one too. Optional so
   *  existing callers/fixtures that don't pass it still work, falling back to the envelope. */
  costUsd?: number | null;
}

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
      costUsd: computeStats(numbersOnly(rows.map((r, i) => r.costUsd ?? metrics[i].costUsd))),
    });
  }

  return result.sort((a, b) => a.type.localeCompare(b.type));
}
```

(`CliMetrics`, `EMPTY_METRICS`, `computeStats`, `numbersOnly` are unchanged.)

- [ ] **Step 8: Update the perf route to pass `cost_usd` through**

In `src/app/api/llm-traces/perf/route.ts`, change:

```ts
  const features = aggregatePerfStats(
    traces.map((t) => ({
      type: t.type,
      durationMs: t.duration_ms,
      rawResponse: t.raw_response,
      costUsd: t.cost_usd,
    }))
  );
```

- [ ] **Step 9: Run test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/perfAggregate.test.mjs`
Expected: PASS (all existing tests plus the 2 new ones)

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no errors

- [ ] **Step 11: Commit**

```bash
git add src/lib/runs.ts src/lib/runs.test.mjs src/lib/perfAggregate.ts src/lib/perfAggregate.test.mjs src/app/api/llm-traces/perf/route.ts
git commit -m "Read either CLI or Messages API envelope shape in runs.ts and perfAggregate.ts"
```

---

### Task 5: Demo abuse guard — spend cap + IP throttle

**Files:**
- Create: `src/lib/spendCap.ts`
- Create: `src/lib/spendCap.test.mjs`
- Create: `src/lib/ipThrottle.ts`
- Create: `src/lib/ipThrottle.test.mjs`
- Modify: `src/app/api/itinerary/route.ts`
- Modify: `src/app/api/trip-edit/route.ts`
- Modify: `src/app/api/place-detail/route.ts`

**Interfaces:**
- Consumes: `getSpendSince` from `./db` (Task 2).
- Produces: `isOverDailyCap(): boolean`, `isThrottled(req: { headers: { get(name: string): string | null } }): boolean` — both consumed by the three route files in this task.

- [ ] **Step 1: Write the failing test for `spendCap.ts`**

Create `src/lib/spendCap.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { isOverDailyCap } from "./spendCap.ts";

test("isOverDailyCap is false when DAILY_SPEND_CAP_USD is unset", () => {
  delete process.env.DAILY_SPEND_CAP_USD;
  assert.equal(isOverDailyCap(), false);
});

test("isOverDailyCap is false when DAILY_SPEND_CAP_USD is not a finite number", () => {
  process.env.DAILY_SPEND_CAP_USD = "not-a-number";
  assert.equal(isOverDailyCap(), false);
  delete process.env.DAILY_SPEND_CAP_USD;
});

test("isOverDailyCap trips once today's spend reaches the configured cap", () => {
  // A $0 cap trips regardless of actual spend, since SUM(cost_usd) is never negative —
  // deterministic without depending on what other tests have already written to the DB.
  process.env.DAILY_SPEND_CAP_USD = "0";
  assert.equal(isOverDailyCap(), true);
  delete process.env.DAILY_SPEND_CAP_USD;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/spendCap.test.mjs`
Expected: FAIL — `./spendCap.ts` does not exist.

- [ ] **Step 3: Create `src/lib/spendCap.ts`**

```ts
import { getSpendSince } from "./db";

function dailyCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD;
  if (!raw) return Infinity;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Infinity;
}

/**
 * True once today's LLM spend (a rolling 24h window, not calendar-day) reaches the configured
 * cap. Unset/invalid DAILY_SPEND_CAP_USD means no cap — the default in local dev, where the
 * LLM_TRANSPORT=cli path costs nothing extra anyway. Bounds overshoot to "one extra generation's
 * worth", not an exact ceiling: a single in-flight expensive run can push spend past the cap
 * before the next request's check sees it. Fine for a demo guard, not a precise billing control —
 * see docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md.
 */
export function isOverDailyCap(): boolean {
  const cap = dailyCapUsd();
  if (cap === Infinity) return false;
  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return getSpendSince(cutoffIso) >= cap;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/spendCap.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for `ipThrottle.ts`**

Create `src/lib/ipThrottle.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { isThrottled } from "./ipThrottle.ts";

function fakeRequest(ip) {
  return { headers: { get: (name) => (name === "x-forwarded-for" ? ip : null) } };
}

test("isThrottled allows the first few requests from an IP", () => {
  const req = fakeRequest("1.2.3.4");
  assert.equal(isThrottled(req), false);
  assert.equal(isThrottled(req), false);
  assert.equal(isThrottled(req), false);
});

test("isThrottled trips once an IP exceeds the window limit", () => {
  const req = fakeRequest("5.6.7.8");
  for (let i = 0; i < 3; i += 1) isThrottled(req);
  assert.equal(isThrottled(req), true);
});

test("isThrottled tracks IPs independently", () => {
  const req = fakeRequest("9.9.9.9");
  for (let i = 0; i < 4; i += 1) isThrottled(req);
  assert.equal(isThrottled(fakeRequest("10.10.10.10")), false);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/ipThrottle.test.mjs`
Expected: FAIL — `./ipThrottle.ts` does not exist.

- [ ] **Step 7: Create `src/lib/ipThrottle.ts`**

```ts
/**
 * Secondary, noise-reducer-only guard — the daily spend cap (spendCap.ts) is the real backstop.
 * A per-IP limit alone doesn't hold up (shared IPs/NAT), so this only exists to stop one actor
 * from burning through the whole cap alone. In-memory and per-process: resets on redeploy, which
 * is fine since the spend cap survives restarts (it's DB-backed) and this doesn't need to.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;

const recentByIp = new Map<string, number[]>();

function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export function isThrottled(req: { headers: { get(name: string): string | null } }): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (recentByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  recentByIp.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}
```

(A plain structural type for `req`, not `NextRequest`, so this stays trivially unit-testable and dependency-free — `NextRequest` already satisfies this shape.)

- [ ] **Step 8: Run test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/ipThrottle.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 9: Wire the guard into the three public routes**

In `src/app/api/itinerary/route.ts`, add the imports and insert the guard as the very first lines of `POST`:

```ts
import { isThrottled } from "@/lib/ipThrottle";
import { isOverDailyCap } from "@/lib/spendCap";
```

```ts
export async function POST(req: NextRequest) {
  if (isThrottled(req)) {
    return NextResponse.json(
      { error: "Too many requests — slow down and try again shortly." },
      { status: 429 }
    );
  }
  if (isOverDailyCap()) {
    return NextResponse.json(
      { error: "Demo budget for today has been used up — try again tomorrow." },
      { status: 503 }
    );
  }
  const body = await req.json();
  // ...unchanged from here
```

Repeat the same two imports and the same guard block (identical error messages and status codes) as the first lines of `POST` in `src/app/api/trip-edit/route.ts` and `src/app/api/place-detail/route.ts`, before each file's existing `const body = await req.json();` / `const { name, destination, lat, lng, tripId } = await req.json();` line.

- [ ] **Step 10: Run the full test suite, typecheck, and lint**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: PASS, no errors

- [ ] **Step 11: Manual verification against a running dev server**

Run: `npm run dev`, then in another terminal:
```bash
curl -s -X POST http://localhost:3000/api/place-detail -H "Content-Type: application/json" -d '{}'
```
Expected: a 400 "Missing required fields" (proves the guard didn't block a normal request through — `DAILY_SPEND_CAP_USD` and no real IP flood are both absent, so both checks pass through to the existing validation).

- [ ] **Step 12: Commit**

```bash
git add src/lib/spendCap.ts src/lib/spendCap.test.mjs src/lib/ipThrottle.ts src/lib/ipThrottle.test.mjs src/app/api/itinerary/route.ts src/app/api/trip-edit/route.ts src/app/api/place-detail/route.ts
git commit -m "Add a route-boundary spend cap and IP throttle guard for public generation endpoints"
```

---

### Task 6: SSE keepalive for the generation stream

**Files:**
- Modify: `src/app/api/itinerary/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (internal behavior fix only).

- [ ] **Step 1: Edit the streaming branch of `POST` in `src/app/api/itinerary/route.ts`**

Replace the block starting at `const stream = new ReadableStream({` through its closing `});` with:

```ts
  // Do not add `export const runtime = "edge"` — the Edge runtime is deprecated in Next 16;
  // the Node default is the only non-deprecated choice and it supports streaming.
  let keepalive: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(PADDING_FRAME);
      let clientGone = false;
      const safeEnqueue = (event: string, data: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(sseFrame(event, data));
        } catch (err) {
          clientGone = true;
          console.error(`[itinerary] ${event} emit failed`, err);
        }
      };
      // The generate wait (60-150s) and critique wait (10-30s) are otherwise silent on the
      // wire, which a platform proxy's idle-connection timeout (nginx ~60s, an ALB ~60s,
      // Cloudflare ~100s — see docs/backend.md) would kill mid-wait. A `:`-prefixed line is a
      // comment frame the client (eventStream.ts) already skips unconditionally, so this needs
      // no client change.
      keepalive = setInterval(() => {
        if (clientGone) return;
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch (err) {
          clientGone = true;
          console.error("[itinerary] keepalive emit failed", err);
        }
      }, 20_000);
      const onStage = (event: StageEvent) => safeEnqueue("stage", event);
      try {
        const result = await runGeneration(params, onStage);
        safeEnqueue("done", result);
      } catch (err) {
        console.error("[itinerary]", err);
        safeEnqueue("error", { error: GENERATION_ERROR });
      } finally {
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // Already closed or the controller is unusable post-disconnect — either way
          // there is nothing left to do.
        }
      }
    },
    cancel() {
      // The client navigated away or aborted the fetch; Next/undici already tears this
      // stream down for us. runGeneration has no cancellation token, so an in-flight Claude
      // call simply finishes and its result is discarded — nothing further to clean up here.
      clearInterval(keepalive);
    },
  });
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: no errors

- [ ] **Step 3: Manual verification against a running dev server**

Run: `npm run dev`, then in another terminal, start a real streaming generate call and watch the raw bytes for periodic `:` comment lines during the wait:
```bash
curl -N -X POST "http://localhost:3000/api/itinerary?stream=1" \
  -H "Content-Type: application/json" \
  -d '{"destination":"Kyoto, Japan","startDate":"2026-09-19","endDate":"2026-09-21","budget":2000,"tier":"comfort"}'
```
Expected: a `stage` event arrives quickly, then — during the generate wait — periodic blank-looking lines every ~20s (the `:` comment frames) before the `done` event, rather than total silence.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/itinerary/route.ts
git commit -m "Add an SSE keepalive so the generation stream survives a proxy idle timeout"
```

---

### Task 7: Docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/backend.md`
- Modify: `docs/llm.md`
- Modify: `docs/product-readiness.md`
- Modify: `.env.local.example`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Extend `CLAUDE.md`**

Insert a new subsection immediately after the existing "### The LLM is a subprocess, not an SDK" section (before "### Two generation paths coexist"):

```markdown
### Two transports, one interface

`runClaude()` is a dispatcher, not the implementation. It routes to one of two functions based on
`LLM_TRANSPORT` (default `"cli"`):

- `runClaudeViaCli()` — the subprocess described above, unchanged. Serves local development for
  free under the existing CLI subscription; no `ANTHROPIC_API_KEY` needed.
- `runClaudeViaApi()` — calls the Anthropic Messages API directly via `@anthropic-ai/sdk`. Used
  only where `LLM_TRANSPORT=api` is set (Railway's deployed environment), since there's no `claude`
  CLI binary or logged-in session on a container.

This is a deliberate, permanent dual-path design, not a migration in progress — both stay in
service. Consequences worth knowing:

- **Session continuity works differently per transport but never crosses transports.** The CLI
  replays a local JSONL transcript on `--resume`; the API path replays a message array stored in
  the `llm_sessions` table (`src/lib/db.ts`). Because `LLM_TRANSPORT` is a whole-process setting,
  a session is only ever resumed under the transport that created it.
- **`llm_traces.raw_response` holds two envelope shapes side by side, forever.** A CLI-transport
  row has the CLI's `modelUsage`/`total_cost_usd` shape; an API-transport row has the Messages
  API's `usage` shape and a separately-populated `cost_usd` column (the Messages API reports no
  cost at all — see `src/lib/modelPricing.ts`). `src/lib/runs.ts` and `src/lib/perfAggregate.ts`
  branch on which shape they're reading; don't "simplify" that branch away.
- `src/lib/skill.ts` is unaffected either way — it only ever produced a prompt-text string to
  splice into the messages/prompt, independent of how the call is transported.

See `docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md` for the full design and
why (LinkedIn demo needed a public deploy link, which the CLI-only mechanism blocked).
```

- [ ] **Step 2: Update `docs/backend.md`**

Replace the existing "Deployment prerequisites" bullet with:

```markdown
## Deployment prerequisites

- **SSE idle-timeout gap (`POST /api/itinerary?stream=1`) — resolved 2026-08-25.** Implemented the
  keepalive this section used to defer: a `setInterval` in the stream's `start()` enqueues a
  `:\n\n` comment frame every 20s, cleared in `finally` and `cancel()`. See the Features table.
```

Add these two rows to the Features table:

```markdown
| SSE keepalive comment frame every 20s (`POST /api/itinerary?stream=1`) | Active | 2026-08-25 | Claude | Closes the idle-timeout gap this doc used to flag as "not built now" — a public Railway deploy makes it load-bearing. `:`-prefixed lines are already skipped by the client parser (`eventStream.ts`), so no client change |
| `runClaude()` gains a second transport: direct Anthropic API calls | Active | 2026-08-25 | Claude | `LLM_TRANSPORT=api` routes through `runClaudeViaApi()` instead of the CLI subprocess; default stays `cli` so local dev is unaffected. See CLAUDE.md and the design spec for the full picture |
```

- [ ] **Step 3: Update `docs/llm.md`**

Add these two rows to the Features table:

```markdown
| `cost_usd` column on `llm_traces`, `src/lib/modelPricing.ts` (extracted from `bench/models.ts`) | Active | 2026-08-25 | Claude | Populated by `runClaudeViaApi()` from the Messages API's `usage` block — the API reports no cost itself. `runClaudeViaCli()` traces keep deriving cost from the CLI envelope's own `total_cost_usd`/`modelUsage[model].costUSD` on read, unchanged |
| Thinking-budget mapping for the API transport (`thinkingFor()` in `claude.ts`) | Active | 2026-08-25 | Claude | Sonnet 4.5 has no `effort` param (Sonnet-5+/Opus-4.5+ only) — `effort:"low"` calls (chat/element-edit/bench) now omit `thinking` entirely (a genuine improvement over the CLI, which couldn't turn thinking off at all); generate/refine/rebalance/critique get a fixed `budget_tokens: 4096` to approximate the CLI's always-on thinking the 0.959 benchmark score was measured under. Ported starting point, not a measured constant — re-benchmark before trusting a quality delta to it |
```

- [ ] **Step 4: Update `docs/product-readiness.md`**

Add this paragraph immediately after the existing "**Deferred deliberately:** deploy/Vercel, hosted Postgres or Turso, auth and multi-tenancy, ..." line:

```markdown
**Update, 2026-08-25:** deploy is no longer deferred — a public Railway link is needed for a
LinkedIn demo, a different trigger than this round's validation sequencing. Not a reversal of the
judgment above: hosted Postgres/Turso, auth/multi-tenancy, and the B2B pitch are all still
deferred. See `docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md`.
```

- [ ] **Step 5: Update `.env.local.example`**

Append:

```bash
# Required only when LLM_TRANSPORT=api (see CLAUDE.md). Unset/default "cli" means local dev
# keeps using the claude CLI subprocess for free and none of the below is needed.
# LLM_TRANSPORT=api
# ANTHROPIC_API_KEY=
# Hard daily spend cap (USD) on live generation, enforced only when LLM_TRANSPORT=api. Unset
# means no cap — fine for local dev, not for a public deploy.
# DAILY_SPEND_CAP_USD=
# Overrides where the SQLite file lives — set on Railway to the persistent volume's mount path.
# DB_PATH=

# Required in every environment (see CLAUDE.md) — POI suggestions silently degrade to none
# without it, they do not error.
OPENTRIPMAP_API_KEY=
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/backend.md docs/llm.md docs/product-readiness.md .env.local.example
git commit -m "Document the LLM transport dispatcher, its new env vars, and the resolved SSE gap"
```

---

### Task 8: Railway deploy scaffolding

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:** none.

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.next
.git
*.db
.env*
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# Node 22 per .nvmrc — better-sqlite3's native binding must be built inside this image, not
# copied from the host, or it crashes at the first DB-backed route (see CLAUDE.md).
#
# ponytail: single-stage, not multi-stage — image size isn't a stated requirement for a demo;
# revisit if Railway build/push time becomes a real problem.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
```

- [ ] **Step 3: Verify the image builds, if Docker is available locally**

Run: `docker build -t tripmate-test .` (if Docker isn't installed in this environment, skip this step — the actual Railway build will build from this same Dockerfile, and that's where it gets exercised for real; note this explicitly rather than claiming a local verification that didn't happen).
Expected (if run): the build completes without error, ending at `CMD ["npm", "start"]`.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "Add Railway deploy scaffolding: Dockerfile and .dockerignore"
```

---

## Final Verification

After all 8 tasks:

- [ ] `npm test` — full suite green.
- [ ] `npx tsc --noEmit -p tsconfig.json` — clean.
- [ ] `npm run lint` — clean.
- [ ] `grep -rn "runClaude(" src/` — confirm all 11 pre-existing call sites are byte-identical to before this plan (the point of preserving `runClaude()`'s interface).
- [ ] With `LLM_TRANSPORT` unset, run the app locally end-to-end (generate a trip, use the chat edit) and confirm it behaves exactly as before this plan — zero regression from the unused `runClaudeViaApi()` code path existing.
- [ ] With `LLM_TRANSPORT=api` and a real `ANTHROPIC_API_KEY` set locally: `curl` a real `POST /api/itinerary` generate call and confirm a trace row lands with `status: "ok"` and a populated `cost_usd`; a streaming (`?stream=1`) call and confirm the keepalive fires; a `trip-edit` chat turn that resumes a session and confirm `llm_sessions` grew correctly; and a temporarily-low `DAILY_SPEND_CAP_USD` to confirm the `503` guard fires.
- [ ] The actual Railway deploy (account/dashboard steps, env vars, volume) is the user's manual action — see the runbook in the spec — verified live once deployed, not as part of this plan's automated checks.
