import { normalizeDays } from "./itinerary";
import type { TripListRow, TripRow } from "./db";
import type { Trip, TripSummary } from "./types";

/**
 * The snake_case-row → camelCase-payload boundary, in one place.
 *
 * The house convention is that each route maps this by hand, and that was fine while a route
 * handler was the only reader. It stopped being fine once the server pages started reading the
 * same rows directly: two hand-written copies of the same mapping drift, and the one that drifts
 * silently is the one nobody is looking at. `import type` on the row shapes keeps this module
 * free of any runtime dependency on `db.ts`, so importing it never drags better-sqlite3 along.
 */
export function toTripSummary(row: TripListRow): TripSummary {
  return {
    id: row.id,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    budget: row.budget,
  };
}

/**
 * The full trip, with the stored itinerary parsed and normalized.
 *
 * `normalizeDays` on read is load-bearing and predates this module: `trips.itinerary_json` has
 * several writers (the original generate, a refine, a rebalance, and anything trip-edit patches
 * back through PATCH), and rows written before that boundary existed can carry an unrecognised
 * category or a cost stored as a string. Normalizing here means an old trip renders exactly like
 * a new one, and it self-heals on disk at the next PATCH.
 */
export function toTripDetail(row: TripRow): Trip {
  const stored = JSON.parse(row.itinerary_json);
  return {
    ...toTripSummary(row),
    itinerary: { ...stored, days: normalizeDays(stored.days) },
    userAnswers: row.user_answers_json ? JSON.parse(row.user_answers_json) : null,
    chatSessionId: row.chat_session_id,
  };
}
