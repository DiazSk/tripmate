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

  // The parse-and-normalize boundary lives in `toTripDetail` now, because the server page for
  // this route reads the same row directly and the two must not drift. See its comment for why
  // normalizing on read is load-bearing.
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
