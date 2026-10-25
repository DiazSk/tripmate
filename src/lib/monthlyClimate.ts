import { cached } from "./fetchCache";

const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
/** A day at or above this much rain counts as a rain day. */
const RAIN_DAY_MM = 1;

export interface MonthClimate {
  month: number;
  highC: number;
  rainDays: number;
}

/** Daily archive rows to one row per month: average high to 1 dp, and how many days rained. */
export function monthlyFromDaily(daily: { time: string[]; temperature_2m_max: number[]; precipitation_sum: number[] }): MonthClimate[] {
  const byMonth = new Map<number, { sum: number; n: number; rain: number }>();
  daily.time.forEach((day, i) => {
    const month = Number(day.slice(5, 7));
    const m = byMonth.get(month) ?? { sum: 0, n: 0, rain: 0 };
    // Open-Meteo sends null for a day it has no reading for; counting it as 0°C would cool the month.
    const high = daily.temperature_2m_max[i];
    if (typeof high === "number") {
      m.sum += high;
      m.n += 1;
    }
    if ((daily.precipitation_sum[i] ?? 0) >= RAIN_DAY_MM) m.rain += 1;
    byMonth.set(month, m);
  });
  return [...byMonth.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, m]) => m.n > 0)
    .map(([month, m]) => ({ month, highC: Math.round((m.sum / m.n) * 10) / 10, rainDays: m.rain }));
}

/** Comfortable months (15-30°C highs), driest first, at most six, in calendar order. */
export function bestMonthsFromClimate(months: MonthClimate[]): number[] {
  return months
    .filter((m) => m.highC >= 15 && m.highC <= 30)
    .sort((a, b) => a.rainDays - b.rainDays || a.month - b.month)
    .slice(0, 6)
    .map((m) => m.month)
    .sort((a, b) => a - b);
}

/** Last full calendar year, month by month. `null` when the archive could not answer. */
export async function fetchMonthlyClimate(point: { lat: number; lng: number }): Promise<MonthClimate[] | null> {
  const key = `climate:${point.lat.toFixed(2)},${point.lng.toFixed(2)}`;
  return cached(key, 180 * DAY_MS, async () => {
    try {
      const year = new Date().getUTCFullYear() - 1;
      const url = new URL("https://archive-api.open-meteo.com/v1/archive");
      url.searchParams.set("latitude", String(point.lat));
      url.searchParams.set("longitude", String(point.lng));
      url.searchParams.set("start_date", `${year}-01-01`);
      url.searchParams.set("end_date", `${year}-12-31`);
      url.searchParams.set("daily", "temperature_2m_max,precipitation_sum");
      url.searchParams.set("timezone", "UTC");
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data?.daily?.time)) return null;
      const months = monthlyFromDaily(data.daily);
      return months.length ? months : null;
    } catch {
      return null;
    }
  });
}
