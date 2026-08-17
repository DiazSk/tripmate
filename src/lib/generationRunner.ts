import { randomUUID } from "crypto";
import { DEFAULT_TIMEOUT_MS, itineraryTimeoutMs, parseJsonResponse, runClaude } from "./claude";
import { geocodeDestination, getWeatherForDates, DayWeather } from "./weather";
import { resolveNamedPlaceCoords } from "./poiDetails";
import { getDestinationContextInsight } from "./destinationContext";
import { insertRun } from "./db";
import { buildCritiquePrompt, buildGeneratePrompt, buildRefinePrompt } from "./itineraryPrompt";
import { normalizeDays } from "./itinerary";
import { tripDays, TierId } from "./tiers";
import { deriveFlags } from "./userAnswers";
import { CritiqueResult, Itinerary, ItineraryPreferences, ResolvedFlags, UserAnswers } from "./types";
import { StageEvent } from "./generationStages";
import type { DietaryNeeds } from "./travelerProfile";

export interface GenerationParams {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  tier?: TierId;
  previousItinerary?: Itinerary;
  feedback?: string;
  preferences?: ItineraryPreferences | null;
  tripId?: string | null;
  userAnswers?: unknown;
  dietary?: DietaryNeeds | null;
}

/**
 * The generate/refine body of `POST /api/itinerary`, extracted so both the plain-JSON
 * response and the SSE-streamed response (route.ts) run this exact same logic — the one
 * genuine structural requirement of the streaming design: a second copy behind a flag
 * would drift the moment either was edited. `onStage` fires at each of the five real steps
 * (see generationStages.ts); the JSON caller passes a no-op, the streaming caller writes
 * real frames.
 */
export async function runGeneration(
  params: GenerationParams,
  onStage: (event: StageEvent) => void
): Promise<{ itinerary: Itinerary; traceId: string; runId: string }> {
  const {
    destination,
    startDate,
    endDate,
    budget,
    tier,
    previousItinerary,
    feedback,
    preferences,
    tripId,
    userAnswers,
    dietary,
  } = params;

  let prompt: string;
  let effectiveTier: TierId;
  let dayCount: number;
  let weather: DayWeather[] = [];
  let geoPoint: { lat: number; lon: number } | null = null;
  const isRefine = Boolean(previousItinerary && feedback);

  // The wizard has always sent these; the route simply never read them, so six
  // screens of answers were collected and discarded. Malformed input is treated
  // as absent rather than fatal — a bad shape must not fail a generation that is
  // otherwise fine, and the prompt is unchanged when this is null.
  let resolvedFlags: ResolvedFlags | null = null;
  if (userAnswers) {
    try {
      resolvedFlags = deriveFlags(userAnswers as UserAnswers);
    } catch (err) {
      console.error("[itinerary] ignoring malformed userAnswers", err);
    }
  }

  const runId = randomUUID();
  insertRun({
    id: runId,
    kind: isRefine ? "refine" : "generate",
    destination,
    tripId: tripId ?? null,
  });

  // Kicked off before the geocode/weather work below so it runs concurrently
  // with it rather than adding its latency on top.
  onStage({ stage: "context", status: "start" });
  const contextInsightPromise = getDestinationContextInsight(destination, startDate, endDate, runId);
  let contextInsight: string;

  if (isRefine) {
    // Refine reuses the previous itinerary's coordinates and tier — there is nothing to
    // geocode or re-place, so both stages are reported skipped rather than left pending.
    onStage({ stage: "geocode", status: "skipped" });
    if (!previousItinerary || !feedback) {
      // isRefine's own Boolean(...) check already guarantees this at runtime; the guard
      // exists only so TypeScript can narrow these from optional to required below.
      throw new Error("Refine requires both a previous itinerary and feedback.");
    }
    effectiveTier = previousItinerary.tier;
    dayCount = previousItinerary.days.length;
    contextInsight = await contextInsightPromise;
    onStage({ stage: "context", status: "done" });
    prompt = buildRefinePrompt({
      destination,
      startDate,
      endDate,
      budget,
      previousItinerary,
      feedback,
      contextInsight,
      resolvedFlags,
      dietary,
    });
  } else {
    if (!tier) {
      // route.ts already validated tier is present whenever isRefine is false; this
      // exists purely so TypeScript can narrow tier from optional to required below.
      throw new Error("Missing tier for a non-refine generation.");
    }
    effectiveTier = tier;
    dayCount = tripDays(startDate, endDate);
    onStage({ stage: "geocode", status: "start" });
    try {
      const geo = await geocodeDestination(destination);
      if (geo) {
        geoPoint = { lat: geo.lat, lon: geo.lon };
        weather = await getWeatherForDates(geo.lat, geo.lon, startDate, endDate);
      }
    } catch {
      weather = [];
    }
    // A failed (or null-result) geocode leaves `geoPoint` unset, and `placing` below already
    // reports `skipped` in that case — reporting `done` here would sit a green "Locating" dot
    // next to a skipped "Placing" one, implying the two are unrelated when the second is
    // skipped *because* the first failed. `skipped` is reused rather than adding a fourth
    // status: three already cover everything the loader renders, and a new one would touch
    // the shared vocabulary, both consumers, and the dot rendering for no visible difference.
    onStage({ stage: "geocode", status: geoPoint ? "done" : "skipped" });
    contextInsight = await contextInsightPromise;
    onStage({ stage: "context", status: "done" });
    prompt = buildGeneratePrompt({
      destination,
      startDate,
      endDate,
      budget,
      tier,
      weather,
      preferences,
      contextInsight,
      resolvedFlags,
      dietary,
    });
  }

  onStage({ stage: "generate", status: "start" });
  const { result: raw, traceId } = await runClaude(
    prompt,
    isRefine ? "refine" : "generate",
    itineraryTimeoutMs(dayCount),
    { runId }
  );
  onStage({ stage: "generate", status: "done" });
  // The model returns just { days: [...] } — tier is known server-side, not part of its output.
  const { days } = parseJsonResponse<{ days: Itinerary["days"] }>(raw);
  const itinerary: Itinerary = { tier: effectiveTier, days: normalizeDays(days) };

  // Best-effort QA pass: checks budget/timing/context usage and swaps in a
  // corrected day set if it finds issues. Never fails the request — a
  // broken critique call just leaves the original itinerary in place.
  onStage({ stage: "critique", status: "start" });
  try {
    const critiquePrompt = buildCritiquePrompt({
      itinerary,
      budget,
      contextInsight,
      interestTags: preferences?.tags,
      resolvedFlags,
      dietary,
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
  onStage({ stage: "critique", status: "done" });

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
    onStage({ stage: "placing", status: "start" });
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
    onStage({ stage: "placing", status: "done" });
  } else {
    onStage({ stage: "placing", status: "skipped" });
  }

  return { itinerary, traceId, runId };
}
