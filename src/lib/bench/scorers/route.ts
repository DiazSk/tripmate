import { haversineKm } from "../../travelTime";
import { knownPois } from "../fixtures";
import { dayEntries } from "../parseItinerary";
import { findPoi } from "./domain";
import type { BenchFixture } from "../fixtures";
import type { ParsedDay, ParsedEntry, ParsedItinerary } from "../parseItinerary";
import type {
  BacktrackScore,
  DowntimeScore,
  MealProximityScore,
} from "../types";

/**
 * Route-geometry and day-shape scorers. Deterministic; no LLM.
 *
 * These three answer questions `geo_coherence` can't. Average leg length says how far apart a
 * day's stops are; it says nothing about whether the model walked past a stop and doubled back,
 * whether lunch is on the route or a detour, or whether the day has any slack in it.
 */

// --- Tunable constants ---------------------------------------------------------------------------

/** Same circuity correction the app's own travel-time estimator applies to straight-line distance. */
const ROUTE_CIRCUITY_FACTOR = 1.3;

/** Door-to-door speeds, matching src/lib/travelTime.ts so numbers here are comparable to the app's. */
const SPEED_KMH: Record<string, number> = { walk: 4.5, bike: 13, transit: 18, drive: 30 };

/** A meal more than this far from the preceding stop is a detour, not a stop on the way. */
export const MEAL_PROXIMITY_CAP_MIN = 20;

/** Meal windows the scorer looks in, per the brief. */
export const LUNCH_WINDOW = { startMin: 12 * 60, endMin: 14 * 60 };
export const DINNER_WINDOW = { startMin: 18 * 60, endMin: 21 * 60 };

/** A day with less unallocated time than this has no room for a queue, a photo, or a wrong turn. */
export const MIN_DOWNTIME_MIN = 60;

/** Above this many stops, exact TSP is replaced by a heuristic (documented in the score). */
const EXACT_TSP_LIMIT = 10;

// --- Geometry helpers ----------------------------------------------------------------------------

interface Located {
  name: string;
  lat: number;
  lon: number;
}

function legKm(a: Located, b: Located): number {
  return haversineKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) * ROUTE_CIRCUITY_FACTOR;
}

function pathLength(points: Located[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += legKm(points[i], points[i + 1]);
  return total;
}

/**
 * Shortest Hamiltonian PATH through the points — an open route, because a traveler doesn't return
 * to their first stop at the end of the day. Held-Karp, exact, over every start/end pair.
 *
 * O(2^n · n^2), which is nothing at the sizes a day plan reaches (2-6 stops). Above
 * EXACT_TSP_LIMIT it falls back to nearest-neighbour + 2-opt and says so, rather than hanging.
 */
export function shortestPathKm(points: Located[]): { km: number; exact: boolean } {
  const n = points.length;
  if (n < 2) return { km: 0, exact: true };
  if (n === 2) return { km: legKm(points[0], points[1]), exact: true };

  if (n > EXACT_TSP_LIMIT) return { km: heuristicPathKm(points), exact: false };

  const dist = points.map((a) => points.map((b) => legKm(a, b)));
  const size = 1 << n;
  // dp[mask][last] = cheapest path visiting exactly `mask`, ending at `last`.
  const dp = Array.from({ length: size }, () => new Array<number>(n).fill(Infinity));
  for (let i = 0; i < n; i++) dp[1 << i][i] = 0;

  for (let mask = 1; mask < size; mask++) {
    for (let last = 0; last < n; last++) {
      const cost = dp[mask][last];
      if (!Number.isFinite(cost) || !(mask & (1 << last))) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nextMask = mask | (1 << next);
        const candidate = cost + dist[last][next];
        if (candidate < dp[nextMask][next]) dp[nextMask][next] = candidate;
      }
    }
  }

  const full = size - 1;
  let best = Infinity;
  for (let last = 0; last < n; last++) best = Math.min(best, dp[full][last]);
  return { km: best, exact: true };
}

