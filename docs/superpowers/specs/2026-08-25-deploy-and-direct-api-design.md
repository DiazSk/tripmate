# Making TripMate deployable: route to the Anthropic API alongside the `claude` CLI subprocess, add a demo abuse guard, deploy to Railway

**Date:** 2026-08-25 (revised same day — see Revision note)
**Author:** Zaid (requested), Claude (drafting)
**Status:** Parked for discussion — not approved, not started

**Revision note:** the original version of this spec fully replaced the CLI subprocess with the
API call. Revised per Zaid: local development keeps running on the CLI (free under the existing
subscription, zero behavior change, no new env vars required day-to-day); only the deployed
Railway environment routes through the metered API. See "The transport dispatcher" in the Approach
section below.

## Context

The trigger: posting a demo on LinkedIn needs a live, shareable link, not just a video. Zaid's
framing was "our backend is too rigid, it only uses one vendor (Claude via the CLI)" — brainstorming
this surfaced that the vendor-rigidity worry and the deploy blocker are **the same root cause**, not
two separate concerns.

`runClaude()` in `src/lib/claude.ts` spawns the local `claude` CLI binary and hands it a copy of
`process.env` with no `ANTHROPIC_API_KEY` set anywhere — it rides whatever CLI session happens to
be logged in on the developer's machine (`resolveCliBin()` searches `PATH` and VS Code extension
install directories). That cannot exist on a Railway container. Confirmed with Zaid: the actual
ask is replacing the CLI-subprocess *mechanism* with a direct Anthropic API call — still Claude,
not multi-vendor (OpenAI/Gemini) support.

Worth having in view: three days ago (2026-08-22) a 5-advisor council explicitly deferred
deploy/hosted-DB/auth as "downstream of a validation result that does not exist yet"
(`docs/product-readiness.md`), and built `/trip/[id]/print` instead so reviewers could see a real
itinerary with zero deploy work. This spec reopens that deferred decision for a different,
legitimate reason — a public marketing demo — not because the prior judgment was wrong.

Because every model call in the app already funnels through the single `runClaude()` choke point
(11 call sites, all just awaiting `{result, traceId, model, durationMs, sessionId?}`), this is
smaller than it looks: **preserve `runClaude()`'s signature and `ClaudeResult` shape, and none of
the 11 callers need to change.** `claude.ts` gains a new API-calling implementation alongside the
existing CLI one, plus a thin router between them (see "The transport dispatcher" below), and three
downstream cost/usage parsers need to handle a second envelope shape appearing alongside the CLI's.

Scope, confirmed with Zaid during brainstorming:
- Live generation open to any visitor (not a canned/pre-generated demo).
- Abuse/cost guard: a **global daily spend cap** is the real backstop (per-IP alone was rejected —
  shared IPs/NAT make it useless as a hard limit); a light per-IP throttle is a secondary
  noise-reducer only.
- Host: Railway (persistent volume for SQLite, long-running Node process, no serverless timeout).

## Approach

### 1. `package.json`
Add `@anthropic-ai/sdk` to `dependencies`. No script changes needed here (container specifics are
step 9).

### 2. `src/lib/modelPricing.ts` (new)
Extract `DEFAULT_PRICES`, `CACHE_WRITE_MULTIPLIER` (1.25), `CACHE_READ_MULTIPLIER` (0.1), the
`TokenUsage` shape, and `computeCostUsd()`/`promptTokens()` out of `src/lib/bench/models.ts`
verbatim. `bench/models.ts` re-exports/wraps these instead of defining its own copy; its
env-override merge (`benchPrices()`) stays local since that's bench-only. Current Sonnet 4.5
pricing in that table ($3/$15 per MTok in/out) is correct as-is.

### 3. `src/lib/db.ts`
- `const db = new Database(process.env.DB_PATH ?? path.join(process.cwd(), "tripmate.db"));` —
  one-line override, default behavior unchanged (needed so a Railway volume can mount anywhere).
- `addColumnIfMissing("llm_traces", "cost_usd", "REAL")`, alongside the existing calls.
- New table:
  ```sql
  CREATE TABLE IF NOT EXISTS llm_sessions (
    id TEXT PRIMARY KEY,
    messages TEXT NOT NULL,   -- JSON array of Anthropic.MessageParam
    created_at TEXT NOT NULL
  )
  ```
