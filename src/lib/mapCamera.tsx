"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
  RefObject,
} from "react";
import type { Entity, Viewer } from "cesium";
import {
  buildRouteGeometry,
  RouteGeometry,
  RouteStop,
  sampleRouteAltitude,
  STEM_HEIGHT_M,
} from "@/lib/mapRoute";

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
  /** Lit stems out of glow pools at each stop, a route line connecting them in order, and a
   *  camera flight framing all of them — call again on every day-tab change. */
  showDayRoute: (stops: RouteStop[]) => void;
  /** The stops currently drawn, for StopMarkerLayer to render an HTML card per stop. State
   *  rather than a ref because the card list is real DOM that has to change when the day does. */
  routeStops: RouteStop[];
  /** Altitude the current route is drawn at. A ref, not state: the marker layer reads it once
   *  per frame to place cards on top of the stems, and that must not re-render anything. */
  routeAltitudeRef: RefObject<number>;
  /**
   * Index of the stop being pointed at, from either side — a marker card or an itinerary row.
   * Both surfaces read the same value, which is what makes the highlight bidirectional without
   * either needing to know anything about the other.
   *
   * Plain state rather than a subscription: hover changes at human speed, a few times a second,
   * so a context re-render is cheap. It is the *positioning* loop that must never re-render, and
   * that reads refs only.
   */
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
  /** Index of the selected stop — clicked, or stepped onto by the tour. Outlives hover. */
  activeIndex: number | null;
  setActiveIndex: (index: number | null) => void;
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
/** Framing floor for a day's stops, in metres — a lone stop gives a zero-radius sphere, and a
 *  tight cluster gives one small enough that the camera dives into the building mesh. */
const MIN_ROUTE_RADIUS_M = 400;
/** Fraction of the route radius to shove the aim point east by, so the route lands left of the
 *  right-docked itinerary panel. Applied only at the panel's own `sm:` breakpoint. */
const PANEL_BIAS_RATIO = 0.6;

