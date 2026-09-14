"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useMapCamera } from "@/lib/mapCamera";
import { MapLibreRenderer, createMapLibreMap } from "@/lib/maplibreRenderer";
import { dayPhase } from "@/lib/mapRoute";

/**
 * The MapLibre GL JS half of the map layer — the flag-off alternative to `GlobeBackground`.
 *
 * It is a deliberate mirror of that component rather than an independent design, because the
 * things `GlobeBackground` had to work out are not Cesium-specific:
 *
 * - **The map is built once and never swapped.** `built` is a one-way latch on `globeWanted`, set
 *   during render and never reset. Tearing a map down loses the camera pose, the tile cache and
 *   every source the provider's pending queues were replayed into — see `GlobeBackground`'s
 *   construction effect for the full account. Leaving a map surface hides the canvas; it does not
 *   destroy it.
 * - **Hidden with `invisible`, never `display: none` or an unmount.** Visibility keeps the drawing
 *   buffer and `canvas.clientWidth/Height` alive, which the marker layer reads every frame, and it
 *   also takes the canvas out of hit-testing — which is how a wheel over a scrollable panel stops
 *   being eaten as a map zoom.
 * - **The render loop is gated on `globeWanted`.** MapLibre has no `useDefaultRenderLoop`, so the
 *   equivalent is `map.stop()` plus letting it idle: with nothing animating and nothing to fetch
 *   it settles to zero GPU work of its own. This matters for the same reason it did on Cesium —
 *   every map frame forces every `backdrop-filter` glass panel above it to re-blur.
 * - **Day/night is a CSS blend sheet, not a light.** Identical to the Cesium path: `.globe-tint`
 *   carries a `data-phase` and the tiles underneath are untouched.
 */