/** Nearest-neighbour from every start, improved by 2-opt. Only used past EXACT_TSP_LIMIT stops. */
function heuristicPathKm(points: Located[]): number {
  const n = points.length;
  let best = Infinity;

  for (let start = 0; start < n; start++) {
    const unvisited = new Set(points.map((_, i) => i));
    let current = start;
    unvisited.delete(start);
    const order = [start];
    while (unvisited.size > 0) {
      let nearest = -1;
      let nearestKm = Infinity;
      for (const i of unvisited) {
        const km = legKm(points[current], points[i]);
        if (km < nearestKm) {
          nearestKm = km;
          nearest = i;
        }
      }
      order.push(nearest);
      unvisited.delete(nearest);
      current = nearest;
    }

    // 2-opt: reverse any segment that shortens the path, until nothing improves.
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 2; j < order.length; j++) {
          const before = pathLength(order.map((k) => points[k]));
          const candidate = [...order.slice(0, i + 1), ...order.slice(i + 1, j + 1).reverse(), ...order.slice(j + 1)];
          if (pathLength(candidate.map((k) => points[k])) < before - 1e-9) {
            order.splice(0, order.length, ...candidate);
            improved = true;
          }
        }
      }
    }
    best = Math.min(best, pathLength(order.map((k) => points[k])));
  }
  return best;
}

function locatedStops(day: ParsedDay, fixture: BenchFixture): Located[] {
  const pois = knownPois(fixture);
  return dayEntries(day)
    .map((entry) => (entry.areaLevel ? null : findPoi(entry.name, pois)))
    .filter((p): p is { name: string; lat: number; lon: number } =>
      p !== null && p.lat !== null && p.lon !== null
    )
    .map((p) => ({ name: p.name, lat: p.lat, lon: p.lon }));
}

// --- geo_backtrack_ratio ---------------------------------------------------------------------------

/**
 * geo_backtrack_ratio — how much of the day's walking was necessary.
 *
 * Compares the distance actually walked, in the order the model scheduled the stops, against the
 * shortest possible route through the SAME stops. The ratio isolates *ordering* from *selection*:
 * picking scattered stops is `geo_coherence`'s business, and a day can score badly there while
 * scoring 1.0 here because the model at least visited them in the best possible order.
 *
 * 1.0 = the model found the optimal ordering. 0.5 = it walked twice as far as it needed to.
 */
export function scoreBacktrack(itinerary: ParsedItinerary, fixture: BenchFixture): BacktrackScore {
  const perDayRatio: (number | null)[] = [];
  const perDayExcessKm: (number | null)[] = [];
  let scoredDays = 0;
  let exactAll = true;
  const worstDays: { dayIndex: number; ratio: number; actualKm: number; optimalKm: number }[] = [];

  itinerary.days.forEach((day, dayIndex) => {
    const stops = locatedStops(day, fixture);
    // Fewer than three located stops has exactly one possible ordering, so there is no
    // backtracking to measure — scoring it 1.0 would inflate every sparse day into a perfect one.
    if (stops.length < 3) {
      perDayRatio.push(null);
      perDayExcessKm.push(null);
      return;
    }

    const actualKm = pathLength(stops);
    const { km: optimalKm, exact } = shortestPathKm(stops);
    if (!exact) exactAll = false;

    const ratio = actualKm > 0 ? Math.min(1, optimalKm / actualKm) : 1;
    perDayRatio.push(ratio);
    perDayExcessKm.push(Math.round((actualKm - optimalKm) * 10) / 10);
    scoredDays++;
    worstDays.push({
      dayIndex,
      ratio,
      actualKm: Math.round(actualKm * 10) / 10,
      optimalKm: Math.round(optimalKm * 10) / 10,
    });
  });

  const scored = perDayRatio.filter((r): r is number => r !== null);
  worstDays.sort((a, b) => a.ratio - b.ratio);

  return {
    perDayRatio,
    perDayExcessKm,
    scoredDays,
    totalDays: itinerary.days.length,
    exact: exactAll,
    worstDay: worstDays[0] ?? null,
    normalized: scored.length > 0 ? scored.reduce((s, r) => s + r, 0) / scored.length : null,
  };
}

// --- meal_proximity_score --------------------------------------------------------------------------

const MEAL_WORDS = /\b(lunch|dinner|brunch|supper|meal|eat|dining|restaurant|food)\b/i;

function inWindow(entry: ParsedEntry, window: { startMin: number; endMin: number }): boolean {
  if (!entry.window) return false;
  return entry.window.startMin < window.endMin && entry.window.endMin > window.startMin;
}

/**
 * meal_proximity_score — is the meal on the route, or a detour?
 *
 * For every entry falling in the lunch or dinner window, measures the hop from the stop before it.
 * Distance is preferred when both ends are locatable; otherwise the model's own stated travel time
 * on the preceding entry is used, since an area-level meal ("dinner around Ribeira") has no
 * coordinates by design and refusing to score it would ignore most meals in a well-formed plan.
 *
 * Reports how many meal slots it could actually measure — a plan whose meals are all unmeasurable
 * scores `null`, not 1.0.
 */
