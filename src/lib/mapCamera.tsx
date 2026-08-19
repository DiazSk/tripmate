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
import type { Cartesian3, Entity, Viewer } from "cesium";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import {
  buildRouteGeometry,
  RouteGeometry,
  RouteStop,
  sampleRouteAltitude,
  STEM_HEIGHT_M,
} from "@/lib/mapRoute";

/**
 * How much globe a surface is asking for.
 *
 * - `off` — no viewer at all: no Cesium bundle, no WebGL context, no tile stream. A static
 *   poster (`GlobePoster`) stands in. This is the state every route starts in.
 * - `static` — the real globe, parked at the hero pose with camera input disabled. Under
 *   `requestRenderMode` that means it draws the frames it takes to stream in and then stops
 *   dead: a picture of the Earth that costs nothing to keep on screen. The landing page's
 *   backdrop.
 * - `live` — the same viewer with input enabled, flying and drawing on demand.
 *
 * `static` and `live` differ only in `enableInputs`, deliberately: switching between them must
 * never rebuild the viewer, because a rebuild is seconds of re-fetched tiles.
 */
export type GlobeMode = "off" | "static" | "live";

/** The landing-page pose. A true altitude, unlike `flyTo`'s `height`, which is a
 *  HeadingPitchRange *range*. Exported so GlobeBackground's initial `setView` and this
 *  module's flight home read the same numbers instead of keeping two copies in sync by hand. */
export const HERO_VIEW = {
  lng: 8,
  lat: 22,
  height: 2_500_000,
  headingDeg: 5,
  pitchDeg: -45,
};

