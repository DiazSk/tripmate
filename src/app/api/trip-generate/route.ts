import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { itineraryTimeoutMs, runClaude } from "@/lib/claude";
import { insertRun, insertTripArtifacts } from "@/lib/db";
import { buildItineraryGenerationPrompt } from "@/lib/generationPrompt";
import { loadSkill } from "@/lib/skill";
import { buildTripContext } from "@/lib/tripContext";

/**
 * Steps 5 + 6. Step 5 (digesting the bundles into trip-context.md) is deterministic and runs
 * inline; Step 6 is the single LLM call, made through the same runClaude() choke point every
 * other model call in the app uses, so it's traced and groupable like the rest.
 *
 * Both artifacts are persisted against the run id before returning, so Step 7's edit loop can
 * reuse the frozen context rather than rebuilding (and risk changing) it.
 */
export async function POST(req: NextRequest) {
  const { reconciled, poiDetails, tripId } = await req.json();
  if (!reconciled || !poiDetails) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!reconciled.usable) {
    return NextResponse.json({ error: reconciled.error ?? "Trip is not ready to plan" }, { status: 400 });
  }

  const tripContextMd = buildTripContext(reconciled, poiDetails);

  try {
    const runId = randomUUID();
    insertRun({
      id: runId,
      kind: "generate",
      destination: reconciled.rawFetch.destination.region ?? "unknown",
      tripId: tripId ?? null,
    });

    const skill = await loadSkill("itinerary-planner");
    const prompt = buildItineraryGenerationPrompt({ skill, tripContext: tripContextMd });

    const { result: itineraryMd } = await runClaude(
      prompt,
      "generate",
      itineraryTimeoutMs(reconciled.rawFetch.dateContext.tripDays),
      { runId }
    );

    insertTripArtifacts({
      run_id: runId,
      trip_context_md: tripContextMd,
      itinerary_md: itineraryMd,
    });

    return NextResponse.json({ ok: true, runId, tripContextMd, itineraryMd });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Itinerary generation failed" },
      { status: 500 }
    );
  }
}
