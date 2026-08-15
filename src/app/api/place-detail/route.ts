import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseJsonResponse, runClaude } from "@/lib/claude";
import { buildPlaceDetailPrompt } from "@/lib/itineraryPrompt";
import { getTrip, insertRun } from "@/lib/db";
import { PlaceDetail } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { name, destination, lat, lng, tripId } = await req.json();

  if (!name || !destination || typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    // Append to the trip's original generation run when one exists, so
    // browsing place details shows up as more steps on that same pipeline
    // card. Falls back to a fresh single-step run otherwise (no trip yet,
    // or an unknown/stale tripId).
    const trip = tripId ? getTrip(tripId) : undefined;
    let runId = trip?.run_id ?? undefined;
    if (!runId) {
      runId = randomUUID();
      insertRun({ id: runId, kind: "place-detail", destination, tripId: tripId ?? null });
    }

    const prompt = buildPlaceDetailPrompt({ name, destination, lat, lng });
    const { result: raw } = await runClaude(prompt, "place-detail", undefined, { runId });
    const detail = parseJsonResponse<PlaceDetail>(raw);
    // runId was previously computed but never returned — every other itinerary route hands it
    // back so a caller can look the run up (see the backend dashboard's "view full run"), and
    // this one silently didn't. Additive field: existing callers (useTripCamera's selectStop)
    // only read `data.detail` and ignore the rest.
    return NextResponse.json({ detail, runId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load place detail" },
      { status: 500 }
    );
  }
}
