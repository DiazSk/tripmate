import { spawn } from "child_process";
import { accessSync, constants, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import { appendLlmSessionTurns, createLlmSession, getLlmSession, insertTrace, updateTrace } from "./db";
import { computeCostUsd } from "./modelPricing";
import {
  apiModelFor,
  llmMode,
  maxTokensFor,
  supportsAdaptiveThinking,
  supportsEffort,
  type ClaudeCallType,
} from "./llmConfig";

/**
 * The production model for every call in the app.
 *
 * Was `claude-haiku-4-5-20251001`. The benchmark's own sweep (one fixture, 3 runs each) scored
 * Haiku 4.5 at 0.842 composite against 0.959 for Sonnet 4.5 and 0.952 for Opus 4.5 — the
 * Sonnet/Opus gap is noise at that sample size, the Haiku gap is not. This is a single call that
 * produces the entire product, so the tier matters more here than the per-token rate does.
 *
 * Sonnet 4.5 specifically, and NOT Sonnet 5, for three measured reasons:
 *
 * 1. **It is the model that actually scored 0.959.** Sonnet 5 was never benchmarked on this task;
 *    picking it was an extrapolation from "same tier, one generation newer".
 * 2. **Sonnet 5 was slower than the budget of the day.** It spent 164s before its first token
 *    and 196s in total on an 8-day trip, then timed out twice at 216s on a *3-day* trip. This
 *    reason has since weakened on its own: Sonnet 4.5 went on to time out at 218s the same way,
 *    and `itineraryTimeoutMs()` is now 300s — so "it does not fit the timeout" was really "the
 *    timeout was calibrated on Haiku". Reasons 1 and 3 are the ones still standing.
 * 3. **Its compliance broke the day shape.** It followed "about 3 stops per day" literally where
 *    Haiku had loosely ignored it, so days ended at 1pm. That prompt bug is fixed now (see
 *    travelerProfilePrompt.ts), but it is a reminder that a model change is a behaviour change and
 *    wants a real generation looked at, not just a benchmark number.
 *
 * Bare id, no date suffix — the dated form is a stale convention.
 */
export const MODEL = "claude-sonnet-4-5";
export const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * The critique pass reasons over a whole generated itinerary, so it is far closer to a
 * generate call than to the small lookups DEFAULT_TIMEOUT_MS was sized for.
 *
 * **Third calibration of this constant, and the first two failed the same way: the percentile
 * was computed over the calls that survived the cap.** 90s was set from "p50 58s / p90 75s",
 * 150s from a corpus that is no longer in the table. Both looked like measurements. Neither
 * was, and the reason is worth stating once because it is the whole trap:
 *
 * A killed call does not record how long it needed — it records the cap. So the successes are
 * exactly the calls that fit, and a percentile over them **cannot exceed the cap no matter how
 * heavy the real tail is.** "p90 = 146s" against a 150s cap is not evidence the cap holds; it
 * is the cap describing itself. Timed-out rows are *censored observations*: we know they needed
 * more than 150s, not how much more.
 *
 * Treated properly, as 17 rows of which 6 are censored at exactly 150s (`type='critique'`):
 *
 *     whole-sample p50   146.3s   measured
 *     whole-sample p64.7 149.8s   measured — last point the data can see
 *     whole-sample p75+  >150s    CENSORED, true value unknown
 *     P(duration > 150s) ~35%     tail beyond the cap unidentified
 *
 * Six of the eleven successes land within 8s of the cap (142.2, 143.3, 143.9, 146.3, 147.6,
 * 149.8) — and that last one cleared by **201ms**. A cap that most of your successes crowd
 * against is a cut into the distribution, not a bound on it.
 *
 * **This is NOT a consequence of the Sonnet switch, despite matching the generate story.** Split
 * by era, `claude-haiku-4-5` was already censored 3/11 (27%) — 150s was under-provisioned on
 * the very model it was measured against, even though that model's *measured* p50 is only 116s.
 * Sonnet 4.5 made it worse, 3/6 censored (50%), but did not cause it. So the fix here is not "re-measure against
 * the current model"; it is "stop reading percentiles off censored data".
 *
 * 300s, matching `BASE_TIMEOUT_MS`, chosen on two grounds rather than a margin calculation:
 *
 *  - **Critique prompts are the bigger ones.** 9.3k-20.5k chars against generate's 7.5k-9.2k in
 *    the same era, correlating with duration at r = 0.52 (over a truncated sample, so itself suspect). Giving critique *less* budget than
 *    generate would assert it is the cheaper call; prompt size says the opposite. Generate needed
 *    300s to clear a measured max of 220.8s, and critique's max is not even measured.
 *  - **Raising the cap is also the instrument.** At 150s every slow call is censored, so the tail
 *    can never be learned — which is precisely how this rotted twice. At 300s a call that takes
 *    170s or 240s gets *recorded*, and the next person re-derives from durations instead of from
 *    another pile of rows reading exactly 150000.
 *
 * The trade: critique is awaited on the traveller's critical path, between generate and placing,
 * so the worst case goes from 7.5 minutes to 10. Accepted, because a spurious kill is the worse
 * outcome on both axes — the traveller waits the full 150s *and* silently loses the budget/timing
 * review, paying full price for nothing. A slow success at least delivers the review.
 *
 * Re-derive from the table rather than nudging, and split by era. Note that `status='ok'` alone
 * is the query that caused this bug — you need the censored rows to see the tail at all:
 *   SELECT model, status, duration_ms, length(prompt) FROM llm_traces
 *   WHERE type='critique' ORDER BY duration_ms;
 * Counts here are a snapshot — the table grows whenever anyone generates a trip, and these
 * figures already shifted once between one agent measuring them and another writing them down.
 * Trust the shape, re-derive the numbers.
 *
 * If kills reappear at 300s the tail is genuinely heavier than a five-minute wait can hold, and
 * the answer is to make the pass cheaper (or move it off the critical path), not to raise this again.
 */
export const CRITIQUE_TIMEOUT_MS = 300_000;

/**
 * Where the `claude` binary lives, independent of whoever launched the dev server.
 *
 * `spawn` without `shell: true` resolves the command against the child's PATH and nothing else,
 * so a server started from a GUI-launched editor or any shell that didn't source the user's
 * profile gets `spawn claude ENOENT` for every call. That is not hypothetical: it silently broke
 * 26 consecutive generations across two days until the server happened to be restarted from a
 * different terminal. The native installer puts the binary in ~/.local/bin, and npm-global
 * installs land somewhere already on PATH, so appending the standard locations covers both.
 * CLAUDE_CLI_PATH is the escape hatch for anything else.
 *
 * Appending those directories is necessary but not sufficient. `~/.local/bin/claude` is usually a
 * symlink into the *version-stamped* VS Code extension directory
 * (`…/anthropic.claude-code-2.1.221-darwin-arm64/resources/native-binary/claude`), and the
 * extension deletes the old directory when it auto-updates. The link is then dangling: PATH still
 * appears to contain `claude`, and every call dies with the same ENOENT. That has now happened
 * twice (2026-08-04, 2026-08-18), each time reading to the traveller as "The planner didn't
 * finish" with no hint that the cause was an editor update. So resolve to a path that is
 * executable *right now* rather than trusting the name, and fall back to the newest installed
 * extension binary — which is what the stale symlink was pointing at before the upgrade.
 */
const CLI_SEARCH_PATH = [`${homedir()}/.local/bin`, `${homedir()}/.claude/local`];

/** False for a dangling symlink too — `access()` follows the link, which is the whole point here. */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Native binaries shipped by the VS Code extension, newest version first. */
function extensionBinaries(): string[] {
  const dir = join(homedir(), ".vscode", "extensions");
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith("anthropic.claude-code-"))
      // Numeric compare, not lexical: a plain sort ranks 2.1.9 above 2.1.235.
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((name) => join(dir, name, "resources", "native-binary", "claude"));
  } catch {
    return [];
  }
}

