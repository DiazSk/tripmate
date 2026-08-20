import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { insertTrip, listTrips } from "@/lib/db";
import { toTripSummary } from "@/lib/tripPayload";

export async function GET() {
  return NextResponse.json({ trips: listTrips().map(toTripSummary) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { destination, startDate, endDate, budget, itinerary, runId, userAnswers } = body;

  if (!destination || !startDate || !endDate || typeof budget !== "number" || !itinerary) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const trip = insertTrip({
    id: randomUUID(),
    destination,
    start_date: startDate,
    end_date: endDate,
    budget,
    itinerary_json: JSON.stringify(itinerary),
    run_id: runId ?? null,
    user_answers_json: userAnswers ? JSON.stringify(userAnswers) : null,
  });

  return NextResponse.json({ id: trip.id });
}
