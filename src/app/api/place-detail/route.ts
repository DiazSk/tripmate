import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseJsonResponse, runClaude } from "@/lib/claude";
import { buildPlaceDetailPrompt } from "@/lib/itineraryPrompt";
import { compactItinerary } from "@/lib/editPrompt";
import { getTrip, insertRun } from "@/lib/db";
import { isThrottled } from "@/lib/ipThrottle";
import { isOverDailyCap } from "@/lib/spendCap";
import { Itinerary, PlaceDetail } from "@/lib/types";

/**
 * Which day and slot the tapped stop sits in, as a phrase the prompt can drop in.
 *
 * Matched on coordinates first and the name only as a tiebreak: a trip can legitimately hold two
 * stops with the same name (a station visited twice), and the client sends the exact lat/lng of the
 * marker that was clicked. Returns null rather than guessing when nothing matches — a stop that has
 * been edited away since the card opened should produce a generic entry, not a confident one about
 * the wrong slot.
 */
function locateStop(
  itinerary: Itinerary,
  name: string,
  lat: number,
  lng: number
): string | null {
  for (const [dayIndex, day] of itinerary.days.entries()) {
    const stopIndex = day.stops.findIndex(
      (s) => Math.abs(s.lat - lat) < 1e-6 && Math.abs(s.lng - lng) < 1e-6 && s.name === name
    );
    if (stopIndex !== -1) {
      const stop = day.stops[stopIndex];
      return `stopIndex=${stopIndex} on Day ${dayIndex + 1} (${day.date})${stop.time ? `, scheduled ${stop.time}` : ""}`;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (isThrottled(req)) {
    return NextResponse.json(
      { error: "Too many requests — slow down and try again shortly." },
      { status: 429 }
    );
  }
  if (isOverDailyCap()) {
    return NextResponse.json(
      { error: "Demo budget for today has been used up — try again tomorrow." },
      { status: 503 }
    );
  }
  const { name, destination, lat, lng, tripId } = await req.json();

  if (!name || !destination || typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    // Append to the trip's original generation run when one exists, so
    // browsing place details shows up as more steps on that same pipeline
    // card. Falls back to a fresh single-step run otherwise (no trip yet,
    // or an unknown/stale tripId).
    const trip = tripId ? getTrip(tripId) : undefined;
    let runId = trip?.run_id ?? undefined;
    if (!runId) {
      runId = randomUUID();
      insertRun({ id: runId, kind: "place-detail", destination, tripId: tripId ?? null });
    }

    // Read from the store, never regenerated: the plan is already on the trip row, and re-running
    // any of the fetch stages to answer "tell me about this stop" would be several seconds and
    // several API calls to rebuild facts we are holding. Absent for an unsaved trip (no row yet),
    // which degrades to exactly the generic entry this route produced before — no error path.
    const itineraryContext = trip
      ? (() => {
          try {
            const saved = JSON.parse(trip.itinerary_json) as Itinerary;
            // Same compacted view the edit loop reasons over, so the two flows describe the plan
            // to the model identically rather than each inventing a format.
            const plan = compactItinerary(saved);
            const at = locateStop(saved, name, lat, lng);
            return at ? `${plan}\n\nThe traveler tapped ${at}.` : plan;
          } catch (err) {
            // A trip row whose JSON won't parse is a broken trip, but it is not this route's
            // problem to report — fall back to the context-free entry.
            console.error("[place-detail] unreadable itinerary_json", err);
            return undefined;
          }
        })()
      : undefined;

    const prompt = buildPlaceDetailPrompt({ name, destination, lat, lng, itineraryContext });
    const { result: raw } = await runClaude(prompt, "place-detail", undefined, { runId });
    const detail = parseJsonResponse<PlaceDetail>(raw);
    // runId was previously computed but never returned — every other itinerary route hands it
    // back so a caller can look the run up (see the backend dashboard's "view full run"), and
    // this one silently didn't. Additive field: existing callers (useTripCamera's selectStop)
    // only read `data.detail` and ignore the rest.
    return NextResponse.json({ detail, runId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load place detail" },
      { status: 500 }
    );
  }
}
