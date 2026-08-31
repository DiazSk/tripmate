import type { TransportMode } from "./types";

/**
 * OSRM's free public demo instance. Shared infra, not a committed SLA: usage guidance caps it at
 * ~1 req/sec and 5000 req/min service-wide, offers no uptime guarantee, and access can be
 * withdrawn without notice.
 */
const OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1";

/** Keeps a request to the shared demo server small — a pathological day degrades to no data
 *  instead of a slow dense matrix nobody asked for. */
const MAX_MATRIX_STOPS = 10;

/**
 * The public demo server hosts only the driving/car road network. `walking`, `foot`, and `cycling`
 * are all accepted in the URL but verified live to return byte-identical numbers to `driving` for
 * the same coordinates — the profile segment is silently ignored rather than rejected. Reporting
 * those as real walking times would misrepresent car speeds as foot speeds, so every routable mode
 * maps to the one profile that's actually real, and transit has no profile at all.
 */
const MODE_BY_TRANSPORT: Partial<Record<TransportMode, string>> = {
  walk: "driving",
  drive: "driving",
};

export interface RealLeg {
  fromIndex: number;
  toIndex: number;
  minutes: number;
  distanceMeters: number | null;
}

/**
 * Pure. Reads the Table response into consecutive-leg minutes.
 *
 * OSRM returns dense `durations`/`distances` matrices (seconds/meters) rather than a flat element
 * list; an unroutable pair is `null` in both arrays at `[i][j]` rather than a per-element status
 * field. Self-pairs (`i === j`) are dropped, as is anything with a `null`/non-numeric duration — an
 * unroutable pair is missing data, not a zero-minute hop, and the caller's existing haversine
 * estimate is the honest fallback for it.
 */
export function distilRouteMatrix(raw: unknown): RealLeg[] {
  const data = raw as { durations?: unknown; distances?: unknown; code?: unknown } | null;
  if (data?.code !== "Ok" || !Array.isArray(data.durations)) return [];
  const distances = Array.isArray(data.distances) ? data.distances : [];
  const legs: RealLeg[] = [];
  data.durations.forEach((row, i) => {
    if (!Array.isArray(row)) return;
    row.forEach((seconds, j) => {
      if (i === j || typeof seconds !== "number") return;
      const distanceMeters = distances[i]?.[j];
      legs.push({
        fromIndex: i,
        toIndex: j,
        minutes: Math.round(seconds / 60),
        distanceMeters: typeof distanceMeters === "number" ? distanceMeters : null,
      });
    });
  });
  return legs;
}

/**
 * Real door-to-door durations for one day's stops, as a lookup keyed `"from->to"`.
 *
 * One call covers the whole N×N cross product — measured ~2.9s for 3×3 — so this is a per-DAY
 * cost, not per-leg. The full matrix is requested rather than only consecutive pairs because it
 * costs the same and also answers §3c ("is this day's route actually clustered").
 *
 * Resolves an empty map on any failure (including a transit-mode request, for which OSRM has no
 * profile at all), so callers fall back to `travelLegBetween`'s estimate, which already flags
 * itself `estimated: true`.
 */
export async function fetchDayTravelMinutes(
  points: { lat: number; lon: number }[],
  mode: TransportMode = "walk"
): Promise<Map<string, RealLeg>> {
  const out = new Map<string, RealLeg>();
  if (points.length < 2 || points.length > MAX_MATRIX_STOPS) return out;

  const profile = MODE_BY_TRANSPORT[mode];
  if (!profile) return out;

  // OSRM takes `lon,lat` order — the reverse of this app's `{lat, lon}` convention everywhere else.
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");

  try {
    const res = await fetch(
      `${OSRM_TABLE_URL}/${profile}/${coords}?annotations=duration,distance`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return out;
    const data = await res.json();
    for (const leg of distilRouteMatrix(data)) {
      out.set(`${leg.fromIndex}->${leg.toIndex}`, leg);
    }
  } catch {
    return out;
  }
  return out;
}

export { MAX_MATRIX_STOPS };

/**
 * Fills the `transportModes` placeholder in `RawFetch`, a permanent `available: false` since the
 * pipeline shipped ("no reliable free data source for this yet").
 *
 * No free transit-routing data source exists — OSRM's public demo hosts only the driving profile
 * (see `MODE_BY_TRANSPORT`). Always false, consistent with this function's own documented contract:
 * a negative result means "not proven," not "no transit."
 */
export async function probeTransitAvailable(): Promise<boolean> {
  return false;
}
