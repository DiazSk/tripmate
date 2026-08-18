import { randomUUID } from "crypto";
import { itineraryTimeoutMs, runClaude } from "./claude";
import { insertRun, insertTripArtifacts } from "./db";
import { buildItineraryGenerationPrompt } from "./generationPrompt";
import { loadSkill } from "./skill";
import { buildTripContext } from "./tripContext";
import type { PoiDetails, ReconciledTrip } from "./types";

export interface GenerateItineraryParams {
  reconciled: ReconciledTrip;
  poiDetails: PoiDetails;
  tripId?: string | null;
  /**
   * Overrides the model for this generation. Exists solely for the dev-only benchmark harness
   * (src/lib/bench), which varies this and nothing else; `/api/trip-generate` never sets it, so
   * the production path still runs on `MODEL`.
   */
  model?: string;
  /**
   * Overrides the call timeout. Also benchmark-only: `itineraryTimeoutMs()` is tuned for the
   * production model, and letting it cap a slower model would measure the timeout rather than the
   * model. Omitted everywhere in the app, which keeps the trip-length-scaled default.
   */
  timeoutMs?: number;
}

export interface GenerateItineraryResult {
  runId: string;
  traceId: string;
  model: string;
  /** Wall clock of the single LLM call, excluding the deterministic Step 5 digest. */
  latencyMs: number;
  tripContextMd: string;
  itineraryMd: string;
}

/**
 * Steps 5 + 6, extracted from `/api/trip-generate` so there is exactly one implementation of the
 * generation path. Step 5 (digesting the bundles into trip-context.md) is deterministic and runs
 * inline; Step 6 is the single LLM call, made through the same runClaude() choke point every
 * other model call in the app uses, so it's traced and groupable like the rest.
 *
 * Both artifacts are persisted against the run id before returning, so Step 7's edit loop can
 * reuse the frozen context rather than rebuilding (and risk changing) it.
 *
 * The three inputs to the call — skill, trip-context, generation prompt — are assembled here and
 * nowhere else. That is what lets the benchmark harness claim its comparison is attributable to
 * the model: it calls this function, and the only argument it varies is `model`.
 */
export async function generateItinerary(
  params: GenerateItineraryParams
): Promise<GenerateItineraryResult> {
  const { reconciled, poiDetails, tripId, model, timeoutMs } = params;

  const tripContextMd = buildTripContext(reconciled, poiDetails);

  const runId = randomUUID();
  insertRun({
    id: runId,
    kind: "generate",
    destination: reconciled.rawFetch.destination.region ?? "unknown",
    tripId: tripId ?? null,
  });

  const skill = await loadSkill("itinerary-planner");
  const prompt = buildItineraryGenerationPrompt({ skill, tripContext: tripContextMd });

  const generated = await runClaude(
    prompt,
    "generate",
    timeoutMs ?? itineraryTimeoutMs(reconciled.rawFetch.dateContext.tripDays),
    { runId, model }
  );

  insertTripArtifacts({
    run_id: runId,
    trip_context_md: tripContextMd,
    itinerary_md: generated.result,
  });

  return {
    runId,
    traceId: generated.traceId,
    model: generated.model,
    latencyMs: generated.durationMs,
    tripContextMd,
    itineraryMd: generated.result,
  };
}
