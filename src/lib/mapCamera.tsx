"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
  RefObject,
} from "react";
import type { Cartesian3, Entity, Viewer } from "cesium";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { metresBetween, peekFlightSeconds, peekRangeM } from "@/lib/peekRange";
import {
  arcLift,
  buildDayClusters,
  buildRouteGeometry,
  cssColor,
  dayColorToken,
  dayVisualState,
  frameRouteBesidePanel,
  routeViewHeadingDeg,
  RouteCluster,
  RouteGeometry,
  RouteStop,
  sampleRouteAltitude,
  STEM_HEIGHT_M,
} from "@/lib/mapRoute";

// Re-exported so the marker layer can reach the rule without importing two modules for it.
export { dayVisualState } from "@/lib/mapRoute";

interface MapCameraContextValue {
  setViewer: (viewer: Viewer | null) => void;
  /** The live viewer, for components that drive the camera directly (MapControls). Exposed as
   *  the ref rather than wrapped in per-action context methods — one consumer doesn't justify
   *  five indirections, and camera math is better kept next to the control it belongs to. */
  viewerRef: RefObject<Viewer | null>;
  /** False until the viewer exists — the 3D tileset takes seconds, so map chrome must not
   *  render (and reach for `viewerRef.current`) before then. */
  ready: boolean;
  /** Whether the currently-mounted surface puts the globe on screen. Exactly two do: `/trip/[id]`
   *  for its whole life, and `/` from the moment generation starts through the result view.
   *  Everywhere else this stays false and Cesium is never imported at all — a cold `/profile` was
   *  measured at 5410ms of long tasks across 32 tasks, a 2287KB chunk, 33 `/cesium/` asset
   *  requests and a live WebGL2 context, for a settings form.
   *
   *  Deliberately NOT derived from `usePathname()`, which replaced a `globeVisibility.ts` that
   *  was. A pathname cannot tell `/`'s three steps apart (all local state in HomeView), and it
   *  cannot tell `/trip/<real-id>` from `/trip/<unknown-id>` — the latter renders not-found.tsx,
   *  a glass card that wants no globe, and the 404 case is not expressible as a path at all.
   *  Same for `/trip/latest` on an empty database. The two surfaces that want the globe are two
   *  mounted components, so they are what declares it, via `useGlobeOnScreen`.
   *
   *  A plain boolean and not a reference count: exactly one route is mounted at a time, React
   *  runs every effect cleanup in a commit before every setup, and there is no `loading.tsx`
   *  anywhere in `src/app` to split a navigation across two commits.
   *  ponytail: make this a counter if a route ever mounts two globe surfaces at once. */
  globeWanted: boolean;
  setGlobeWanted: (wanted: boolean) => void;
  /**
   * True while an editing surface is open, which suspends the hover peek.
   *
   * The peek answers "which stop is this?" while *reading* a plan. While editing one, the same
   * pointer movement means something else entirely — dragging a stop between days, or reading a
   * chat turn with the globe's marker cards still under the cursor — and a camera that dives at
   * whatever the pointer brushed is moving the ground out from under the edit. Editing surfaces
   * declare themselves with `useHoverPeekSuspended`, the same way a surface declares it wants
   * the globe at all.
   */
  peekSuspended: boolean;
  setPeekSuspended: (suspended: boolean) => void;
  flyToDestination: (lat: number, lng: number, label?: string) => void;
  flyToPlace: (lat: number, lng: number, label?: string) => void;
  /** Wipe every trip overlay, fly back to the hero pose and resume the idle spin. The globe
   *  lives above the route boundary and never unmounts, so without this a trip's route and
   *  markers survive a navigation back to the landing page. No-ops before the viewer exists. */
  resetToHome: () => void;
  /**
   * Draw every day of the trip at once — lit stems out of glow pools at each stop, a route line
   * connecting each day's stops in order, one colour per day, and a camera flight framing them.
   *
   * `focusDay` is the day the panel has selected, or `null` for a whole-trip overview with no day
   * singled out. The two are exclusive: with a day focused that day is the *only* one drawn, and
   * with `null` every day goes up at once, each in its own colour. Dimming the other days instead
   * of dropping them was tried and does not work — at any alpha that still reads as a route, five
   * other days' arcs cross the one being read, which is what focusing was for.
   *
   * Collapsing the panel passes `null`, so it returns to the overview. That is the feature: a
   * finished trip opens on its whole shape, and picking a day is how you leave it.
   *
   * `panelVisible` is purely about framing: with the panel open the route is aimed left of it, and
   * with it collapsed the same day is centred. It is a separate argument from `focusDay` because
   * these are separate questions — which day matters, and how much screen is left to put it in.
   *
   * Call again on every day-tab change. Cheap to do so: it rebuilds geometry, but the height
   * sample that dominates the cost is taken once for the whole trip.
   */
  showTripRoute: (
    days: RouteStop[][],
    focusDay: number | null,
    panelVisible?: boolean,
    soloFocus?: boolean
  ) => void;
  /** The day the pointer is resting on, or null. Brings a dimmed day most of the way back
   *  without disturbing the selection, so Thursday can be checked without losing Tuesday.
   *  Retints in place — no geometry is rebuilt. */
  setHoveredDay: (day: number | null) => void;
  hoveredDay: number | null;
  /** Draws real motorway/trunk-road geometry around a city, fetched from OSM Overpass. Fire-and-
   *  forget: failures (rate limit, network) just leave the map without highways rather than
   *  surfacing an error, since this is ambient context, not something the trip depends on. */
  showHighways: (lat: number, lng: number) => void;
  /** Draws the destination's administrative outline and collects the names of nearby towns.
   *  Fire-and-forget; failures leave the map without them. */
  showCityContext: (lat: number, lng: number, name?: string) => void;
  /** Towns around the destination, for StopMarkerLayer to label. */
  nearbyPlaces: NearbyPlaceMarker[];
  /** The stops currently drawn, for StopMarkerLayer to render an HTML card per stop. State
   *  rather than a ref because the card list is real DOM that has to change when the day does.
   *  Flattened across every day, each stop carrying its own `day`. */
  routeStops: RouteStop[];
  /** One "Day N" label per day, at that day's centroid — the at-a-glance layer. */
  routeClusters: RouteCluster[];
  /** The selected day, or null when the whole trip is shown at once. Read by StopMarkerLayer to
   *  decide whose stop names are worth showing: all of them at once is ~45 serif names over
   *  photography, which is unreadable however they are coloured. */
  focusedDay: number | null;
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
  /**
   * Select a stop given the stop *object* rather than its index into `routeStops`.
   *
   * For the callers that legitimately do not have that index. `StopMarkerLayer` and `useStopTour`
   * both do and should keep using `setActiveIndex` — this is for the itinerary rows and the
   * "up next" list inside the place detail, which reach a stop through `useTripCamera.selectStop`
   * and only ever hold an `Itinerary` stop. Threading a flat index down to both would mean a new
   * prop on `StopList`, on `PlaceDetailPanel`, and on whatever opens a stop next.
   */
  setActiveStop: (stop: { lat: number; lng: number; name: string; time?: string }) => void;
  /**
   * Fly back to the framing of whatever route is currently drawn.
   *
   * Returns false when there is no route to go back to, so a caller can fall back to something
   * else — the home page can have a stop detail open with no trip drawn behind it yet.
   */
  reframeRoute: () => boolean;
}

