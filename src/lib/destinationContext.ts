import { DEFAULT_TIMEOUT_MS, parseJsonResponse, runClaude } from "./claude";
import { getDestinationContextRow, upsertDestinationContext } from "./db";
import { buildContextPrompt, formatContextInsight } from "./itineraryPrompt";
import { fetchSafetyNotes } from "./destinationSafety";
import { fetchFestivals } from "./destinationFestivals";
import type { DestinationContext } from "./types";

const CACHE_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The parsed destination context (festivals/safety/shopping/trends), cached per destination +
 * start-month so repeat requests for the same city/month skip the fetches and the LLM call.
 *
 * Safety and festivals are fetched and grounded (destinationSafety.ts, destinationFestivals.ts) —
 * a `null` from either degrades that category to `[]` in the assembled context, **never** back to
 * model invention; that would silently regress the exact bug those modules exist to fix. Shopping
 * and trends still come from a single recall call (`buildContextPrompt`), run in parallel with the
 * other two since none depend on each other.
 *
 * Returns `null` rather than throwing, and `null` specifically means "we couldn't get it" — the
 * house convention (see holidays.ts, poiDetails.ts) where a failed fetch is distinguishable from
 * a successful one that found nothing. A broken or stale-but-unrefreshable context call must
 * never block itinerary generation.
 *
 * Split out from `getDestinationContextInsight` below so the parsed object can be used directly —
 * the loader's fact feed wants the festivals and shopping entries themselves, not the
 * prompt-shaped text block. Both callers share this one cache lookup, so surfacing the data to
 * the client costs no extra model call: the warmer has already paid for it.
 */
export async function getDestinationContext(
  destination: string,
  startDate: string,
  endDate: string,
  runId?: string
): Promise<DestinationContext | null> {
  const monthBucket = startDate.slice(0, 7);

  try {
    const cached = getDestinationContextRow(destination, monthBucket);
    if (cached && Date.now() - new Date(cached.created_at).getTime() < CACHE_FRESHNESS_MS) {
      return JSON.parse(cached.context_json) as DestinationContext;
    }

    const [recalled, safety, festivals] = await Promise.all([
      (async () => {
        const prompt = buildContextPrompt({ destination, startDate, endDate });
        const { result: raw } = await runClaude(prompt, "context", DEFAULT_TIMEOUT_MS, { runId });
        return parseJsonResponse<Pick<DestinationContext, "shopping" | "trends">>(raw);
      })(),
      fetchSafetyNotes(destination),
      fetchFestivals(destination, startDate, runId),
    ]);

    const context: DestinationContext = {
      festivals: festivals ?? [],
      safety: safety ?? [],
      shopping: recalled.shopping,
      trends: recalled.trends,
    };
    upsertDestinationContext(destination, monthBucket, JSON.stringify(context));
    return context;
  } catch {
    return null;
  }
}

/**
 * The same context, formatted as the insight block the generation prompt injects. Falls back
 * to "" (no context in the prompt) on any failure, exactly as before.
 */
export async function getDestinationContextInsight(
  destination: string,
  startDate: string,
  endDate: string,
  runId?: string
): Promise<string> {
  const context = await getDestinationContext(destination, startDate, endDate, runId);
  return context ? formatContextInsight(context) : "";
}
