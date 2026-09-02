import { randomUUID } from "crypto";
import { CRITIQUE_TIMEOUT_MS, itineraryTimeoutMs, parseJsonResponse, runClaude } from "./claude";
import { geocodeDestination, getWeatherForDates, DayWeather } from "./weather";
import { fetchPoiOsmTags, resolveNamedPlaceCoords } from "./poiDetails";
import { buildPlaceFacts } from "./placeFacts";
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
import { getDestinationContextInsight } from "./destinationContext";
import { insertGeneration, insertRun } from "./db";
import { llmMode } from "./llmConfig";
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
import { StreamingItineraryParser, type StreamedStop } from "./streamingItinerary";

/**
 * Where a streaming caller receives the plan as it is written. Absent for the plain-JSON
 * caller, and its absence is the switch: `runGeneration` streams stops, resolves coordinates
 * per day and moves critique off the critical path only when a sink is supplied. The JSON
 * route has no channel to deliver anything after its single response, so it keeps the
 * blocking order it has always had.
 */
export interface LiveSink {
  onStop(stop: StreamedStop): void;
  onDayCoords(dayIndex: number, coords: Record<string, { lat: number; lon: number }>): void;
  /** The plan is complete and interactive. Everything after this is a background improvement. */
  onPlan(result: { itinerary: Itinerary; traceId: string; runId: string; sessionId?: string }): void;
  /** Critique returned a corrected day set. The client decides whether to take it. */
  onRevised(revision: { days: Itinerary["days"]; issues: string[] }): void;
}

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
  onStage: (event: StageEvent) => void,
  live?: LiveSink
): Promise<{ itinerary: Itinerary; traceId: string; runId: string; sessionId?: string }> {
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
  /**
   * The exact argument object handed to the prompt builder — the "context/account payload" that
   * produced this plan, captured so it can be persisted beside the prompt and the response.
   *
   * Captured rather than reassembled afterwards. The two branches below feed different builders
   * from a spread of locals (the weather window, the resolved flags, the destination-context
   * insight), and a second pass that tried to rebuild it would be a second source of truth that
   * drifts the first time either branch gains a field.
   */
  let contextPayload: Record<string, unknown>;
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
    prompt = buildRefinePrompt((contextPayload = {
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
    }));
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
    prompt = buildGeneratePrompt((contextPayload = {
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
    }));
  }

  const parser = new StreamingItineraryParser();
  /** Stop names per day index, accumulated as they stream, so a day's coordinate lookup can be
   *  fired the moment that day closes. */
  const namesByDay = new Map<number, string[]>();
  /** Coordinates already resolved during the stream, merged across days and keyed by the
   *  trimmed stop name — the same key `resolveNamedPlaceCoords` returns. The `placing` sweep
   *  below skips anything already in here, which is what shrinks it from the whole trip to
   *  whatever the stream missed. */
  const streamedCoords: Record<string, { lat: number; lon: number }> = {};
  const pendingCoordLookups: Promise<unknown>[] = [];

  const onText = live
    ? (delta: string) => {
        // See Task 2's review: runClaude invokes this with no try/catch around it on either
        // transport, so a parse hiccup or a sink error here must degrade to "no live reveal
        // for this generation" rather than derailing the model call it is riding along with.
        try {
          const { stops, closedDays } = parser.feed(delta);
          for (const streamed of stops) {
            const names = namesByDay.get(streamed.dayIndex) ?? [];
            names.push(streamed.stop.name);
            namesByDay.set(streamed.dayIndex, names);
            live.onStop(streamed);
          }
          for (const dayIndex of closedDays) {
            const names = namesByDay.get(dayIndex) ?? [];
            // Nothing to place, or nowhere to place it from — a failed geocode leaves geoPoint
            // unset and the whole correction is skipped, exactly as the batched version already does.
            if (names.length === 0 || !geoPoint) continue;
            // Deliberately NOT awaited. This is a ~25s Overpass call and the parse it would block
            // is the feature; the whole set is awaited once, after generate, before the sweep.
            pendingCoordLookups.push(
              resolveNamedPlaceCoords(names, geoPoint)
                .then((coords) => {
                  Object.assign(streamedCoords, coords);
                  live.onDayCoords(dayIndex, coords);
                })
                // Fail-soft, per the house convention: a day whose lookup fails keeps the model's
                // coordinates and says nothing, which is what the batched call already did.
                .catch((err) => console.error("[itinerary] day coords lookup failed", err))
            );
          }
        } catch (err) {
          console.error("[itinerary] live stream onText failed", err);
        }
      }
    : undefined;

  onStage({ stage: "generate", status: "start" });
  // Persisted so the edit chat can resume THIS conversation rather than opening a fresh one —
  // the session the traveller goes on to refine through is the one that wrote their plan.
  // Only the generate call gets a session: critique/place-detail/context are internal passes the
  // traveller never talks to, and threading them through the same session would bury their chat
  // turns under machine traffic. See SessionOption in claude.ts for what this does not buy.
  const { result: raw, traceId, sessionId, model: servedBy } = await runClaude(
    prompt,
    isRefine ? "refine" : "generate",
    itineraryTimeoutMs(dayCount),
    { runId, session: { persist: true }, onText }
  );
  onStage({ stage: "generate", status: "done" });

  // The full input→output record, written the moment the model answers and **before** anything is
  // parsed. Order matters: a response that fails `parseJsonResponse` below is exactly the one worth
  // having on disk, and persisting after the parse would keep only the generations that already
  // worked. Best-effort for the same reason every other side-effect here is — a plan the traveller
  // is waiting on must not fail because a bookkeeping insert did.
  //
  // Not a `trips` row. This is a generation, not a kept trip; `save()` in HomeView still promotes
  // one to a trip, and `linkGenerationToTrip` back-fills `trip_id` when it does.
  try {
    insertGeneration({
      run_id: runId,
      trip_id: tripId ?? null,
      session_id: sessionId ?? null,
      kind: isRefine ? "refine" : "generate",
      destination,
      context_json: JSON.stringify(contextPayload),
      prompt,
      response: raw,
      model: servedBy,
      mode: llmMode(),
    });
  } catch (err) {
    console.error("[itinerary] generation record write failed", err);
  }

  // The model returns just { days: [...] } — tier is known server-side, not part of its output.
  const { days } = parseJsonResponse<{ days: Itinerary["days"] }>(raw);
  const itinerary: Itinerary = {
    tier: effectiveTier,
    days: normalizeDays(days),
  };

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
    // OSM matches by coordinate radius, not by name+destination, so look up each stop's own
    // lat/lng from the itinerary rather than passing `destination` through.
    const coordsByName = new Map<string, { lat: number; lng: number }>();
    for (const day of itinerary.days) {
      for (const stop of day.stops ?? []) {
        if (typeof stop.lat === "number" && typeof stop.lng === "number" && !coordsByName.has(stop.name)) {
          coordsByName.set(stop.name, { lat: stop.lat, lng: stop.lng });
        }
      }
    }
    // One batched Overpass call for every stop needing enrichment — matches poiEnrichment.ts's
    // shape — rather than one POST per stop, which used to fire N concurrent requests at a
    // public instance this repo already documents as flaky under load.
    const toFetch = names
      .filter((name) => coordsByName.has(name))
      .map((name) => ({ name, ...coordsByName.get(name)! }))
      .map(({ name, lat, lng }) => ({ name, lat, lon: lng }));
    const tagsByName = await fetchPoiOsmTags(toFetch);
    if (tagsByName) {
      for (const { name } of toFetch) {
        const facts = buildPlaceFacts(tagsByName[name]);
        if (facts) placeFacts.set(normalizeStopName(name), facts);
      }
    } // network/HTTP failure (tagsByName === null) — every requested stop stays unenriched
  } catch (err) {
    // Fail-soft: no facts means no annotations and no pinned costs, never a failed generation.
    console.error("[itinerary] place-facts lookup failed", err);
  }
  const placeConflicts = detectConflicts(itinerary.days, placeFacts, { stepFreeRequired, crowdBias });

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

  // Attach the real forecast (not the model's free-text guess) to each day by date, so the UI
  // can render structured icon/temp/humidity data. Declared here, above finalizeDays, so the
  // helper can close over it.
  const weatherByDate = new Map(weather.map((w) => [w.date, w]));

  /**
   * Everything that turns a raw day set into a renderable one: conflict detection against the
   * place facts, admission costs, book-ahead notes, verified dietary notes and the real forecast.
   *
   * One function rather than two call sites, because it now runs twice on a streaming run —
   * once on the plan the traveller starts reading and again on whatever critique returns. Two
   * copies of these rules is how the second one silently stops matching the first.
   */
  const finalizeDays = (target: Itinerary["days"]): void => {
    const conflicts = detectConflicts(target, placeFacts, { stepFreeRequired, crowdBias });
    annotateConflicts(target, conflicts);
    pinAdmissionCosts(target, placeFacts);
    annotateBookAhead(target, placeFacts);
    for (const day of target) {
      for (const stop of day.stops ?? []) {
        const note = dietaryNote(dietaryByStop.get(normalizeStopName(stop.name)) ?? null);
        if (note && !stop.note?.includes(note)) {
          stop.note = stop.note ? `${stop.note} ${note}` : note;
        }
      }
      const detail = weatherByDate.get(day.date);
      if (detail) day.weatherDetail = detail;
    }
  };

  // Reuses the §12a/§12b arithmetic and phrasing in guardrails.ts rather than restating it.
  // No real door-to-door durations are available (the OSRM route-matrix path was removed — it
  // was unreachable dead code, since this app never requests drive mode and OSRM's demo instance
  // cannot serve real walking data), so this always runs on the haversine estimate.
  const travelFindings = evaluateItinerary(itinerary)
    .filter((g) => g.rule === "travel")
    .map((g) => g.message)
    .concat(dietaryFindings);

  // Correct the model's coordinates against OSM. It writes lat/lng from memory and is often
  // badly wrong (measured: Fushimi Inari 11km off, Nishiki Market 3km), which lands map pins in
  // the wrong part of the city. Names it resolves get real positions; anything unmatched keeps
  // the model's guess, and the whole step is skipped if Overpass is unreachable.
  //
  // Wrapped in a function, not inlined, so both the plain-JSON and streaming branches below can
  // call it at the point in their own sequence where it belongs — before returning for JSON,
  // before handing the plan to the traveller for streaming.
  const placeStops = async (): Promise<void> => {
    if (geoPoint) {
      onStage({ stage: "placing", status: "start" });
      try {
        // Settle whatever the stream started. `allSettled`, not `all`: each lookup already
        // swallows its own failure, and one that somehow rejects must not skip the sweep.
        await Promise.allSettled(pendingCoordLookups);
        const allStops = itinerary.days.flatMap((d) => d.stops);
        // Only the names the stream never resolved. On a streaming run this is usually empty or
        // near it, so the stage that used to be a ~25s whole-trip Overpass call becomes a sweep
        // for the leftovers. On a plain-JSON run nothing streamed, so this is the whole trip and
        // the behaviour is exactly what it was before.
        const unresolved = allStops
          .map((s) => s.name.trim())
          .filter((name) => !(name in streamedCoords));
        const resolved = unresolved.length
          ? await resolveNamedPlaceCoords(unresolved, geoPoint)
          : {};
        const all = { ...streamedCoords, ...resolved };
        for (const stop of allStops) {
          const fixed = all[stop.name.trim()];
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
  };

  // Best-effort QA pass: checks budget/timing/context usage and swaps in a corrected day set if
  // it finds issues. Never fails the request — a broken critique call just leaves whichever day
  // set it was handed in place.
  const runCritique = async (): Promise<{ days: Itinerary["days"]; issues: string[] } | null> => {
    onStage({ stage: "critique", status: "start" });
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
      onStage({ stage: "critique", status: "done" });
      return critique.revisedDays
        ? { days: critique.revisedDays, issues: critique.issues ?? [] }
        : null;
    } catch {
      // `failed`, not `done` and not `skipped` — the pass really did consume its budget, and
      // critique is alone in its display group, so a skip would collapse to "Checking it over —
      // done" about a review that never ran. See generationStages.ts.
      onStage({ stage: "critique", status: "failed" });
      return null;
    }
  };

  if (!live) {
    // Plain-JSON caller: one response, so critique has to land before it. Unchanged order.
    const revision = await runCritique();
    if (revision) itinerary.days = revision.days;
    finalizeDays(itinerary.days);
    await placeStops();
    return { itinerary, traceId, runId, sessionId };
  }

  // Streaming caller: finish the plan the traveller is watching, hand it over, and only then
  // spend the ~150s critique costs. This is the halving — interactive at ~160s rather than ~310s.
  finalizeDays(itinerary.days);
  await placeStops();
  live.onPlan({ itinerary, traceId, runId, sessionId });

  const revision = await runCritique();
  if (revision) {
    finalizeDays(revision.days);
    live.onRevised({ days: revision.days, issues: revision.issues });
    itinerary.days = revision.days;
  }
  return { itinerary, traceId, runId, sessionId };
}

