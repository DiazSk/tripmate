import { NextRequest, NextResponse } from "next/server";
import { deleteTrip, getTrip, updateTripItinerary } from "@/lib/db";
import { toTripDetail } from "@/lib/tripPayload";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trip = getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "That trip isn't saved here." }, { status: 404 });
  }

  // The only route that reads `trips.itinerary_json`, so it's the one place a
  // parse boundary pays for every writer at once — the original generate, a
  // refine, a rebalance, and anything trip-edit patches back through PATCH.
  // Rows written before this boundary existed can carry an unrecognised
  // category or a string cost; normalizing on read means an old trip renders
  // the same as a new one, and it self-heals on disk at the next PATCH.
  return NextResponse.json(toTripDetail(trip));
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Same existence guard and copy as GET/PATCH above. Checking first rather than
  // letting the DELETE no-op means "already gone" is reported as a 404 instead of
  // a success the caller would use to remove a card that was never there.
  const trip = getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "That trip isn't saved here." }, { status: 404 });
  }

  deleteTrip(id);
  return NextResponse.json({ ok: true });
}
