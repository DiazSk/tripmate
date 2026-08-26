export interface DayWeather {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationProbability: number | null;
  humidity: number | null;
  weatherCode: number | null;
  /** Local ISO datetime (e.g. "2026-08-14T05:16"), astronomical so available on both the
   *  forecast and historical-archive endpoints regardless of forecast horizon. */
  sunrise: string | null;
  sunset: string | null;
  historical: boolean;
}

export interface GeoResult {
  lat: number;
  lon: number;
  name: string;
  admin1: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2, e.g. "FR" — same field `GeoSuggestion` already carries, added here too
   *  since Step 2a's holidays lookup needs a country code to query by. */
  countryCode: string | null;
}

export interface GeoSuggestion {
  lat: number;
  lon: number;
  name: string;
  admin1: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2, e.g. "FR" — for the country-code badge on a suggestion row. */
  countryCode: string | null;
}

/** Wall-clock cap on each outbound call. Without a signal, undici lets a hung upstream sit for
 *  ~5 minutes and the request that triggered it hangs with it — the literal "the page is stuck"
 *  failure. An abort throws, which is the same shape as any other network failure here, so it
 *  lands on the fail-soft paths that already exist rather than adding a new error surface. */
const FETCH_TIMEOUT_MS = 8_000;

const FORECAST_HORIZON_DAYS = 16;

export async function geocodeDestination(name: string): Promise<GeoResult | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = await res.json();
  const first = data?.results?.[0];
  if (!first) return null;
  return {
    lat: first.latitude,
    lon: first.longitude,
    name: first.name,
    admin1: first.admin1 ?? null,
    country: first.country ?? null,
    countryCode: first.country_code ?? null,
  };
}

/** Typeahead suggestions for the destination field — same free Open-Meteo geocoder as
 *  `geocodeDestination`, just asking for several candidates instead of the single best match. */
export async function suggestDestinations(query: string, count = 6): Promise<GeoSuggestion[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(count));

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return [];
  const data = await res.json();
  const results = data?.results;
  if (!Array.isArray(results)) return [];
  return results.map((r) => ({
    lat: r.latitude,
    lon: r.longitude,
    name: r.name,
    admin1: r.admin1 ?? null,
    country: r.country ?? null,
    countryCode: r.country_code ?? null,
  }));
}

/** "Kyoto, Japan" — the disambiguated form worth both showing the user and sending on as the
 *  actual destination value, since a bare city name (e.g. "Springfield") is often ambiguous. */
export function suggestionLabel(s: GeoSuggestion): string {
  return s.country ? `${s.name}, ${s.country}` : s.name;
}

export async function getWeatherForDates(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<DayWeather[]> {
  const { days } = await fetchWeatherBundle(lat, lon, startDate, endDate);
  return days;
}

/** Same lookup as `getWeatherForDates`, plus the metadata (resolved IANA timezone, whether the
 *  historical-fallback branch was used) that Step 2a's raw-fetch bundle needs but the itinerary
 *  prompt never has — kept as a separate export so existing callers of `getWeatherForDates`
 *  don't have to change shape. */
export async function getWeatherWithMeta(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<{ days: DayWeather[]; timezone: string | null; historical: boolean }> {
  return fetchWeatherBundle(lat, lon, startDate, endDate);
}

async function fetchWeatherBundle(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<{ days: DayWeather[]; timezone: string | null; historical: boolean }> {
  const daysUntilStart =
    (new Date(startDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);

  if (daysUntilStart <= FORECAST_HORIZON_DAYS) {
    return fetchDaily(
      "https://api.open-meteo.com/v1/forecast",
      lat,
      lon,
      startDate,
      endDate,
      false
    );
  }

  // Trip too far out to forecast: use the same calendar dates one year back as a "typical weather" stand-in.
  const lastYear = (d: string) => {
    const date = new Date(d);
    date.setFullYear(date.getFullYear() - 1);
    return date.toISOString().slice(0, 10);
  };
  return fetchDaily(
    "https://archive-api.open-meteo.com/v1/archive",
    lat,
    lon,
    lastYear(startDate),
    lastYear(endDate),
    true
  );
}

async function fetchDaily(
  base: string,
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  historical: boolean
): Promise<{ days: DayWeather[]; timezone: string | null; historical: boolean }> {
  const url = new URL(base);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set(
    "daily",
    historical
      ? "temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset"
      : "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,sunrise,sunset"
  );
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`weather API returned ${res.status}`);
  const data = await res.json();
  const timezone: string | null = data.timezone ?? null;
  const daily = data.daily;
  if (!daily?.time) return { days: [], timezone, historical };

  // Best-effort only: relative humidity isn't a supported "daily" aggregate on
  // Open-Meteo, so it's fetched separately (hourly, averaged per day) and
  // merged in. Never lets a humidity hiccup break the core forecast.
  const humidityByDate: Record<string, number> = historical
    ? {}
    : await fetchHourlyHumidity(base, lat, lon, startDate, endDate);

  const days: DayWeather[] = daily.time.map((date: string, i: number) => ({
    date,
    tempMaxC: daily.temperature_2m_max[i],
    tempMinC: daily.temperature_2m_min[i],
    sunrise: daily.sunrise?.[i] ?? null,
    sunset: daily.sunset?.[i] ?? null,
    precipitationProbability: historical
      ? null
      : daily.precipitation_probability_max?.[i] ?? null,
    weatherCode: historical ? null : daily.weathercode?.[i] ?? null,
    humidity: humidityByDate[date] ?? null,
    historical,
  }));
  return { days, timezone, historical };
}

async function fetchHourlyHumidity(
  base: string,
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<Record<string, number>> {
  try {
    const url = new URL(base);
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("hourly", "relative_humidity_2m");
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return {};
    const data = await res.json();
    const times: string[] = data?.hourly?.time ?? [];
    const values: number[] = data?.hourly?.relative_humidity_2m ?? [];

    const byDate = new Map<string, number[]>();
    times.forEach((t, i) => {
      const date = t.slice(0, 10);
      const bucket = byDate.get(date) ?? [];
      bucket.push(values[i]);
      byDate.set(date, bucket);
    });

    const avgByDate: Record<string, number> = {};
    for (const [date, vals] of byDate) {
      avgByDate[date] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    return avgByDate;
  } catch {
    return {};
  }
}
