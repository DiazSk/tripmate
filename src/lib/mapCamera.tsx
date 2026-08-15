"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  ReactNode,
  RefObject,
} from "react";
import type { Entity, Viewer } from "cesium";

interface RouteStop {
  lat: number;
  lng: number;
}

interface MapCameraContextValue {
  setViewer: (viewer: Viewer | null) => void;
  /** The live viewer, for components that drive the camera directly (MapControls). Exposed as
   *  the ref rather than wrapped in per-action context methods — one consumer doesn't justify
   *  five indirections, and camera math is better kept next to the control it belongs to. */
  viewerRef: RefObject<Viewer | null>;
  /** False until the viewer exists — the 3D tileset takes seconds, so map chrome must not
   *  render (and reach for `viewerRef.current`) before then. */
  ready: boolean;
  flyToDestination: (lat: number, lng: number, label?: string) => void;
  flyToPlace: (lat: number, lng: number, label?: string) => void;
  /** Wipe every trip overlay, fly back to the hero pose and resume the idle spin. The globe
   *  lives above the route boundary and never unmounts, so without this a trip's route and
   *  markers survive a navigation back to the landing page. No-ops before the viewer exists. */
  resetToHome: () => void;
  /** Apple-blue stop nodes + a cased blue route line connecting them in order, and a camera
   *  flight framing all of them — call again on every day-tab change. */
  showDayRoute: (stops: RouteStop[]) => void;
  /** Draws real motorway/trunk-road geometry around a city, fetched from OSM Overpass. Fire-and-
   *  forget: failures (rate limit, network) just leave the map without highways rather than
   *  surfacing an error, since this is ambient context, not something the trip depends on. */
  showHighways: (lat: number, lng: number) => void;
  /** Pulsing highlight ring on whichever stop is currently selected; `null` clears it. */
  setActivePin: (stop: RouteStop | null) => void;
}

const MapCameraContext = createContext<MapCameraContextValue | null>(null);

const DESTINATION_HEIGHT_M = 15000;
const PLACE_HEIGHT_M = 600;
/** Mirrors --on-deep / --surface-deep. Cesium wants plain colour strings at label-build time,
 *  so these can't be `var()` — update both here if those tokens move. */
const LABEL_COLOR = "#f4f7fa";
const LABEL_OUTLINE = "#0f172a";
/** The landing-page pose, mirrored from GlobeBackground's initial `setView`. Kept in sync by
 *  hand — these are true altitudes, unlike `flyTo`'s `height` which is a HeadingPitchRange range. */
const HERO_VIEW = { lng: 8, lat: 22, height: 2_500_000, headingDeg: 5, pitchDeg: -45 };
// Apple Maps' systemBlue, matching the reference: one blue for everything routed. The previous
// neon cyan + violet-glow pairing was most of what read as "too vibrant" — Apple's route is a
// flat stroke with a darker casing and no bloom at all.
const ROUTE_BLUE = "#0A84FF";
const ROUTE_CASING = "#0060DF";
const PULSE_PERIOD_MS = 1400;
/** Framing floor for a day's stops, in metres — a lone stop gives a zero-radius sphere, and a
 *  tight cluster gives one small enough that the camera dives into the building mesh. */
const MIN_ROUTE_RADIUS_M = 400;
/** Fraction of the route radius to shove the aim point east by, so the route lands left of the
 *  right-docked itinerary panel. Applied only at the panel's own `sm:` breakpoint. */
const PANEL_BIAS_RATIO = 0.6;
/** Metres above the sampled surface to float the route. Small on purpose: enough to clear the
 *  road mesh without the line reading as detached when the camera drops to street level. */
const ROUTE_CLEARANCE_M = 2;
/** Opacity for route segments that fail the depth test, i.e. the parts running behind or through
 *  buildings. Dimmed rather than hidden so the whole day stays traceable at a low camera angle. */
const ROUTE_OCCLUDED_ALPHA = 0.3;
// Warm gold rather than the UI's amber accent or the route's Apple blue — highways are ambient
// city context, not the thing the app is asking you to look at, so they need their own hue that
// doesn't compete with either.
const HIGHWAY_COLOR = "#F5C242";
const HIGHWAY_CASING = "#8A5A00";
/** Fixed float height for highway lines, in metres. Unlike the day route's per-stop sampling
 *  (sampleRouteAltitude), a highway query can return hundreds of vertices — sampling each would
 *  be slow and isn't worth it for roads that are only ever viewed from a city-wide camera height.
 *  Same "unclamped and floating" reasoning as the day route: CLAMP_TO_GROUND climbs Google 3D
 *  Tiles rooftops, and TERRAIN classification draws nothing with globe.show = false. */