const MapCameraContext = createContext<MapCameraContextValue | null>(null);

const DESTINATION_HEIGHT_M = 15000;
const PLACE_HEIGHT_M = 600;
/**
 * The hover peek is a *relative* zoom, not a destination.
 *
 * How close it goes is `peekRangeM()` in `peekRange.ts` — a relative lean, tightened for stops
 * whose neighbours are crowded around them. The rule lives there because it is arithmetic worth
 * testing on its own; what stays here is when to fly and how.
 *
 * The anchor is the *pre-peek* pose, not wherever the camera is right now. Halving from the live
 * camera compounds: hovering four rows would be 2x, 4x, 8x, 16x, and the fourth stop would be
 * inside the pavement.
 */
/**
 * How long the pointer must rest on a row before the camera moves. This one number is what makes
 * the feature affordable: sweeping down a day of eight stops fires eight hover events, and
 * without a dwell that is eight cancelled flights and eight bursts of tile requests for places
 * nobody looked at. With it, a sweep costs nothing and only a stop actually paused on is fetched.
 */
const PEEK_DWELL_MS = 300;
/**
 * How long after the last scroll a hover stops being treated as scroll-induced.
 *
 * Dragging a list under a stationary pointer fires exactly the `pointerenter` a deliberate hover
 * does — the rows move, the pointer does not — and wheel scrolling arrives in discrete ticks with
 * idle gaps longer than `PEEK_DWELL_MS`, so the dwell alone let a flick down the itinerary peek at
 * whichever row happened to be under the cursor between two ticks. Each of those is a camera
 * flight and a burst of tile requests for a place nobody was looking at.
 */
const SCROLL_SETTLE_MS = 350;
/**
 * How long an un-hover waits before the camera leans back out.
 *
 * Rows do not touch — there is a gap between each pair, and the pointer is over *no* row while it
 * crosses one. Acting on that immediately meant sliding from row 3 to row 4 pulled the camera all
 * the way back out and then dived in again, which is the one thing the peek is supposed not to
 * look like. A hover that lands within this window is treated as a continuation of the same run of
 * peeks, so the camera moves sideways between the two stops and never pulls out at all.
 *
 * Only the *decision* is delayed, not the flight: leaving the list for good still reads as
 * immediate, because the flight it starts dwarfs this.
 */
const PEEK_LEAVE_GRACE_MS = 220;
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
/** Same reasoning as HIGHWAY_HEIGHT_M: a fixed height above the *ellipsoid*, which is routinely
 *  below the real tile surface — the depth-fail material is what keeps the line visible there. */
const CITY_BOUNDARY_HEIGHT_M = 40;

/**
 * Camera pitch when a route is framed, in degrees.
 *
 * Was -60, which is 30 degrees off straight down, and at that angle a day's arcs project back
 * onto the ground line they span: the whole point of lifting them (`ARC_LIFT_RATIO`) is that two
 * hops over the same ground sit at different heights, and height is exactly what a near-nadir
 * view throws away. So the overview stayed a tangle while the same route read cleanly the moment
 * the camera came over. -45 is the compromise, and the same pose the landing-page hero uses:
 * enough plan to see where the day goes, enough elevation to see the arches as arches.
 *
 * Pitching over costs frame height — a metre of altitude maps to more screen at a shallow pitch
 * than a steep one — which is why the framing sphere below had to grow to include the arc apexes
 * at the same time. Changing one without the other just clips the arcs off the top instead.
 */
const ROUTE_FRAME_PITCH_DEG = -45;

/**
 * Half the camera's *horizontal* field of view, as a tangent, for turning screen pixels into
 * metres at a given depth.
 *
 * Derived from `fovy` and the aspect ratio rather than read off `frustum.fov`, which is the
 * horizontal angle only while the canvas is wider than it is tall and silently becomes the
 * vertical one when it is not. Returns undefined in 2D, where the frustum is orthographic and has
 * no field of view at all — `frameRouteBesidePanel` then falls back to Cesium's 60° default,
 * which is the right kind of wrong: a slightly off-centre aim, not a thrown error.
 */
function horizontalTanHalfFov(viewer: Viewer): number | undefined {
  const frustum = viewer.camera.frustum as { fovy?: number; aspectRatio?: number };
  if (typeof frustum.fovy !== "number" || typeof frustum.aspectRatio !== "number") return undefined;
  return Math.tan(frustum.fovy / 2) * frustum.aspectRatio;
}

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

/** Cesium is only ever reached through `await import("cesium")`, so the helpers below take the
 *  module as a parameter rather than importing it — same contract as mapRoute's. */
type CesiumModule = typeof import("cesium");

type Flight = [
  lat: number,
  lng: number,
  height: number,
  pitchDeg: number,
  label?: string,
  centreHeightM?: number,
];

/** A named town near the destination, for the marker layer to label. */
export interface NearbyPlaceMarker {
  name: string;
  lat: number;
  lng: number;
  kind: string;
}

/** A whole trip's worth of routes, held for replay when the request beats the viewer. */
interface TripRouteRequest {
  days: RouteStop[][];
  focusedDay: number | null;
  soloFocus: boolean;
  panelVisible: boolean;
}

/**
 * The days a `showTripRoute` call actually puts on screen — the focused one if it has stops in it,
 * otherwise every day. The camera frames these, the height probe samples these, and the arc-apex
 * reservation walks these, so the rule lives in one place rather than three.
 */
function drawnDaysOf(days: RouteStop[][], focusDay: number | null): RouteStop[][] {
  return focusDay !== null && days[focusDay]?.length ? [days[focusDay]] : days;
}

