import { tripDays } from "./tiers";
import { DateContext } from "./types";

// `new Date("2026-09-19")` is parsed as UTC midnight, so every read below uses the UTC accessors.
// Reading them in local time rolls the date back a day anywhere west of Greenwich — which showed
// up as an off-by-one day-of-week (2026-09-19 reported as Friday rather than Saturday).
function addDays(iso: string, n: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

// Meteorological (not astronomical) seasons, indexed by calendar month (0 = Jan).
const NORTHERN_SEASON_BY_MONTH = [
  "winter",
  "winter",
  "spring",
  "spring",
  "spring",
  "summer",
  "summer",
  "summer",
  "fall",
  "fall",
  "fall",
  "winter",
] as const;

const SOUTHERN_FLIP: Record<string, DateContext["season"]> = {
  winter: "summer",
  summer: "winter",
  spring: "fall",
  fall: "spring",
};

/** Null when the destination hasn't been geocoded — season depends on which hemisphere the
 *  destination is in, and there's nothing sensible to default to without that. */
function seasonForDate(iso: string, lat: number | null): DateContext["season"] {
  if (lat === null) return null;
  const month = new Date(iso).getUTCMonth();
  const northern = NORTHERN_SEASON_BY_MONTH[month];
  return lat >= 0 ? northern : SOUTHERN_FLIP[northern];
}

/** Pure date math for Step 2a — no fetch, no failure mode. `lat` is optional (pass `null` if
 *  geocoding hasn't resolved) since only `season` needs it; everything else is calendar math. */
export function buildDateContext(startDate: string, endDate: string, lat: number | null): DateContext {
  const duration = tripDays(startDate, endDate);
  const leadTimeDays = Math.max(
    Math.round((new Date(startDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    0
  );
  const days = Array.from({ length: duration }, (_, i) => {
    const date = addDays(startDate, i);
    return {
      date,
      dayOfWeek: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
        new Date(date)
      ),
    };
  });

  return {
    tripDays: duration,
    leadTimeDays,
    season: seasonForDate(startDate, lat),
    days,
  };
}
