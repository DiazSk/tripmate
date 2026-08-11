import { NextRequest, NextResponse } from "next/server";
import { getTrip, updateTripItinerary } from "@/lib/db";
import { normalizeDays } from "@/lib/itinerary";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trip = getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "That trip isn't saved here." }, { status: 404 });
  }

  // Rows written before the parse boundary existed can carry an unrecognised
  // category or a string cost. Normalizing on read means an old trip renders the
  // same as a new one; it self-heals on disk at the next PATCH.
  const stored = JSON.parse(trip.itinerary_json);

  return NextResponse.json({
    id: trip.id,
    destination: trip.destination,
    startDate: trip.start_date,
    endDate: trip.end_date,
    budget: trip.budget,
    itinerary: { ...stored, days: normalizeDays(stored.days) },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trip = getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "That trip isn't saved here." }, { status: 404 });
  }

  const { itinerary } = await req.json();
  if (!itinerary) {
    return NextResponse.json({ error: "Missing itinerary" }, { status: 400 });
  }

  updateTripItinerary(id, JSON.stringify(itinerary));
  return NextResponse.json({ ok: true });
}
