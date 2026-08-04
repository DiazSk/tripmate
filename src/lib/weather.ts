export interface DayWeather {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationProbability: number | null;
  historical: boolean;
}

interface GeoResult {
  lat: number;
  lon: number;
  name: string;
}

const FORECAST_HORIZON_DAYS = 16;

export async function geocodeDestination(name: string): Promise<GeoResult | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const first = data?.results?.[0];
  if (!first) return null;
  return { lat: first.latitude, lon: first.longitude, name: first.name };
}

export async function getWeatherForDates(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<DayWeather[]> {
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
): Promise<DayWeather[]> {
  const url = new URL(base);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set(
    "daily",
    historical
      ? "temperature_2m_max,temperature_2m_min,precipitation_sum"
      : "temperature_2m_max,temperature_2m_min,precipitation_probability_max"
  );
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather API returned ${res.status}`);
  const data = await res.json();
  const daily = data.daily;
  if (!daily?.time) return [];

  return daily.time.map((date: string, i: number) => ({
    date,
    tempMaxC: daily.temperature_2m_max[i],
    tempMinC: daily.temperature_2m_min[i],
    precipitationProbability: historical
      ? null
      : daily.precipitation_probability_max?.[i] ?? null,
    historical,
  }));
}
