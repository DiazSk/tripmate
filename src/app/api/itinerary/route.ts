import { NextRequest, NextResponse } from "next/server";
import { parseJsonResponse, runClaude } from "@/lib/claude";
import { geocodeDestination, getWeatherForDates, DayWeather } from "@/lib/weather";
import {
  buildGeneratePrompt,
  buildRebalancePrompt,
  buildRefinePrompt,
} from "@/lib/itineraryPrompt";
import { DayPlan, Itinerary } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    destination,
    startDate,
    endDate,
    budget,
    tier,
    previousItinerary,
    feedback,
    rebalance,
    remainingDays,
    remainingBudget,
  } = body;

  if (!destination) {
    return NextResponse.json({ error: "Missing destination" }, { status: 400 });
  }

  try {
    if (rebalance) {
      if (!Array.isArray(remainingDays) || typeof remainingBudget !== "number" || !tier) {
        return NextResponse.json({ error: "Missing rebalance fields" }, { status: 400 });
      }
      const prompt = buildRebalancePrompt({ destination, remainingDays, remainingBudget, tier });
      const raw = await runClaude(prompt);
      const days = parseJsonResponse<DayPlan[]>(raw);
      return NextResponse.json({ days });
    }

    if (!startDate || !endDate || typeof budget !== "number") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    let prompt: string;
    let effectiveTier = tier;
    if (previousItinerary && feedback) {
      effectiveTier = previousItinerary.tier;
      prompt = buildRefinePrompt({ destination, startDate, endDate, budget, previousItinerary, feedback });
    } else {
      if (!tier) {
        return NextResponse.json({ error: "Missing tier" }, { status: 400 });
      }
      let weather: DayWeather[] = [];
      try {
        const geo = await geocodeDestination(destination);
        if (geo) {
          weather = await getWeatherForDates(geo.lat, geo.lon, startDate, endDate);
        }
      } catch {
        weather = [];
      }
      prompt = buildGeneratePrompt({ destination, startDate, endDate, budget, tier, weather });
    }

    const raw = await runClaude(prompt);
    // The model returns just { days: [...] } — tier is known server-side, not part of its output.
    const { days } = parseJsonResponse<{ days: Itinerary["days"] }>(raw);
    const itinerary: Itinerary = { tier: effectiveTier, days };

    return NextResponse.json({ itinerary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Itinerary generation failed" },
      { status: 500 }
    );
  }
}