interface MapCameraContextValue {
  setViewer: (viewer: Viewer | null) => void;
  /** Which of the three backdrop states the app is in. See `GlobeMode`. */
  globeMode: GlobeMode;
  /**
   * Whether the parked globe should drift.
   *
   * Requested by the one section that actually shows the globe (the landing story's reveal),
   * and only while it is on screen — rotation is the single most expensive thing this app can
   * do, since a moving camera renders every frame by definition, so it is scoped to the moment
   * it is being looked at rather than left on for the session. Ignored outside `static`: in
   * `live` the camera belongs to the user, and drifting under a flight makes no sense.
   */
  globeSpinning: boolean;
  setGlobeSpinning: (spinning: boolean) => void;
  /** Go `live`: build the viewer if it isn't up, and hand the camera to the user. Idempotent —
   *  every camera request that genuinely needs interactive 3D calls it, so activation follows
   *  intent rather than needing its own plumbing per caller. */
  activateGlobe: () => void;
  /** Place whose photo backs the poster while the globe is down — the city overview state.
   *  Null falls back to the plain globe still used on the landing sequence. */
  posterPlace: string | null;
  setPosterPlace: (place: string | null) => void;
  /** The live viewer, for components that drive the camera directly (MapControls). Exposed as
   *  the ref rather than wrapped in per-action context methods — one consumer doesn't justify
   *  five indirections, and camera math is better kept next to the control it belongs to. */
  viewerRef: RefObject<Viewer | null>;
  /** False until the viewer exists — the 3D tileset takes seconds, so map chrome must not
   *  render (and reach for `viewerRef.current`) before then. */
  ready: boolean;
  flyToDestination: (lat: number, lng: number, label?: string) => void;
  flyToPlace: (lat: number, lng: number, label?: string) => void;
  /** Wipe every trip overlay and fly the camera back to the hero pose, dropping to `static`.
   *  The globe lives above the route boundary and is never unmounted by routing, so without
   *  this a trip's route and markers would survive a navigation back to the landing page. */
  resetToHome: () => void;
  /** Lit stems out of glow pools at each stop, a route line connecting them in order, and a
   *  camera flight framing all of them — call again on every day-tab change. */
  showDayRoute: (stops: RouteStop[]) => void;
  /** Draws real motorway/trunk-road geometry around a city, fetched from OSM Overpass. Fire-and-
   *  forget: failures (rate limit, network) just leave the map without highways rather than
   *  surfacing an error, since this is ambient context, not something the trip depends on. */
  showHighways: (lat: number, lng: number) => void;
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
/**
 * The hover peek is a *relative* zoom, not a destination.
 *
 * It flies to half the distance between where the camera already was and the stop being pointed
 * at — literally "twice as close", which is what makes it read as leaning in rather than going
 * somewhere. A fixed altitude was tried first (1,500m) and was wrong: from a day framed at 4km
 * it is a 2.7x dive, and from a tight day already at 2km it barely moves. The same number can't
 * be a gentle lean for both, because "how much zoom is a lot" is a question about where you
 * started.
 *
 * Critically, the anchor is the *pre-peek* pose (`peekReturnRef`), not wherever the camera is
 * right now. Halving from the live camera would compound: hovering four rows in a row would be
 * 2x, then 4x, then 8x, then 16x, and the fourth stop would be inside the pavement.
 */
const PEEK_ZOOM_FACTOR = 2;
/** Floor on the peek range, in metres. Without it a stop the camera already sits near would be
 *  halved to inside the building mesh — and it keeps the peek clear of the click's 600m, so
 *  selecting a stop after hovering it still visibly goes somewhere. */
const PEEK_MIN_RANGE_M = 800;
/**
 * How long the pointer must rest on a row before the camera moves. This one number is what
 * makes the feature affordable: sweeping a pointer down a day of eight stops fires eight hover
 * events, and without a dwell that is eight cancelled flights and eight bursts of tile requests
 * for places nobody looked at. With it, a sweep costs nothing at all and only a stop you
 * actually paused on is ever fetched.
 */
const PEEK_DWELL_MS = 300;
/** Peek flights are short on purpose: a camera in motion renders every frame, so the render
 *  window is the cost. A third of the click's 2.5s, which also keeps the peek feeling like a
 *  glance rather than a journey. */
const PEEK_FLIGHT_S = 0.8;
/** Mirrors --on-deep / --surface-deep. Cesium wants plain colour strings at label-build time,
 *  so these can't be `var()` — update both here if those tokens move. */
const LABEL_COLOR = "#f4f7fa";
const LABEL_OUTLINE = "#0f172a";
/** Framing floor for a day's stops, in metres — a lone stop gives a zero-radius sphere, and a
 *  tight cluster gives one small enough that the camera dives into the building mesh. */
const MIN_ROUTE_RADIUS_M = 400;
/** Fraction of the route radius to shove the aim point east by, so the route lands left of the
 *  right-docked itinerary panel. Applied only at the panel's own `sm:` breakpoint. */
const PANEL_BIAS_RATIO = 0.6;

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
  const pendingHighwaysRef = useRef<[lat: number, lng: number] | null>(null);
  const highwayEntitiesRef = useRef<Entity[]>([]);
  /** Bumped per showHighways call so a slow, superseded fetch (e.g. re-picking a destination
   *  before the previous city's highways landed) can't draw over the newer city's roads. */
  const highwayGenerationRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [globeMode, setGlobeMode] = useState<GlobeMode>("off");
  const [globeSpinning, setGlobeSpinning] = useState(false);
  const [posterPlace, setPosterPlace] = useState<string | null>(null);
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  /** The live geometry, so hover emphasis can reach it without rebuilding the route. */
  const routeGeometryRef = useRef<RouteGeometry | null>(null);
  /** Where the camera was before the current run of hover peeks began, so leaving the list
   *  puts it back. Null means no peek is in flight — and any real camera command clears it,
   *  which is what stops an unhover from yanking the camera off a stop you just clicked. */
  const peekReturnRef = useRef<{
    position: Cartesian3;
    heading: number;
    pitch: number;
    roll: number;
  } | null>(null);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activateGlobe = useCallback(() => setGlobeMode("live"), []);

  /**
   * Ask for one frame.
   *
   * The viewer runs with `requestRenderMode`, so a stationary camera renders *nothing* — which
   * is the whole point, but it means anything that changes the scene without moving the camera
   * (entities added, a material swapped for hover emphasis, geometry repositioned once its real
   * altitude lands) is invisible until something asks. Camera moves request their own frames,
   * so only the non-camera mutations below need this.
   */
  /**
   * Abandon any hover peek — the pending dwell timer and the saved pose both.
   *
   * Called by every real camera command. Without it two things go wrong: a click landing during
   * a dwell would be followed a moment later by the peek flying somewhere else, and the next
   * unhover would drag the camera back off the stop the user had just selected.
   */
  const cancelPeek = useCallback(() => {
    if (peekTimerRef.current !== null) {
      clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    }
    peekReturnRef.current = null;
  }, []);