/**
 * The first candidate that actually exists and is executable, searched against the child's own
 * (already augmented) PATH before the extension fallback, so an npm-global or Homebrew install
 * still wins over whatever the editor happens to ship.
 *
 * Resolved per call rather than memoised: the extension can update mid-session — that is exactly
 * the failure being defended against — and a handful of `stat` calls is nothing beside a request
 * that runs for two minutes. Falls back to the bare name so an install-less machine still gets
 * the familiar ENOENT and the hint below.
 */
function resolveCliBin(pathEnv: string): string {
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
  const onPath = pathEnv.split(":").filter(Boolean).map((dir) => join(dir, "claude"));
  return [...onPath, ...extensionBinaries()].find(isExecutable) ?? "claude";
}

const BASE_TIMEOUT_MS = 300_000;
const PER_DAY_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 480_000;

/**
 * How long a generate/refine call may run before it is killed.
 *
 * **Recalibrated because the production model changed.** The previous 210s was derived from a
 * Haiku-4.5 corpus; `MODEL` is now `claude-sonnet-4-5`, which is slower to first token. Only the
 * post-swap era is informative — the Aug 8-9 rows ran ~2.3k-char prompts at p50 74s and describe
 * a regime that no longer exists. Pooling both eras is what made 210s look survivable.
 *
 * Current era, 20 calls, **counting the killed ones** (see CRITIQUE_TIMEOUT_MS above for why that
 * matters — a percentile over survivors alone cannot exceed the cap, and reading one off is how
 * both constants in this file rotted):
 *
 *     p50 153s   p75 189s   p90 218s*   max 221s        * = CENSORED, true value unknown
 *
 * Two calls were killed at exactly 218s (a 4-day trip's old budget) with the model still writing,
 * so 10% of the era was censored and the p90 lands on the cap itself. The tail is real and partly
 * unmeasured: one 6-day trip *succeeded* at 220.8s, which is direct evidence the distribution
 * reaches past the point where the short trips were being cut off.
 *
 * 300s is a decision about what a traveller should wait, not a margin calculation. It clears the
 * longest measured success by ~36% and sits at a legible five minutes. The trade the old comment
 * named is real — a wedged call hangs 5 minutes instead of 3.5 — but a spurious kill costs *more*
 * wall-clock than a slow success, because the traveller regenerates and pays the full duration
 * again. Raising the cap is also the instrument: at 218s every slow call was censored, so the
 * tail could never be learned. At 300s a 240s call gets recorded instead of clipped.
 *
 * The per-day term stays at 2s/day and is not load-bearing. Prompt size correlates with duration
 * at r = 0.27 across this era's 7.5k-9.2k range, and that figure is itself unstable — it read
 * 0.09 twenty rows ago and 0.13 before that, which is what noise looks like. (The r = 0.77 you
 * get over the full table is era confounding: the old corpus was both shorter and faster, for
 * unrelated reasons.) Every trip measured is 3-8 days; the term is retained as a knob for the
 * 30-day itinerary nobody has run, which genuinely does emit several times more JSON, not because
 * the data asks for it. Raising it would be inventing a slope — that is how it got to 12s/day.
 *
 * Re-derive rather than nudging, and note both things the old query here got wrong: it filtered
 * `status='ok'` (dropping exactly the rows that prove a tail exists) and it pooled the eras.
 *   SELECT model, status, duration_ms, length(prompt), created_at FROM llm_traces
 *   WHERE type='generate' AND duration_ms > 1000 ORDER BY duration_ms;
 * Counts here are a snapshot of a table that grows whenever anyone generates a trip; treat them
 * as the shape of the distribution, not as the current row count.
 */