- `createLlmSession(messages): string` (new `randomUUID()`, already imported in this file),
  `getLlmSession(id)`, `appendLlmSessionTurns(id, newTurns)` — store the **full content blocks**
  for both the user turn and the assistant reply, not just extracted text, so a resume replays
  faithfully even though today it's realistically one text block per turn.
- `updateTrace()` gains an optional `costUsd?: number`, written with the same `COALESCE(...)`
  pattern already used for `rawResponse`.
- `getSpendSince(isoCutoff: string): number` — `SELECT COALESCE(SUM(cost_usd),0) FROM llm_traces
  WHERE created_at >= ?`, cutoff built as a JS ISO string (never SQLite `datetime('now', ...)` —
  the existing gotcha about `T`/space-separated string comparison applies here too).

### 4. `src/lib/claude.ts` — split into two implementations behind a dispatcher

**Do not remove the CLI path.** Rename the existing spawn-based implementation (today's whole
`runClaude()` body) to `runClaudeViaCli()`, verbatim — no changes to `spawn`, `resolveCliBin()`,
`CLI_SEARCH_PATH`, `isExecutable()`, `extensionBinaries()`, `CLAUDE_CLI_PATH`, `--effort` handling,
or any of its doc comments. It keeps serving local development exactly as it does today.

Add a new `runClaudeViaApi()` with the design from the original version of this spec:

Add `import Anthropic from "@anthropic-ai/sdk"`, `computeCostUsd` from `./modelPricing`, the three
new session functions from `./db`. Module-level `const client = new Anthropic();` (reads
`ANTHROPIC_API_KEY` from env automatically — no explicit key needed).

`runClaudeViaApi()`'s body:
1. `insertTrace(...)` exactly as `runClaudeViaCli()` does.
2. Resolve the `messages` array: `session.resume` → `getLlmSession(id)`, append the new user turn
   to its stored history (if the row is missing, throw so the existing `trip-edit/route.ts`
   catch-and-rebuild path fires unchanged — same contract the CLI's "session file gone" case had);
   otherwise a fresh one-turn array.
3. **Thinking-budget mapping** (Sonnet 4.5 has no `effort` param — passing one 400s):
   - Calls that passed `effort: "low"` today (`chat`, `element-edit`, bench harness) → **omit
     `thinking` entirely**. This is a genuine improvement over the CLI, which had no way to turn
     thinking off at all.
   - `generate`/`refine`/`rebalance`/`critique` → `thinking: { type: "enabled", budget_tokens:
     4096 }`, approximating "thinking stayed on" (the model's 0.959 benchmark score ran under
     always-on CLI thinking). Note in the docs that this budget is a ported starting point, not a
     measured constant — re-benchmark before trusting a quality delta to it.
   - `place-detail`/`context`/`judge` → omit `thinking` (small lookups).
   - Put this mapping in one small pure helper (e.g. `thinkingFor(type, effort)`) so it's
     unit-testable without a network call.
4. `max_tokens: 16000` (new required param the CLI never surfaced; revisit only if a real
   `stop_reason: "max_tokens"` truncation is observed on a long trip).
5. `client.messages.create({ model, max_tokens, messages, thinking })`, non-streaming (confirmed:
   every caller only consumes the final text, and the app's SSE stream carries stage-progress
   events, never token deltas — no caller needs partial output). Pass an `AbortSignal` timed to
   `timeoutMs` so a timeout actually cancels the HTTP request, not just the local wait.
6. On success: extract the first `text` block from `response.content`; `computeCostUsd(model,
   response.usage)`; if session persist/resume, write/append via the new db functions and capture
   the id; `updateTrace(traceId, { status: "ok", rawResponse: JSON.stringify(response), durationMs,
   costUsd })` — **store the raw Messages API response**, not a synthesized CLI-shaped envelope.
7. On timeout/abort/SDK error: same `status: "timeout"|"error"` trace shape `runClaudeViaCli()`
   uses. Use the SDK's typed error chain (`Anthropic.AuthenticationError` → hint "ANTHROPIC_API_KEY
   missing or invalid — check Railway's environment variables") — this is a separate error path
   from the CLI's ENOENT/dangling-symlink hint, which stays exactly as-is in `runClaudeViaCli()`
   since that failure mode still exists there.

**The transport dispatcher.** `runClaude()` — the exported function every caller uses — becomes a
one-line router:
```ts
export function runClaude(
  prompt: string, type: ClaudeCallType, timeoutMs?: number, meta?: {...}
): Promise<ClaudeResult> {
  return (process.env.LLM_TRANSPORT ?? "cli") === "api"
    ? runClaudeViaApi(prompt, type, timeoutMs, meta)
    : runClaudeViaCli(prompt, type, timeoutMs, meta);
}
```
Default `"cli"` means **local development requires zero new env vars and zero behavior change** —
`LLM_TRANSPORT=api` is set only in Railway's environment. Because the transport choice is a
whole-process setting rather than a per-call decision, a session is only ever resumed under the
transport that created it (a trip generated locally stays on its CLI session for its whole chat
lifetime; a trip generated on Railway stays on its API session) — there is no cross-transport
resume case to handle.

`parseJsonResponse()` is untouched either way (operates on the extracted text string, always was
transport-agnostic). **Verify with `grep -rn "runClaude(" src/`** at the end that none of the 11
call sites needed edits — that's the point of preserving the interface, and it now also proves the
dispatcher is the only new thing callers depend on.

### 5. `src/lib/runs.ts` + `src/lib/perfAggregate.ts` — usage/cost reading
Both currently parse the CLI envelope shape (`modelUsage[model].costUSD` / `total_cost_usd`) out
of `raw_response`. Since step 4 now stores the raw Messages API response there instead, both need
to read `usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`
— and **prefer the new `cost_usd` trace column** over re-deriving cost from tokens where available.

**Required compatibility branch, and a permanent one — not a one-time migration shim.** Because the
CLI path keeps running for local dev (see the dispatcher above), `llm_traces.raw_response` will
hold **both** envelope shapes indefinitely, not just old-vs-new across a cutover date: any row
from a `LLM_TRANSPORT=cli` call has the CLI's `modelUsage`/`total_cost_usd` shape, any row from an
`LLM_TRANSPORT=api` call has the Messages API's `usage` shape, forever, side by side in the same
table. `parseUsage()`/`parseCliMetrics()` must branch on which shape they're looking at (e.g.
`"modelUsage" in envelope` vs `"usage" in envelope`) so trace-viewer/perf-dashboard entries render
correctly regardless of which transport produced them. Comment the branch so a future reader
doesn't "simplify" it away — there is no migration point after which one branch stops firing.

