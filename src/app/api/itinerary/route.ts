import { NextRequest, NextResponse } from "next/server";
import { parseJsonResponse, runClaude } from "@/lib/claude";
import { geocodeDestination, getWeatherForDates, DayWeather } from "@/lib/weather";
import { buildGeneratePrompt, buildRefinePrompt } from "@/lib/itineraryPrompt";
import { Itinerary } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { destination, startDate, endDate, budget, previousItinerary, feedback, preferences } = body;

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

    const isRefine = Boolean(previousItinerary && feedback);
    const prompt = isRefine
      ? buildRefinePrompt({ destination, startDate, endDate, budget, previousItinerary, feedback })
      : buildGeneratePrompt({ destination, startDate, endDate, budget, weather, preferences });

    const { result: raw, traceId } = await runClaude(prompt, isRefine ? "refine" : "generate");
    const itinerary = parseJsonResponse<Itinerary>(raw);

    // Attach the real forecast (not the model's free-text guess) to each day
    // by date, so the UI can render structured icon/temp/humidity data.
    const weatherByDate = new Map(weather.map((w) => [w.date, w]));
    for (const day of itinerary.days) {
      const detail = weatherByDate.get(day.date);
      if (detail) day.weatherDetail = detail;
    }

    return NextResponse.json({ itinerary, traceId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Itinerary generation failed" },
      { status: 500 }
    );
  }
}
