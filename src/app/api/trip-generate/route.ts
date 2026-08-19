import { NextRequest, NextResponse } from "next/server";
import { generateItinerary } from "@/lib/generateItinerary";

/**
 * Steps 5 + 6. The work itself lives in `generateItinerary()` so the dev benchmark harness can
 * invoke the identical path with only the model swapped; this route is just the HTTP shell —
 * validation in, JSON out.
 */
export async function POST(req: NextRequest) {
  const { reconciled, poiDetails, tripId, destination } = await req.json();
  if (!reconciled || !poiDetails) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!reconciled.usable) {
    return NextResponse.json({ error: reconciled.error ?? "Trip is not ready to plan" }, { status: 400 });
  }

  try {
    const { runId, tripContextMd, itineraryMd } = await generateItinerary({
      reconciled,
      poiDetails,
      tripId,
      destination,
    });
    return NextResponse.json({ ok: true, runId, tripContextMd, itineraryMd });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Itinerary generation failed" },
      { status: 500 }
    );
  }
}