  const requestRender = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }, []);

  const flyTo = useCallback(
    (
      lat: number,
      lng: number,
      height: number,
      pitchDeg: number,
      label?: string,
      /** Altitude of the point to centre in frame. Zero aims at the ellipsoid surface, which for
       *  a stop means aiming below the street; a stop flight passes its card's height instead. */
      centreHeightM = 0,
    ) => {
      // A flight is the app asking for the live 3D view, so it is also the activation signal:
      // choosing a destination, clicking an itinerary stop, a marker, or Play tour all land
      // here. Everything that only *draws* (showDayRoute, showHighways) deliberately does not
      // activate — a city overview is served by the poster, and its geometry queues below until
      // something actually asks for 3D.
      activateGlobe();
      cancelPeek();
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) {
        // The viewer registers only once the 3D tileset has loaded, which takes seconds — long
        // after a trip page has fetched its trip and asked to fly. Hold the request and replay
        // it on registration instead of dropping it.
        pendingRef.current = [lat, lng, height, pitchDeg, label, centreHeightM];
        return;
      }
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
          new Cesium.BoundingSphere(
            Cesium.Cartesian3.fromDegrees(lng, lat, centreHeightM),
            0,
          ),
          {
            offset: new Cesium.HeadingPitchRange(
              0,
              Cesium.Math.toRadians(pitchDeg),
              height,
            ),
            duration: 2.5,
          },
        );
        // The flight moves the camera, which requests its own frames; this is for the marker,
        // which is added whether or not the camera ends up anywhere new.
        viewer.scene.requestRender();
      });
    },
    [activateGlobe, cancelPeek],
  );

  /**
   * Note what this does *not* do: activate the globe. A day's route is drawn for a city
   * overview, and an overview is exactly the state the static poster covers — so on a trip page
   * the geometry queues in `pendingRouteRef` and is replayed the moment something (a stop click,
   * Play tour, the poster's own "Explore in 3D") brings the viewer up.
   */
  const showDayRoute = useCallback(
    (stops: RouteStop[]) => {
      // A new day reframes the camera, so any peek's saved pose belongs to a view that is about
      // to stop existing.
      cancelPeek();
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

        const groundPositions = stops.map((s) =>
          Cesium.Cartesian3.fromDegrees(s.lng, s.lat),
        );

        // Frame the whole day rather than one point. Selecting a day is an explicit "show me
        // this", so this deliberately overrides wherever the user had dragged the camera. Started
        // before the height sampling below, since framing needs no heights and the 2s flight
        // covers the sampling latency.
        const sphere = Cesium.BoundingSphere.fromPoints(groundPositions);
        const radius = Math.max(sphere.radius, MIN_ROUTE_RADIUS_M);
        // The itinerary panel covers the right ~40% from `sm:` up, so aim east of the route's
        // centre to push the route itself left of the panel — at heading 0, camera-right is
        // local east. Below `sm:` the panel is full-bleed, so centred framing is correct.
        const bias = window.innerWidth >= 640 ? radius * PANEL_BIAS_RATIO : 0;
        const enu = Cesium.Transforms.eastNorthUpToFixedFrame(sphere.center);
        const east = Cesium.Cartesian3.fromCartesian4(
          Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4()),
        );
        const target = Cesium.Cartesian3.add(
          sphere.center,
          Cesium.Cartesian3.multiplyByScalar(
            east,
            bias,
            new Cesium.Cartesian3(),
          ),
          new Cesium.Cartesian3(),
        );
        // Growing the radius by the same bias is what keeps the westernmost stop in frame
        // after the aim point moves east.
        const framed = radius + bias;
        viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(target, framed),
          {
            offset: new Cesium.HeadingPitchRange(
              0,
              Cesium.Math.toRadians(-60),
              Math.max(framed * 2.5, 800),
            ),
            duration: 2.0,
          },
        );

        // Drawn immediately at the last route's altitude and corrected once the real sample lands,
        // rather than awaiting first. Height sampling takes ~1.3s alone but several seconds when
        // day-tab clicks stack the requests up, which left the map visibly empty. Consecutive days
        // of one trip share a city, so the previous altitude is a near-perfect stand-in; the very
        // first route falls back to 0 and visibly settles once.
        const altitudeAtDraw = routeAltitudeRef.current;
        const geometry = buildRouteGeometry(
          viewer,
          Cesium,
          stops,
          altitudeAtDraw,
        );
        routeEntitiesRef.current = geometry.entities;
        routeGeometryRef.current = geometry;
        viewer.scene.requestRender();

        const altitude = await sampleRouteAltitude(
          viewer,
          Cesium,
          groundPositions,
        );
        // A fast day-tab switch can land a newer route mid-sample; the newest request wins, and a
        // superseded generation's entities are already gone from the collection.
        if (generation !== routeGenerationRef.current || viewer.isDestroyed())
          return;
        routeAltitudeRef.current = altitude;
        if (Math.abs(altitude - altitudeAtDraw) < 0.5) return;
        geometry.reposition(altitude);
        // Lands ~1.3s after the draw, by which time the framing flight may already have settled —
        // without a frame requested here the route stays visibly at the old altitude.
        viewer.scene.requestRender();
      });
    },
    [cancelPeek],
  );

  // Hover wins over selection: while the pointer is on something, that is what the globe should
  // be pointing at. Falls back to the selected stop when the pointer leaves.
  useEffect(() => {
    routeGeometryRef.current?.setEmphasis(hoveredIndex ?? activeIndex);
    // Hovering an itinerary row moves nothing, so under requestRenderMode the emphasised stem
    // would not be drawn until the next unrelated camera move.
    requestRender();
  }, [hoveredIndex, activeIndex, routeStops, requestRender]);

  /**
   * The hover peek: resting the pointer on an itinerary row leans the camera in toward that
   * stop, and leaving the list leans it back out.
   *
   * Three gates, and each one is a cost decision rather than a nicety:
   *
   * - **A viewer must already exist, in `live` mode.** Hovering must never be the thing that
   *   builds a viewer — a pointer crossing a list would otherwise spin up a WebGL context and
   *   a tile stream. On a trip page still showing its poster, hover does nothing.
   * - **PEEK_DWELL_MS of stillness first.** A sweep down the list costs nothing; only a row you
   *   actually paused on is fetched.
   * - **Not under `prefers-reduced-motion`.** This is unrequested camera movement in response
   *   to a pointer, which is close to the definition of what that setting is asking us to skip.
   *
   * Moving from one row to another flies *directly* between the two peek poses rather than
   * pulling out and diving back in. It reads the same, in half the flight time and half the
   * tiles — the pull-out frames would be showing an intermediate altitude nobody asked about.
   */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || globeMode !== "live") return;
    if (prefersReducedMotion()) return;

    const stop = hoveredIndex === null ? null : routeStops[hoveredIndex];

    if (!stop) {
      // Pointer has left the list. `peekReturnRef` is null unless a peek actually happened, so
      // an ordinary mouse-out over a map with no peek in flight is free.
      const home = peekReturnRef.current;
      peekReturnRef.current = null;
      if (!home) return;
      import("cesium").then(() => {
        if (viewer.isDestroyed()) return;
        viewer.camera.flyTo({
          destination: home.position,
          orientation: {
            heading: home.heading,
            pitch: home.pitch,
            roll: home.roll,
          },
          duration: PEEK_FLIGHT_S,
        });
      });
      return;
    }

    peekTimerRef.current = setTimeout(() => {
      peekTimerRef.current = null;
      import("cesium").then((Cesium) => {
        if (viewer.isDestroyed()) return;
        // Captured once per run of peeks, not per row: hovering four rows in sequence should
        // return to where the camera was before the first of them, not to the third one.
        peekReturnRef.current ??= {
          position: viewer.camera.position.clone(),
          heading: viewer.camera.heading,
          pitch: viewer.camera.pitch,
          roll: viewer.camera.roll,
        };

        const home = peekReturnRef.current;
        // Aim at the stop's floating card rather than the ground, same as a click does, so the
        // peek centres on the thing that names the place.
        const target = Cesium.Cartesian3.fromDegrees(
          stop.lng,
          stop.lat,
          routeAltitudeRef.current + STEM_HEIGHT_M,
        );
        const range = Math.max(
          Cesium.Cartesian3.distance(home.position, target) / PEEK_ZOOM_FACTOR,
          PEEK_MIN_RANGE_M,
        );
        viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(target, 0),
          {
            // The pre-peek heading and pitch, deliberately kept rather than snapped to the click's
            // -35°. Re-tilting on hover is what made this read as "the camera went somewhere":
            // holding the angle you were already looking from leaves only the distance changing,
            // which is the whole request.
            offset: new Cesium.HeadingPitchRange(
              home.heading,
              home.pitch,
              range,
            ),
            duration: PEEK_FLIGHT_S,
          },
        );
      });
    }, PEEK_DWELL_MS);

    return () => {
      if (peekTimerRef.current === null) return;
      clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    };
  }, [hoveredIndex, routeStops, globeMode]);

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
      if (generation !== highwayGenerationRef.current || viewer.isDestroyed())
        return;

      const Cesium = await import("cesium");
      if (generation !== highwayGenerationRef.current || viewer.isDestroyed())
        return;
      for (const e of highwayEntitiesRef.current) viewer.entities.remove(e);
      highwayEntitiesRef.current = segments.map((segment) =>
        viewer.entities.add({
          polyline: {
            positions: segment.points.map((p) =>
              Cesium.Cartesian3.fromDegrees(p.lng, p.lat, HIGHWAY_HEIGHT_M),
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
              Cesium.Color.fromCssColorString(HIGHWAY_COLOR),
            ),
          },
        }),
      );
      // An Overpass round trip routinely outlives the destination flight, so the camera is
      // usually still by the time these are added.
      viewer.scene.requestRender();
    })();
  }, []);

  const setViewer = useCallback(
    (viewer: Viewer | null) => {
      viewerRef.current = viewer;
      if (!viewer) {
        markerRef.current = null;
        routeEntitiesRef.current = [];
        highwayEntitiesRef.current = [];
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
    [flyTo, showDayRoute, showHighways],
  );

  const flyToDestination = useCallback(
    (lat: number, lng: number, label?: string) =>
      flyTo(lat, lng, DESTINATION_HEIGHT_M, -45, label),
    [flyTo],
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
      flyTo(
        lat,
        lng,
        PLACE_HEIGHT_M,
        -35,
        label,
        routeAltitudeRef.current + STEM_HEIGHT_M,
      ),
    [flyTo],
  );
  /**
   * Return to the landing state: drop every trip overlay and put the globe back at the hero
   * pose, static.
   *
   * Called on mount of the landing step and by its own back button, so it is the one thing that
   * asks for `static`. It does *not* tear the viewer down — coming home from a trip and landing
   * on `/` cold should look the same, and destroying a viewer only to rebuild it a moment later
   * costs seconds of re-fetched tiles for no saving (a parked viewer under `requestRenderMode`
   * draws nothing anyway). Everything here runs whether or not a viewer exists, since the trip
   * state is React state and pending requests are queued regardless.
   */
  const resetToHome = useCallback(() => {
    // These generation bumps are what stop an in-flight height sample or Overpass response from
    // drawing onto a globe that has already gone home.
    routeGenerationRef.current++;
    highwayGenerationRef.current++;
    routeGeometryRef.current = null;
    // Otherwise the day's marker cards survive a navigation back to the landing page — the
    // marker layer is plain DOM and knows nothing about the camera.
    setRouteStops([]);
    setHoveredIndex(null);
    setActiveIndex(null);
    // Otherwise a request queued while the globe was still coming up replays onto the hero
    // view, which by then belongs to a different trip.
    pendingRef.current = null;
    pendingRouteRef.current = null;
    pendingHighwaysRef.current = null;
    cancelPeek();
    setPosterPlace(null);
    // Unconditional: every path into here is "the user is on the landing page now", whether
    // they arrived cold (off) or backed out of a trip (live).
    setGlobeMode("static");

    const viewer = viewerRef.current;
    // Nothing more to do on a cold load of `/`: this runs long before the viewer registers, and
    // GlobeBackground's own initial `setView` puts a fresh viewer at exactly this pose.
    if (!viewer || viewer.isDestroyed()) return;

    for (const e of routeEntitiesRef.current) viewer.entities.remove(e);
    routeEntitiesRef.current = [];
    for (const e of highwayEntitiesRef.current) viewer.entities.remove(e);
    highwayEntitiesRef.current = [];
    if (markerRef.current) viewer.entities.remove(markerRef.current);
    markerRef.current = null;

    import("cesium").then((Cesium) => {
      if (viewer.isDestroyed()) return;
      // `camera.flyTo` directly rather than this module's own `flyTo` helper — that one is the
      // activation signal for `live`, which is the opposite of what going home means.
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          HERO_VIEW.lng,
          HERO_VIEW.lat,
          HERO_VIEW.height,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(HERO_VIEW.headingDeg),
          pitch: Cesium.Math.toRadians(HERO_VIEW.pitchDeg),
          roll: 0,
        },
        duration: 2.0,
      });
      // The flight requests its own frames; this one is for the entity removals above, which
      // otherwise would not be drawn until something moved.
      viewer.scene.requestRender();
    });
  }, [cancelPeek]);

  return (
    <MapCameraContext.Provider
      value={{
        setViewer,
        viewerRef,
        ready,
        globeMode,
        globeSpinning,
        setGlobeSpinning,
        activateGlobe,
        posterPlace,
        setPosterPlace,
        flyToDestination,
        flyToPlace,
        resetToHome,
        showDayRoute,
        showHighways,
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
  if (!ctx)
    throw new Error("useMapCamera must be used within MapCameraProvider");
  return ctx;
}
