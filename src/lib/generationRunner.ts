import { randomUUID } from "crypto";
import { CRITIQUE_TIMEOUT_MS, itineraryTimeoutMs, parseJsonResponse, runClaude } from "./claude";
import { geocodeDestination, getWeatherForDates, DayWeather } from "./weather";
import { resolveNamedPlaceCoords } from "./poiDetails";
import { fetchLodgingOptions, reconcileLodging } from "./lodging";
import { fetchPlaceFacts } from "./placeFacts";
import { fetchDayTravelMinutes } from "./routeMatrix";
import {
  dietaryNote,
  fetchDietaryVenues,
  noOptionsFinding,
  searchableCategories,
} from "./dietaryVenues";
import type { DietaryVenue } from "./dietaryVenues";
import { evaluateItinerary } from "./guardrails";
import type { PlaceFacts } from "./placeFacts";
import {
  annotateBookAhead,
  annotateConflicts,
  detectConflicts,
  normalizeStopName,
  pinAdmissionCosts,
  selectStopsToEnrich,
} from "./placeConflicts";
import type { LodgingOption } from "./lodging";
import { getDestinationContextInsight } from "./destinationContext";
import { insertRun } from "./db";
import { buildCritiquePrompt, buildGeneratePrompt, buildRefinePrompt } from "./itineraryPrompt";
import { normalizeDays } from "./itinerary";
import { tripDays, TierId } from "./tiers";
import { deriveFlags, sanitizeLogistics } from "./userAnswers";
import {
  CritiqueResult,
  Itinerary,
  ItineraryPreferences,
  ResolvedFlags,
  TripLogistics,
  UserAnswers,
} from "./types";
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
  // Stays null for refine (no search runs there) and for a failed/empty lookup — both are
  // no-ops for `reconcileLodging` below, so nothing else needs to branch on isRefine for this.
  let lodgingOptions: LodgingOption[] | null = null;
  const isRefine = Boolean(previousItinerary && feedback);

  // The wizard has always sent these; the route simply never read them, so six
  // screens of answers were collected and discarded. Malformed input is treated
  // as absent rather than fatal — a bad shape must not fail a generation that is
  // otherwise fine, and the prompt is unchanged when this is null.
  let resolvedFlags: ResolvedFlags | null = null;
  let logistics: TripLogistics | null = null;
  const stepFreeRequired =
    (userAnswers as UserAnswers | undefined)?.accessibility?.stepFreeRequired === true;
  // Raw preference, not the derived CrowdBias flags object — detectConflicts only needs to know
  // whether this traveler wants busy hours flagged at all.
  const crowdBias = (userAnswers as UserAnswers | undefined)?.crowds;
  if (userAnswers) {
    try {
      resolvedFlags = deriveFlags(userAnswers as UserAnswers);
      logistics = sanitizeLogistics((userAnswers as UserAnswers).logistics);
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
      logistics,
    });
  } else {
    if (!tier) {
      // route.ts already validated tier is present whenever isRefine is false; this
      // exists purely so TypeScript can narrow tier from optional to required below.
      throw new Error("Missing tier for a non-refine generation.");
    }
    effectiveTier = tier;
    dayCount = tripDays(startDate, endDate);
    // Started here and awaited just before the prompt is built, so its ~6s overlaps the
    // geocode/weather/context work below instead of stacking on top of it. The hotel search
    // takes a text query, so unlike the weather it does not depend on the geocode's result.
    // `.catch` keeps a surprise rejection on the fail-soft path: no lodging data degrades to
    // the type-first instruction, it never fails the generation.
    const lodgingPromise = fetchLodgingOptions({
      destination,
      checkIn: startDate,
      checkOut: endDate,
      tier,
      adults: resolvedFlags?.partySize ?? undefined,
    }).catch(() => null);
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
    // skipped *because* the first failed.
    //
    // Deliberately still `skipped` and not `failed`, now that the two are distinct. Two reasons,
    // and the first is the one that matters: geocode shares the "Reading the place" group with
    // `context`, which reports real state either way — so nothing is laundered here. That is
    // exactly what was NOT true of critique, which is alone in its group. Second, CLAUDE.md is
    // explicit that a geocoding miss is non-blocking by design and must not read as "the app is
    // broken"; surfacing it as a failure to a traveller would do that for something the plan
    // recovers from on its own.
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
      logistics,
      lodging: (lodgingOptions = await lodgingPromise),
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

  // Look up real listings for the stops where the answer can change the plan, then check the
  // schedule against them. Selective on purpose: a call per stop put one 44-stop trip at ~91
  // metered calls in the Phase 0 spike, so only "entry" stops qualify — plus every stop when
  // step-free access is required, because §9e outranks the cost control.
  //
  // Fetched once, here, and reused after critique. Critique can rewrite the day set, but
  // re-fetching against its output would double the spend for stops that are mostly the same;
  // anything it newly invents simply has no facts and is left alone.
  const placeFacts = new Map<string, PlaceFacts>();
  try {
    const names = selectStopsToEnrich(itinerary.days, { stepFreeRequired });
    const fetched = await Promise.all(
      names.map(async (name) => [name, await fetchPlaceFacts(name, destination)] as const)
    );
    for (const [name, facts] of fetched) {
      if (facts) placeFacts.set(normalizeStopName(name), facts);
    }
  } catch (err) {
    // Fail-soft: no facts means no annotations and no pinned costs, never a failed generation.
    console.error("[itinerary] place-facts lookup failed", err);
  }
  const placeConflicts = detectConflicts(itinerary.days, placeFacts, { stepFreeRequired, crowdBias });

  // Real door-to-door durations, one matrix call per day — the whole N×N comes back in a single
  // call (~3s), so this is per-day, not per-leg. Keyed by coordinate pair rather than by stop
  // position: critique may reorder the day, and a leg that no longer exists must fall back to the
  // estimate rather than reporting a stale number.
  const realLegMinutes = new Map<string, number>();
  try {
    await Promise.all(
      itinerary.days.map(async (day) => {
        const points = (day.stops ?? [])
          .filter((s) => typeof s.lat === "number" && typeof s.lng === "number")
          .map((s) => ({ lat: s.lat, lon: s.lng }));
        const legs = await fetchDayTravelMinutes(points, "walk");
        for (const leg of legs.values()) {
          const from = points[leg.fromIndex];
          const to = points[leg.toIndex];
          if (from && to) realLegMinutes.set(legKey(from, to), leg.minutes);
        }
      })
    );
  } catch (err) {
    // Fail-soft: no real durations means the existing straight-line estimate still applies.
    console.error("[itinerary] route-matrix lookup failed", err);
  }

  // §3d is a hard constraint, but only once something was stated — a traveler with no
  // restrictions costs zero calls here and gets a byte-identical plan. The model currently asserts
  // what an area contains ("several vegan places along the arcade"); this checks it.
  const dietaryByStop = new Map<string, DietaryVenue[]>();
  const dietaryFindings: string[] = [];
  if (searchableCategories(dietary ?? null).length > 0) {
    try {
      const foodStops = itinerary.days.flatMap((day) =>
        (day.stops ?? [])
          .filter((stop) => stop.category === "food" && typeof stop.lat === "number")
          .map((stop) => ({ date: day.date, stop }))
      );
      await Promise.all(
        foodStops.map(async ({ date, stop }) => {
          const venues = await fetchDietaryVenues({ lat: stop.lat, lon: stop.lng }, dietary ?? null);
          if (venues === null) return; // lookup failed — say nothing rather than imply a check
          if (venues.length === 0) {
            dietaryFindings.push(noOptionsFinding(stop.name, date));
            return;
          }
          dietaryByStop.set(normalizeStopName(stop.name), venues);
        })
      );
    } catch (err) {
      console.error("[itinerary] dietary venue lookup failed", err);
    }
  }

  // Reuses the §12a/§12b arithmetic and phrasing in guardrails.ts rather than restating it,
  // substituting looked-up minutes where a route was found.
  const travelFindings = evaluateItinerary(itinerary, {
    realMinutes: (from, to) =>
      realLegMinutes.get(legKey({ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng })) ??
      null,
  })
    .filter((g) => g.rule === "travel")
    .map((g) => g.message)
    .concat(dietaryFindings);

  // Best-effort QA pass: checks budget/timing/context usage and swaps in a
  // corrected day set if it finds issues. Never fails the request — a
  // broken critique call just leaves the original itinerary in place.
  onStage({ stage: "critique", status: "start" });
  let critiqued = false;
  try {
    const critiquePrompt = buildCritiquePrompt({
      itinerary,
      budget,
      contextInsight,
      interestTags: preferences?.tags,
      resolvedFlags,
      dietary,
      placeConflicts,
      travelFindings,
    });
    const { result: critiqueRaw } = await runClaude(critiquePrompt, "critique", CRITIQUE_TIMEOUT_MS, {
      runId,
    });
    const critique = parseJsonResponse<CritiqueResult>(critiqueRaw);
    if (critique.revisedDays) {
      itinerary.days = critique.revisedDays;
    }
    critiqued = true;
  } catch {
    // Keep the uncritiqued itinerary.
  }

  // Deterministic backstop, run AFTER critique rather than before it. It has to be: critique's
  // own prompt independently re-derives the 85-100% budget target with zero knowledge of the
  // real lodging list, the pricing basis, or the overshoot escape, and can replace
  // `itinerary.days` wholesale via `revisedDays` — verified live, this is exactly how the
  // invented-hotel defect reappeared after generate's own output had already been corrected.
  // Running the check here, on whatever `itinerary.days` ends up being, is the one point both
  // paths (revised or not) converge on — the fix belongs where the callers join, not duplicated
  // before each one. A no-op when `lodgingOptions` is null/empty (refine, or the lookup
  // failed/found nothing) — nothing to check the name against.
  for (const day of itinerary.days) {
    if (day.lodging) day.lodging = reconcileLodging(day.lodging, lodgingOptions, budget);
  }

  // Re-detect against whatever critique actually returned, then annotate and pin. Re-detection
  // matters: if critique moved the Louvre off its closed Tuesday, the original conflict no longer
  // applies and annotating it would warn about a problem that is fixed. Annotation is the floor —
  // critique fails ~35% of the time, and the traveler still needs to know.
  const finalConflicts = detectConflicts(itinerary.days, placeFacts, { stepFreeRequired, crowdBias });
  annotateConflicts(itinerary.days, finalConflicts);
  pinAdmissionCosts(itinerary.days, placeFacts);
  annotateBookAhead(itinerary.days, placeFacts);

  // Replaces the model's unverified claim about an area with names that were actually looked up.
  for (const day of itinerary.days) {
    for (const stop of day.stops ?? []) {
      const note = dietaryNote(dietaryByStop.get(normalizeStopName(stop.name)) ?? null);
      if (note && !stop.note?.includes(note)) {
        stop.note = stop.note ? `${stop.note} ${note}` : note;
      }
    }
  }
  // `failed`, not `done` and not `skipped`, when the pass didn't actually run.
  //
  // `done` either way was the original bug: a 35% critique failure rate went unnoticed because
  // the trip still arrived, just without the budget/timing review, and the loader said the
  // review had happened. That was fixed to `skipped` — which was still wrong, and wrong in a way
  // that looked right. The claim at the time was that `skipped` was "already in the vocabulary
  // and the strip already renders it distinctly, so honesty here needs no new UI". The strip does
  // not: `stepGroupState` collapses a group whose every stage was skipped to `done`, because for
  // refine that is correct (geocode and placing genuinely never needed doing). Critique is ALONE
  // in the "Checking it over" group, so skipping it emptied the group and the traveller was told
  // "Checking it over — done" about a review that had timed out. Two failure modes, one value.
  //
  // `failed` also carries the right weight semantics: unlike a skip, this stage really did burn
  // its budget (up to CRITIQUE_TIMEOUT_MS), so generationProgress counts it as time spent.
  onStage({ stage: "critique", status: critiqued ? "done" : "failed" });

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

/** Key a leg by rounded coordinates. Rounding matters: the model emits lat/lng at varying
 *  precision, and keying on raw floats would miss pairs that are the same place. */
function legKey(a: { lat: number; lon: number }, b: { lat: number; lon: number }): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(a.lat)},${r(a.lon)}->${r(b.lat)},${r(b.lon)}`;
}
