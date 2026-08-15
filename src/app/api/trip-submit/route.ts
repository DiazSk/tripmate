import { NextRequest, NextResponse } from "next/server";
import { geocodeDestination } from "@/lib/weather";

/**
 * Step 1 of the pipeline: validates a freshly-submitted { destination, startDate, endDate }
 * and hands back the validated params for the caller to fan out to Step 2a (data fetch, e.g.
 * /api/destination-context) and Step 2b (the interests/tier Q&A step). This route only
 * validates — it never calls those steps itself.
 *
 * A geocode miss is intentionally non-blocking here too (see the same tradeoff already made
 * in page.tsx and itinerary/route.ts): only `destinationResolved` reflects it, so callers can
 * show the existing soft "we'll still plan it" messaging without duplicating the geocode call.
 */
export async function POST(req: NextRequest) {
  const { destination, startDate, endDate } = await req.json();

  if (typeof destination !== "string" || !destination.trim()) {
    return NextResponse.json({ error: "Missing destination", field: "destination" }, { status: 400 });
  }
  if (!startDate) {
    return NextResponse.json({ error: "Missing start date", field: "startDate" }, { status: 400 });
  }
  if (!endDate) {
    return NextResponse.json({ error: "Missing end date", field: "endDate" }, { status: 400 });
  }
  if (Number.isNaN(new Date(startDate).getTime())) {
    return NextResponse.json({ error: "Invalid start date", field: "startDate" }, { status: 400 });
  }
  if (Number.isNaN(new Date(endDate).getTime())) {
    return NextResponse.json({ error: "Invalid end date", field: "endDate" }, { status: 400 });
  }
  if (endDate < startDate) {
    return NextResponse.json(
      { error: "End date must be on or after the start date.", field: "endDate" },
      { status: 400 }
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  if (startDate < today) {
    return NextResponse.json(
      { error: "Start date can't be in the past.", field: "startDate" },
      { status: 400 }
    );
  }

  let destinationResolved = false;
  try {
    destinationResolved = Boolean(await geocodeDestination(destination));
  } catch {
    destinationResolved = false;
  }

  return NextResponse.json({
    ok: true,
    trip: { destination, startDate, endDate },
    destinationResolved,
  });
}