// Cesium's PinBuilder only draws its own squat rounded-square marker, so the classic teardrop
// comes from an inline SVG instead. `encodeURIComponent` rather than `btoa` — this module is
// imported during SSR, where `btoa` doesn't exist. Red is deliberate and follows Apple's own
// convention: red marks the place you searched for, blue marks the route through it.
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 .8C6 .8 1.2 5.6 1.2 11.6c0 8 10.8 19.6 10.8 19.6s10.8-11.6 10.8-19.6C22.8 5.6 18 .8 12 .8z" fill="#FF3B30" stroke="#C1271F" stroke-width="1.2" stroke-linejoin="round"/><circle cx="12" cy="11.6" r="4.2" fill="#fff"/></svg>`;
const PIN_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PIN_SVG)}`;

type Flight = [
  lat: number,
  lng: number,
  height: number,
  pitchDeg: number,
  label?: string,
  centreHeightM?: number,
];

export function MapCameraProvider({ children }: { children: ReactNode }) {
  const viewerRef = useRef<Viewer | null>(null);
  const markerRef = useRef<Entity | null>(null);
  const pendingRef = useRef<Flight | null>(null);
  const pendingRouteRef = useRef<RouteStop[] | null>(null);
  const routeEntitiesRef = useRef<Entity[]>([]);
  /** Altitude the current route was drawn at, so new geometry lands on the arcs. */
  const routeAltitudeRef = useRef(0);
  /** Bumped per showDayRoute call so a slow height sample from an older day can't win. */
  const routeGenerationRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  /** The live geometry, so hover emphasis can reach it without rebuilding the route. */
  const routeGeometryRef = useRef<RouteGeometry | null>(null);

  const flyTo = useCallback(
    (
      lat: number,
      lng: number,
      height: number,
      pitchDeg: number,
      label?: string,
      /** Altitude of the point to centre in frame. Zero aims at the ellipsoid surface, which for
       *  a stop means aiming below the street; a stop flight passes its card's height instead. */
      centreHeightM = 0
    ) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) {
        // The viewer registers only once the 3D tileset has loaded, which takes seconds — long
        // after a trip page has fetched its trip and asked to fly. Hold the request and replay
        // it on registration instead of dropping it.
        pendingRef.current = [lat, lng, height, pitchDeg, label, centreHeightM];
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
          new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lng, lat, centreHeightM), 0),
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
    // Published before the viewer check: the cards are plain DOM and cost nothing to mount
    // early, and they stay hidden until the per-frame loop has a viewer to project them with.
    setRouteStops(stops);
    // A new day means no stop is hovered or selected, and stale indices would be wrong rather
    // than merely unhelpful — day 1 of the preview trip has 8 stops and day 2 has 7, so index 7
    // would emphasise nothing while still reading as a selection in the panel.
    setHoveredIndex(null);
    setActiveIndex(null);
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

      // Drawn immediately at the last route's altitude and corrected once the real sample lands,
      // rather than awaiting first. Height sampling takes ~1.3s alone but several seconds when
      // day-tab clicks stack the requests up, which left the map visibly empty. Consecutive days
      // of one trip share a city, so the previous altitude is a near-perfect stand-in; the very
      // first route falls back to 0 and visibly settles once.
      const altitudeAtDraw = routeAltitudeRef.current;
      const geometry = buildRouteGeometry(viewer, Cesium, stops, altitudeAtDraw);
      routeEntitiesRef.current = geometry.entities;
      routeGeometryRef.current = geometry;

      const altitude = await sampleRouteAltitude(viewer, Cesium, groundPositions);
      // A fast day-tab switch can land a newer route mid-sample; the newest request wins, and a
      // superseded generation's entities are already gone from the collection.
      if (generation !== routeGenerationRef.current || viewer.isDestroyed()) return;
      routeAltitudeRef.current = altitude;
      if (Math.abs(altitude - altitudeAtDraw) < 0.5) return;
      geometry.reposition(altitude);
    });
  }, []);

  // Hover wins over selection: while the pointer is on something, that is what the globe should
  // be pointing at. Falls back to the selected stop when the pointer leaves.
  useEffect(() => {
    routeGeometryRef.current?.setEmphasis(hoveredIndex ?? activeIndex);
  }, [hoveredIndex, activeIndex, routeStops]);

  const setViewer = useCallback(
    (viewer: Viewer | null) => {
      viewerRef.current = viewer;
      if (!viewer) {
        markerRef.current = null;
        routeEntitiesRef.current = [];
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
    },
    [flyTo, showDayRoute]
  );

  const flyToDestination = useCallback(
    (lat: number, lng: number, label?: string) =>
      flyTo(lat, lng, DESTINATION_HEIGHT_M, -45, label),
    [flyTo]
  );
  /**
   * Fly to one stop of the current day, framing its floating card rather than the ground.
   *
   * The card is the thing that names the place, so it is what the camera should arrive on. Aiming
   * at the default ellipsoid surface put the card near the top edge of the frame — or out of it —
   * and centred a patch of road instead, which is what made both the Play tour and a marker click
   * look like they were zooming to the bottom of the marker.
   *
   * Every stop flight goes through here — the tour, a marker click, and an itinerary row — so
   * they all arrive the same way.
   */
  const flyToPlace = useCallback(
    (lat: number, lng: number, label?: string) =>
      flyTo(lat, lng, PLACE_HEIGHT_M, -35, label, routeAltitudeRef.current + STEM_HEIGHT_M),
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
    // Otherwise the day's marker cards survive a navigation back to the landing page — the
    // globe never unmounts, so nothing else clears them.
    setRouteStops([]);
    setHoveredIndex(null);
    setActiveIndex(null);
    routeGeometryRef.current = null;
    if (markerRef.current) viewer.entities.remove(markerRef.current);
    markerRef.current = null;
    // Otherwise a request queued while the tileset was loading replays onto the empty globe.
    pendingRef.current = null;
    pendingRouteRef.current = null;

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
        routeStops,
        routeAltitudeRef,
        hoveredIndex,
        setHoveredIndex,
        activeIndex,
        setActiveIndex,
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