`perfAggregate.ts`'s `ttft_ms`/`time_to_request_ms`/`duration_api_ms` columns have no Messages-API
equivalent (no first-token concept on a non-streaming call, no subprocess-spawn overhead) — accept
`null` for these going forward on the Perf Dashboard; document it, don't try to fabricate them.

### 6. Abuse guard — new `src/lib/spendCap.ts` and `src/lib/ipThrottle.ts`
- `spendCap.ts`: `isOverDailyCap()` → `getSpendSince(iso 24h ago) >= Number(process.env
  .DAILY_SPEND_CAP_USD ?? Infinity)`. A rolling 24h window via one `SUM` query — no cron/reset job.
  This naturally only bites where it's configured: `DAILY_SPEND_CAP_USD` is unset in local dev, so
  the cap defaults to `Infinity` there — no special-casing needed to keep it out of the CLI path's
  way, it just never triggers unless deployed with the var set (which only Railway does).
- `ipThrottle.ts` (secondary only): read `x-forwarded-for` (Railway sits behind a proxy), an
  in-memory `Map<string, number[]>` of recent timestamps per IP, simplest sliding-window count
  (e.g. cap N requests per 10 minutes). No DB table — resetting on redeploy is fine, since the
  spend cap (DB-backed, survives restarts) is the actual backstop.
- Enforcement point: **route boundary only**, not inside `runClaude()`/`generationRunner.ts`. Once
  a generate call is already running, killing its downstream critique/context calls saves a small
  fraction of that run's sunk cost while guaranteeing a worse result for a traveler already
  mid-wait — the cap should block the *next* request, not truncate one in flight. Add the check
  (IP throttle first, cheaper; then spend cap) at the top of the `POST` handlers in
  `src/app/api/itinerary/route.ts` (covers generate, streaming, and rebalance — all billed),
  `src/app/api/trip-edit/route.ts` (chat/element-edit), and `src/app/api/place-detail/route.ts`.
  Over-cap → `503` with "Demo budget for today has been used up — try again tomorrow."
  Note for the docs: this bounds overshoot to "one extra generation's worth," not an exact ceiling
  — a single in-flight expensive run can push spend past the cap before the next request's check
  sees it. Fine for a demo guard, not a precise billing control.

