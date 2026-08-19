import { NextRequest, NextResponse } from "next/server";
import { deleteTrip, getTrip, updateTripItinerary } from "@/lib/db";
import { normalizeDays } from "@/lib/itinerary";
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

  // The only route that reads `trips.itinerary_json`, so it's the one place a
  // parse boundary pays for every writer at once — the original generate, a
  // refine, a rebalance, and anything trip-edit patches back through PATCH.
  // Rows written before this boundary existed can carry an unrecognised
  // category or a string cost; normalizing on read means an old trip renders
  // the same as a new one, and it self-heals on disk at the next PATCH.
  const stored = JSON.parse(trip.itinerary_json);

  return NextResponse.json({
    id: trip.id,
    destination: trip.destination,
    startDate: trip.start_date,
    endDate: trip.end_date,
    budget: trip.budget,
    itinerary: { ...stored, days: normalizeDays(stored.days) },
    userAnswers: trip.user_answers_json ? JSON.parse(trip.user_answers_json) : null,
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

  deleteTrip(id);
  return NextResponse.json({ ok: true });
}
