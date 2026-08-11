import { spawn } from "child_process";
import { homedir } from "os";
import { insertTrace, updateTrace } from "./db";

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 90_000;

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
 */
const CLI_BIN = process.env.CLAUDE_CLI_PATH ?? "claude";
const CLI_SEARCH_PATH = [`${homedir()}/.local/bin`, `${homedir()}/.claude/local`];

const BASE_TIMEOUT_MS = 120_000;
const PER_DAY_TIMEOUT_MS = 12_000;
const MAX_TIMEOUT_MS = 480_000;

/**
 * Itinerary generation time scales with trip length (more days = more JSON to
 * produce), so a flat timeout either times out long trips or waits too long
 * on short ones. Measured: a 3-day trip took ~95s and a 10-day trip took
 * ~85-105s — most latency is fixed overhead (CLI cold start, geocode/weather
 * calls), not output size — so the base needs its own margin, with a smaller
 * per-day term on top for longer trips (up to 30 days, see MAX_TRIP_DAYS).
 */
export function itineraryTimeoutMs(days: number): number {
  return Math.min(BASE_TIMEOUT_MS + days * PER_DAY_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

export interface ClaudeResult {
  result: string;
  traceId: string;
}

export type ClaudeCallType = "generate" | "refine" | "rebalance" | "place-detail";

/**
 * Runs a one-shot prompt through the `claude` CLI (Haiku, no tools) instead
 * of a metered LLM API. Two non-obvious requirements found while wiring this up:
 * - CLAUDECODE must be unset in the child's env, or the CLI refuses to launch
 *   nested inside another Claude Code session.
 * - Must use `spawn`, not `execFile`: execFile reliably hangs forever on this
 *   binary (reproduced consistently), spawn does not. Root cause not chased
 *   further since spawn just works.
 *
 * Every call is logged to the llm_traces table (prompt + raw response, on
 * every outcome including errors/timeouts) so it can be inspected via the
 * LLM trace FAB (src/components/LlmTraceFab.tsx) — this is the single choke
 * point all itinerary generation goes through, so it's the natural place to
 * log from.
 */
export function runClaude(
  prompt: string,
  type: ClaudeCallType,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const { CLAUDECODE: _drop, ...env } = process.env;
    void _drop;
    env.PATH = [env.PATH, ...CLI_SEARCH_PATH].filter(Boolean).join(":");

    const traceId = insertTrace({ type, prompt, model: MODEL });
    const startedAt = Date.now();

    const child = spawn(
      CLI_BIN,
      [
        "-p",
        prompt,
        "--model",
        MODEL,
        "--output-format",
        "json",
        "--tools",
        "",
        "--no-session-persistence",
        "--setting-sources",
        "",
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    const timer = setTimeout(() => {
      child.kill();
      updateTrace(traceId, { status: "timeout", durationMs: Date.now() - startedAt });
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      // ENOENT here means only one thing, and the bare message never said so.
      const hint =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? ` — '${CLI_BIN}' is not on the dev server's PATH. Install it, or set CLAUDE_CLI_PATH` +
            ` to its absolute path (\`which claude\`) and restart the server.`
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
        resolve({ result: envelope.result as string, traceId });
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
