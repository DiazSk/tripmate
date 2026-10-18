import { NextRequest, NextResponse } from "next/server";
import { generateItinerary } from "@/lib/generateItinerary";
import { throttle } from "@/lib/ipThrottle";
import { capResponse, limitResponse } from "@/lib/limitResponse";
import { dailyCapResumesAt } from "@/lib/spendCap";

/**
 * Steps 5 + 6. The work itself lives in `generateItinerary()` so the dev benchmark harness can
 * invoke the identical path with only the model swapped; this route is just the HTTP shell —
 * validation in, JSON out.
 */
export async function POST(req: NextRequest) {
  const capped = dailyCapResumesAt();
  if (capped) return capResponse(capped);
  const limit = throttle(req, "plan");
  if (limit.limited) return limitResponse(limit, "plan");
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
    // Logged, not returned. `err.message` here is internal text — a model timeout, a parse
    // failure, a stack-bearing SDK error — and `/api/itinerary` already substitutes a safe
    // string for exactly that reason. Matched rather than re-invented.
    console.error("[trip-generate]", err);
    return NextResponse.json({ error: "Itinerary generation failed" }, { status: 500 });
  }
}
