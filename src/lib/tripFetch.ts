import { buildDateContext } from "./dateContext";
import { fetchBikeshare } from "./bikeshare";
import { probeTransitAvailable } from "./routeMatrix";
import { getPublicHolidays } from "./holidays";

import { geocodeDestination } from "./weather";
import {
  geocodeDestinationCached,
  getCandidatePoisCached,
  getWeatherWithMetaCached,
} from "./serverFetchCached";
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
    geo = await geocodeDestinationCached(destination);
  } catch {
    geo = null;
  }

  const dateContext = buildDateContext(startDate, endDate, geo?.lat ?? null);

  const [weatherResult, holidaysResult, poisResult, transitResult, bikeshareResult] =
    await Promise.allSettled([
      geo ? getWeatherWithMetaCached(geo.lat, geo.lon, startDate, endDate) : Promise.resolve(null),
      geo?.countryCode ? getPublicHolidays(geo.countryCode, startDate, endDate) : Promise.resolve(null),
      geo ? getCandidatePoisCached(geo.lat, geo.lon) : Promise.resolve(null),
      probeTransitAvailable(),
      geo ? fetchBikeshare(geo) : Promise.resolve(null),
    ]);

  const weather = weatherResult.status === "fulfilled" ? weatherResult.value : null;
  const holidays = holidaysResult.status === "fulfilled" ? holidaysResult.value : null;
  const pois = poisResult.status === "fulfilled" ? poisResult.value : null;
  const hasTransit = transitResult.status === "fulfilled" ? transitResult.value === true : false;
  const bikeshare = bikeshareResult.status === "fulfilled" ? bikeshareResult.value : null;

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
    // Only ever set from positive evidence. A TRANSIT route proves transit and a resolved GBFS
    // system proves bikeshare; neither one's absence proves anything, so a bundle with no evidence
    // still falls through to reconcile's flagged default rather than claiming a car-only city.
    // Walking is assumed alongside whatever is proven, because every one of these destinations is
    // walkable at the scale a day's stops occupy.
    //
    // Until GBFS landed this was unreachable — `probeTransitAvailable` is a stub returning false,
    // so `available` was permanently false and the default always fired. A bikeshare hit is the
    // first real evidence this field has ever carried.
    transportModes:
      hasTransit || bikeshare
        ? {
            available: true,
            modes: [
              "walk",
              ...(bikeshare ? (["bike"] as const) : []),
              ...(hasTransit ? (["transit"] as const) : []),
            ],
          }
        : { available: false, modes: [] },
    // `available` tracks whether the lookup *ran and answered*, which is why it is keyed on the
    // geocode rather than on finding something. No system found for a city we did locate is a
    // real finding ("no bikeshare here"); no system found because we never had coordinates is not.
    bikeshare: { available: Boolean(geo), system: bikeshare },
    candidatePois: pois ? { available: pois.length > 0, pois } : { available: false, pois: [] },
  };
}
