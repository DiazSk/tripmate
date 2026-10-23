import { NextRequest, NextResponse } from "next/server";
import {
  deleteTrip,
  getTrip,
  promoteTripToSaved,
  setTripChatSession,
  updateTripItinerary,
} from "@/lib/db";
import { itineraryRejection } from "@/lib/itinerary";
import { readableOwners, writableOwners } from "@/lib/owner";
import { currentOwner } from "@/lib/ownerRequest";
import { toTripDetail } from "@/lib/tripPayload";
import { attemptIdFrom, captureServer, editByFrom, whoFromRequest } from "@/lib/analytics/server";
import { stopChanges } from "@/lib/analytics/stopChanges";
import type { Itinerary } from "@/lib/types";
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

  // **Scoped now, where it deliberately was not.** This read was left open because an unguessable
  // id *was* the sharing mechanism — the comment on PATCH below still described it that way. That
  // conflated two things: a trip's identity and a decision to publish it. An id is in the owner's
  // address bar, their history and their device's cache, it is never withdrawn, and it is the
  // same value that reaches every other route here. Sharing is now an explicit act that mints a
  // separate revocable token, so identity can go back to being private.
  //
  // Same 404-not-403 copy as everywhere else in this file: a trip somebody may not read should
  // not be distinguishable from one that does not exist.
  const { id: ownerId, signedIn } = await currentOwner();
  if (!readableOwners(ownerId, signedIn).includes(trip.owner_id)) {
    return NextResponse.json({ error: "That trip isn't saved here." }, { status: 404 });
  }

  // The parse-and-normalize boundary lives in `toTripDetail` now, because the server page for
  // this route reads the same row directly and the two must not drift. See its comment for why
  // normalizing on read is load-bearing.
  return NextResponse.json(toTripDetail(trip));
}

const ORIGINS = ["generated", "imported", "ready-made"] as const;

/** Analytics for a PATCH that has already been applied: a plan kept, stops changed. Never throws. */
async function reportPatch(
  req: NextRequest,
  trip: { created_at: string; itinerary_json: string },
  itinerary: Itinerary | undefined,
  promoted: boolean
): Promise<void> {
  try {
    const before = JSON.parse(trip.itinerary_json) as Itinerary;
    const who = await whoFromRequest(req);
    const sinceMs = Date.now() - new Date(trip.created_at).getTime();
    const after = itinerary ?? before;
    if (promoted) {
      captureServer(who, "trip_kept", {
        // From the client's body, so only the three known values are passed on.
        origin: ORIGINS.find((o) => o === (after.origin ?? before.origin ?? "generated")) ?? null,
        days: after.days.length,
        minutes_since_written: Math.max(0, Math.round(sinceMs / 60_000)),
        attempt_id: attemptIdFrom(req),
      });
    }
    // Hundredths of a day, so an edit minutes after the plan was written reads differently from one a day later.
    const days_since_written = Math.max(0, Math.round((sinceMs / 86_400_000) * 100) / 100);
    const by = editByFrom(req);
    if (itinerary && by !== "revision") {
      for (const c of stopChanges(before, itinerary)) {
        captureServer(who, "stop_changed", { ...c, by, days_since_written });
      }
    }
  } catch (err) {
    console.warn("[analytics] trip patch report failed:", err instanceof Error ? err.message : err);
  }
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

  // Scoped, like the GET above now is. It always intended to be — the note here used to say that
  // widening to the legacy bucket kept pre-ownership rows editable by whoever made them, which is
  // not what it did: measured against a running server, a request carrying nothing but a trip id
  // overwrote a legacy-owned itinerary to zero days and got a 200. `writableOwners` is exact, and
  // its docblock records what that still cannot fix.
  const { id: ownerId } = await currentOwner();
  const owners = writableOwners(ownerId);
  if (!owners.includes(trip.owner_id)) {
    return NextResponse.json({ error: "That trip isn't saved here." }, { status: 404 });
  }

  const { itinerary, status, chatSessionId } = await req.json();
  // A bare `{ status: "saved" }` is a Keep that leaves the plan as the row has it: the trip page
  // persists every edit as it is made, so it has nothing to send, and sending its copy anyway could
  // write the old plan over a critique revision that landed on the row a moment before. Every
  // caller that sends an itinerary is handled exactly as before.
  if (!itinerary && status !== "saved") {
    return NextResponse.json({ error: "Missing itinerary" }, { status: 400 });
  }

  // Same guard as POST, because this writes to the same column by the same means — an edit can
  // put a placeless stop into a trip that saved clean.
  const rejection = itinerary ? itineraryRejection(itinerary) : null;
  if (rejection) return NextResponse.json({ error: rejection }, { status: 400 });

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
  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
  const endDate = days.length ? tripEndDate(trip.start_date, days.length) : undefined;

  if (itinerary) updateTripItinerary(id, JSON.stringify(itinerary), owners, endDate);
  // After the itinerary write, not before. Promotion is the traveler saying "keep this plan", and
  // the plan they mean is the one in this request body — flipping the status first would leave a
  // window where a saved trip holds the pre-edit itinerary if the write then failed.
  if (promote) promoteTripToSaved(id, owners);
  // A refine on the pre-save view replaces the conversation the plan was written in, so the row's
  // handle has to move with it — otherwise a promoted trip opens its chat resuming a session that
  // only knows the plan before the rework. Written only for a non-empty string: `null` here means
  // "the caller isn't tracking a session", which is every pre-existing PATCH caller, and must not
  // be read as "clear the one on the row".
  if (typeof chatSessionId === "string" && chatSessionId) setTripChatSession(id, chatSessionId);
  await reportPatch(req, trip, itinerary, promote);
  return NextResponse.json({
    ok: true,
    endDate: endDate ?? trip.end_date,
    days: itinerary ? days.length : (JSON.parse(trip.itinerary_json).days?.length ?? 0),
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

  // Scoped, like every other handler on this path now is, and exactly: destroying a row is the
  // operation where being wrong cannot be undone. `deleteTrip` takes no `signedIn` any more —
  // an exact owner match has nothing to widen.
  const { id: deleterId } = await currentOwner();
  if (!deleteTrip(id, deleterId)) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
