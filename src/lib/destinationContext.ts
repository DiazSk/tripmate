import { DEFAULT_TIMEOUT_MS, parseJsonResponse, runClaude } from "./claude";
import { getDestinationContextRow, upsertDestinationContext } from "./db";
import { buildContextPrompt, formatContextInsight } from "./itineraryPrompt";
import { DestinationContext } from "./types";

const CACHE_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Returns a formatted destination-context insight block (festivals/safety/
 * shopping/trends), cached per destination + start-month so repeat requests
 * for the same city/month skip the LLM call. Never throws — a broken or
 * stale-but-unrefreshable context call shouldn't block itinerary generation,
 * so any failure just falls back to "" (no context injected into the prompt).
 */
export async function getDestinationContextInsight(
  destination: string,
  startDate: string,
  endDate: string,
  runId?: string
): Promise<string> {
  const monthBucket = startDate.slice(0, 7);

  try {
    const cached = getDestinationContextRow(destination, monthBucket);
    if (cached && Date.now() - new Date(cached.created_at).getTime() < CACHE_FRESHNESS_MS) {
      return formatContextInsight(JSON.parse(cached.context_json) as DestinationContext);
    }

    const prompt = buildContextPrompt({ destination, startDate, endDate });
    const { result: raw } = await runClaude(prompt, "context", DEFAULT_TIMEOUT_MS, { runId });
    const context = parseJsonResponse<DestinationContext>(raw);
    upsertDestinationContext(destination, monthBucket, JSON.stringify(context));
    return formatContextInsight(context);
  } catch {
    return "";
  }
}
