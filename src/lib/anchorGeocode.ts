import type { Anchor } from "./types";

/** Fuzzy lookups are one Overpass request per name — see placeSearch.ts on rate limits. */
const MAX_FUZZY_LOOKUPS = 8;

/** Total wall-clock budget for the whole call, batch resolve plus every fuzzy lookup. Without
 *  it, one unresolvable name (a live Overpass query with no deadline) can run the fuzzy loop for
 *  minutes and stall both callers (runGeneration, /api/import) — see anchorGeocode.test.mjs. */
const DEFAULT_BUDGET_MS = 12_000;

/** Resolves to `undefined` if `ms` elapses before `promise` does; the timeout never rejects. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  if (ms <= 0) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(undefined); }
    );
  });
}

export interface GeocodeDeps {
  resolve: (names: string[], near: { lat: number; lon: number }) => Promise<Record<string, { lat: number; lon: number }>>;
  search: (name: string, near: { lat: number; lon: number }) => Promise<{ lat: number; lng: number } | null>;
}

let _defaultDeps: GeocodeDeps | undefined;

async function getDefaultDeps(): Promise<GeocodeDeps> {
  if (!_defaultDeps) {
    // Lazy imports to avoid loading server dependencies until needed
    const { resolveNamedPlaceCoords } = await import("./poiDetails");
    const { searchPlaces } = await import("./placeSearch");
    _defaultDeps = {
      resolve: (names, near) => resolveNamedPlaceCoords(names, near),
      search: async (name, near) => {
        const res = await searchPlaces({ lat: near.lat, lng: near.lon, query: name, radiusM: 30000 });
        const hit = res.places[0];
        return hit ? { lat: hit.lat, lng: hit.lng } : null;
      },
    };
  }
  return _defaultDeps;
}

/** Fills missing coordinates: one batched OSM query, then a few fuzzy lookups. Never throws;
 *  anything still unplaced keeps null coordinates and reaches the model by name. */
export async function geocodeAnchors(
  anchors: Anchor[],
  near: { lat: number; lon: number },
  deps?: GeocodeDeps,
  budgetMs: number = DEFAULT_BUDGET_MS
): Promise<Anchor[]> {
  deps ??= await getDefaultDeps();
  const missing = anchors.filter((a) => a.lat === null || a.lng === null).map((a) => a.name);
  if (missing.length === 0) return anchors;
  const deadline = Date.now() + budgetMs;
  let batch: Record<string, { lat: number; lon: number }> = {};
  try {
    batch = (await withDeadline(deps.resolve(missing, near), deadline - Date.now())) ?? {};
  } catch (err) {
    console.error("[anchors] batch geocode failed", err);
  }
  const found = new Map<string, { lat: number; lng: number }>();
  for (const name of missing) {
    const hit = batch[name.trim()];
    if (hit) found.set(name, { lat: hit.lat, lng: hit.lon });
  }
  for (const name of missing.filter((n) => !found.has(n)).slice(0, MAX_FUZZY_LOOKUPS)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const hit = await withDeadline(deps.search(name, near), remaining);
      if (hit) found.set(name, hit);
    } catch (err) {
      console.error("[anchors] fuzzy geocode failed", err);
    }
  }
  return anchors.map((a) => {
    const hit = found.get(a.name);
    return hit ? { ...a, lat: hit.lat, lng: hit.lng } : a;
  });
}
