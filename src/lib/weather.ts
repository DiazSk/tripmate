export interface DayWeather {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationProbability: number | null;
  humidity: number | null;
  weatherCode: number | null;
  /** Local ISO datetime (e.g. "2026-08-14T05:16"), astronomical so available on both the
   *  forecast and historical-archive endpoints regardless of forecast horizon. Written by the
   *  clock in force at the destination *that day* (see `localWallClock`); on the archive
   *  fallback that is the trip's own date, a year after the row's `date`. */
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
  /**
   * IANA zone, e.g. "Europe/Lisbon". The geocoder returns it on every result and this was
   * discarding it — the same omission as `feature_code`, at the same endpoint.
   *
   * It is what lets the phone tell the time *where the trip is*. Measured on the simulator:
   * a device at 21:07 on Sep 28 is Lisbon 05:07 on Sep **29**, so a client using its own clock
   * gets the wrong day of the itinerary, not merely the wrong hour.
   */
  timezone: string | null;
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
    timezone: first.timezone ?? null,
  };
}

/**
 * GeoNames feature-code prefixes for somewhere a trip can be *to*.
 *
 * `PPL*` populated places, `ADM*` administrative divisions, `PCL*` political entities
 * (countries), plus islands and regions. Everything else the gazetteer knows is a thing inside a
 * destination rather than a destination: searching "Kyoto" returns `AIRH` Kyoto Heliport and
 * `PRK` Kyoto Imperial Palace alongside the city, and both are answers to a different question.
 */
const PLACE_CODES = ["PPL", "ADM", "PCL", "ISL", "RGN", "TERR", "CONT"];

const isPlace = (code: unknown) =>
  typeof code === "string" && PLACE_CODES.some((prefix) => code.startsWith(prefix));

/**
 * Typeahead suggestions for the destination field — same free Open-Meteo geocoder as
 * `geocodeDestination`, just asking for several candidates instead of the single best match.
 *
 * **Non-places are dropped, and that is a correctness fix rather than tidying.** This field sets
 * the coordinate every later distance, forecast and travel-time in the trip is measured from.
 * Picking `AIRH Kyoto Heliport` anchors a week in Kyoto to a landing pad six kilometres from the
 * city it meant, and nothing downstream can tell that happened — the name reads right and the
 * arithmetic is confidently wrong.
 *
 * **An empty filter falls back to the unfiltered list**, the same fail-soft bargain the rest of
 * this file strikes. Somebody who types a landmark by name has asked for it plainly enough, and
 * a field that answers a real query with nothing is worse than one that answers it oddly.
 *
 * Over-fetching covers the drop: asking for `count` and filtering would show three rows where the
 * caller asked for six.
 */
export async function suggestDestinations(query: string, count = 6): Promise<GeoSuggestion[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(count * 2));

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return [];
  const data = await res.json();
  const results = data?.results;
  if (!Array.isArray(results)) return [];

  const places = results.filter((r) => isPlace(r?.feature_code));
  return (places.length ? places : results).slice(0, count).map((r) => ({
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
  // UTC accessors, because `new Date("2026-11-02")` is UTC midnight: the local ones moved it a day
  // on any machine whose own clocks change between the two years' dates (a Pacific dev box turned
  // 2 Nov 2026 into 1 Nov 2025, and the trip lost its last day of weather).
  const lastYear = (d: string) => {
    const date = new Date(d);
    date.setUTCFullYear(date.getUTCFullYear() - 1);
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
  // The archive branch asked for these dates a year early (`fetchWeatherBundle`), so its sun
  // times are moved back onto the trip's own year before being read off the clock there.
  const wallClock = (v: string | null) => localWallClock(v, data.utc_offset_seconds, timezone, historical ? 1 : 0);

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
    sunrise: wallClock(daily.sunrise?.[i] ?? null),
    sunset: wallClock(daily.sunset?.[i] ?? null),
    precipitationProbability: historical
      ? null
      : daily.precipitation_probability_max?.[i] ?? null,
    weatherCode: historical ? null : daily.weathercode?.[i] ?? null,
    humidity: humidityByDate[date] ?? null,
    historical,
  }));
  return { days, timezone, historical };
}

/**
 * Open-Meteo writes every time in a response at ONE UTC offset — `utc_offset_seconds`, the zone's
 * offset at the start of the requested range — not at each day's own. So a range that crosses a
 * clock change comes back an hour out on every day after it: Lisbon's sunrise on Sunday 25 October
 * 2026 arrives as "07:56" when the clocks have gone back and it is 06:56, and a plan that trusts
 * it sends somebody to a sunset viewpoint after the sun has set. Undoing the response's offset
 * gives the instant; writing that instant in the zone itself gives each day the offset it has.
 *
 * `yearsAhead` first moves the instant onto a later year, for the archive branch's last-year
 * stand-in. The sun rises within a minute of the same instant a year on, but the clocks change on
 * different dates in different years (25 October in 2026, 31 October in 2027), so the offset has
 * to be the trip year's, not the stand-in's.
 *
 * Anything it can't correct comes back as given: no zone, no offset, or a zone the runtime
 * doesn't know. The hourly humidity below has the same one-offset clock, and is left alone: after
 * a change its day buckets slide by an hour, which an average of 24 readings doesn't notice.
 */
function localWallClock(value: string | null, utcOffsetSeconds: unknown, timeZone: string | null, yearsAhead = 0): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? "");
  if (!m || !timeZone || typeof utcOffsetSeconds !== "number") return value;
  const instant = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - utcOffsetSeconds * 1000);
  instant.setUTCFullYear(instant.getUTCFullYear() + yearsAhead);
  try {
    const fields = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, ...fields }).formatToParts(instant).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch {
    return value;
  }
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
