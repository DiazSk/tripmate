import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { insertTrip, listTrips } from "@/lib/db";

export async function GET() {
  const trips = listTrips().map((t) => ({
    id: t.id,
    destination: t.destination,
    startDate: t.start_date,
    endDate: t.end_date,
    budget: t.budget,
  }));
  return NextResponse.json({ trips });
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
