import { buildDateContext } from "./dateContext";
import { getPublicHolidays } from "./holidays";
import { getCandidatePois } from "./pois";
import { geocodeDestination, getWeatherWithMeta } from "./weather";
import type { RawFetch } from "./types";

/**
 * Step 2a — the preference-independent data fetch, extracted from `/api/trip-fetch` so the route
 * and the benchmark's custom-trip builder run the same code instead of two copies that drift.
 *
 * Every source fails soft: one source down only flips that field's own `available` flag, never the
 * whole bundle. A geocode miss is deliberately non-blocking (same tradeoff as page.tsx and
 * itinerary/route.ts) — it degrades `destination.resolved`, it doesn't raise.
 */
export async function fetchRawTrip(params: {
  destination: string;
  startDate: string;
  endDate: string;
}): Promise<RawFetch> {
  const { destination, startDate, endDate } = params;

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

  return {
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
    candidatePois: pois ? { available: pois.length > 0, pois } : { available: false, pois: [] },
  };
}
