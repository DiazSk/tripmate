import { NextRequest, NextResponse } from "next/server";
import { getDestinationContext } from "@/lib/destinationContext";

/**
 * Fire-and-forget cache warmer: the client calls this the moment destination/dates are
 * submitted (before the user has picked interests or a tier), so the destination_context
 * cache is already populated by the time the real /api/itinerary generate call needs it.
 *
 * It now also returns the parsed context. That is not a second job bolted on — the model call
 * has already been made and paid for by the warm-up, and the festivals/shopping entries are
 * real facts about the trip that the generation loader shows while the itinerary is being
 * written. Throwing them away and then wanting destination facts later would mean a second
 * model call for data already sitting in the cache.
 *
 * `ok: true` is kept so the original fire-and-forget callers, which never read the body, are
 * unaffected. `context` is null whenever the lookup failed.
 */
export async function POST(req: NextRequest) {
  const { destination, startDate, endDate } = await req.json();
  if (!destination || !startDate || !endDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const context = await getDestinationContext(destination, startDate, endDate);
  return NextResponse.json({ ok: true, context });
}
