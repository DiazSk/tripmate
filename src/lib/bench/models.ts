import { MODEL } from "../claude";
import { MODEL_PRICES } from "../llmConfig";

/**
 * Which models the benchmark compares, and what a token costs on each.
 *
 * Both are configurable rather than hardcoded — the model list via `BENCH_MODELS` (comma-
 * separated) and the price table via `BENCH_PRICES` (JSON, `{"<model>": [inPerMTok, outPerMTok]}`)
 * in `.env.local`. The defaults below are a sane starting point, not a law: model ids and prices
 * both move, and a benchmark that silently costs its own numbers off a stale table is worse than
 * one that says it doesn't know.
 */

export interface BenchModel {
  /** Exactly the string passed to the CLI's `--model`. */
  id: string;
  /** Short label for charts. */
  label: string;
}

/**
 * The app's production model is always first — it's the baseline every comparison is against —
 * and its two siblings are the SAME GENERATION.
 *
 * That generation match is the point: the app runs Sonnet 4.5, so the question worth answering is
 * "what would Haiku or Opus of that same generation buy me", not "what would a model a generation
 * newer buy me". Comparing 4.5 against 5 conflates the tier difference with the generation
 * difference, and no chart can separate them afterwards.
 *
 * To weigh a 5-generation model deliberately, set BENCH_MODELS — but note that Sonnet 5 timed out
 * twice at 216s on a 3-day trip here, so `BENCH_TIMEOUT_MS` has to go up with it or the sweep
 * measures the timeout rather than the model.
 */
const DEFAULT_MODELS: BenchModel[] = [
  { id: MODEL, label: "Sonnet 4.5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-opus-4-5", label: "Opus 4.5" },
];

/**
 * The price table, imported rather than kept here.
 *
 * It moved to llmConfig.ts when the API transport landed: the production path now has to turn
 * `usage` into a dollar figure itself (an HTTP response reports tokens, not money, where the CLI
 * envelope reported both), so the table stopped being bench-only. `BENCH_PRICES` still layers over
 * it below for sweeps — this is the default, not the ceiling.
 */
const DEFAULT_PRICES = MODEL_PRICES;

function parseModelsEnv(raw: string): BenchModel[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id.replace(/^claude-/, "").replace(/-\d{8}$/, "") }));
}

export function benchModels(): BenchModel[] {
  const raw = process.env.BENCH_MODELS;
  if (!raw) return DEFAULT_MODELS;
  const parsed = parseModelsEnv(raw);
  return parsed.length > 0 ? parsed : DEFAULT_MODELS;
}

export function benchPrices(): Record<string, [number, number]> {
  const raw = process.env.BENCH_PRICES;
  if (!raw) return DEFAULT_PRICES;
  try {
    return { ...DEFAULT_PRICES, ...(JSON.parse(raw) as Record<string, [number, number]>) };
  } catch {
    return DEFAULT_PRICES;
  }
}

/**
 * How long a benchmark generation may run before it's recorded as a timeout.
 *
 * Deliberately NOT `itineraryTimeoutMs()`: that is tuned around the production model, and the very
 * first real sweep proved why it can't be reused — all three models were killed at exactly 168s on
 * a 4-day trip, which measures the timeout, not the model. A benchmark's timeout has to be generous
 * enough that the slowest model in the comparison finishes, or the comparison is circular.
 */
export function benchTimeoutMs(): number {
  const raw = Number(process.env.BENCH_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 900_000;
}

/** Cache-write and cache-read multipliers on the input rate (5-minute TTL). */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
}

/**
 * Total prompt size. `inputTokens` alone is the UNCACHED REMAINDER, not the prompt — the CLI caches
 * the skill+context prefix, and a real sweep showed Sonnet 5 reporting `inputTokens: 2` against
 * 14,023 cache-creation tokens. Summing the three is the only reading that means "how big was the
 * prompt", and it's what the benchmark charts and prices.
 */
export function promptTokens(usage: TokenUsage): number | null {
  const parts = [usage.inputTokens, usage.cacheReadInputTokens, usage.cacheCreationInputTokens];
  if (parts.every((p) => p === null || p === undefined)) return null;
  return parts.reduce((sum: number, p) => sum + (p ?? 0), 0);
}

/**
 * Cost in USD from the price table, priced per token class rather than lumping the prompt together:
 * cache writes cost more than fresh input and cache reads cost far less, and on these prompts the
 * cache-write tier is most of the input bill. Returns null rather than 0 when the model isn't
 * priced or the counts are missing — a missing cost must not render as "free" on the Pareto chart.
 */
export function computeCostUsd(model: string, usage: TokenUsage): number | null {
  const price = benchPrices()[model];
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
