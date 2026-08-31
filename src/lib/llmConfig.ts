/**
 * The one place that decides **which transport** serves an LLM call and **which model** answers it.
 *
 * Both questions used to have a single hardcoded answer: `spawn`ing the CLI, on `claude-sonnet-4-5`
 * (see `MODEL` in claude.ts). They are now two independent axes, and every knob for both lives
 * here so that routing a task to a different model is an env edit, not a code search.
 *
 * Nothing in this file talks to the network or the database — it is pure configuration, imported by
 * `claude.ts` (the chokepoint) and by the `/api/llm-mode` route. Keep it that way: a config module
 * that can fail to import is a config module that can take the whole app down.
 */

/** Transport, not provider. Both talk to the same Anthropic models — one over a child process,
 *  one over HTTPS. */
export type LlmMode = "api" | "cli";

/**
 * Every kind of call the app makes, and the axis model routing keys off.
 *
 * Declared here rather than in claude.ts so that `apiModelFor()` can be typed against it without
 * importing the chokepoint (which imports *this*). claude.ts re-exports it, so every existing
 * `import { ClaudeCallType } from "@/lib/claude"` keeps working unchanged.
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Mode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The runtime override set through `POST /api/llm-mode`, or null to defer to the environment.
 *
 * Process-local and deliberately not persisted: flipping transport is a debugging action ("is this
 * a model problem or a transport problem?"), and a flag that survives a restart is one somebody
 * forgets they set. `LLM_MODE` in `.env.local` is the durable setting; this is the toggle.
 *
 * Next's dev server runs route handlers in the same process as the rest of the server, so a flip
 * here is visible to `runClaude()` immediately. Under a multi-worker production deploy it would
 * only bind the worker that served the POST — which is exactly why the durable answer is env.
 */
let runtimeOverride: LlmMode | null = null;

/**
 * `LLM_TRANSPORT` — the name the deploy path already uses, not a second spelling of it.
 *
 * This module arrived from a branch that called it `LLM_MODE`; the variable is `LLM_TRANSPORT`
 * because that is what Railway is configured with and what claude.ts documented first. One name.
 */
function envMode(): LlmMode | null {
  const raw = process.env.LLM_TRANSPORT?.trim().toLowerCase();
  if (raw === "cli" || raw === "api") return raw;
  return null;
}

/**
 * The transport in force right now: runtime override, else env, else `cli`.
 *
 * The `cli` default is deliberate and belongs to the deploy design — local development runs free
 * under the existing CLI subscription, and only the deployed environment (which has no CLI binary)
 * sets `LLM_TRANSPORT=api`. Flipping the default would start metering every developer's machine.
 */
export function llmMode(): LlmMode {
  return runtimeOverride ?? envMode() ?? "cli";
}

/** Where the current mode came from — surfaced by `GET /api/llm-mode` so the answer to "why is it
 *  doing that" doesn't require guessing which layer won. */
export function llmModeSource(): "runtime" | "env" | "default" {
  if (runtimeOverride) return "runtime";
  return envMode() ? "env" : "default";
}

/** Set (or, with null, clear) the runtime override. Returns the mode now in force. */
export function setLlmMode(mode: LlmMode | null): LlmMode {
  runtimeOverride = mode;
  return llmMode();
}

// ─────────────────────────────────────────────────────────────────────────────
// Model routing (API path only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The strong tier: one call produces the entire product, so quality outranks the per-token rate.
 * Carries generation and the two passes that reason over a whole itinerary.
 */
const DEFAULT_STRONG = "claude-opus-5";

/**
 * The cheap tier: short, well-specified tasks against context that already exists — a patch, a
 * lookup, a single slot. None of them writes a plan from scratch.
 */
const DEFAULT_CHEAP = "claude-haiku-4-5";

/**
 * The documented escape hatch for chat.
 *
 * Chat is the one cheap-tier task that must emit a *structured patch* (`ops[]` against exact
 * dayIndex/stopIndex values), not prose — and that is the ability most likely to be thin on the
 * smallest model. If chat starts returning malformed ops, empty patches for real change requests,
 * or indices the applier rejects, set `LLM_MODEL_CHAT=claude-sonnet-5` and restart. No code change.
 *
 * Not the default, because the failure is hypothetical: the ops contract is heavily specified in
 * the prompt (see CHAT_OPS_SHAPE in editPrompt.ts) and `applyPatch` rejects out-of-scope ops rather
 * than trusting them, so a weak patch degrades to "did less than asked", not to a corrupted plan.
 * Measure before paying 3x.
 */
export const CHAT_FALLBACK_MODEL = "claude-sonnet-5";

/**
 * Read lazily, never at module scope.
 *
 * Next loads `.env.local` before route modules but the ordering is not something to bet a silent
 * misconfiguration on — an env var read into a `const` at import time reads as a hardcoded default
 * the moment that ordering shifts. A function call per LLM request is free next to the request.
 */
