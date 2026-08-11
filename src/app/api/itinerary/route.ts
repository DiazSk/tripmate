import { NextRequest, NextResponse } from "next/server";
import { itineraryTimeoutMs, parseJsonResponse, runClaude } from "@/lib/claude";
import { geocodeDestination, getWeatherForDates, DayWeather } from "@/lib/weather";
import {
  buildGeneratePrompt,
  buildRebalancePrompt,
  buildRefinePrompt,
} from "@/lib/itineraryPrompt";
import { MAX_TRIP_DAYS, tripDays } from "@/lib/tiers";
import { normalizeDays } from "@/lib/itinerary";
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

  // These are contract failures, not things a traveller can act on, so they read
  // as one sentence rather than as a field name: the client validates before it
  // ever gets here, and anything that reaches this point is a bug or a raw POST.
  if (!destination) {
    return NextResponse.json({ error: "No destination was sent with the request." }, { status: 400 });
  }

  try {
    if (rebalance) {
      if (!Array.isArray(remainingDays) || typeof remainingBudget !== "number" || !tier) {
        return NextResponse.json(
          { error: "The request was missing the days or budget to rebalance." },
          { status: 400 }
        );
      }
      const prompt = buildRebalancePrompt({ destination, remainingDays, remainingBudget, tier });
      const { result: raw } = await runClaude(
        prompt,
        "rebalance",
        itineraryTimeoutMs(remainingDays.length)
      );
      const days = normalizeDays(parseJsonResponse<DayPlan[]>(raw));
      return NextResponse.json({ days });
    }

    if (!startDate || !endDate || typeof budget !== "number") {
      return NextResponse.json(
        { error: "The request was missing a destination, dates, or a budget." },
        { status: 400 }
      );
    }

    // The client enforces this too, but the cap exists because the prompt grows
    // with the day count — so it belongs on the side that builds the prompt.
    if (tripDays(startDate, endDate) > MAX_TRIP_DAYS) {
      return NextResponse.json(
        { error: `Trips longer than ${MAX_TRIP_DAYS} days aren't supported yet.` },
        { status: 400 }
      );
    }

    let prompt: string;
    let effectiveTier = tier;
    let dayCount: number;
    let weather: DayWeather[] = [];
    const isRefine = Boolean(previousItinerary && feedback);

    if (isRefine) {
      effectiveTier = previousItinerary.tier;
      dayCount = previousItinerary.days.length;
      prompt = buildRefinePrompt({ destination, startDate, endDate, budget, previousItinerary, feedback });
    } else {
      if (!tier) {
        return NextResponse.json({ error: "No spending style was selected." }, { status: 400 });
      }
      dayCount = tripDays(startDate, endDate);
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

    const { result: raw, traceId } = await runClaude(
      prompt,
      isRefine ? "refine" : "generate",
      itineraryTimeoutMs(dayCount)
    );
    // The model returns just { days: [...] } — tier is known server-side, not part of its output.
    const { days } = parseJsonResponse<{ days: Itinerary["days"] }>(raw);
    const itinerary: Itinerary = { tier: effectiveTier, days: normalizeDays(days) };

    // Attach the real forecast (not the model's free-text guess) to each day
    // by date, so the UI can render structured icon/temp/humidity data.
    const weatherByDate = new Map(weather.map((w) => [w.date, w]));
    for (const day of itinerary.days) {
      const detail = weatherByDate.get(day.date);
      if (detail) day.weatherDetail = detail;
    }

    return NextResponse.json({ itinerary, traceId });
  } catch (err) {
    // `runClaude` throws CLI timeouts and JSON parse failures. Those messages are
    // written for a developer reading a trace, not for someone waiting on a plan,
    // so the real one goes to the server log and the client gets a recovery step.
    console.error("[itinerary]", err);
    return NextResponse.json(
      { error: "The planner didn't finish. Try generating again." },
      { status: 500 }
    );
  }
}
