import { spawn } from "child_process";
import { accessSync, constants, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { runClaudeApi } from "./claudeApi";
import { insertTrace, updateTrace } from "./db";
import { llmMode, type ClaudeCallType, type LlmMode } from "./llmConfig";

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
 * here (this module imports that one, so the dependency only runs one way). Re-exported so every
 * existing `import { ClaudeCallType } from "@/lib/claude"` keeps resolving unchanged.
 */
export type { ClaudeCallType };

/**
 * **The transport switch.** Every model call in the app arrives here, and this is the only place
 * that decides whether it is served by spawning the CLI or by an HTTPS request.
 *
 * Deliberately the chokepoint and not the call sites. There are eight call sites across six files
 * (generate, refine, critique, rebalance, chat, element-edit, place-detail, context) and none of
 * them has any business knowing the transport — they assemble a prompt and want a string back.
 * Branching here means the switch reached all of them the day it was written, and that a ninth
 * caller added later rides it without being told to.
 *
 * The two paths are held to being indistinguishable:
 *   - same signature, same `ClaudeResult` (including `sessionId`, which the API path emulates —
 *     see `SessionOption` below and `llm_sessions` in db.ts),
 *   - a row in `llm_traces` on every outcome, with the same statuses (`ok` / `error` / `timeout`)
 *     and a `raw_response` in the same envelope shape, so the trace viewer and `parseUsage()` read
 *     both without branching,
 *   - `timeoutMs` means the same hard wall-clock ceiling in both, so the day-scaled budgets above
 *     carry over unchanged.
 *
 * What differs, and only these: **which model answers** — the API path routes per task through
 * `apiModelFor()` (strong for generation, cheap for patches and lookups) while the CLI path stays
 * pinned to `MODEL`, because the constants above were calibrated against that model and re-pointing
 * it would invalidate them — and **where conversational memory lives**: a JSONL file on one machine
 * for the CLI, a `llm_sessions` row for the API.
 *
 * `meta.mode` forces one path for a single call, bypassing both env and the runtime override. No
 * production caller passes it; it exists so a comparison harness can run the same prompt down both
 * transports without mutating global state.
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
    mode?: LlmMode;
  }
): Promise<ClaudeResult> {
  const mode = meta?.mode ?? llmMode();
  return mode === "api"
    ? runClaudeApi(prompt, type, timeoutMs, meta)
    : runClaudeCli(prompt, type, timeoutMs, meta);
}

/**
 * Runs a one-shot prompt through the `claude` CLI (Haiku, no tools) instead
 * of a metered LLM API. Two non-obvious requirements found while wiring this up:
 * - CLAUDECODE must be unset in the child's env, or the CLI refuses to launch
 *   nested inside another Claude Code session.
 * - Must use `spawn`, not `execFile`: execFile reliably hangs forever on this
 *   binary (reproduced consistently), spawn does not. Root cause not chased
 *   further since spawn just works.
 * - The CLI installer places the binary in `~/.local/bin`, which shell
 *   profiles (e.g. .zshrc) add to PATH — but non-login/non-interactive
 *   process launchers (dev server started from an IDE, a task runner, etc.)
 *   often don't source that profile, so PATH lookup for "claude" fails with
 *   ENOENT even though the binary is installed. Force it onto PATH here
 *   instead of trusting the inherited environment.
 *
 * Every call is logged to the llm_traces table (prompt + raw response, on
 * every outcome including errors/timeouts) so it can be inspected via the
 * LLM trace FAB (src/components/LlmTraceFab.tsx) — this is the single choke
 * point all itinerary generation goes through, so it's the natural place to
 * log from. `meta.runId`, when passed, groups this call with sibling calls
 * (context/generate/critique/place-detail) from the same pipeline execution
 * — see llm_runs in src/lib/db.ts.
 *
 * `meta.model` overrides which model serves the call. It exists for the dev-only benchmark
 * harness (src/lib/bench), which holds prompt/skill/context constant and varies only this —
 * every production caller omits it and gets `MODEL` exactly as before.
 */
function runClaudeCli(
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

/** Strips markdown code fences the model sometimes wraps JSON in, then parses it. */
export function parseJsonResponse<T>(raw: string): T {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(stripped) as T;
}