function envModel(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export function strongModel(): string {
  return envModel("LLM_MODEL_STRONG", DEFAULT_STRONG);
}

export function cheapModel(): string {
  return envModel("LLM_MODEL_CHEAP", DEFAULT_CHEAP);
}

export function chatModel(): string {
  return envModel("LLM_MODEL_CHAT", cheapModel());
}

/**
 * Which model serves a given call on the **API path**.
 *
 * The CLI path does NOT consult this — it stays pinned to `MODEL` (`claude-sonnet-4-5`), whose
 * choice and whose timeout constants were calibrated together against measured runs. Routing the
 * CLI elsewhere would invalidate that calibration without re-measuring it.
 *
 * The split is by *what the call has to do*, not by how long its prompt is:
 *   - strong — writes or rewrites a whole plan from facts (generate, refine, rebalance), or judges
 *     one end to end (critique). Getting this wrong costs the traveller the entire product.
 *   - cheap  — works against a plan that already exists: patch one thing (chat, element-edit),
 *     look one thing up (place-detail, context). Bounded, well-specified, latency-sensitive.
 *
 * `judge` sits on the strong tier because a benchmark scored by a weaker model than the ones under
 * test measures the judge. It is dev-only and the bench harness usually passes `meta.model`
 * explicitly (BENCH_JUDGE_MODEL), which overrides this anyway.
 */
export function apiModelFor(type: ClaudeCallType): string {
  switch (type) {
    case "generate":
    case "refine":
    case "rebalance":
    case "critique":
    case "judge":
      return strongModel();
    case "chat":
      return chatModel();
    case "element-edit":
    case "place-detail":
    case "context":
      return cheapModel();
  }
}

/** Ceiling on generated tokens, by what the call actually emits. Hitting the cap truncates
 *  mid-JSON and costs a full retry, so these are generous — an unused ceiling is free. */
export function maxTokensFor(type: ClaudeCallType): number {
  switch (type) {
    // A whole itinerary as strict JSON: ~44 stops on a long trip, each with a dozen fields.
    case "generate":
    case "refine":
    case "rebalance":
      return 32_000;
    // Reasons over a whole plan but emits a review, not a plan.
    case "critique":
    case "judge":
      return 16_000;
    // A patch plus a short reply. A multi-day restructure is the big case and stays well inside.
    case "chat":
      return 16_000;
    case "element-edit":
      return 8_000;
    // Four short fields.
    case "place-detail":
    case "context":
      return 4_000;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model capabilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which models accept `output_config.effort` and adaptive `thinking`.
 *
 * These are not stylistic choices — sending either parameter to a model that predates it is a
 * **400, not a silent no-op**. `claude-haiku-4-5` is the default cheap model and rejects both, so
 * a chat call that blindly forwarded the CLI's `--effort low` would fail every single time.
 *
 * Matched by prefix so a dated snapshot (`claude-opus-5-20260401`) resolves like its base id.
 * Anything unrecognised gets neither parameter — the conservative direction, since a missing
 * `effort` costs some tokens while an unsupported one costs the whole call.
 */
const EFFORT_CAPABLE = /^claude-(fable-5|mythos-5|opus-5|opus-4-[5678]|sonnet-5|sonnet-4-6)/;
const ADAPTIVE_THINKING = /^claude-(fable-5|mythos-5|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6)/;

export function supportsEffort(model: string): boolean {
  return EFFORT_CAPABLE.test(model);
}

export function supportsAdaptiveThinking(model: string): boolean {
  return ADAPTIVE_THINKING.test(model);
}

/**
 * Models where a policy decline can be rescued server-side by re-running the turn on another
 * model in the same call (`fallbacks: "default"` + the matching beta).
 *
 * Worth having on the generation path specifically: a refusal there is a blank screen after a
 * five-minute wait. Set `LLM_REFUSAL_FALLBACK=0` to send plain requests instead — the one knob to
 * reach for if the beta flag is ever retired and the parameter starts 400ing.
 */
const FALLBACK_CAPABLE = /^claude-(opus-5|fable-5|mythos-5)/;

export function refusalFallbackEnabled(model: string): boolean {
  return process.env.LLM_REFUSAL_FALLBACK?.trim() !== "0" && FALLBACK_CAPABLE.test(model);
}

// ─────────────────────────────────────────────────────────────────────────────
// Prices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-exported, not redefined.
 *
 * Two price tables reached this file from opposite directions — one here, one in `modelPricing.ts`
 * — with the same rates and the same cache multipliers. `modelPricing.ts` wins because the trace
 * viewer, the perf aggregate and the bench harness all already read it; a second copy would be a
 * table that disagrees with the UI the first time either is edited.
 */
export { DEFAULT_PRICES as MODEL_PRICES, computeCostUsd } from "./modelPricing";
