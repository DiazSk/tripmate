import { normalizeDays } from "./itinerary";
import type { TripRow } from "./db";
import type { Trip } from "./types";

/**
 * The snake_case-row -> camelCase `Trip` boundary, in one place.
 *
 * `GET /api/trips/[id]` (src/app/api/trips/[id]/route.ts) already builds this exact shape inline;
 * this module exists so the export route (Task 7) doesn't have to duplicate that mapping a third
 * time. `normalizeDays` on read is load-bearing and predates this module: `trips.itinerary_json`
 * has several writers (the original generate, a refine, a rebalance, and anything trip-edit
 * patches back through PATCH), and rows written before that boundary existed can carry an
 * unrecognised category or a cost stored as a string. Normalizing here means an old trip renders
 * exactly like a new one, and it self-heals on disk at the next PATCH.
 */
export function toTripDetail(row: TripRow): Trip {
  const stored = JSON.parse(row.itinerary_json);
  return {
    id: row.id,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    budget: row.budget,
    itinerary: { ...stored, days: normalizeDays(stored.days) },
    userAnswers: row.user_answers_json ? JSON.parse(row.user_answers_json) : null,
  };
}
