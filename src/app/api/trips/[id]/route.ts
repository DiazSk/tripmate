import { NextRequest, NextResponse } from "next/server";
import { deleteTrip, getTrip, updateTripItinerary } from "@/lib/db";
import { currentOwnerId } from "@/lib/ownerRequest";
import { toTripDetail } from "@/lib/tripPayload";
// Still needed by PATCH below, which derives the end date from the saved itinerary — GET's own
// use of `normalizeDays` moved into `toTripDetail`, but this did not.
import { tripEndDate } from "@/lib/tripDays";

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

  // Derived here rather than trusted from the client: the trip's length is a property of the
  // itinerary being saved, and the days are consecutive dates from the (immutable) start date. So
  // the end date is computable, and computing it means an edit that added or removed a day can't
  // leave `trips.end_date` disagreeing with the plan stored beside it.
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  const endDate = days.length ? tripEndDate(trip.start_date, days.length) : undefined;

  updateTripItinerary(id, JSON.stringify(itinerary), endDate);
  return NextResponse.json({ ok: true, endDate: endDate ?? trip.end_date, days: days.length });
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

  // Scoped, unlike the GET beside it: reading a trip by an unguessable id is how a shared link
  // works, but destroying one is the operation where being wrong cannot be undone.
  if (!deleteTrip(id, await currentOwnerId())) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
