import { spawn } from "child_process";
import { accessSync, constants, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { insertTrace, updateTrace } from "./db";

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
 * 2. **Sonnet 5 doesn't fit the timeout.** It spent 164s before its first token and 196s in total
 *    on an 8-day trip, then timed out twice at 216s on a *3-day* trip — `itineraryTimeoutMs()`
 *    can't accommodate it without making every user wait four minutes for a plan.
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
 * On the shared 90s default it was failing **35% of the time** (7 of 20 calls in
 * `llm_traces`, every one of them dying at exactly 90s). Those failures were invisible:
 * the runner catches critique errors by design, so a third of trips shipped without the
 * budget/timing review and nothing said so. The successful calls run p50 58s / p90 75s, and
 * the seven that were killed were still working — so the real tail extends past 90s and the
 * old ceiling was cutting into it, not bounding it.
 */
export const CRITIQUE_TIMEOUT_MS = 150_000;

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

const BASE_TIMEOUT_MS = 210_000;
const PER_DAY_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 480_000;

/**
 * How long a generate/refine call may run before it is killed.
 *
 * Recalibrated against 36 successful generate calls in `llm_traces` rather than the handful
 * of samples the previous value came from. The measured distribution:
 *
 *     p50 117s   p75 123s   p90 145s   max 165s
 *
 * The old budget was `120s + 12s/day`, which gave a one-day trip 132s — *below* the p90. The
 * comment justifying it cited "~85-105s", but 105s turns out to be roughly the 25th
 * percentile, so the margin was measured against the fast end of the range and the slowest
 * tenth of runs could not finish by construction. Five consecutive failures each died exactly
 * at their cap (156s, 156s, 156s, 168s, 192s) with the model still working.
 *
 * 210s clears the observed maximum with real margin. The cost is that a genuinely wedged call
 * now hangs ~3.5 minutes before erroring, which is the right trade: a slow success is worth
 * far more than a fast failure when the alternative is regenerating from scratch.
 *
 * The per-day term is nearly gone (12s → 2s) because trip length is not what drives duration.
 * Correlation between prompt size and duration across a 6x range of prompt sizes is r = 0.132
 * — essentially none; the variance is fixed overhead (CLI start, time to first token), not
 * output size. The old term gave the most headroom to long trips while leaving short ones the
 * tightest budget, which is backwards. It is kept small and non-zero only because a 30-day
 * itinerary genuinely does emit several times more JSON.
 *
 * Re-derive this from the table rather than nudging it by feel:
 *   SELECT duration_ms FROM llm_traces WHERE type='generate' AND status='ok' ORDER BY 1;
 */
export function itineraryTimeoutMs(days: number): number {
  return Math.min(BASE_TIMEOUT_MS + days * PER_DAY_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

export interface ClaudeResult {
  result: string;
  traceId: string;
  /** Which model actually served the call — `MODEL` unless the caller overrode it. Returned so a
   *  caller comparing models doesn't have to re-read the trace row to know what it got. */
  model: string;
  /** Wall-clock time of the child process, the same number written to the trace row. */
  durationMs: number;
}

export type ClaudeCallType =
  | "generate"
  | "refine"
  | "rebalance"
  | "place-detail"
  | "context"
  | "critique"
  | "chat"
  | "element-edit"
  /** Dev-only: the blinded quality judge in the model benchmark harness (src/lib/bench). */
  | "judge";

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
export function runClaude(
  prompt: string,
  type: ClaudeCallType,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  meta?: { runId?: string; effort?: "low" | "medium" | "high"; model?: string }
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const { CLAUDECODE: _drop, ...env } = process.env;
    void _drop;
    env.PATH = [env.PATH, ...CLI_SEARCH_PATH].filter(Boolean).join(":");
    const cliBin = resolveCliBin(env.PATH);

    const model = meta?.model ?? MODEL;
    const traceId = insertTrace({ type, prompt, model, runId: meta?.runId });
    const startedAt = Date.now();

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
        "--no-session-persistence",
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
        resolve({ result: envelope.result as string, traceId, model, durationMs });
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