/**
 * Fly the camera to the framing for a drawn route, without touching any geometry.
 *
 * Lifted out of `showTripRoute` so it can be replayed. Closing a stop's detail panel used to fly
 * out to the destination at `DESTINATION_HEIGHT_M` — a 15km nadir view of the whole city — which
 * was survivable while a day's framing was also near-nadir and looked much the same. It stopped
 * being survivable once a day got a heading and a pitch of its own (`routeViewHeadingDeg`,
 * `ROUTE_FRAME_PITCH_DEG`): backing out of a stop threw away the side-on view of the day and
 * landed somewhere that read as the map having forgotten which day was open.
 */
function flyToRouteFraming(
  viewer: Viewer,
  Cesium: CesiumModule,
  days: RouteStop[][],
  focusDay: number | null,
  panelVisible: boolean,
  routeAltitudeM: number
) {
      // Frame the focused day if there is one, otherwise the whole trip. Selecting a day is an
      // explicit "show me this", so this deliberately overrides wherever the user had dragged
      // the camera. The caller starts this before its own height sampling, since framing needs no
      // heights and the 2s flight covers the sampling latency.
      const drawnDays = drawnDaysOf(days, focusDay);
      const drawnStops = drawnDays.flat();
      const drawnPositions = drawnStops.map((st) =>
        Cesium.Cartesian3.fromDegrees(st.lng, st.lat)
      );

      // The stops *and* the apex of every arc between them. Framing the stops alone was right
      // while arcs bowed 180m; they now peak at a fraction of the hop's ground length, so a
      // cross-city day arches kilometres up and the camera cut the tops off — worse at
      // `ROUTE_FRAME_PITCH_DEG`, which trades frame height for exactly the elevation this
      // sphere now has to contain. Grouped by day rather than run across the flat list: two
      // consecutive days are joined in `flat` by a pair that no arc is ever drawn between, and
      // reserving room for that phantom hop would pull the whole trip's overview back.
      //
      // The apex is the arc's own midpoint height (see `arcPositionsAt`), read off the previous
      // route's altitude for the same reason the geometry is drawn at it — the real sample is
      // seconds away and consecutive days of one trip share a city. A degenerate hop that will
      // draw no arc at all still contributes `MIN_ARC_LIFT_M`, which is 80m of slack on a frame
      // measured in kilometres.
      const framePositions = [...drawnPositions];
      for (const stops of drawnDays) {
        for (let i = 1; i < stops.length; i++) {
          const a = stops[i - 1];
          const b = stops[i];
          const span = Cesium.Cartesian3.distance(
            Cesium.Cartesian3.fromDegrees(a.lng, a.lat),
            Cesium.Cartesian3.fromDegrees(b.lng, b.lat)
          );
          framePositions.push(
            Cesium.Cartesian3.fromDegrees(
              (a.lng + b.lng) / 2,
              (a.lat + b.lat) / 2,
              routeAltitudeM + STEM_HEIGHT_M + arcLift(span)
            )
          );
        }
      }
      const sphere = Cesium.BoundingSphere.fromPoints(framePositions);
      const radius = Math.max(sphere.radius, MIN_ROUTE_RADIUS_M);
      // Aim at the middle of the strip the panel leaves, not the middle of the viewport — see
      // `frameRouteBesidePanel`. Measured off the panel's own box rather than assumed from its
      // width classes, so Focus Mode's wider 62% split and any future width are handled without
      // this knowing about either.
      //
      // Keyed on the panel actually being there, not on whether a day is focused: collapsed, the
      // panel is a pill in a corner and aiming beside it would shove the route left of an
      // otherwise empty screen.
      const viewWidth = viewer.scene.canvas.clientWidth;
      const panelLeft =
        panelVisible && window.innerWidth >= 640
          ? (document.querySelector(".docked-panel")?.getBoundingClientRect().left ?? viewWidth)
          : viewWidth;
      const { biasM, rangeM } = frameRouteBesidePanel(
        radius,
        viewWidth,
        panelLeft,
        horizontalTanHalfFov(viewer)
      );
      // Face the route across its long axis rather than down it — see `routeViewHeadingDeg`.
      const headingDeg = routeViewHeadingDeg(drawnStops);
      const heading = Cesium.Math.toRadians(headingDeg);

      // The panel bias has to run along the camera's own *right*, not along world east.
      //
      // Those were the same vector for as long as the heading was hardcoded to north, and the
      // bias was written as "shove the aim point east" on that basis. They stop being the same
      // the moment the camera turns: at heading 90 world east is straight into the screen, so an
      // east-shifted aim point would push the route away from the camera instead of sideways out
      // from under the panel, and the framing this bias exists for would silently stop working.
      //
      // Screen-right in the local frame is (cos h, -sin h) over (east, north) — at h = 0 that is
      // east, which is exactly the old behaviour, so a north-facing route is bit-identical.
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(sphere.center);
      const east = Cesium.Cartesian3.fromCartesian4(
        Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4())
      );
      const north = Cesium.Cartesian3.fromCartesian4(
        Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4())
      );
      const right = Cesium.Cartesian3.subtract(
        Cesium.Cartesian3.multiplyByScalar(east, Math.cos(heading), new Cesium.Cartesian3()),
        Cesium.Cartesian3.multiplyByScalar(north, Math.sin(heading), new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const target = Cesium.Cartesian3.add(
        sphere.center,
        Cesium.Cartesian3.multiplyByScalar(right, biasM, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, radius), {
        offset: new Cesium.HeadingPitchRange(
          heading,
          Cesium.Math.toRadians(ROUTE_FRAME_PITCH_DEG),
          rangeM
        ),
        duration: 2.0,
      });
}

export function MapCameraProvider({ children }: { children: ReactNode }) {
  const viewerRef = useRef<Viewer | null>(null);
  const markerRef = useRef<Entity | null>(null);
  const pendingRef = useRef<Flight | null>(null);
  const pendingRouteRef = useRef<TripRouteRequest | null>(null);
  /** The last route asked for, kept after it is drawn rather than cleared like `pendingRouteRef`,
   *  so `reframeRoute` can replay its framing without rebuilding any geometry. */
  const lastRouteRef = useRef<TripRouteRequest | null>(null);
  const routeEntitiesRef = useRef<Entity[]>([]);
  /** Altitude the current route was drawn at, so new geometry lands on the arcs. */
  const routeAltitudeRef = useRef(0);
  /** Bumped per showTripRoute call so a slow height sample from an older trip can't win. */
  const routeGenerationRef = useRef(0);
  const pendingHighwaysRef = useRef<[lat: number, lng: number] | null>(null);
  const highwayEntitiesRef = useRef<Entity[]>([]);
  /** Bumped per showHighways call so a slow, superseded fetch (e.g. re-picking a destination
   *  before the previous city's highways landed) can't draw over the newer city's roads. */
  const highwayGenerationRef = useRef(0);
  const cityEntitiesRef = useRef<Entity[]>([]);
  /** Bumped per showCityContext call, so a slow answer for a city the traveler has already
   *  moved on from cannot draw over the one they are looking at now. */
  const cityGenerationRef = useRef(0);
  /** The destination already asked for, so two callers (and React's development double-invoke)
   *  cannot fire the same Overpass query twice and have the throttled one win. */
  const cityKeyRef = useRef<string | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlaceMarker[]>([]);
  const [ready, setReady] = useState(false);
  const [globeWanted, setGlobeWanted] = useState(false);
  const [peekSuspended, setPeekSuspended] = useState(false);
  /** Every stop of every day, flattened, each carrying its own `day`. Flat rather than nested
   *  because `hoveredIndex`/`activeIndex` index into it and always have — keeping one index
   *  space means StopMarkerLayer, useStopTour and the peek logic needed no reworking when the
   *  globe went from one day to all of them. */
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  /** The same list, for `setActiveStop` to search without becoming a new function every time a
   *  route is drawn — `useTripCamera.selectStop` closes over it, and that closure is handed to
   *  every itinerary row. Same ref-beside-state pattern as `hoveredDayRef`. */
  const routeStopsRef = useRef<RouteStop[]>([]);
  /** One label per day, at that day's centroid. */
  const [routeClusters, setRouteClusters] = useState<RouteCluster[]>([]);
  /** The day the pointer is resting on, or null. Kept in a ref *as well as* state: the draw
   *  path reads it synchronously while building geometry, and a state read there would see the
   *  value from the render that scheduled the draw rather than the current one. */
  const hoveredDayRef = useRef<number | null>(null);
  const [hoveredDay, setHoveredDayState] = useState<number | null>(null);
  /** The day the panel has selected, or null while the whole trip is being shown at once.
   *  Drives which route is drawn at full strength and which are dimmed behind it. */
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  /** The live geometry, one per day, so hover emphasis and dimming can reach it without
   *  rebuilding the routes. Index is the day index; a day with no stops still takes a slot so
   *  this stays aligned with `Itinerary.days[]`. */
  const routeGeometriesRef = useRef<RouteGeometry[]>([]);
  /** Where the camera was before the current run of hover peeks began, so leaving the list puts
   *  it back. Null means no peek is in flight — and any real camera command clears it, which is
   *  what stops an unhover from yanking the camera off a stop that was just clicked. */
  const peekReturnRef = useRef<{
    position: Cartesian3;
    heading: number;
    pitch: number;
    roll: number;
  } | null>(null);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Seconds the flight *in* took, replayed on the way out so the two read as one gesture. A deep
   *  dive travelled over 1.4s and snapped back in 0.8s would look like the camera being dropped. */
  const peekFlightRef = useRef(0.8);
  /** The current peek effect's own `flyHome`, so the suspend guard can reach it. */
  const flyHomeRef = useRef<(() => void) | null>(null);
  /** Timestamp of the last scroll anywhere on the page, and of the last input that expresses hover
   *  intent — a pointer that actually changed coordinates, or a keypress. A peek needs the intent
   *  to be the more recent of the two; see the peek effect. */
  const lastScrollAtRef = useRef(0);
  const lastIntentAtRef = useRef(0);
  /** Last seen pointer coordinates. Browsers report content moving under a still pointer during a
   *  scroll as `pointermove`, so only a change in these counts as the pointer having moved. */
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);
  /** Set by the peek effect when it has a hovered row but is holding it back as scroll-induced, so
   *  a later pointer nudge can re-arm it. Needed because the row does not change on that nudge —
   *  without this hook there is no state change to re-run the effect, and the peek would be lost
   *  for as long as the pointer stayed on the row the scroll left it on. */
  const peekRearmRef = useRef<(() => void) | null>(null);

  /**
   * Abandon any hover peek — the pending dwell timer and the saved pose both.
   *
   * Called by every real camera command. Without it two things go wrong: a click landing during a
   * dwell would be followed a moment later by the peek flying somewhere else, and the next
   * unhover would drag the camera back off the stop the user had just selected.
   */
  const cancelPeek = useCallback(() => {
    if (peekTimerRef.current !== null) {
      clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    }
    peekReturnRef.current = null;
    peekRearmRef.current = null;
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
      centreHeightM = 0
    ) => {
      // A real flight supersedes any hover peek, including one still waiting out its dwell.
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
          new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lng, lat, centreHeightM), 0),
          {
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(pitchDeg), height),
            duration: 2.5,
          }
        );
      });
    },
    [cancelPeek]
  );

  const showTripRoute = useCallback(
    (
      days: RouteStop[][],
      focusDay: number | null,
      panelVisible = true,
      soloFocus = false
    ) => {
      // A new route reframes the camera, so any peek's saved pose belongs to a view that is about
      // to stop existing.
      cancelPeek();
      const flat = days.flat();
      // Published before the viewer check: the cards are plain DOM and cost nothing to mount
      // early, and they stay hidden until the per-frame loop has a viewer to project them with.
      routeStopsRef.current = flat;
      lastRouteRef.current = { days, focusedDay: focusDay, panelVisible, soloFocus };
      setRouteStops(flat);
      // Only for days that will actually be drawn. Under `soloFocus` the others have no route
    // under them, and a "Day 4" badge hanging over bare imagery names nothing.
    setRouteClusters(
      buildDayClusters(days).filter(
        (c) => !soloFocus || focusDay === null || c.day === focusDay
      )
    );
        setFocusedDay(focusDay);
      // A rebuilt trip means the day under the pointer is gone with the old geometry; a stale
      // hover would leave one day lit through the next selection.
      hoveredDayRef.current = null;
      setHoveredDayState(null);
      // A rebuilt route means no stop is hovered or selected, and stale indices would be wrong
      // rather than merely unhelpful — they index a flat list whose length changes with the trip.
      setHoveredIndex(null);
      setActiveIndex(null);
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) {
        // Same race as flyTo: the itinerary renders in a few hundred ms, the tileset takes
        // seconds. Dropping the request here meant the route silently never drew on a cold load.
        pendingRouteRef.current = { days, focusedDay: focusDay, panelVisible, soloFocus };
        return;
      }
      const generation = ++routeGenerationRef.current;
      import("cesium").then(async (Cesium) => {
        if (viewer.isDestroyed()) return;
        for (const e of routeEntitiesRef.current) viewer.entities.remove(e);
        routeEntitiesRef.current = [];
        routeGeometriesRef.current = [];
        if (flat.length === 0) return;

        flyToRouteFraming(viewer, Cesium, days, focusDay, panelVisible, routeAltitudeRef.current);

        // The same days the framing works on, because the height probe below needs their ground
        // positions and nothing else here does. Through `drawnDaysOf` so the camera and the probe
        // cannot disagree about which days are on screen.
        const drawnPositions = drawnDaysOf(days, focusDay)
          .flat()
          .map((st) => Cesium.Cartesian3.fromDegrees(st.lng, st.lat));

        // Drawn immediately at the last route's altitude and corrected once the real sample lands,
        // rather than awaiting first. Height sampling takes ~1.3s alone but several seconds when
        // day-tab clicks stack the requests up, which left the map visibly empty. Consecutive days
        // of one trip share a city, so the previous altitude is a near-perfect stand-in; the very
        // first route falls back to 0 and visibly settles once.
        const altitudeAtDraw = routeAltitudeRef.current;
        // Two modes, and the difference is what is drawn at all rather than how brightly. With
        // `focusDay === null` every day goes on the globe at once, each in its own colour — the
        // overview a finished trip opens on. Once a day is picked in the panel it is the only
        // day drawn: reading one day means reading one day, and leaving the rest on screen
        // behind it is a week of arcs crossing the one being read.
        //
        // Holes are deliberate. `routeGeometriesRef` stays indexed *by day index* so the
        // emphasis effect can look a day up directly; in focused mode every slot but one is
        // empty, and `forEach`/`flatMap` skip holes rather than visiting undefined.
        // Two readings of "select a day", and they belong to different surfaces.
        //
        // `soloFocus` — the itinerary panel. Picking a day there means "show me this day", and
        // the answer is that day and nothing else: five other days' arcs crossing the one being
        // read is not context, and dimming them to 0.25 was still enough line to obscure it.
        //
        // Otherwise — the split editor. Every day stays drawn and the unselected ones dim,
        // because a cross-day drag is a decision about two days and hiding one hides half of it.
        const geometries: RouteGeometry[] = [];
        days.forEach((stops, day) => {
          if (soloFocus && focusDay !== null && day !== focusDay) return;
          const geometry = buildRouteGeometry(
            viewer,
            Cesium,
            stops,
            altitudeAtDraw,
            dayColorToken(day)
          );
          geometry.setDayState(dayVisualState(day, focusDay, hoveredDayRef.current));
          geometries[day] = geometry;
        });
        routeEntitiesRef.current = geometries.flatMap((g) => g.entities);
        routeGeometriesRef.current = geometries;

        // One sample across everything drawn, not one per day: `clampToHeightMostDetailed` is
        // the expensive part (~1.3s for a single day) and the days of one trip share a city, so
        // sampling each separately would multiply the wait by the trip length to land on
        // near-identical answers — and any disagreement between them would step the days onto
        // visibly different planes in the overview.
        const altitude = await sampleRouteAltitude(viewer, Cesium, drawnPositions);
        // A fast day-tab switch can land a newer route mid-sample; the newest request wins, and a
        // superseded generation's entities are already gone from the collection.
        if (generation !== routeGenerationRef.current || viewer.isDestroyed()) return;
        routeAltitudeRef.current = altitude;
        if (Math.abs(altitude - altitudeAtDraw) < 0.5) return;
        geometries.forEach((geometry) => geometry.reposition(altitude));
      });
    },
    [cancelPeek]
  );
  const setHoveredDay = useCallback((day: number | null) => {
    if (hoveredDayRef.current === day) return;
    hoveredDayRef.current = day;
    setHoveredDayState(day);
  }, []);

  // Retint in place whenever the selection or the hovered day changes. No geometry is rebuilt:
  // every day is already drawn, and which one is being read is a colour and a width, not a
  // question of what exists.
  useEffect(() => {
    routeGeometriesRef.current.forEach((geometry, day) =>
      geometry.setDayState(dayVisualState(day, focusedDay, hoveredDay))
    );
    // Load-bearing under `requestRenderMode`: recolouring a material moves nothing, so without a
    // frame requested here the change is not drawn until some unrelated camera move repaints.
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }, [focusedDay, hoveredDay, routeStops]);

  // Hover wins over selection: while the pointer is on something, that is what the globe should
  // be pointing at. Falls back to the selected stop when the pointer leaves.
  useEffect(() => {
    // `hoveredIndex` indexes the flat stop list, but emphasis is per-route, so it has to be
    // resolved back to (which day, which stop within it). Every other day is explicitly cleared
    // rather than left alone: without that, moving the pointer from a stop on day 2 to one on
    // day 5 leaves day 2's stem amber and the trip shows two "you are pointing at this".
    const emphasised = hoveredIndex ?? activeIndex;
    const emphasisedStop = emphasised === null ? null : routeStops[emphasised];
    const dayStart = emphasisedStop
      ? routeStops.findIndex((st) => st.day === emphasisedStop.day)
      : -1;
    routeGeometriesRef.current.forEach((geometry, day) =>
      geometry.setEmphasis(
        emphasisedStop && day === emphasisedStop.day ? emphasised! - dayStart : null
      )
    );
    // Load-bearing under `requestRenderMode`: swapping the emphasised material moves nothing, so
    // without a frame requested here the highlight is not drawn until some unrelated camera move
    // happens to repaint. Hovering a marker card with the camera at rest showed nothing at all.
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }, [hoveredIndex, activeIndex, routeStops]);

  /**
   * Pointer-versus-scroll bookkeeping for the hover peek below.
   *
   * Kept in refs and installed once: these fire at wheel and pointer rates, and routing them
   * through state would re-render every consumer of this context on every scroll frame.
   */
  useEffect(() => {
    const onScroll = () => {
      lastScrollAtRef.current = performance.now();
    };
    const onPointerMove = (e: PointerEvent) => {
      const last = pointerPosRef.current;
      if (last && last.x === e.clientX && last.y === e.clientY) return;
      pointerPosRef.current = { x: e.clientX, y: e.clientY };
      lastIntentAtRef.current = performance.now();
      // The row under the pointer did not change, so only this can revive a peek the scroll gate
      // turned away.
      peekRearmRef.current?.();
    };
    const onKeyDown = () => {
      // Rows peek on focus as well as on hover, so tabbing onto one is intent too.
      lastIntentAtRef.current = performance.now();
      peekRearmRef.current?.();
    };
    // Capture: the itinerary scrolls inside its own container, and a scroll event on a nested
    // element does not bubble to window.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("wheel", onScroll, { passive: true });
    window.addEventListener("touchmove", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("wheel", onScroll);
      window.removeEventListener("touchmove", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  /**
   * The hover peek: resting the pointer on an itinerary row leans the camera in toward that stop,
   * and leaving the list leans it back out.
   *
   * Three gates, each a cost decision rather than a nicety:
   *
   * - **A viewer must already exist.** Hovering must never be the thing that boots one — a
   *   pointer crossing a list would otherwise spin up a WebGL context and a tile stream on a
   *   surface that had declined the globe.
   * - **PEEK_DWELL_MS of stillness first.** A sweep down the list costs nothing; only a row
   *   actually paused on is fetched.
   * - **The pointer, not a scroll, must be what arrived on the row.** A list scrolling under a
   *   still pointer fires the same `pointerenter` and `pointerleave` a hover does, and wheel ticks
   *   are spaced widely enough that the dwell elapses between them, so a single flick down the
   *   itinerary used to peek at — and fly home from — several rows nobody looked at. Both
   *   directions wait for `SCROLL_SETTLE_MS` of quiet *and* for real pointer movement after it.
   * - **Not under `prefers-reduced-motion`.** This is unrequested camera movement in response to
   *   a pointer, which is close to the definition of what that setting asks us to skip.
   *
   * Moving from one row to another flies *directly* between the two peek poses rather than
   * pulling out and diving back in. It reads the same, in half the flight time and half the
   * tiles — the pull-out frames would show an intermediate altitude nobody asked about. That is
   * what `PEEK_LEAVE_GRACE_MS` buys: the pointer is over no row at all while it crosses the gap
   * between two, and an un-hover acted on immediately turned every row-to-row move into a
   * full lean-out and a fresh dive.
   */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || viewer.isDestroyed()) return;
    if (prefersReducedMotion()) return;
    // An editing surface is open. Not merely "don't start a new peek": a peek already in flight
    // when the editor opened would otherwise leave the camera leaned in on a stop with the plan
    // no longer on screen, so the pending dwell is dropped and the lean-out is allowed to run.
    if (peekSuspended) {
      if (peekReturnRef.current) flyHomeRef.current?.();
      else cancelPeek();
      return;
    }

    const stop = hoveredIndex === null ? null : routeStops[hoveredIndex];

    // Pointer has left the list. `peekReturnRef` is null unless a peek actually happened, so an
    // ordinary mouse-out over a map with no peek in flight is free.
    if (!stop && !peekReturnRef.current) {
      peekRearmRef.current = null;
      return;
    }

    /** Lean back out to wherever the camera was before this run of peeks began. Published to a
     *  ref so the suspend guard above — which runs before this is defined, and on a pass where
     *  `stop` may be anything — can undo a peek that an editor just interrupted. */
    const flyHome = () => {
      peekTimerRef.current = null;
      const home = peekReturnRef.current;
      peekRearmRef.current = null;
      if (!home) return;
      import("cesium").then(() => {
        if (viewer.isDestroyed()) return;
        viewer.camera.flyTo({
          destination: home.position,
          orientation: { heading: home.heading, pitch: home.pitch, roll: home.roll },
          duration: peekFlightRef.current,
          // Forgotten on *arrival*, not on departure. Clearing it here was a real bug: a row
          // hovered while this flight was still running found no saved pose, captured the camera
          // mid-flight as its own "home", and the next lean-out went to that meaningless
          // intermediate point — measured 4.5km from where the run had started. Deep dives made it
          // easy to hit, since they take longer to fly and leave a wider window to interrupt.
          // Guarded by identity so a newer run's pose is never the one dropped.
          complete: () => {
            if (peekReturnRef.current === home) peekReturnRef.current = null;
          },
        });
      });
    };

    const fire = () => {
      peekTimerRef.current = null;
      if (!stop) return;
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
          routeAltitudeRef.current + STEM_HEIGHT_M
        );
        // Every other stop of the *hovered stop's own day* — the pocket it sits in is what
        // decides whether a lean is enough to tell it apart from its neighbours. Other days are
        // excluded: they are drawn, but dimmed and unnamed, and they are not what the pointer is
        // reading.
        const neighbourDistancesM = routeStops.reduce<number[]>((acc, other, i) => {
          if (i !== hoveredIndex && other.day === stop.day) acc.push(metresBetween(stop, other));
          return acc;
        }, []);
        const cameraDistanceM = Cesium.Cartesian3.distance(home.position, target);
        const range = peekRangeM(cameraDistanceM, neighbourDistancesM, home.pitch);
        peekFlightRef.current = peekFlightSeconds(cameraDistanceM, range);
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
          // The pre-peek heading and pitch, deliberately kept rather than snapped to the click's
          // -35°. Re-tilting on hover is what made this read as "the camera went somewhere":
          // holding the angle already being looked from leaves only the distance changing.
          offset: new Cesium.HeadingPitchRange(home.heading, home.pitch, range),
          duration: peekFlightRef.current,
        });
      });
    };

    /**
     * Arm the dwell, but only once the pointer — not a scroll — is what put itself on this row.
     *
     * Two gates, because a scroll fakes both halves of a hover. `SCROLL_SETTLE_MS` waits for the
     * list to come to rest, and the intent check then asks whether the pointer moved (or a key was
     * pressed) after it did. A pointer that has not moved since the last scroll is sitting where
     * the scroll left it, which is not a hover; that row waits, re-armed by the first real nudge.
     */
    flyHomeRef.current = flyHome;

    const arm = () => {
      if (peekTimerRef.current !== null) {
        clearTimeout(peekTimerRef.current);
        peekTimerRef.current = null;
      }
      const sinceScroll = performance.now() - lastScrollAtRef.current;
      if (sinceScroll < SCROLL_SETTLE_MS) {
        // Still scrolling — re-check when the list would have settled rather than giving up, so a
        // sweep that ends on a row still peeks at it if the pointer then moves.
        peekRearmRef.current = arm;
        peekTimerRef.current = setTimeout(arm, SCROLL_SETTLE_MS - sinceScroll);
        return;
      }
      if (lastIntentAtRef.current < lastScrollAtRef.current) {
        // The pointer has not moved since the last scroll, so it is sitting where the scroll left
        // it — whatever is or is not under it now was chosen by the list, not by the user. Hold
        // both directions and wait for a real nudge, which is also what re-arms this.
        peekRearmRef.current = arm;
        return;
      }
      peekRearmRef.current = null;
      // Leaving waits out the gap between two rows rather than the dwell — a hover landing inside
      // that window supersedes this timer through the effect's cleanup, and the camera crosses
      // from one stop to the next without ever pulling out.
      peekTimerRef.current = setTimeout(
        stop ? fire : flyHome,
        stop ? PEEK_DWELL_MS : PEEK_LEAVE_GRACE_MS
      );
    };
    arm();

    return () => {
      peekRearmRef.current = null;
      if (peekTimerRef.current === null) return;
      clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    };
  }, [hoveredIndex, routeStops, ready, peekSuspended, cancelPeek]);

  /**
   * The destination's own administrative outline, plus the names of the towns around it.
   *
   * A pin says where a city is and nothing about how far it reaches, so a stop 12km out could be
   * a tram ride or a different town and the map cannot tell you which. The outline answers that,
   * and the neighbour names answer the other half — what the places just past the line are
   * called.
   *
   * Fire-and-forget and fail-soft, exactly like `showHighways`: this is orientation, and a city
   * with no mapped relation or an Overpass outage should cost the map a polygon rather than cost
   * the traveler their destination.
   */
  const showCityContext = useCallback((lat: number, lng: number, name?: string) => {
    // One request per destination, ever.
    //
    // This is called from two entry points and React re-invokes effects in development, so the
    // same city was being asked for twice within a frame. Overpass throttles by IP and answered
    // the second with an empty result — which, being the newer generation, won, while the good
    // answer was discarded by the guard below. The outline never drew, and nothing anywhere
    // reported an error, because an empty result is a legitimate answer for a city with no
    // mapped relation.
    const key = `${lat.toFixed(4)},${lng.toFixed(4)},${name ?? ""}`;
    if (cityKeyRef.current === key) return;
    cityKeyRef.current = key;

    const generation = ++cityGenerationRef.current;
    (async () => {
      let data: { boundary: { segments: { lat: number; lng: number }[][] } | null; nearby: NearbyPlaceMarker[] };
      try {
        const query = new URLSearchParams({ lat: String(lat), lng: String(lng) });
        if (name) query.set("name", name);
        const res = await fetch(`/api/city-context?${query}`);
        if (!res.ok) {
          cityKeyRef.current = null;
          return;
        }
        data = await res.json();
      } catch {
        cityKeyRef.current = null;
        return;
      }
      if (generation !== cityGenerationRef.current) return;
      // An empty answer is "we learned nothing", not "there is nothing" — Overpass returns one
      // for a throttled request exactly as it does for a city with no relation. Overwriting a
      // drawn outline with it would let a rate-limit erase a correct result.
      if (data.nearby?.length) setNearbyPlaces(data.nearby);
      // Read AFTER the fetch, never before it.
      //
      // On a cold load this is called from the destination flight, which happens long before the
      // Cesium viewer registers — capturing the ref up front therefore captured `null` every
      // time, and the outline was silently dropped while the fetch it had just paid for sat
      // there complete. `showHighways` survives the same race only because it queues into
      // `pendingHighwaysRef`; the Overpass round-trip here is seconds long, which is more than
      // enough for the viewer to arrive, so re-reading is all this needs.
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed() || !data.boundary) {
        // Let the next attempt try again rather than caching the failure forever.
        cityKeyRef.current = null;
        return;
      }
      const Cesium = await import("cesium");
      if (generation !== cityGenerationRef.current || viewer.isDestroyed()) return;
      for (const e of cityEntitiesRef.current) viewer.entities.remove(e);
      // Outline only, never a fill. A translucent polygon over photorealistic terrain hides the
      // city it is describing, which is the one thing this must not do.
      cityEntitiesRef.current = data.boundary.segments.map((segment) =>
        viewer.entities.add({
          polyline: {
            positions: segment.map((p) =>
              Cesium.Cartesian3.fromDegrees(p.lng, p.lat, CITY_BOUNDARY_HEIGHT_M)
            ),
            width: 2,
            arcType: Cesium.ArcType.GEODESIC,
            material: new Cesium.ColorMaterialProperty(
              Cesium.Color.fromCssColorString(cssColor("--city-boundary")).withAlpha(0.85)
            ),
            // Full strength on depth-fail, which is the *normal* case rather than the exception.
            // `CITY_BOUNDARY_HEIGHT_M` is a height above the ellipsoid and the real tile surface
            // is routinely tens of metres higher, so this line is below the visible ground almost
            // everywhere — exactly the situation `showHighways` documents. A dimmed depth-fail
            // material therefore isn't "the occluded parts are subtler", it is the whole line at
            // that alpha, which is why the first attempt drew nothing anybody could see.
            //
            // Solid rather than dashed for the same reason: a dash material has no depth-fail
            // equivalent, so the pattern would be lost on every stretch that matters.
            depthFailMaterial: new Cesium.ColorMaterialProperty(
              Cesium.Color.fromCssColorString(cssColor("--city-boundary")).withAlpha(0.85)
            ),
          },
        })
      );
      viewer.scene.requestRender();
    })();
  }, []);

  const showHighways = useCallback((lat: number, lng: number) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) {
      // Same cold-load race as flyTo/showTripRoute: the destination flight can be requested
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
      if (pendingRoute)
        showTripRoute(
          pendingRoute.days,
          pendingRoute.focusedDay,
          pendingRoute.panelVisible,
          pendingRoute.soloFocus
        );
      const pendingHighways = pendingHighwaysRef.current;
      pendingHighwaysRef.current = null;
      if (pendingHighways) showHighways(...pendingHighways);
    },
    [flyTo, showTripRoute, showHighways]
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
  /**
   * Find a stop in the flat route list and select it.
   *
   * Matched on name, coordinate *and* time, not coordinate alone. One coordinate legitimately
   * carries several stops — a hotel is the transfer, the breakfast and the evening return — and
   * for the day/night tint, which reads the matched stop's clock time, picking the wrong one of
   * those is the difference between 9am and 8:45pm. All four fields are already on `RouteStop`,
   * so the stronger key costs nothing.
   *
   * A miss leaves the selection alone rather than clearing it. There is one real way to miss: the
   * detail panel can be opened from a surface whose stop is no longer in the drawn route at all
   * (a day switch behind it), and blanking the selection there would be a worse answer than
   * keeping the last one.
   */
  const setActiveStop = useCallback(
    (stop: { lat: number; lng: number; name: string; time?: string }) => {
      const index = routeStopsRef.current.findIndex(
        (s) =>
          s.lat === stop.lat &&
          s.lng === stop.lng &&
          s.name === stop.name &&
          s.time === stop.time
      );
      if (index >= 0) setActiveIndex(index);
    },
    []
  );

  /**
   * Re-fly the current route's framing.
   *
   * Exists for the way back out of a stop: closing the detail panel used to fly to the trip's
   * *destination*, which is a 15km nadir view of the whole city. That was fine while a day's
   * framing looked much the same, and stopped being fine once a day got its own heading and pitch
   * — backing out of a stop threw away the side-on view of the day and read as the map losing
   * track of which day was open.
   *
   * Reframes rather than redrawing: `showTripRoute` would rebuild every entity and, worse, clear
   * `activeIndex` and `hoveredIndex`, so going back to the itinerary would drop the selection that
   * lights the row and holds the day/night tint.
   */
  const reframeRoute = useCallback(() => {
    const request = lastRouteRef.current;
    if (!request) return false;
    cancelPeek();
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return false;
    import("cesium").then((Cesium) => {
      if (viewer.isDestroyed()) return;
      // `routeAltitudeRef` is the real sampled altitude by now, rather than the previous route's
      // stand-in that the first draw had to make do with — so this framing is the better of the two.
      flyToRouteFraming(
        viewer,
        Cesium,
        request.days,
        request.focusedDay,
        request.panelVisible,
        routeAltitudeRef.current
      );
    });
    return true;
  }, [cancelPeek]);

  const resetToHome = useCallback(() => {
    cancelPeek();
    const viewer = viewerRef.current;
    // No-op before the viewer exists, which is exactly right on a cold load of `/`: the home
    // effect fires long before the tileset registers, so GlobeBackground's own setView and spin
    // proceed untouched. On a soft navigation the viewer always exists, so this always runs.
    if (!viewer || viewer.isDestroyed()) return;

    routeGenerationRef.current++;
    for (const e of routeEntitiesRef.current) viewer.entities.remove(e);
    routeEntitiesRef.current = [];
    // Same reasoning as the route entities: the globe never unmounts, so the previous city's
    // highways would otherwise still be drawn under the landing-page hero pose.
    highwayGenerationRef.current++;
    for (const e of highwayEntitiesRef.current) viewer.entities.remove(e);
    highwayEntitiesRef.current = [];
    // Otherwise the day's marker cards survive a navigation back to the landing page — the
    // globe never unmounts, so nothing else clears them.
    routeStopsRef.current = [];
    lastRouteRef.current = null;
    setRouteStops([]);
    setRouteClusters([]);
    setFocusedDay(null);
    setHoveredIndex(null);
    setActiveIndex(null);
    routeGeometriesRef.current = [];
    if (markerRef.current) viewer.entities.remove(markerRef.current);
    markerRef.current = null;
    // Otherwise a request queued while the tileset was loading replays onto the empty globe.
    pendingRef.current = null;
    pendingRouteRef.current = null;
    pendingHighwaysRef.current = null;

    import("cesium").then((Cesium) => {
      if (viewer.isDestroyed()) return;
      // camera.flyTo directly rather than this module's flyTo helper, which layers this app's
      // own pitch/range conventions on top of a destination — this wants the raw hero pose.
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(HERO_VIEW.lng, HERO_VIEW.lat, HERO_VIEW.height),
        orientation: {
          heading: Cesium.Math.toRadians(HERO_VIEW.headingDeg),
          pitch: Cesium.Math.toRadians(HERO_VIEW.pitchDeg),
          roll: 0,
        },
        duration: 2.0,
      });
    });
  }, [cancelPeek]);

  // Memoised because this provider is rendered from the root layout, so *any* re-render of
  // AppShell — a route change, for one — otherwise handed every `useMapCamera()` consumer a
  // brand-new object and re-rendered all of them, including page.tsx and ItineraryCard.
  //
  // Note what this does not fix: `hoveredIndex`/`activeIndex` live in this same context, so
  // hovering a marker or an itinerary row still re-renders every consumer, because the value
  // genuinely changed. Splitting the volatile hover state into its own context would fix that,
  // but it changes the shape of `useMapCamera()` for every caller — a separate piece of work.
  const value = useMemo(
    () => ({
      setViewer,
      viewerRef,
      ready,
      globeWanted,
      setGlobeWanted,
      peekSuspended,
      setPeekSuspended,
      flyToDestination,
      flyToPlace,
      resetToHome,
      showTripRoute,
      showHighways,
      showCityContext,
      nearbyPlaces,
      routeStops,
      routeClusters,
      focusedDay,
      hoveredDay,
      setHoveredDay,
      routeAltitudeRef,
      hoveredIndex,
      setHoveredIndex,
      activeIndex,
      setActiveIndex,
      setActiveStop,
      reframeRoute,
    }),
    [
      setViewer,
      ready,
      peekSuspended,
      globeWanted,
      flyToDestination,
      flyToPlace,
      resetToHome,
      showTripRoute,
      showHighways,
      showCityContext,
      nearbyPlaces,
      routeStops,
      routeClusters,
      focusedDay,
      hoveredDay,
      setHoveredDay,
      hoveredIndex,
      activeIndex,
      // Stable — `useCallback(…, [])` — so these never re-run the memo. Listed only because
      // eslint knows `useState` setters are stable and cannot know that about a callback.
      setActiveStop,
      reframeRoute,
    ]
  );

  return <MapCameraContext.Provider value={value}>{children}</MapCameraContext.Provider>;
}

