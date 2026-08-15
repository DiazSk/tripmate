import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_TIMEOUT_MS, itineraryTimeoutMs, parseJsonResponse, runClaude } from "@/lib/claude";
import { geocodeDestination, getWeatherForDates, DayWeather } from "@/lib/weather";
import { resolveNamedPlaceCoords } from "@/lib/poiDetails";
import { getDestinationContextInsight } from "@/lib/destinationContext";
import { insertRun } from "@/lib/db";
import {
  buildCritiquePrompt,
  buildGeneratePrompt,
  buildRebalancePrompt,
  buildRefinePrompt,
} from "@/lib/itineraryPrompt";
import { normalizeDays } from "@/lib/itinerary";
import { MAX_TRIP_DAYS, tripDays } from "@/lib/tiers";
import { CritiqueResult, DayPlan, Itinerary } from "@/lib/types";

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
    preferences,
    rebalance,
    remainingDays,
    remainingBudget,
    tripId,
  } = body;

  // These are contract failures, not things a traveller can act on, so they read as one
  // sentence rather than as a field name: the client validates before it ever gets here,
  // and anything that reaches this point is a bug or a raw POST.
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
      // Its own run, never merged into the trip's original generation run:
      // rebalance fires on a separate later user action (possibly days after
      // generation) and produces/persists new days, unlike place-detail's
      // read-only enrichment of an already-generated pipeline — folding it
      // into the original run would make that run's total duration and step
      // sequence meaningless.
      const runId = randomUUID();
      insertRun({ id: runId, kind: "rebalance", destination, tripId: tripId ?? null });
      const prompt = buildRebalancePrompt({ destination, remainingDays, remainingBudget, tier });
      const { result: raw } = await runClaude(
        prompt,
        "rebalance",
        itineraryTimeoutMs(remainingDays.length),
        { runId }
      );
      const days = normalizeDays(parseJsonResponse<DayPlan[]>(raw));
      return NextResponse.json({ days, runId });
    }

    if (!startDate || !endDate || typeof budget !== "number") {
      return NextResponse.json(
        { error: "The request was missing a destination, dates, or a budget." },
        { status: 400 }
      );
    }

    // The client enforces this too, but the cap exists because the prompt grows with the
    // day count — so it belongs on the side that builds the prompt.
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
    let geoPoint: { lat: number; lon: number } | null = null;
    const isRefine = Boolean(previousItinerary && feedback);

    const runId = randomUUID();
    insertRun({
      id: runId,
      kind: isRefine ? "refine" : "generate",
      destination,
      tripId: tripId ?? null,
    });

    // Kicked off before the geocode/weather work below so it runs concurrently
    // with it rather than adding its latency on top.
    const contextInsightPromise = getDestinationContextInsight(
      destination,
      startDate,
      endDate,
      runId
    );
    let contextInsight: string;

    if (isRefine) {
      effectiveTier = previousItinerary.tier;
      dayCount = previousItinerary.days.length;
      contextInsight = await contextInsightPromise;
      prompt = buildRefinePrompt({
        destination,
        startDate,
        endDate,
        budget,
        previousItinerary,
        feedback,
        contextInsight,
      });
    } else {
      if (!tier) {
        return NextResponse.json({ error: "No spending style was selected." }, { status: 400 });
      }
      dayCount = tripDays(startDate, endDate);
      try {
        const geo = await geocodeDestination(destination);
        if (geo) {
          geoPoint = { lat: geo.lat, lon: geo.lon };
          weather = await getWeatherForDates(geo.lat, geo.lon, startDate, endDate);
        }
      } catch {
        weather = [];
      }
      contextInsight = await contextInsightPromise;
      prompt = buildGeneratePrompt({
        destination,
        startDate,
        endDate,
        budget,
        tier,
        weather,
        preferences,
        contextInsight,
      });
    }

    const { result: raw, traceId } = await runClaude(
      prompt,
      isRefine ? "refine" : "generate",
      itineraryTimeoutMs(dayCount),
      { runId }
    );
    // The model returns just { days: [...] } — tier is known server-side, not part of its output.
    const { days } = parseJsonResponse<{ days: Itinerary["days"] }>(raw);
    const itinerary: Itinerary = { tier: effectiveTier, days: normalizeDays(days) };

    // Best-effort QA pass: checks budget/timing/context usage and swaps in a
    // corrected day set if it finds issues. Never fails the request — a
    // broken critique call just leaves the original itinerary in place.
    try {
      const critiquePrompt = buildCritiquePrompt({
        itinerary,
        budget,
        contextInsight,
        interestTags: preferences?.tags,
      });
      const { result: critiqueRaw } = await runClaude(critiquePrompt, "critique", DEFAULT_TIMEOUT_MS, {
        runId,
      });
      const critique = parseJsonResponse<CritiqueResult>(critiqueRaw);
      if (critique.revisedDays) {
        itinerary.days = critique.revisedDays;
      }
    } catch {
      // Keep the uncritiqued itinerary.
    }

    // Attach the real forecast (not the model's free-text guess) to each day
    // by date, so the UI can render structured icon/temp/humidity data.
    const weatherByDate = new Map(weather.map((w) => [w.date, w]));
    for (const day of itinerary.days) {
      const detail = weatherByDate.get(day.date);
      if (detail) day.weatherDetail = detail;
    }

    // Correct the model's coordinates against OSM. It writes lat/lng from memory and is often
    // badly wrong (measured: Fushimi Inari 11km off, Nishiki Market 3km), which lands map pins in
    // the wrong part of the city. Names it resolves get real positions; anything unmatched keeps
    // the model's guess, and the whole step is skipped if Overpass is unreachable.
    if (geoPoint) {
      try {
        const allStops = itinerary.days.flatMap((d) => d.stops);
        const resolved = await resolveNamedPlaceCoords(
          allStops.map((s) => s.name),
          geoPoint
        );
        for (const stop of allStops) {
          const fixed = resolved[stop.name.trim()];
          if (fixed) {
            stop.lat = fixed.lat;
            stop.lng = fixed.lon;
          }
        }
      } catch {
        // Keep the model's coordinates.
      }
    }

    return NextResponse.json({ itinerary, traceId, runId });
  } catch (err) {
    // `runClaude` throws CLI timeouts and JSON parse failures. Those messages are written
    // for a developer reading a trace, not for someone waiting on a plan, so the real one
    // goes to the server log and the client gets a recovery step.
    console.error("[itinerary]", err);
    return NextResponse.json(
      { error: "The planner didn't finish. Try generating again." },
      { status: 500 }
    );
  }
}
