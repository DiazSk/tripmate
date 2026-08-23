import { buildDateContext } from "./dateContext";
import { probeTransitAvailable } from "./routeMatrix";
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

  const [weatherResult, holidaysResult, poisResult, transitResult] = await Promise.allSettled([
    geo ? getWeatherWithMeta(geo.lat, geo.lon, startDate, endDate) : Promise.resolve(null),
    geo?.countryCode ? getPublicHolidays(geo.countryCode, startDate, endDate) : Promise.resolve(null),
    geo ? getCandidatePois(geo.lat, geo.lon) : Promise.resolve(null),
    geo ? probeTransitAvailable(geo.lat, geo.lon) : Promise.resolve(false),
  ]);

  const weather = weatherResult.status === "fulfilled" ? weatherResult.value : null;
  const holidays = holidaysResult.status === "fulfilled" ? holidaysResult.value : null;
  const pois = poisResult.status === "fulfilled" ? poisResult.value : null;
  const hasTransit = transitResult.status === "fulfilled" ? transitResult.value === true : false;

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
    // Was a permanent gap until a route-matrix probe could confirm transit exists. Only ever
    // set from positive evidence: a TRANSIT route proves transit, but no route proves nothing, so
    // absence still falls through to reconcile's flagged default rather than claiming a car-only
    // city. Walking is assumed alongside it because every one of these destinations is walkable
    // at the scale a day's stops occupy.
    transportModes: hasTransit
      ? { available: true, modes: ["walk", "transit"] }
      : { available: false, modes: [] },
    candidatePois: pois ? { available: pois.length > 0, pois } : { available: false, pois: [] },
  };
}