export function scoreMealProximity(
  itinerary: ParsedItinerary,
  fixture: BenchFixture
): MealProximityScore {
  const pois = knownPois(fixture);
  const modes = fixture.reconciled.transportModes;
  const speed = SPEED_KMH[modes.includes("transit") ? "transit" : modes.includes("drive") ? "drive" : "walk"];

  let mealSlots = 0;
  let measured = 0;
  let within = 0;
  const detours: { dayIndex: number; name: string; minutes: number; source: string }[] = [];

  itinerary.days.forEach((day, dayIndex) => {
    const entries = dayEntries(day);
    entries.forEach((entry, i) => {
      const isMeal =
        MEAL_WORDS.test(entry.name) || MEAL_WORDS.test(entry.raw.split(/\s+—\s+/)[0] ?? "");
      const timed = inWindow(entry, LUNCH_WINDOW) || inWindow(entry, DINNER_WINDOW);
      if (!isMeal && !timed) return;
      if (!isMeal && timed && entry.areaLevel === false) return; // a sightseeing stop at 13:00 isn't a meal
      mealSlots++;

      const previous = entries[i - 1];
      if (!previous) return; // first entry of the day has nothing to be near

      let minutes: number | null = null;
      let source = "";

      const from = previous.areaLevel ? null : findPoi(previous.name, pois);
      const to = entry.areaLevel ? null : findPoi(entry.name, pois);
      if (from?.lat != null && from.lon != null && to?.lat != null && to.lon != null) {
        const km = legKm(
          { name: from.name, lat: from.lat, lon: from.lon },
          { name: to.name, lat: to.lat, lon: to.lon }
        );
        minutes = Math.round((km / speed) * 60);
        source = "measured from coordinates";
      } else if (previous.transport?.minutes != null) {
        minutes = previous.transport.minutes;
        source = "model's stated travel time";
      }

      if (minutes === null) return;
      measured++;
      if (minutes <= MEAL_PROXIMITY_CAP_MIN) within++;
      else detours.push({ dayIndex, name: entry.name, minutes, source });
    });
  });

  return {
    mealSlots,
    measured,
    within,
    capMinutes: MEAL_PROXIMITY_CAP_MIN,
    detours,
    normalized: measured > 0 ? within / measured : null,
  };
}

// --- downtime_margin_score -------------------------------------------------------------------------

/**
 * downtime_margin_score — does the day have any slack left in it?
 *
 * Takes the day's active span (first stop's start to last stop's end), subtracts the stated
 * activity durations and travel times, and checks what's left. A day with under an hour unallocated
 * has no room for a queue, a photo stop, or a wrong turn.
 *
 * This is the opposite failure to `feasibility`, which catches days that don't fit in waking hours
 * at all. A day can pass that and still be scheduled wall-to-wall.
 */
export function scoreDowntime(itinerary: ParsedItinerary): DowntimeScore {
  const perDayUnallocatedMin: (number | null)[] = [];
  let scoredDays = 0;
  let passedDays = 0;
  const tightDays: { dayIndex: number; unallocatedMin: number; activeSpanMin: number }[] = [];

  itinerary.days.forEach((day, dayIndex) => {
    const entries = dayEntries(day);
    const windows = entries
      .map((e) => e.window)
      .filter((w): w is { startMin: number; endMin: number } => w !== null);

    if (windows.length < 2) {
      perDayUnallocatedMin.push(null);
      return;
    }

    const activeSpan =
      Math.max(...windows.map((w) => w.endMin)) - Math.min(...windows.map((w) => w.startMin));
    const activity = entries.reduce((sum, e) => {
      if (e.durationMin !== null) return sum + e.durationMin;
      if (e.window) return sum + (e.window.endMin - e.window.startMin);
      return sum;
    }, 0);
    const travel = entries.reduce((sum, e) => sum + (e.transport?.minutes ?? 0), 0);

    const unallocated = activeSpan - activity - travel;
    perDayUnallocatedMin.push(unallocated);
    scoredDays++;
    if (unallocated >= MIN_DOWNTIME_MIN) passedDays++;
    else tightDays.push({ dayIndex, unallocatedMin: unallocated, activeSpanMin: activeSpan });
  });

  return {
    perDayUnallocatedMin,
    scoredDays,
    passedDays,
    totalDays: itinerary.days.length,
    minimumMinutes: MIN_DOWNTIME_MIN,
    tightDays,
    normalized: scoredDays > 0 ? passedDays / scoredDays : null,
  };
}
