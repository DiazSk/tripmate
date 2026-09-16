import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { insertTrip, linkGenerationToTrip, listTrips, purgeStaleDrafts } from "@/lib/db";
import { toTripSummary } from "@/lib/tripPayload";
import { itineraryRejection } from "@/lib/itinerary";
import { currentOwnerId } from "@/lib/ownerRequest";
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
  return NextResponse.json({ trips: listTrips(status, await currentOwnerId()).map(toTripSummary) });
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

  const trip = insertTrip({
    id: randomUUID(),
    // Stamped from the cookie so this plan comes back to the browser that made it, and to no
    // other. A cookieless caller falls back to the legacy bucket — see owner.ts.
    owner_id: await currentOwnerId(),
    destination,
    start_date: startDate,
    end_date: endDate,
    budget,
    itinerary_json: JSON.stringify(itinerary),
    run_id: runId ?? null,
    chat_session_id: chatSessionId ?? null,
    user_answers_json: userAnswers ? JSON.stringify(userAnswers) : null,
    // Only an explicit "draft" makes one. Anything else — including a caller that predates drafts
    // and sends no status at all — inserts a kept trip, so the Save button's own POST fallback
    // behaves exactly as it did before this field existed.
    status: status === "draft" ? "draft" : "saved",
  });

  // Back-fill the generation that produced this plan. The run still exists before the trip does —
  // a generation is written the moment the model answers, the trip row a beat later — so
  // `generations.trip_id` can only be set here. It now fires when the *draft* is created rather
  // than on Save, which is a strict improvement: a plan the traveler never kept keeps its link to
  // the run that wrote it, instead of leaving the provenance dangling.
  // Best-effort: a trip that saved must not fail because its provenance link didn't.
  if (runId) {
    try {
      linkGenerationToTrip(runId, trip.id);
    } catch (err) {
      console.error("[trips] generation link failed", err);
    }
  }

  return NextResponse.json({ id: trip.id });
}