const HIGHWAY_HEIGHT_M = 25;

// Cesium's PinBuilder only draws its own squat rounded-square marker, so the classic teardrop
// comes from an inline SVG instead. `encodeURIComponent` rather than `btoa` — this module is
// imported during SSR, where `btoa` doesn't exist. Red is deliberate and follows Apple's own
// convention: red marks the place you searched for, blue marks the route through it.
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 .8C6 .8 1.2 5.6 1.2 11.6c0 8 10.8 19.6 10.8 19.6s10.8-11.6 10.8-19.6C22.8 5.6 18 .8 12 .8z" fill="#FF3B30" stroke="#C1271F" stroke-width="1.2" stroke-linejoin="round"/><circle cx="12" cy="11.6" r="4.2" fill="#fff"/></svg>`;
const PIN_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PIN_SVG)}`;

type Flight = [lat: number, lng: number, height: number, pitchDeg: number, label?: string];

/**
 * One altitude for the whole day's route, just above street level.
 *
 * `clampToHeightMostDetailed` samples the *tile surface*, and stops sit on buildings — Paris
 * came back 81-139m against ~35m of actual street. Probing the midpoints between consecutive
 * stops as well, then taking the minimum, biases the answer toward the ground: the gaps between
 * venues are usually road or open space. It's an approximation, not a true street elevation, but
 * a flat ribbon a few metres off is invisible at any framing the app actually uses.
 */
async function sampleRouteAltitude(
  viewer: Viewer,
  Cesium: typeof import("cesium"),
  groundPositions: import("cesium").Cartesian3[]
): Promise<number> {
  // Throws rather than returning undefined when the context lacks depth-texture support.
  if (!viewer.scene.clampToHeightSupported) return 0;

  const probes = [...groundPositions];
  for (let i = 1; i < groundPositions.length; i++) {
    probes.push(
      Cesium.Cartesian3.midpoint(
        groundPositions[i - 1],
        groundPositions[i],
        new Cesium.Cartesian3()
      )
    );
  }

  try {
    // Clones because clampToHeightMostDetailed mutates the array it is handed.
    const clamped = await viewer.scene.clampToHeightMostDetailed(probes.map((p) => p.clone()));
    if (viewer.isDestroyed()) return 0;
    const heights = clamped
      .filter((c): c is import("cesium").Cartesian3 => Cesium.defined(c))
      .map((c) => Cesium.Cartographic.fromCartesian(c).height)
      .filter((h) => Number.isFinite(h));
    if (heights.length === 0) return ROUTE_CLEARANCE_M;
    return Math.min(...heights) + ROUTE_CLEARANCE_M;
  } catch {
    // A sampling failure should cost the route its float, not its existence.
    return ROUTE_CLEARANCE_M;
  }
}

export function MapCameraProvider({ children }: { children: ReactNode }) {
  const viewerRef = useRef<Viewer | null>(null);
  const markerRef = useRef<Entity | null>(null);
  const pendingRef = useRef<Flight | null>(null);
  const pendingRouteRef = useRef<RouteStop[] | null>(null);
  const pendingHighwaysRef = useRef<[lat: number, lng: number] | null>(null);
  const routeEntitiesRef = useRef<Entity[]>([]);
  const highwayEntitiesRef = useRef<Entity[]>([]);
  /** Bumped per showHighways call so a slow, superseded fetch (e.g. re-picking a destination
   *  before the previous city's highways landed) can't draw over the newer city's roads. */
  const highwayGenerationRef = useRef(0);
  const activePinRef = useRef<Entity | null>(null);
  /** Altitude the current route was drawn at, so the selection halo lands on the line. */
  const routeAltitudeRef = useRef(0);
  /** Bumped per showDayRoute call so a slow height sample from an older day can't win. */
  const routeGenerationRef = useRef(0);
  const [ready, setReady] = useState(false);

  const flyTo = useCallback(
    (lat: number, lng: number, height: number, pitchDeg: number, label?: string) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) {
        // The viewer registers only once the 3D tileset has loaded, which takes seconds — long
        // after a trip page has fetched its trip and asked to fly. Hold the request and replay
        // it on registration instead of dropping it.
        pendingRef.current = [lat, lng, height, pitchDeg, label];
        return;
      }
      // Flying toward a specific place means the globe shouldn't keep auto-rotating
      // under it — see stopAutoRotate in GlobeBackground.
      (viewer as Viewer & { stopAutoRotate?: () => void }).stopAutoRotate?.();
      import("cesium").then((Cesium) => {
        // The viewer can be torn down while this dynamic import is in flight.
        if (viewer.isDestroyed()) return;

        // One marker at a time: the pin always sits wherever the camera last flew, so a
        // labelless flight (the global reset) just clears it.
        if (markerRef.current) viewer.entities.remove(markerRef.current);
        markerRef.current = label
          ? viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(lng, lat),
              billboard: {
                image: PIN_IMAGE,
                width: 30,
                height: 40,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                // Without this the photorealistic tiles bury the pin inside nearby buildings.
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              label: {
                text: label,
                font: '500 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
                fillColor: Cesium.Color.fromCssColorString(LABEL_COLOR),
                outlineColor: Cesium.Color.fromCssColorString(LABEL_OUTLINE),
                outlineWidth: 4,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -44),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            })
          : null;

        // Frame the target rather than hovering over it: `camera.flyTo` puts the camera *at*
        // these coordinates, so at a downward pitch the place itself sits at nadir, outside the
        // frustum — you'd fly to Rome and never see Rome. A bounding sphere keeps it centred,
        // with `height` read as distance-to-target instead of altitude.
        viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lng, lat), 0),
          {
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(pitchDeg), height),
            duration: 2.5,
          }
        );
      });
    },
    []
  );

  const showDayRoute = useCallback((stops: RouteStop[]) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) {
      // Same race as flyTo: the itinerary renders in a few hundred ms, the tileset takes
      // seconds. Dropping the request here meant the route silently never drew on a cold load.
      pendingRouteRef.current = stops;
      return;
    }
    const generation = ++routeGenerationRef.current;
    import("cesium").then(async (Cesium) => {
      if (viewer.isDestroyed()) return;
      for (const e of routeEntitiesRef.current) viewer.entities.remove(e);
      routeEntitiesRef.current = [];
      if (stops.length === 0) return;

      const groundPositions = stops.map((s) => Cesium.Cartesian3.fromDegrees(s.lng, s.lat));

      // Frame the whole day rather than one point. Selecting a day is an explicit "show me
      // this", so this deliberately overrides wherever the user had dragged the camera. Started
      // before the height sampling below, since framing needs no heights and the 2s flight
      // covers the sampling latency.
      (viewer as Viewer & { stopAutoRotate?: () => void }).stopAutoRotate?.();
      const sphere = Cesium.BoundingSphere.fromPoints(groundPositions);
      const radius = Math.max(sphere.radius, MIN_ROUTE_RADIUS_M);
      // The itinerary panel covers the right ~40% from `sm:` up, so aim east of the route's
      // centre to push the route itself left of the panel — at heading 0, camera-right is
      // local east. Below `sm:` the panel is full-bleed, so centred framing is correct.
      const bias = window.innerWidth >= 640 ? radius * PANEL_BIAS_RATIO : 0;
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(sphere.center);
      const east = Cesium.Cartesian3.fromCartesian4(
        Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4())
      );
      const target = Cesium.Cartesian3.add(
        sphere.center,
        Cesium.Cartesian3.multiplyByScalar(east, bias, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      // Growing the radius by the same bias is what keeps the westernmost stop in frame
      // after the aim point moves east.
      const framed = radius + bias;
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, framed), {
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(-60),
          Math.max(framed * 2.5, 800)
        ),
        duration: 2.0,
      });

      // The line used to use `clampToGround`, which is not "drape on the ground" — it builds a
      // classification primitive that projects onto the Google 3D tile geometry, rooftops
      // included, so a straight hop across a block climbed every building in its path. Switching
      // classificationType can't help: CESIUM_3D_TILE is that same behaviour, and TERRAIN draws
      // nothing at all here because the classification shader reads back the globe depth texture
      // and this app runs with `globe.show = false`. So the line is unclamped and floats just
      // above the surface instead.
      //
      // Drawn immediately at the last route's altitude and corrected once the real sample lands,
      // rather than awaiting first. Height sampling takes ~1.3s alone but several seconds when
      // day-tab clicks stack the requests up, which left the map visibly empty. Consecutive days
      // of one trip share a city, so the previous altitude is a near-perfect stand-in; the very
      // first route falls back to 0 and visibly settles once.
      const altitudeAtDraw = routeAltitudeRef.current;
      const positionsAt = (h: number) =>
        stops.map((s) => Cesium.Cartesian3.fromDegrees(s.lng, s.lat, h));
      const positions = positionsAt(altitudeAtDraw);

      // Apple's route styling: a solid stroke with a darker casing, no glow. The casing is
      // what keeps it legible over both pale pavement and dark water.
      routeEntitiesRef.current.push(
        viewer.entities.add({
          polyline: {
            positions,
            width: 6,
            arcType: Cesium.ArcType.GEODESIC,
            material: new Cesium.PolylineOutlineMaterialProperty({
              color: Cesium.Color.fromCssColorString(ROUTE_BLUE),
              outlineColor: Cesium.Color.fromCssColorString(ROUTE_CASING),
              outlineWidth: 2,
            }),
            // Segments running behind or through buildings draw dimmed rather than disappearing,
            // so the whole day stays traceable from a low angle. Only available unclamped — the
            // ground path returns its geometry before the depth-fail attribute is ever attached.
            depthFailMaterial: new Cesium.ColorMaterialProperty(
              Cesium.Color.fromCssColorString(ROUTE_BLUE).withAlpha(ROUTE_OCCLUDED_ALPHA)
            ),
          },
        })
      );

      // Blue disc with a white ring at each stop, matching the reference's route pins. Placed at
      // the same altitude as the line — CLAMP_TO_GROUND would resolve against the hidden globe
      // (height 0) and visibly detach the dots from the line at an oblique angle.
      const dotEntities = positions.map((position) =>
        viewer.entities.add({
          position,
          point: {
            pixelSize: 11,
            color: Cesium.Color.fromCssColorString(ROUTE_BLUE),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      );
      routeEntitiesRef.current.push(...dotEntities);
      const lineEntity = routeEntitiesRef.current[0];

      const altitude = await sampleRouteAltitude(viewer, Cesium, groundPositions);
      // A fast day-tab switch can land a newer route mid-sample; the newest request wins, and a
      // superseded generation's entities are already gone from the collection.
      if (generation !== routeGenerationRef.current || viewer.isDestroyed()) return;
      routeAltitudeRef.current = altitude;
      if (Math.abs(altitude - altitudeAtDraw) < 0.5) return;

      const corrected = positionsAt(altitude);
      lineEntity.polyline!.positions = new Cesium.ConstantProperty(corrected);
      dotEntities.forEach((e, i) => {
        e.position = new Cesium.ConstantPositionProperty(corrected[i]);
      });
    });
  }, []);

  const showHighways = useCallback((lat: number, lng: number) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) {
      // Same cold-load race as flyTo/showDayRoute: the destination flight can be requested
      // before the tileset (and thus the viewer) registers. Replayed from setViewer below.
      pendingHighwaysRef.current = [lat, lng];
      return;
    }

    const generation = ++highwayGenerationRef.current;
    (async () => {
      let segments: { points: { lat: number; lng: number }[] }[];
      try {
        const res = await fetch(`/api/roads?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load highways");
        segments = data.segments;
      } catch {
        return; // Ambient context, not core to the trip — a miss here just leaves them off.
      }
      if (generation !== highwayGenerationRef.current || viewer.isDestroyed()) return;

      const Cesium = await import("cesium");
      if (generation !== highwayGenerationRef.current || viewer.isDestroyed()) return;
      for (const e of highwayEntitiesRef.current) viewer.entities.remove(e);
      highwayEntitiesRef.current = segments.map((segment) =>
        viewer.entities.add({
          polyline: {
            positions: segment.points.map((p) =>
              Cesium.Cartesian3.fromDegrees(p.lng, p.lat, HIGHWAY_HEIGHT_M)
            ),
            width: 3,
            arcType: Cesium.ArcType.GEODESIC,
            material: new Cesium.PolylineOutlineMaterialProperty({
              color: Cesium.Color.fromCssColorString(HIGHWAY_COLOR),
              outlineColor: Cesium.Color.fromCssColorString(HIGHWAY_CASING),
              outlineWidth: 1,
            }),
            // HIGHWAY_HEIGHT_M is a fixed height above the *ellipsoid*, not local terrain — the
            // real ground surface is routinely tens of metres higher (see sampleRouteAltitude's
            // own comment on this), so the line sits *below* the visible 3D-tile surface almost
            // everywhere and would otherwise fail the depth test and never be seen. Sampling
            // real terrain height per vertex isn't worth it for a query that can return hundreds
            // of points, so instead — same fallback the day route uses for occluded segments —
            // draw the full-strength colour on depth-fail too, making it effectively always-on.
            depthFailMaterial: new Cesium.ColorMaterialProperty(
              Cesium.Color.fromCssColorString(HIGHWAY_COLOR)
            ),
          },
        })
      );
    })();
  }, []);

  const setViewer = useCallback(
    (viewer: Viewer | null) => {
      viewerRef.current = viewer;
      if (!viewer) {
        markerRef.current = null;
        routeEntitiesRef.current = [];
        highwayEntitiesRef.current = [];
        activePinRef.current = null;
        setReady(false);
        return;
      }
      setReady(true);
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) flyTo(...pending);
      // Replayed after the flight so its framing wins — a queued route is the more specific
      // request, and both resolve to a flyToBoundingSphere where the last call cancels the first.
      const pendingRoute = pendingRouteRef.current;
      pendingRouteRef.current = null;
      if (pendingRoute) showDayRoute(pendingRoute);
      const pendingHighways = pendingHighwaysRef.current;
      pendingHighwaysRef.current = null;
      if (pendingHighways) showHighways(...pendingHighways);
    },
    [flyTo, showDayRoute, showHighways]
  );

  const flyToDestination = useCallback(
    (lat: number, lng: number, label?: string) => flyTo(lat, lng, DESTINATION_HEIGHT_M, -45, label),
    [flyTo]
  );
  const flyToPlace = useCallback(
    (lat: number, lng: number, label?: string) => flyTo(lat, lng, PLACE_HEIGHT_M, -35, label),
    [flyTo]
  );
  const resetToHome = useCallback(() => {
    const viewer = viewerRef.current;
    // No-op before the viewer exists, which is exactly right on a cold load of `/`: the home
    // effect fires long before the tileset registers, so GlobeBackground's own setView and spin
    // proceed untouched. On a soft navigation the viewer always exists, so this always runs.
    if (!viewer || viewer.isDestroyed()) return;

    routeGenerationRef.current++;
    for (const e of routeEntitiesRef.current) viewer.entities.remove(e);
    routeEntitiesRef.current = [];
    highwayGenerationRef.current++;
    for (const e of highwayEntitiesRef.current) viewer.entities.remove(e);
    highwayEntitiesRef.current = [];
    if (markerRef.current) viewer.entities.remove(markerRef.current);
    markerRef.current = null;
    if (activePinRef.current) viewer.entities.remove(activePinRef.current);
    activePinRef.current = null;
    // Otherwise a request queued while the tileset was loading replays onto the empty globe.
    pendingRef.current = null;
    pendingRouteRef.current = null;
    pendingHighwaysRef.current = null;

    import("cesium").then((Cesium) => {
      if (viewer.isDestroyed()) return;
      // camera.flyTo directly rather than this module's flyTo helper — that one calls
      // stopAutoRotate on every invocation, which is the opposite of what's wanted here.
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(HERO_VIEW.lng, HERO_VIEW.lat, HERO_VIEW.height),
        orientation: {
          heading: Cesium.Math.toRadians(HERO_VIEW.headingDeg),
          pitch: Cesium.Math.toRadians(HERO_VIEW.pitchDeg),
          roll: 0,
        },
        duration: 2.0,
        complete: () =>
          (viewer as Viewer & { startAutoRotate?: () => void }).startAutoRotate?.(),
      });
    });
  }, []);

  const setActivePin = useCallback((stop: RouteStop | null) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    import("cesium").then((Cesium) => {
      if (viewer.isDestroyed()) return;
      if (activePinRef.current) {
        viewer.entities.remove(activePinRef.current);
        activePinRef.current = null;
      }
      if (!stop) return;

      const startedAt = performance.now();
      activePinRef.current = viewer.entities.add({
        // Same altitude the route was drawn at, so the halo sits on its stop dot rather than
        // clamping to the hidden globe at height 0.
        position: Cesium.Cartesian3.fromDegrees(stop.lng, stop.lat, routeAltitudeRef.current),
        point: {
          // Pulsing halo: size oscillates continuously while this stop is active. Narrow
          // amplitude on purpose — a 10→22px swing read as a throb; 14→20 reads as a breath.
          pixelSize: new Cesium.CallbackProperty(() => {
            const phase = ((performance.now() - startedAt) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
            return 17 + Math.sin(phase * Math.PI * 2) * 3;
          }, false),
          color: Cesium.Color.fromCssColorString(ROUTE_BLUE).withAlpha(0.22),
          outlineColor: Cesium.Color.fromCssColorString(ROUTE_BLUE),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });
  }, []);

  return (
    <MapCameraContext.Provider
      value={{
        setViewer,
        viewerRef,
        ready,
        flyToDestination,
        flyToPlace,
        resetToHome,
        showDayRoute,
        showHighways,
        setActivePin,
      }}
    >
      {children}
    </MapCameraContext.Provider>
  );
}

export function useMapCamera() {
  const ctx = useContext(MapCameraContext);
  if (!ctx) throw new Error("useMapCamera must be used within MapCameraProvider");
  return ctx;
}