export default function MapLibreBackground({
  active = true,
  creditClassName = "",
}: {
  /**
   * Whether this is the engine currently drawing the world.
   *
   * Both backgrounds are mounted at all times (see `AppShell`), and this is what keeps the
   * inactive one from building a map, streaming a tile or painting a frame. Combined with
   * `globeWanted` rather than replacing it: a surface still has to *want* a map at all before
   * either engine is worth constructing.
   */
  active?: boolean;
  creditClassName?: string;
}) {
  const { setRenderer, globeWanted: mapWanted, routeStops, activeIndex, hoveredIndex } =
    useMapCamera();
  const globeWanted = mapWanted && active;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  /** The in-flight construction, held so a second effect run adopts it — see the effect below. */
  const mapPromiseRef = useRef<Promise<MapLibreMap> | null>(null);
  const [failed, setFailed] = useState(false);

  // One-way latch, set during render: once a surface has asked for the map, it exists for the rest
  // of the session. State rather than a ref, matching `GlobeBackground` — a render-phase set is
  // React's own supported way to derive state from props, and a ref read during render is not.
  const [built, setBuilt] = useState(false);
  if (globeWanted && !built) setBuilt(true);

  useEffect(() => {
    if (!built) return;
    const container = containerRef.current;
    if (!container) return;

    // The construction *promise* is the ref, not the finished map.
    //
    // React runs this effect twice in development (StrictMode: setup → cleanup → setup), and
    // building the map is asynchronous, so any guard on the finished map is still null the second
    // time through. That built a second `maplibregl.Map` into the same container — verified: two
    // `.maplibregl-canvas` nodes, two WebGL contexts, two tile streams for one map. Holding the
    // promise makes the second setup adopt the first one's map instead of starting another.
    //
    // The map is never removed on cleanup, for the reason `GlobeBackground`'s construction effect
    // documents at length: this component is mounted from the root layout for the life of the
    // session, and tearing the map down would lose the camera pose, the tile cache and every
    // source the provider's pending queues were replayed into. Leaving a map surface hides the
    // canvas; it does not destroy it.
    mapPromiseRef.current ??= createMapLibreMap(container);
    let cancelled = false;

    void mapPromiseRef.current.then(
      (map) => {
        if (cancelled) return;
        mapRef.current = map;

        // Dev-only handle, mirroring `__tripmateViewer`: sources and layers after a day switch,
        // camera pose, tile detail. Nothing else reaches the map — it lives in a closure here and
        // behind a `MapRenderer` in mapCamera.
        if (process.env.NODE_ENV === "development") {
          (window as Window & { __tripmateMap?: unknown }).__tripmateMap = map;
        }

        setRenderer(new MapLibreRenderer(map));
      },
      (err) => {
        // Fail-soft: a map that cannot boot should leave the interface intact and unstyled behind
        // it, not throw through the root layout. There is no imagery fallback to reach for the way
        // Cesium falls back from photogrammetry to OSM raster — this *is* the raster-free path.
        //
        // Logged rather than swallowed. A silent catch here cost real debugging time: the map
        // object exists and its canvas is in the DOM by the time a style or layer error throws, so
        // the page looks like it has a working map and merely never draws a route.
        console.error("[MapLibreBackground] map failed to boot", err);
        mapPromiseRef.current = null;
        if (!cancelled) setFailed(true);
      }
    );

    return () => {
      cancelled = true;
      setRenderer(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  // Stop animating while no surface wants the map on screen. MapLibre repaints on demand already,
  // but an in-flight `flyTo` would otherwise keep running — and repainting — behind a route that
  // has no map in it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!globeWanted) map.stop();
    else map.triggerRepaint();
  }, [globeWanted]);

  // The canvas has to be told when its box changed; the container is `inset-0` and the app shell
  // is `h-dvh`, so this fires on viewport resize and on nothing else.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  /**
   * How lit the world should be: the clock time of the stop being pointed at, and nothing else.
   *
   * Deliberately a CSS blend sheet rather than a real sun — the tiles are flat-shaded vector art
   * with no lighting model to drive, so a light would do nothing and a tint does everything.
   *
   * **This used to fall back to `routeStops[0]`, which is not what that index means.** The comment
   * here called it "the first stop of the day on screen"; `showTripRoute` publishes
   * `days.flat()`, so index 0 is the first stop of the **trip**, whichever day is focused. On a
   * trip whose day 1 is an evening arrival — 20:00, `dayPhase` → `night` — every other day was
   * tinted for 8pm, because `showTripRoute` clears `hoveredIndex` and `activeIndex` on every
   * rebuild (stale indices into a list whose length changes) and so a day switch always landed on
   * the fallback. Day 2 opened at 9:30 in the dark.
   *
   * Nothing pointed at is now `undefined` is `"day"` is no tint at all, which is what the Cesium
   * path has always done and what both of this file's comments already claimed this one did.
   */
  const pointedAt = hoveredIndex ?? activeIndex;
  const phase = dayPhase(pointedAt === null ? undefined : routeStops[pointedAt]?.time);

  return (
    <div
      // `invisible`, never unmounted — see the component comment.
      className={`absolute inset-0 ${built && globeWanted ? "" : "invisible"}`}
      data-map-engine="maplibre"
    >
      <div ref={containerRef} className="absolute inset-0" />
      <div className="globe-tint pointer-events-none absolute inset-0" data-phase={phase} />
      {/* OpenFreeMap and the DEM both want attribution, and MapLibre's own control is disabled so
          the app can place it in the same corner Cesium's credit container uses. */}
      <div className={`pointer-events-auto text-[0.6875rem] text-white/45 ${creditClassName}`}>
        {failed ? (
          "Map unavailable"
        ) : (
          <>
            <a href="https://openfreemap.org/" rel="noreferrer" target="_blank">
              OpenFreeMap
            </a>
            {" · "}
            <a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">
              OpenStreetMap
            </a>
            {" · "}
            <a
              href="https://registry.opendata.aws/terrain-tiles/"
              rel="noreferrer"
              target="_blank"
            >
              Terrain Tiles
            </a>
          </>
        )}
      </div>
    </div>
  );
}
