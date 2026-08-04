import { NextRequest, NextResponse } from "next/server";
import { parseJsonResponse, runClaude } from "@/lib/claude";
import { geocodeDestination, getWeatherForDates, DayWeather } from "@/lib/weather";
import { buildGeneratePrompt, buildRefinePrompt } from "@/lib/itineraryPrompt";
import { Itinerary } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { destination, startDate, endDate, budget, previousItinerary, feedback } = body;

  if (!destination || !startDate || !endDate || typeof budget !== "number") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    let weather: DayWeather[] = [];
    try {
      const geo = await geocodeDestination(destination);
      if (geo) {
        weather = await getWeatherForDates(geo.lat, geo.lon, startDate, endDate);
      }
    } catch {
      weather = [];
    }

    const prompt =
      previousItinerary && feedback
        ? buildRefinePrompt({ destination, startDate, endDate, budget, previousItinerary, feedback })
        : buildGeneratePrompt({ destination, startDate, endDate, budget, weather });

    const raw = await runClaude(prompt);
    const itinerary = parseJsonResponse<Itinerary>(raw);

    return NextResponse.json({ itinerary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Itinerary generation failed" },
      { status: 500 }
    );
  }
}
