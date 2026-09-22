import type { TierId } from '@/api/types';

/**
 * A spending style. Ported from `ios/TripMateKit/Sources/TripMateKit/Tiers.swift`, itself a port
 * of `src/lib/tiers.ts` in the web app.
 *
 * **Nothing selects one of these, and that is the point.** The web app had a tier picker and
 * removed it along with the stored preference: the style is derived from the trip's own budget,
 * so a stored one could only ever contradict the number the traveller just typed. But
 * `POST /api/itinerary` still *requires* `tier` — it is a 400 without one — so the client has to
 * work it out rather than ask.
 */
export type Tier = {
  id: TierId;
  name: string;
  dailyRate: number;
  nightlyLodgingRate: number;
};

export const TIERS: Tier[] = [
  { id: 'budget', name: 'Budget', dailyRate: 70, nightlyLodgingRate: 40 },
  { id: 'midrange', name: 'Mid-range', dailyRate: 150, nightlyLodgingRate: 150 },
  { id: 'luxury', name: 'Luxury', dailyRate: 350, nightlyLodgingRate: 500 },
];

export const tierName = (id: TierId) => TIERS.find((t) => t.id === id)?.name ?? TIERS[0].name;

/** Days at the daily rate plus *nights* at the lodging rate — one fewer night than days. */
export function estimateTotal(tier: Tier, days: number): number {
  const nights = Math.max(days - 1, 0);
  return tier.dailyRate * days + tier.nightlyLodgingRate * nights;
}

/**
 * The style whose estimate lands nearest the budget.
 *
 * **Ties go to the earlier tier**, because the comparison is strictly `<`. That matters at the
 * exact midpoint between two styles, and it is the web's behaviour rather than an accident of it.
 */
export function closestTier(budget: number, days: number): TierId {
  let best = TIERS[0];
  let bestDiff = Infinity;
  for (const tier of TIERS) {
    const diff = Math.abs(estimateTotal(tier, days) - budget);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = tier;
    }
  }
  return best.id;
}

/**
 * Inclusive day count between two date-only ISO strings, floored at 1.
 *
 * Parsed by splitting the string, never by constructing a `Date` from it — `2026-09-19` is UTC
 * midnight and reading it back with local accessors rolls it back a day anywhere west of
 * Greenwich, a bug this codebase has already shipped once into generated output.
 */
export function tripDays(startDate: string, endDate: string): number {
  const start = utcDays(startDate);
  const end = utcDays(endDate);
  if (start === null || end === null) return 1;
  return Math.max(end - start + 1, 1);
}

/** Whole days since the epoch, from a `YYYY-MM-DD` string, with no timezone anywhere near it. */
function utcDays(iso: string): number | null {
  const parts = iso.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export const MAX_TRIP_DAYS = 30;

export const isTripTooLong = (startDate: string, endDate: string) =>
  tripDays(startDate, endDate) > MAX_TRIP_DAYS;

/** True when the end date falls before the start date. Both must parse, or there is no claim. */
export function isEndBeforeStart(startDate: string, endDate: string): boolean {
  const start = utcDays(startDate);
  const end = utcDays(endDate);
  if (start === null || end === null) return false;
  return end < start;
}
