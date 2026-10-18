import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runClaude } from "@/lib/claude";
import { cheapModel } from "@/lib/llmConfig";
import { throttle } from "@/lib/ipThrottle";
import { capResponse, limitResponse } from "@/lib/limitResponse";
import { dailyCapResumesAt } from "@/lib/spendCap";
import { geocodeAnchors } from "@/lib/anchorGeocode";
import { fetchAnchorHours } from "@/lib/anchorHours";
import { fetchPoiOsmTags } from "@/lib/poiDetails";
import { geocodeDestinationCached } from "@/lib/serverFetchCached";
import { getWeatherForDates } from "@/lib/weather";
import {
  assembleItinerary,
  budgetToStore,
  buildFillPrompt,
  datesFor,
  fallbackPoint,
  parseFill,
  readCompleteRequest,
  stopId,
  type FillEntry,
} from "@/lib/planComplete";
import { MAX_TRIP_DAYS } from "@/lib/tiers";
import { itineraryRejection } from "@/lib/itinerary";
import { insertTrip } from "@/lib/db";
import { currentOwnerId } from "@/lib/ownerRequest";
import type { Anchor } from "@/lib/types";

/**
 * Bring your own itinerary, step two: geocode what is still unplaced, look up hours and weather,
 * ask one cheap call for what no data source has, and save the result as a draft trip. One write,
 * only once it's complete.
 */

const FILL_TIMEOUT_MS = 60_000;

export async function POST(req: NextRequest) {
  const capped = dailyCapResumesAt();
  if (capped) return capResponse(capped);
  const limit = throttle(req, "import-plan-complete");
  if (limit.limited) return limitResponse(limit, "import-plan-complete");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const request = readCompleteRequest(body);
  if (typeof request === "string") return NextResponse.json({ error: request }, { status: 400 });
  const { plan, destination, startDate, budget } = request;

  const dated = datesFor(plan.days, startDate);
  if (!dated) return NextResponse.json({ error: "Pick the day your trip starts." }, { status: 400 });
  if (dated.length > MAX_TRIP_DAYS) {
    return NextResponse.json(
      { error: "Trips over 30 days aren't supported. Please choose a shorter date range." },
      { status: 400 }
    );
  }

  const geo = await geocodeDestinationCached(destination).catch(() => null);
  const stops = dated.flatMap(({ day }) => day.stops);

  // Stops renamed on the confirm screen, or never found, get one more look.
  const missing = [...new Set(stops.filter((s) => s.lat === undefined || s.lng === undefined).map((s) => s.name))];
  if (missing.length > 0 && geo) {
    const anchors = missing.map((name): Anchor => ({ name, lat: null, lng: null, priority: "want", source: "import" }));
    const placed = new Map((await geocodeAnchors(anchors, { lat: geo.lat, lon: geo.lon })).map((a) => [a.name, a]));
    for (const s of stops) {
      const hit = placed.get(s.name);
      if (s.lat === undefined && hit && hit.lat !== null && hit.lng !== null) {
        s.lat = hit.lat;
        s.lng = hit.lng;
      }
    }
  }
  const fallback = fallbackPoint(geo, stops);
  if (!fallback) {
    return NextResponse.json({ error: "Couldn't find this trip on the map. Check where it is." }, { status: 422 });
  }

  // `fetchAnchorHours` hands the anchors back unchanged when the lookup fails, which reads exactly
  // like "no hours known". The wrapper records whether anything came back, so a failed lookup
  // becomes "Opening hours not checked" instead of a silent all-clear.
  let hoursChecked = false;
  const located = [
    ...new Map(
      stops
        .filter((s) => s.lat !== undefined && s.lng !== undefined)
        .map((s): [string, Anchor] => [s.name, { name: s.name, lat: s.lat as number, lng: s.lng as number, priority: "want", source: "import" }])
    ).values(),
  ];
  const withHours = await fetchAnchorHours(located, async (points, ms) => {
    const tags = await fetchPoiOsmTags(points, ms);
    if (tags) hoursChecked = true;
    return tags;
  });
  const hours = hoursChecked ? Object.fromEntries(withHours.map((a) => [a.name, a.closedDays ?? null])) : null;

  const weather = geo
    ? await getWeatherForDates(geo.lat, geo.lon, dated[0].date, dated[dated.length - 1].date).catch(() => [])
    : [];

  const ids = dated.flatMap(({ day }, d) => day.stops.map((_, i) => stopId(d, i)));
  const prompt = buildFillPrompt(destination, dated);
  const fillOnce = async () => {
    try {
      const { result } = await runClaude(prompt, "plan-fill", FILL_TIMEOUT_MS, { model: cheapModel() });
      return parseFill(result, ids);
    } catch (err) {
      console.error("[import-plan] fill failed", err);
      return null;
    }
  };
  const fill: Record<string, FillEntry> | null = ids.length === 0 ? {} : ((await fillOnce()) ?? (await fillOnce()));
  const storedBudget = budgetToStore(budget, fill !== null);

  const itinerary = assembleItinerary({ dated, fill, hours, weather, budget: storedBudget, fallback });
  const rejection = itineraryRejection(itinerary);
  if (rejection) {
    console.error("[import-plan] assembled plan rejected", rejection);
    return NextResponse.json({ error: "Couldn't build this trip." }, { status: 500 });
  }

  const trip = insertTrip({
    id: randomUUID(),
    owner_id: await currentOwnerId(),
    destination,
    start_date: dated[0].date,
    end_date: dated[dated.length - 1].date,
    budget: storedBudget,
    itinerary_json: JSON.stringify(itinerary),
    run_id: null,
    chat_session_id: null,
    user_answers_json: null,
    status: "draft",
    timezone: geo?.timezone ?? null,
  });
  return NextResponse.json({ id: trip.id });
}