### 7. SSE keepalive (already fully designed in `docs/backend.md`, just implement it)
In `src/app/api/itinerary/route.ts`'s stream `start()` (around line 135, after the existing
`controller.enqueue(PADDING_FRAME)`), start `setInterval(() => { if (!clientGone) try {
controller.enqueue(new TextEncoder().encode(":\n\n")); } catch { clientGone = true; } }, 20_000)`.
`clearInterval` it in the existing `finally` block (where `controller.close()` already happens)
and in `cancel()` (currently a no-op comment). No client change — `src/lib/eventStream.ts` already
skips any line starting with `:` unconditionally.

### 8. Docs
- `CLAUDE.md`: extend "The LLM is a subprocess, not an SDK" rather than replacing it — the four
  existing subprocess-specific bullets (CLAUDECODE stripping, spawn-vs-execFile, PATH resolution,
  `--setting-sources`/`--tools`) all still apply to `runClaudeViaCli()` and stay as-is. Add a new
  subsection describing `runClaudeViaApi()`, the `LLM_TRANSPORT` dispatcher, the session-store
  table, and that this is a deliberate dual-path design (not a migration in progress) — local dev
  stays on the CLI, only Railway routes through the API. Note `src/lib/skill.ts` is unaffected
  either way (pure prompt-text injection, always was transport-agnostic).
- `docs/backend.md`: resolve the "SSE idle-timeout gap" prerequisite (per this repo's convention —
  collapse into an `Eliminated`-style resolved note, add the keepalive as a new Features row);
  add a Features row for the transport swap itself.
- `docs/llm.md`: add rows for the `cost_usd` column, the `modelPricing.ts` extraction, and the
  thinking/effort mapping decision (so "why does the model behave differently now" has an answer).
- `docs/product-readiness.md`: note that deploy is no longer deferred, and why (LinkedIn demo need,
  not a reversal of the validation-first judgment).
- `.env.local.example`: add `LLM_TRANSPORT=` (commented as optional, default `cli`, set to `api`
  only on Railway), `ANTHROPIC_API_KEY=` (commented as required only when `LLM_TRANSPORT=api`),
  `DAILY_SPEND_CAP_USD=`, `DB_PATH=` (optional, Railway-only), and close the pre-existing gap by
  adding `OPENTRIPMAP_API_KEY=` (documented as required per CLAUDE.md but never actually listed in
  this file).

