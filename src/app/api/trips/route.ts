import { NextRequest, NextResponse } from "next/server";
import { listTrips, purgeStaleDrafts, saveTripForRun } from "@/lib/db";
import { toTripSummary } from "@/lib/tripPayload";
import { itineraryRejection } from "@/lib/itinerary";
import { currentOwner, currentOwnerId } from "@/lib/ownerRequest";
import { geocodeDestinationCached } from "@/lib/serverFetchCached";
import type { TripStatus } from "@/lib/types";

/** `?status=draft` for the unsaved plans, anything else for the kept ones. Narrowed rather than
 *  passed through: this value reaches a SQL predicate, and an unrecognised string should read as
 *  the default rather than as an empty list nobody can explain. */
function parseStatus(raw: string | null): TripStatus {
  return raw === "draft" ? "draft" : "saved";
}

export async function GET(req: NextRequest) {
  const status = parseStatus(req.nextUrl.searchParams.get("status"));
  // Swept on the way past, for the same reason the `/trips` page does it: there is no scheduler
  // here, and a list request is the moment stale drafts would otherwise become visible. Best
  // effort — a failed sweep must not fail the read it was riding along with.
  try {
    purgeStaleDrafts();
  } catch (err) {
    console.error("[trips] draft sweep failed", err);
  }
  const { id: ownerId, signedIn } = await currentOwner();
  return NextResponse.json({ trips: listTrips(status, ownerId, signedIn).map(toTripSummary) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { destination, startDate, endDate, budget, itinerary, runId, chatSessionId, userAnswers, status } =
    body;

  if (!destination || !startDate || !endDate || typeof budget !== "number" || !itinerary) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // The trust boundary. This route stores `itinerary` verbatim, so whatever arrives here is what
  // every later reader gets — and a stop with no coordinates 500s the trip page from server
  // render (see `itineraryRejection`). `normalizeDays` drops those on read, which keeps the page
  // up, but a plan that quietly loses a stop between saving and opening is worse than one that
  // was refused. Refused here; dropped there as the backstop.
  const rejection = itineraryRejection(itinerary);
  if (rejection) return NextResponse.json({ error: rejection }, { status: 400 });

  // **The destination's own clock, resolved once and stored.** Without it the phone can only use
  // its own, and that is wrong in a way nobody would catch: measured on the simulator, a device
  // reading 21:07 on Sep 28 is Lisbon 05:07 on Sep *29* — so an on-trip screen would open the
  // wrong day of the itinerary, not merely show the wrong hour.
  //
  // Free in the normal path: the generation that produced the plan being saved geocoded this same
  // destination moments ago, and `geocodeDestinationCached` is that cache. Open-Meteo returns the
  // IANA zone on every geocode result and this app was already discarding it.
  //
  // Fail-soft, like every other geocode here (see the note in `src/app/page.tsx`): a miss stores
  // null, the client shows the plan with no clock, and nothing about saving a trip depends on it.
  let timezone: string | null = null;
  try {
    timezone = (await geocodeDestinationCached(destination))?.timezone ?? null;
  } catch {
    timezone = null;
  }

  // One trip per run: the server already saved this plan as a draft the moment it was written (so a
  // phone suspended mid-stream still gets it), and this save of the same run returns that row — or,
  // for a Keep, promotes it — rather than adding a second. See `saveTripForRun`.
  const id = saveTripForRun({
    // Stamped from the cookie so this plan comes back to the browser that made it, and to no
    // other. A cookieless caller falls back to the legacy bucket — see owner.ts.
    ownerId: await currentOwnerId(),
    destination,
    startDate,
    endDate,
    budget,
    itinerary,
    runId: runId ?? null,
    chatSessionId: chatSessionId ?? null,
    userAnswers: userAnswers ?? null,
    // Only an explicit "draft" makes one. Anything else — including a caller that predates drafts
    // and sends no status at all — saves a kept trip, so the Save button's own POST fallback
    // behaves exactly as it did before this field existed.
    status: status === "draft" ? "draft" : "saved",
    timezone,
  });

  return NextResponse.json({ id });
}
