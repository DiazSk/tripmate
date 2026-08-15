import { NextRequest, NextResponse } from "next/server";
import { geocodeDestination, getWeatherWithMeta } from "@/lib/weather";
import { buildDateContext } from "@/lib/dateContext";
import { getPublicHolidays } from "@/lib/holidays";
import { getCandidatePois } from "@/lib/pois";
import { RawFetch } from "@/lib/types";

/**
 * Step 2a: the preference-independent data fetch, fired the moment a trip is submitted
 * (alongside /api/destination-context) so the bundle is ready by the time Step 2b's POI
 * picker — or Step 3's generation, later — needs it. Every source fails soft: one source
 * down only flips that field's own `available` flag, never the whole bundle.
 */
export async function POST(req: NextRequest) {
  const { destination, startDate, endDate } = await req.json();
  if (!destination || !startDate || !endDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  let geo: Awaited<ReturnType<typeof geocodeDestination>> = null;
  try {
    geo = await geocodeDestination(destination);
  } catch {
    geo = null;
  }

  const dateContext = buildDateContext(startDate, endDate, geo?.lat ?? null);

  const [weatherResult, holidaysResult, poisResult] = await Promise.allSettled([
    geo ? getWeatherWithMeta(geo.lat, geo.lon, startDate, endDate) : Promise.resolve(null),
    geo?.countryCode ? getPublicHolidays(geo.countryCode, startDate, endDate) : Promise.resolve(null),
    geo ? getCandidatePois(geo.lat, geo.lon) : Promise.resolve(null),
  ]);

  const weather = weatherResult.status === "fulfilled" ? weatherResult.value : null;
  const holidays = holidaysResult.status === "fulfilled" ? holidaysResult.value : null;
  const pois = poisResult.status === "fulfilled" ? poisResult.value : null;

  const rawFetch: RawFetch = {
    dateContext,
    destination: {
      resolved: Boolean(geo),
      lat: geo?.lat ?? null,
      lon: geo?.lon ?? null,
      timezone: weather?.timezone ?? null,
      region: geo ? [geo.admin1, geo.country].filter(Boolean).join(", ") || null : null,
      countryCode: geo?.countryCode ?? null,
    },
    weather: weather
      ? { available: true, historical: weather.historical, days: weather.days }
      : { available: false, historical: false, days: [] },
    holidays: holidays ? { available: true, events: holidays } : { available: false, events: [] },
    // No reliable free data source for this yet — see the itinerary-planner Step 2a audit.
    // Kept as an explicit gap, not fabricated data or an LLM call (2a is plain fetching).
    transportModes: { available: false, modes: [] },
    candidatePois: pois
      ? { available: pois.length > 0, pois }
      : { available: false, pois: [] },
  };

  return NextResponse.json({ ok: true, rawFetch });
}
