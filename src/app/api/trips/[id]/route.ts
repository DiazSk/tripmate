import { NextRequest, NextResponse } from "next/server";
import {
  deleteTrip,
  getTrip,
  promoteTripToSaved,
  setTripChatSession,
  updateTripItinerary,
} from "@/lib/db";
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

  const { itinerary, status, chatSessionId } = await req.json();
  if (!itinerary) {
    return NextResponse.json({ error: "Missing itinerary" }, { status: 400 });
  }

  // `status` is write-once and one-way: a draft can be kept, a kept trip cannot be un-kept here.
  // Demotion has no caller and would silently drop a saved trip out of the memories wall, so the
  // only value this route honours is `"saved"`. Everything else — including its absence, which is
  // what every pre-existing PATCH caller sends — leaves the column alone, so an autosave from the
  // draft editor can't promote a plan the traveler hasn't kept yet.
  const promote = status === "saved" && trip.status !== "saved";

  // Derived here rather than trusted from the client: the trip's length is a property of the
  // itinerary being saved, and the days are consecutive dates from the (immutable) start date. So
  // the end date is computable, and computing it means an edit that added or removed a day can't
  // leave `trips.end_date` disagreeing with the plan stored beside it.
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  const endDate = days.length ? tripEndDate(trip.start_date, days.length) : undefined;

  updateTripItinerary(id, JSON.stringify(itinerary), endDate);
  // After the itinerary write, not before. Promotion is the traveler saying "keep this plan", and
  // the plan they mean is the one in this request body — flipping the status first would leave a
  // window where a saved trip holds the pre-edit itinerary if the write then failed.
  if (promote) promoteTripToSaved(id);
  // A refine on the pre-save view replaces the conversation the plan was written in, so the row's
  // handle has to move with it — otherwise a promoted trip opens its chat resuming a session that
  // only knows the plan before the rework. Written only for a non-empty string: `null` here means
  // "the caller isn't tracking a session", which is every pre-existing PATCH caller, and must not
  // be read as "clear the one on the row".
  if (typeof chatSessionId === "string" && chatSessionId) setTripChatSession(id, chatSessionId);
  return NextResponse.json({
    ok: true,
    endDate: endDate ?? trip.end_date,
    days: days.length,
    status: promote ? "saved" : trip.status,
  });
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
