/**
 * Which map engine draws the world behind the itinerary.
 *
 * There are two, and they are held to being interchangeable: both implement `MapRenderer`
 * (`src/lib/mapRenderer.ts`), and everything above that interface — the camera state machine in
 * `mapCamera.tsx`, the marker layer, the map chrome — is written against it rather than against
 * either engine.
 *
 * - **`cesium`** — CesiumJS with Google Photorealistic 3D Tiles. What this app shipped with, and
 *   still the reference for how the map should behave. Left fully wired: flipping the flag is the
 *   only thing needed to get it back.
 * - **`maplibre`** — MapLibre GL JS over OpenFreeMap vector tiles, with a terrarium DEM for real
 *   elevation and extruded buildings. 3D, deliberately *not* satellite/photographic.
 *
 * The point of the split is measurement. Cesium streams photogrammetry meshes and holds a
 * 512MB tile cache; MapLibre rasterises vector tiles and a DEM. They are not the same load on the
 * GPU, and `docs/map-engine-gpu.md` records what the difference actually is.
 *
 * Resolution order, most specific first:
 *
 * 1. `?map=cesium|maplibre` in the URL — per-tab, survives nothing, ideal for flipping between
 *    the two while a profiler is recording.
 * 2. `localStorage.tripmateMapEngine` — per-browser and sticky, so a comparison session doesn't
 *    need the query string on every navigation.
 * 3. `NEXT_PUBLIC_MAP_ENGINE` in `.env.local` — the build's default.
 * 4. `maplibre`.
 *
 * Read once, to seed the state — after that the Map/Satellite toggle changes it live, and this
 * function is not consulted again. That is a change from how it was: an engine swap used to need a
 * reload, on the reasoning that a viewer is built once and never rebuilt. The reasoning still holds
 * and the conclusion no longer follows, because nothing is rebuilt — **both backgrounds stay
 * mounted for the session** and the toggle only decides which one is visible and building. See
 * `setEngine` in `mapCamera.tsx` for the camera handoff that makes the swap keep its view, and
 * `MapEngineCurtain` for what covers it while the incoming engine draws.
 */
export type MapEngine = "cesium" | "maplibre";

export const MAP_ENGINES: readonly MapEngine[] = ["cesium", "maplibre"];

/** The build-time default. `maplibre` unless `.env.local` says otherwise. */
export const DEFAULT_MAP_ENGINE: MapEngine =
  process.env.NEXT_PUBLIC_MAP_ENGINE === "cesium" ? "cesium" : "maplibre";

const STORAGE_KEY = "tripmateMapEngine";

function parse(value: string | null | undefined): MapEngine | null {
  return value === "cesium" || value === "maplibre" ? value : null;
}

/**
 * The engine this session should use.
 *
 * Safe during SSR — `window` is guarded and the env default is returned — so a module that reads
 * this at import time doesn't have to be client-only.
 */
export function resolveMapEngine(): MapEngine {
  if (typeof window === "undefined") return DEFAULT_MAP_ENGINE;
  const fromQuery = parse(new URLSearchParams(window.location.search).get("map"));
  if (fromQuery) {
    // Sticky, so the choice survives the client-side navigations a comparison run makes. The
    // query string only ever has to be typed once.
    try {
      window.localStorage.setItem(STORAGE_KEY, fromQuery);
    } catch {
      // Private mode / storage disabled. The query param still governs this page.
    }
    return fromQuery;
  }
  try {
    const stored = parse(window.localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Same.
  }
  return DEFAULT_MAP_ENGINE;
}

/** Pin the engine for subsequent loads. Used by the dev overlay's engine switch. */
export function setStoredMapEngine(engine: MapEngine | null) {
  if (typeof window === "undefined") return;
  try {
    if (engine) window.localStorage.setItem(STORAGE_KEY, engine);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — the caller reloads either way and gets the env default.
  }
}
