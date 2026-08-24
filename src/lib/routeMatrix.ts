import { runComposioTool } from "./composio";
import type { TransportMode } from "./types";

const TOOL_SLUG = "GOOGLE_MAPS_COMPUTE_ROUTE_MATRIX";

/** Google rejects the request outright when origins × destinations exceeds this for TRANSIT
 *  (verified: a 12×12 returns HTTP 400 "the product ... must be <= 100 if travel_mode is
 *  TRANSIT"). A day's stops sit well inside it; the cap is here so a pathological day degrades to
 *  no data instead of a failed call. */
const MAX_MATRIX_STOPS = 10;

const MODE_BY_TRANSPORT: Record<TransportMode, string> = {
  walk: "WALK",
  transit: "TRANSIT",
  drive: "DRIVE",
};

export interface RealLeg {
  fromIndex: number;
  toIndex: number;
  minutes: number;
  distanceMeters: number | null;
}

/** Durations arrive as protobuf-style second strings — "1305s". */
function parseSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Pure. Reads the matrix response into consecutive-leg minutes.
 *
 * Self-pairs come back as `"0s"` with no `distanceMeters` and are dropped, as is anything whose
 * `condition` is not `ROUTE_EXISTS` — an unroutable pair is missing data, not a zero-minute hop,
 * and the caller's existing haversine estimate is the honest fallback for it.
 */
export function distilRouteMatrix(raw: unknown): RealLeg[] {
  const elements = (raw as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];

  const legs: RealLeg[] = [];
  for (const entry of elements) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.condition !== "ROUTE_EXISTS") continue;

    const fromIndex = typeof e.originIndex === "number" ? e.originIndex : null;
    const toIndex = typeof e.destinationIndex === "number" ? e.destinationIndex : null;
    const seconds = parseSeconds(e.duration);
    if (fromIndex === null || toIndex === null || seconds === null) continue;
    if (fromIndex === toIndex) continue;

    legs.push({
      fromIndex,
      toIndex,
      minutes: Math.round(seconds / 60),
      distanceMeters: typeof e.distanceMeters === "number" ? e.distanceMeters : null,
    });
  }
  return legs;
}

/**
 * Real door-to-door durations for one day's stops, as a lookup keyed `"from->to"`.
 *
 * One call covers the whole N×N cross product — measured ~2.9s for 3×3 — so this is a per-DAY
 * cost, not per-leg. The full matrix is requested rather than only consecutive pairs because it
 * costs the same and also answers §3c ("is this day's route actually clustered").
 *
 * Resolves an empty map on any failure, so callers fall back to `travelLegBetween`'s estimate,
 * which already flags itself `estimated: true`.
 */
export async function fetchDayTravelMinutes(
  points: { lat: number; lon: number }[],
  mode: TransportMode = "walk"
): Promise<Map<string, RealLeg>> {
  const out = new Map<string, RealLeg>();
  if (points.length < 2 || points.length > MAX_MATRIX_STOPS) return out;

  const waypoints = points.map((p) => ({ latitude: p.lat, longitude: p.lon }));
  const data = await runComposioTool(TOOL_SLUG, {
    origins: waypoints,
    destinations: waypoints,
    travelMode: MODE_BY_TRANSPORT[mode] ?? "WALK",
  });
  if (data === null) return out;

  for (const leg of distilRouteMatrix(data)) {
    out.set(`${leg.fromIndex}->${leg.toIndex}`, leg);
  }
  return out;
}

/** Transit must beat walking by at least this margin to count as real. A fallback-to-walking
 *  response returns the identical duration (ratio 1.0); Paris returned 0.37. */
const TRANSIT_SPEEDUP_CEILING = 0.8;

export { MAX_MATRIX_STOPS };

/**
 * Whether the destination actually has public transit, proven rather than assumed.
 *
 * Fills the `transportModes` placeholder in `RawFetch`, a permanent `available: false` since the
 * pipeline shipped ("no reliable free data source for this yet").
 *
 * **`ROUTE_EXISTS` under TRANSIT proves nothing.** Google silently falls back to walking where no
 * transit exists: probed in rural Val d'Orcia, the TRANSIT and WALK responses were byte-identical
 * (3613m, 3301s both). A probe trusting `condition` alone returns `true` for every destination on
 * earth, which would fabricate transit for a car-only region — exactly what the placeholder
 * existed to avoid.
 *
 * So this compares the two modes on the same pair. Transit is only credited when it is materially
 * faster than walking the same leg, which is the observable signature of a real network: Paris
 * returned 1599s by transit against 4322s on foot, while the rural pair returned the identical
 * number twice.
 *
 * One-directional by design — a negative result means "not proven", not "no transit" — so the
 * caller keeps its flagged default rather than asserting absence.
 */
export async function probeTransitAvailable(lat: number, lon: number): Promise<boolean> {
  // ~3.9km north: far enough that a real network beats walking, close enough to stay inside one
  // urban transit system.
  const pair = [
    { lat, lon },
    { lat: lat + 0.035, lon },
  ];

  const [walk, transit] = await Promise.all([
    fetchDayTravelMinutes(pair, "walk"),
    fetchDayTravelMinutes(pair, "transit"),
  ]);

  const walkLeg = walk.get("0->1");
  const transitLeg = transit.get("0->1");
  if (!walkLeg || !transitLeg || walkLeg.minutes <= 0) return false;

  return transitLeg.minutes <= walkLeg.minutes * TRANSIT_SPEEDUP_CEILING;
}
