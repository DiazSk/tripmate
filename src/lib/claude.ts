import { spawn } from "child_process";
import { insertTrace, updateTrace } from "./db";

const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 90_000;

export interface ClaudeResult {
  result: string;
  traceId: string;
}

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
  type: "generate" | "refine" | "container-theme"
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const { CLAUDECODE: _drop, ...env } = process.env;
    void _drop;

    const traceId = insertTrace({ type, prompt, model: MODEL });
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
      reject(new Error(`claude CLI timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

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