### 9. Railway deploy scaffolding (code side — account/dashboard steps are the user's, see below)
- `Dockerfile`: Node 22 base (per `.nvmrc`), `npm ci` **inside the container** (so
  `better-sqlite3`'s native binding builds against the container's real OS/arch — a host-built
  binding crashes at the first DB route, as happened historically on Node 20), which also runs the
  `postinstall` cesium-asset copy since it's already wired to that lifecycle hook, then `npm run
  build` (already runs `verify-build.mjs`), then `npm start`.
- `.dockerignore`: `node_modules`, `.next`, `.git`, `*.db`, `.env*`.
- Optional minimal `railway.json` pinning the start command; Railway auto-detects a Dockerfile.

### 10. Tests (one runnable check per non-trivial logic unit, matching this repo's convention)
- `src/lib/modelPricing.test.mjs`: known price × known tokens → expected cost; missing price →
  `null` (not `0`).
- `src/lib/claude.test.mjs` (new): test `thinkingFor()`'s mapping table directly for every
  `ClaudeCallType`/effort combination — pure function, no network/DB needed.
- Do not attempt to test `runClaude()`'s live network path in the automated suite (no API key in
  CI) — that's what the manual smoke test against a real key is for.

## Risks / known edge cases (documented, not solved)

- **Permanent code duplication, chosen deliberately.** Two session mechanisms (CLI's JSONL-file
  replay vs. the `llm_sessions` table), two effort/thinking mappings, two cost-accounting shapes —
  none of this collapses to one path later, because the CLI path stays in service indefinitely for
  free local dev. This is the direct cost of that choice, not an oversight; revisit only if
  maintaining both ever stops being worth the savings.
- **Orphaned `pending` trace rows on redeploy** — a container restart mid-call leaves a row stuck
  `pending` forever (existed with the CLI too, more likely on Railway where redeploys are
  routine). Not worth a reaper for a demo; note it, revisit only if the trace-viewer FAB gets
  noisy.
- **`llm_sessions` grows unbounded** — no owner/expiry/pruning. Disk growth on the Railway volume,
  not a functional bug; watch it, don't build pruning now.
- **Concurrent double-submit on the same `sessionId`** races the read-modify-write in
  `appendLlmSessionTurns` — mirrors an existing accepted risk class in this codebase (session
  fallback already handles "session unusable," not "session raced"); not solved, flagged.
- **Railway's own proxy idle-timeout is unverified from here** — the 20s keepalive comfortably
  beats the 60-100s range this repo already assumes for nginx/ALB/Cloudflare, but confirm Railway's
  actual value during the deploy smoke test; tighten the interval if it's unusually short.

## Deploy runbook (manual, Railway dashboard — not something an agent session can do)

1. New Railway project → deploy from this GitHub repo.
2. Confirm it builds via the new `Dockerfile` (select it explicitly if Railway defaults to
   Nixpacks instead).
3. Attach a persistent volume (e.g. mounted at `/data`).
4. Set env vars: `LLM_TRANSPORT=api` (this is what actually turns on the API path — without it the
   deployed app would default to `cli` and fail, since there's no `claude` binary in the
   container), `ANTHROPIC_API_KEY`, `DB_PATH=/data/tripmate.db`, `DAILY_SPEND_CAP_USD`,
   `NEXT_PUBLIC_CESIUM_ION_TOKEN`, `OPENTRIPMAP_API_KEY`, `NODE_ENV=production`.
5. Start command `npm start`; Railway sets `PORT` automatically and `next start` respects it.
6. Generate the public `*.up.railway.app` URL (or attach a custom domain) — this is the LinkedIn
   link.
7. Smoke-test one real generation against the live URL before sharing it publicly, watching logs
   for the auth/DB-path/cesium-asset failure modes above.
8. Confirm a second generation after the first still works (proves the volume persisted through
   the initial deploy) and that the SSE stream survives a full generate wait without dropping.

## Critical files

- `src/lib/claude.ts` — split into `runClaudeViaCli()` (unchanged) + `runClaudeViaApi()` (new) +
  the `runClaude()` dispatcher
- `src/lib/db.ts` — new table/column, `DB_PATH` override
- `src/lib/modelPricing.ts` (new, extracted from `src/lib/bench/models.ts`)
- `src/lib/runs.ts`, `src/lib/perfAggregate.ts` — envelope-shape compatibility branch
- `src/app/api/itinerary/route.ts` — spend/IP guard, SSE keepalive
- `src/app/api/trip-edit/route.ts`, `src/app/api/place-detail/route.ts` — spend/IP guard
- `src/lib/spendCap.ts`, `src/lib/ipThrottle.ts` (new)
- `Dockerfile`, `.dockerignore` (new)
- `CLAUDE.md`, `docs/backend.md`, `docs/llm.md`, `docs/product-readiness.md`, `.env.local.example`

## Verification (once approved and implemented)

- `npm test` (17 files, ~220 tests) stays green — claude.ts isn't in that suite's coverage today;
  confirm the two new `.test.mjs` files run under it.
- `npx tsc --noEmit -p tsconfig.json` and `npm run lint` clean.
- With `LLM_TRANSPORT` unset (default `cli`): confirm the app behaves exactly as it does today —
  no regression from adding the dispatcher and the unused `runClaudeViaApi()` code path.
- With `LLM_TRANSPORT=api` and a real `ANTHROPIC_API_KEY` set locally: `curl` a real
  `POST /api/itinerary` generate call and confirm a trace row lands with `status: "ok"` and a
  populated `cost_usd`; a streaming (`?stream=1`) call and confirm stage events plus periodic `:`
  keepalive bytes on the wire during a long wait; a `trip-edit` chat turn that resumes a session
  and confirm `llm_sessions` grew correctly; and a synthetic low `DAILY_SPEND_CAP_USD` to confirm
  the `503` guard actually fires.
- `grep -rn "runClaude(" src/` — confirm all 11 call sites are byte-identical to before (the point
  of preserving the interface holds regardless of which transport they end up routed to).
- The actual Railway deploy and its runbook steps are the user's manual action, verified per the
  smoke-test checklist above once live.