export function itineraryTimeoutMs(days: number): number {
  return Math.min(BASE_TIMEOUT_MS + days * PER_DAY_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

/**
 * Opt-in CLI session persistence. Omit it and every call stays one-shot, which is the default
 * for good reason — see below.
 *
 * `persist: true` drops `--no-session-persistence` so the CLI writes a session file and the
 * returned `sessionId` can be resumed. `resume: <id>` continues that conversation; the two are
 * mutually exclusive and `resume` already implies persistence.
 *
 * **This does not reduce tokens or latency, and the temptation to assume it does is the whole
 * reason this comment exists.** Measured on this machine, 2026-08-24:
 *
 *   turn 1  18,100-char prompt into a fresh session   ->  13,332 input tokens
 *   turn 2  `--resume <id>`, a 36-character question  ->  13,475 input tokens
 *
 * A six-word follow-up cost *more* than the turn that established the context. The model holds
 * no state between calls; `--resume` makes the CLI replay the whole transcript from a local
 * JSONL under `~/.claude/projects/<slugified-cwd>/<session-id>.jsonl`. Proof that the memory is
 * that file and nothing else: `sed`-ing a fact inside it changed the answer on the next resume
 * of the same session id, with nothing uploaded.
 *
 * Nor does caching rescue it — two calls sharing an identical 13k prefix both reported
 * `cache_read_input_tokens: 0`, because `-p` sends the prompt as a single cache block that any
 * edit invalidates.
 *
 * And prompt size is not what costs the time anyway: across the `type='chat'` traces, prompt
 * chars vs. duration is r = +0.062 (a 33,658-char call finished in 11.0s; a 20,921-char one took
 * 139.5s). Latency here is thinking time.
 *
 * So reach for this when you want *conversational continuity* — one Claude session per trip that
 * the traveller refines through the UI chat — not when you want it faster. Callers that resume
 * must also handle the session file being gone (another machine, a cleaned home dir, a trip
 * opened tomorrow) by falling back to a fully-rebuilt prompt.
 */
export interface SessionOption {
  persist?: boolean;
  resume?: string;
}

export interface ClaudeResult {
  result: string;
  traceId: string;
  /** Which model actually served the call — `MODEL` unless the caller overrode it. Returned so a
   *  caller comparing models doesn't have to re-read the trace row to know what it got. */
  model: string;
  /** Wall-clock time of the child process, the same number written to the trace row. */
  durationMs: number;
  /**
   * The CLI session this call ran in — present only when `meta.session` asked for persistence.
   *
   * Undefined in the default one-shot mode, where `--no-session-persistence` means no session
   * file is ever written and there is nothing to resume. Persist this to continue the same
   * conversation on a later call. See `meta.session` on runClaude() for what resuming does and
   * does not buy you.
   */
  sessionId?: string;
}

/**
 * Moved to llmConfig.ts, which needs it to type the model-routing table and cannot import it from
 * here (this module imports that one). Re-exported so every existing
 * `import { ClaudeCallType } from "@/lib/claude"` keeps resolving unchanged.
 */
export type { ClaudeCallType };

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

    // Default stays one-shot. `--resume` implies persistence (the turn is appended to the
    // session file), so the two flags are mutually exclusive — passing both makes the CLI
    // resume a conversation and then refuse to record the reply, silently losing the turn.
    const sessionArgs = meta?.session?.resume
      ? ["--resume", meta.session.resume]
      : meta?.session?.persist
        ? []
        : ["--no-session-persistence"];

    // turbopackIgnore: cliBin is resolved at runtime (resolveCliBin), so Turbopack's static
    // file-tracer can't determine what this touches and defensively traces the whole project
    // as a dependency of every route that imports this file — which is what makes a production
    // build's page-data collection step for /api/bench fail under constrained build environments
    // (first surfaced running a real container build; reproduces identically on a pre-existing,
    // untouched version of this exact call, so it predates this file's CLI/API transport split).
    const child = spawn(
      /* turbopackIgnore: true */ cliBin,
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
        // Measured on real edit calls: ~96% of generated tokens are internal reasoning that never
        // reaches the caller (12.4k output tokens for a 450-token JSON patch), and time-to-first-
        // token is ~95% of the wall clock. "low" is the floor the CLI exposes — there is no way to
        // turn thinking off — and it cut a representative edit from 105s to 84s with identical,
        // valid output. Only passed where the task is a narrow, well-specified patch.
        ...(meta?.effort ? ["--effort", meta.effort] : []),
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    // Killing the child makes it exit, which fires the `exit` handler below — and that
    // handler used to overwrite the row this one just wrote, turning every timeout into a
    // generic `error` / "exited null". The result was that `llm_traces` had never recorded a
    // single `timeout` in its life while generate calls were timing out repeatedly, so the
    // one failure mode worth spotting was the one the trace viewer could not show. This flag
    // is what makes the timeout the terminal outcome for the call.
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      updateTrace(traceId, { status: "timeout", durationMs: Date.now() - startedAt });
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      // Same reason as the timeout flag: a spawn failure can be followed by an exit, and the
      // generic "exited null" would replace the ENOENT hint below — which is the one message
      // that actually tells you what to do about it.
      settled = true;
      // ENOENT here means only one thing, and the bare message never said so. It no longer says
      // "install it" — the two real occurrences were both a *dangling* ~/.local/bin/claude on a
      // machine where the CLI was installed the whole time, and that advice sent the reader the
      // wrong way.
      const hint =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? ` — no runnable claude CLI was found (tried '${cliBin}'). If ~/.local/bin/claude is a` +
            ` symlink into a VS Code extension directory that an update has since deleted, repoint` +
            ` it at the current one; otherwise set CLAUDE_CLI_PATH to the binary's absolute path` +
            ` and restart the server; or, if this is a deployed container with no claude CLI` +
            ` installed at all, set LLM_TRANSPORT=api instead.`
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
      // The timeout above already wrote the terminal status and rejected. This exit is the
      // kill it issued, not a real outcome, so there is nothing left to report.
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

/**
 * Output-token ceiling for every API-transport call. Exported so `claude.test.mjs` can pin the
 * two bounds below, which are otherwise a magic number nobody could re-derive.
 *
 * **This is a ceiling, not a budget: unused headroom is free.** You are billed for
 * `usage.output_tokens` actually produced, so there is no cost or latency argument for setting
 * this tightly — and deliberately no per-trip-day scaling of the kind `itineraryTimeoutMs()`
 * uses, because scaling a free ceiling buys nothing but a branch.
 *
 * Two bounds fix the value, and it sits between them:
 *
 *  - **Floor — the largest generation actually observed.** `claude-sonnet-4-5` has emitted up to
 *    **17,789** output tokens for one generate call (Haiku 4.5, far more verbose, reached 27,849;
 *    Opus 4.5 peaked at 15,759). The previous value of 16,000 sat *below* the production model's
 *    own observed maximum: measured against history, **5.7% of Sonnet generate calls (2 of 35)
 *    would have been truncated**, and 72% of Haiku's. Truncation is the worst-shaped failure
 *    available here — the response is cut mid-JSON so `parseJsonResponse` throws in the route,
 *    the traveller is told "The planner didn't finish", and you are billed for every token of the
 *    truncated output anyway.
 *  - **Hard ceiling — 21,333, imposed by the SDK.** `calculateNonstreamingTimeout` throws
 *    `AnthropicError("Streaming is required for operations that may take longer than 10 minutes")`
 *    when `(60min * max_tokens) / 128000 > 10min`. That guard runs whenever no explicit `timeout`
 *    is passed, and the call below passes only an AbortSignal, so it is live for us. Note this is
 *    a *request-time throw*, not a slow request: every API-transport call would fail instantly.
 *
 * 21,000 clears the observed Sonnet maximum by ~18% and leaves 333 tokens under the SDK's limit.
 *
 * **What this does NOT fix.** Every generation measured so far was a 2-8 day trip, while
 * `MAX_TRIP_DAYS` is 30 — a long trip could plausibly exceed even this, and Haiku already does.
 * Raising the number further is not available; the ceiling above is the wall. The real fix for
 * that case is streaming (which lifts the 10-minute constraint entirely), deliberately deferred.
 * Until then, a `stop_reason: "max_tokens"` response is detected and reported explicitly below
 * rather than being left to surface as an unexplained JSON parse failure.
 */
export const API_MAX_TOKENS = 21_000;

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
    // Per task, not one model for everything. Generation and the passes that judge a whole plan
    // go to the strong tier; patches and lookups go to the cheap one. `MODEL` still serves the CLI
    // transport unchanged — its timeout constants above were calibrated against that model.
    const model = meta?.model ?? apiModelFor(type);
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
      // Streamed, which is what lets the ceiling be per-task rather than one number just under the
      // SDK's non-streaming limit. API_MAX_TOKENS existed because a non-streaming request cannot
      // ask for more without risking an HTTP timeout — the comment on it says as much ("trips long
      // enough to need more than this require the streaming transport"). This is that transport;
      // `finalMessage()` returns the same assembled message `create()` did, so everything below
      // reads unchanged.
      const response = await anthropic.messages
        .stream(
          {
            model,
            max_tokens: maxTokensFor(type),
            messages,
            // Capability-gated, and that gate is load-bearing now that the model varies by task.
            // `thinkingFor()` speaks Sonnet 4.5's dialect — `budget_tokens` — which is a 400 on
            // Opus 5 and Haiku 4.5 alike. Each model gets only the knobs it actually accepts.
            ...(supportsAdaptiveThinking(model)
              ? { thinking: { type: "adaptive" as const } }
              : { thinking: thinkingFor(type, meta?.effort) }),
            ...(meta?.effort && supportsEffort(model)
              ? { output_config: { effort: meta.effort } }
              : {}),
          },
          { signal: controller.signal }
        )
        .finalMessage();
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;

      // Truncation is diagnosed HERE, where the cause is still knowable, because by the time it
      // reaches the caller it no longer looks like truncation: the text comes back cut mid-JSON,
      // `parseJsonResponse` throws a generic syntax error in the route, and the trace reads `ok`
      // — a real outcome recorded as a success, which is exactly the shape of the two failure
      // modes this file has already been burned by (timeouts logged as generic errors, the
      // dangling-symlink ENOENT). See API_MAX_TOKENS for why this can still happen at 21,000.
      if (response.stop_reason === "max_tokens") {
        const detail =
          `hit the ${maxTokensFor(type)}-token output ceiling for a '${type}' call (used` +
          ` ${response.usage.output_tokens}) — the response is truncated, not malformed. The` +
          ` transport streams now, so this ceiling is a per-call-type budget in llmConfig.ts and` +
          ` can be raised there; it is no longer bounded by the SDK's non-streaming limit.`;
        updateTrace(traceId, {
          status: "error",
          rawResponse: JSON.stringify(response),
          durationMs,
          errorMessage: `truncated at max_tokens: ${detail}`,
        });
        console.warn(`[claude] ${type} call ${detail}`);
        throw new Error(`claude API response truncated: ${detail}`);
      }

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
      // A null cost means `model` has no entry in DEFAULT_PRICES — this call's spend is then
      // invisible to getSpendSince() (cost_usd stays NULL), so the daily cap silently stops
      // covering it. No trace row field for this today; a warn is the only signal.
      if (costUsd === null) {
        console.warn(`[claude] no price entry for model "${model}" — spend cap cannot see this call's cost`);
      }

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
      const message = err instanceof Error ? err.message : String(err);
      // AuthenticationError is a real 401 (an invalid/rejected key). A simply-*missing* key never
      // reaches the API at all — the SDK throws a plain Error client-side ("Could not resolve
      // authentication method...") — so match that message too, or the hint only fires for the
      // less common case.
      const hint =
        err instanceof Anthropic.AuthenticationError || /authentication method/i.test(message)
          ? " — ANTHROPIC_API_KEY is missing or invalid. Check Railway's environment variables."
          : "";
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
  // Through llmConfig rather than reading the env var here, so that POST /api/llm-mode can flip
  // transport mid-session without a restart. With no override set this is exactly the same
  // expression it replaced: `LLM_TRANSPORT` if set, `cli` otherwise.
  return llmMode() === "api"
    ? runClaudeViaApi(prompt, type, timeoutMs, meta)
    : runClaudeViaCli(prompt, type, timeoutMs, meta);
}

/** Strips markdown code fences the model sometimes wraps JSON in, then parses it. */
export function parseJsonResponse<T>(raw: string): T {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(stripped) as T;
}
