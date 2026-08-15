import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { insertTrace, updateTrace } from "./db";

export const MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_TIMEOUT_MS = 90_000;

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

export type ClaudeCallType =
  | "generate"
  | "refine"
  | "rebalance"
  | "place-detail"
  | "context"
  | "critique";

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
 */
export function runClaude(
  prompt: string,
  type: ClaudeCallType,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  meta?: { runId?: string; effort?: "low" | "medium" | "high" }
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const { CLAUDECODE: _drop, ...env } = process.env;
    void _drop;
    const localBin = join(homedir(), ".local", "bin");
    if (!(env.PATH ?? "").split(":").includes(localBin)) {
      env.PATH = `${env.PATH ?? ""}:${localBin}`;
    }

    const traceId = insertTrace({ type, prompt, model: MODEL, runId: meta?.runId });
    const startedAt = Date.now();

    const child = spawn(
      "claude",
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

    const timer = setTimeout(() => {
      child.kill();
      updateTrace(traceId, { status: "timeout", durationMs: Date.now() - startedAt });
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      updateTrace(traceId, {
        status: "error",
        errorMessage: err.message,
        durationMs: Date.now() - startedAt,
      });
      reject(new Error(`claude CLI failed to start: ${err.message}`));
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
