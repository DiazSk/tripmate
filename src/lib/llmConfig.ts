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

/** Transport, not provider. Both modes talk to the same Anthropic models — one over a child
 *  process, one over HTTPS. */
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

function envMode(): LlmMode | null {
  const raw = process.env.LLM_MODE?.trim().toLowerCase();
  if (raw === "cli" || raw === "api") return raw;
  return null;
}

/** The mode in force right now: runtime override, else env, else the `api` default. */
export function llmMode(): LlmMode {
  return runtimeOverride ?? envMode() ?? "api";
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
 * USD per million tokens, [input, output].
 *
 * The 5-generation rows are Anthropic's published list prices. The 4.5 rows are NOT in the current
 * published table (they're legacy models) — they're set to their tier's rate, which is an
 * assumption, not a quote.
 *
 * Lives here rather than in the bench harness because it is no longer bench-only: the API path has
 * no vendor-reported cost to fall back on (the CLI envelope carried one; an HTTP response carries
 * token counts and nothing else), so this table is what turns `usage` into the `costUSD` the trace
 * viewer renders. `src/lib/bench/models.ts` imports it as its own default and still layers
 * `BENCH_PRICES` on top for sweeps.
 */
export const MODEL_PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5-20251001": [1, 5],
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-4-5": [3, 15],
  "claude-sonnet-4-5-20250929": [3, 15],
  "claude-opus-4-5": [5, 25],
  "claude-opus-4-5-20251101": [5, 25],
  // Sonnet 5 list price. An introductory $2/$10 runs through 2026-08-31; the higher list price is
  // the default here so a cost comparison doesn't flatter it past that date without anyone noticing.
  "claude-sonnet-5": [3, 15],
  "claude-opus-5": [5, 25],
  "claude-fable-5": [10, 50],
};

/**
 * Dollar cost of one call, or null for a model with no price on file.
 *
 * Cache multipliers are the published ones: a cache *read* bills at ~0.1x the input rate, a cache
 * *write* at ~1.25x. Both matter here — the chat path deliberately caches a large stable prefix
 * (the seeded generate turn), so ignoring them would overstate turn 2 by roughly 10x.
 */
export function computeCostUsd(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  }
): number | null {
  const price =
    MODEL_PRICES[model] ??
    MODEL_PRICES[Object.keys(MODEL_PRICES).find((k) => model.startsWith(k)) ?? ""];
  if (!price) return null;
  const [inPerM, outPerM] = price;
  const perM = (tokens: number, rate: number) => (tokens / 1_000_000) * rate;
  return (
    perM(usage.inputTokens, inPerM) +
    perM(usage.outputTokens, outPerM) +
    perM(usage.cacheReadInputTokens ?? 0, inPerM * 0.1) +
    perM(usage.cacheCreationInputTokens ?? 0, inPerM * 1.25)
  );
}
