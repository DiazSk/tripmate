import { NextRequest, NextResponse } from "next/server";
import { getTrip } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trip = getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: trip.id,
    destination: trip.destination,
    startDate: trip.start_date,
    endDate: trip.end_date,
    budget: trip.budget,
    itinerary: JSON.parse(trip.itinerary_json),
  });
}