export function useMapCamera() {
  const ctx = useContext(MapCameraContext);
  if (!ctx) throw new Error("useMapCamera must be used within MapCameraProvider");
  return ctx;
}

/**
 * Declares that the calling surface puts the globe on screen for as long as `wanted` holds.
 *
 * Released on unmount, so leaving a globe surface hides the canvas and pauses the render loop.
 * The viewer is never *destroyed* — see `GlobeBackground`'s construction effect for why a swap is
 * unrecoverable — so this is a visibility gate, not a lifecycle one.
 */
/**
 * Declare that this surface is an editing one, and that the globe's hover peek should hold still
 * while it is mounted. Mirrors `useGlobeOnScreen`: the surface that knows says so, and unmounting
 * lifts it.
 */
export function useHoverPeekSuspended(suspended = true) {
  const { setPeekSuspended } = useMapCamera();
  useEffect(() => {
    setPeekSuspended(suspended);
    return () => setPeekSuspended(false);
  }, [suspended, setPeekSuspended]);
}

export function useGlobeOnScreen(wanted: boolean) {
  const { setGlobeWanted } = useMapCamera();
  useEffect(() => {
    setGlobeWanted(wanted);
    return () => setGlobeWanted(false);
  }, [wanted, setGlobeWanted]);
}
