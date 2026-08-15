import { NextRequest, NextResponse } from "next/server";
import { getDestinationContextInsight } from "@/lib/destinationContext";

/**
 * Fire-and-forget cache warmer: the client calls this the moment destination/dates are
 * submitted (before the user has picked interests or a tier), so the destination_context
 * cache is already populated by the time the real /api/itinerary generate call needs it.
 * The response body carries no data on purpose — callers don't await this before advancing.
 */
export async function POST(req: NextRequest) {
  const { destination, startDate, endDate } = await req.json();
  if (!destination || !startDate || !endDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  await getDestinationContextInsight(destination, startDate, endDate);
  return NextResponse.json({ ok: true });
}
