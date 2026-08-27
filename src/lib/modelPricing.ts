/**
 * USD per million tokens, [input, output], shared by the runtime cost calc (claude.ts) and the
 * dev benchmark harness (bench/models.ts, which layers its own BENCH_PRICES env override on top).
 *
 * The 5-generation rows are Anthropic's published list prices. The 4.5 rows are NOT in the current
 * published table (they're legacy models) — they're set to their tier's rate, which is an
 * assumption, not a quote.
 */
export const DEFAULT_PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5-20251001": [1, 5],
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-4-5": [3, 15],
  "claude-sonnet-4-5-20250929": [3, 15],
  "claude-opus-4-5": [5, 25],
  "claude-opus-4-5-20251101": [5, 25],
  "claude-sonnet-5": [3, 15],
  "claude-opus-5": [5, 25],
  "claude-fable-5": [10, 50],
};

/** Cache-write and cache-read multipliers on the input rate (5-minute TTL). */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
}

/**
 * Total prompt size. `inputTokens` alone can be the UNCACHED REMAINDER, not the whole prompt, when
 * the caller is caching a prefix — summing all three is the only reading that means "how big was
 * the prompt".
 */
export function promptTokens(usage: TokenUsage): number | null {
  const parts = [usage.inputTokens, usage.cacheReadInputTokens, usage.cacheCreationInputTokens];
  if (parts.every((p) => p === null || p === undefined)) return null;
  return parts.reduce((sum: number, p) => sum + (p ?? 0), 0);
}

/**
 * Cost in USD from a price table, priced per token class rather than lumping the prompt together:
 * cache writes cost more than fresh input and cache reads cost far less. Returns null rather than 0
 * when the model isn't priced or the counts are missing — a missing cost must not render as "free".
 *
 * `prices` defaults to `DEFAULT_PRICES` but accepts an override so bench/models.ts's BENCH_PRICES
 * merge doesn't need its own copy of this function.
 */
export function computeCostUsd(
  model: string,
  usage: TokenUsage,
  prices: Record<string, [number, number]> = DEFAULT_PRICES
): number | null {
  const price = prices[model];
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
