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
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { metresBetween, peekFlightSeconds, peekRangeM } from "@/lib/peekRange";
import {
  buildDayClusters,
  dayVisualState,
  RouteCluster,
  RouteStop,
  STEM_HEIGHT_M,
} from "@/lib/mapRoute";
import {
  SEARCH_CONTEXT_RADIUS_M,
  SEARCH_MIN_RANGE_M,
  STOP_CONTEXT_RADIUS_M,
  STOP_MIN_RANGE_M,
  type CameraPose,
  type CameraState,
  type LegPathDrawRequest,
  type MapRenderer,
} from "@/lib/mapRenderer";
import type { MapEngine } from "@/lib/mapEngine";

// Re-exported so the marker layer can reach the rule without importing two modules for it.
export { dayVisualState } from "@/lib/mapRoute";

interface MapCameraContextValue {
  /**
   * Register the engine that is drawing the world, or `null` on teardown.
   *
   * Called by whichever background component the `MAP_ENGINE` flag mounted — `GlobeBackground`
   * for Cesium, `MapLibreBackground` for MapLibre — once its map is ready to take commands.
   * Everything below this line is written against `MapRenderer` and does not know which one
   * answered.
   */
  setRenderer: (renderer: MapRenderer | null) => void;
  /** The live renderer, for components that drive the camera directly (MapControls, the marker
   *  layer's per-frame projection, the split editor's map picking). Exposed as the ref rather
   *  than wrapped in per-action context methods — camera math is better kept next to the control
   *  it belongs to, and the ref is what keeps a per-frame loop out of React's render path. */
  rendererRef: RefObject<MapRenderer | null>;
  /** Which engine is drawing. Read by the Map/Satellite toggle and by the GPU probe; not for
   *  branching behaviour anywhere else — that is what `MapRenderer` is for. */
  engine: MapEngine;
  /**
   * Swap the engine drawing the world, keeping the view.
   *
   * The outgoing engine's `cameraState()` is captured here and applied to the incoming one the
   * moment it registers, so Satellite arrives looking at the same street Map was on rather than at
   * whatever pose it was last left in. The trip's geometry, the highways, the city outline and the
   * search pin are replayed onto it too — none of that is refetched.
   *
   * Switching to an engine that has never been built waits on it (Cesium's tileset takes seconds);
   * switching back to one that has is immediate, because neither map is ever destroyed.
   */
  setEngine: (engine: MapEngine) => void;
  /** False until the map exists — Cesium's 3D tileset takes seconds, and MapLibre's style is a
   *  network round-trip — so map chrome must not render (and reach for `rendererRef.current`)
   *  before then. */
  ready: boolean;
  /** Whether the currently-mounted surface puts the map on screen. Exactly two do: `/trip/[id]`
   *  for its whole life, and `/` from the moment generation starts through the result view.
   *  Everywhere else this stays false and the engine is never imported at all — a cold `/profile`
   *  was measured at 5410ms of long tasks across 32 tasks, a 2287KB chunk, 33 `/cesium/` asset
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
   * chat turn with the map's marker cards still under the cursor — and a camera that dives at
   * whatever the pointer brushed is moving the ground out from under the edit. Editing surfaces
   * declare themselves with `useHoverPeekSuspended`, the same way a surface declares it wants
   * the globe at all.
   */
  peekSuspended: boolean;
  setPeekSuspended: (suspended: boolean) => void;
  /**
   * Hold `showTripRoute`'s camera flight while something else is driving the camera, without
   * holding the draw.
   *
   * Exists for a streaming generation, where the two halves of `showTripRoute` want opposite
   * things: the route and its markers *should* be rebuilt on every arriving stop, and the camera
   * *should not* be re-aimed on every arriving stop. Set by `useStreamingCamera`, which takes
   * the camera over for the length of a run and gives it back on the way out.
   */
  setRouteFramingSuspended: (suspended: boolean) => void;
  /**
   * Draw the trip's stops without the arcs between them. Set only by Story mode.
   *
   * A mode switch rather than an argument to `showTripRoute`, and for the reason
   * `setRouteFramingSuspended` above is one: the call already carries four positional parameters,
   * three of them booleans, and a fifth would be unreadable at every call site for the benefit of
   * the one caller that wants it. Read when a route is drawn *and* when it is replayed onto a
   * freshly-toggled engine, so switching Map/Satellite mid-film keeps the arcs away.
   *
   * See `connectors` on `RouteDrawRequest` for what the flag means to a renderer and why it covers
   * both the elevated arc and the draped line.
   */
  setRouteConnectorsHidden: (hidden: boolean) => void;
  flyToDestination: (lat: number, lng: number, label?: string) => void;
  /** `motion` is a story beat's facing and pacing; every other caller omits it and stays north-up.
   *  See the implementation for why they are deliberately not the same. */
  flyToPlace: (
    lat: number,
    lng: number,
    label?: string,
    motion?: { headingRad?: number; durationS?: number }
  ) => void;
  /**
   * Frame a **search result**: the candidate plus enough of its surroundings to judge whether it
   * belongs in the plan.
   *
   * Separate from `flyToPlace` rather than a parameter on it, because the two are asking different
   * questions and drifting them together would quietly change one when the other was tuned. A stop
   * is already in the plan and its framing answers "where is this"; a search result is a candidate
   * and the only useful question is "is this near anything else I am doing", which a frame holding
   * nothing but the candidate cannot answer. See `SEARCH_CONTEXT_RADIUS_M`.
   */
  flyToSearchResult: (lat: number, lng: number) => void;
  /**
   * Arrive on a stop the way a film arrives on it — close, low and with no neighbourhood framing.
   *
   * Deliberately **not** `flyToPlace`, whose whole design is the opposite trade: that one pulls
   * back to `STOP_CONTEXT_RADIUS_M` and refuses to come nearer than `STOP_MIN_RANGE_M` (3.5km,
   * ~zoom 14.5), because somebody reading a plan is asking "where is this *in the city*". Story
   * mode is not asking that. Its camera *is* the narration's subject, and at a 3.5km floor the
   * flight from a day's framing to a stop is a few hundred metres of range — measured, it read as
   * the map not moving at all, which is the one thing a film cannot do.
   *
   * No label, so no pin: the caption panel names the place, and the stop already has a marker.
   */
  flyToStoryStop: (lat: number, lng: number, motion?: { headingRad?: number; durationS?: number }) => void;
  /** Wipe every trip overlay and fly back to the hero pose. The map lives above the route
   *  boundary and never unmounts, so without this a trip's route and markers survive a navigation
   *  back to the landing page. No-ops before the renderer exists. */
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
   * Call again on every day-tab change. Cheap to do so on either engine: Cesium rebuilds geometry
   * but takes its one expensive height sample per trip rather than per day, and MapLibre just
   * re-serialises a few hundred coordinates.
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
  /**
   * Draw (or clear) the focused day's real street paths.
   *
   * No fetching here, unlike `showHighways` — the data is already deduped and cached in
   * `dayRoutes.ts`, which the panel and the map both read. This just stores it for the engine
   * toggle's replay and forwards it to the live renderer.
   */
  showLegPaths: (request: LegPathDrawRequest | null) => void;
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
  /**
   * Altitude the current route is drawn at, in metres. A ref, not state: the marker layer reads
   * it once per frame to place cards on top of the stems, and that must not re-render anything.
   *
   * Engine-dependent by design. Cesium floats its geometry above the ellipsoid and samples the
   * rendered tile surface to find out how far, so this settles on a real city elevation; MapLibre
   * drapes on terrain and reports 0, which is the correct "the route is on the ground" for it.
   * Either way the marker layer adds `STEM_HEIGHT_M` on top and lands on the stem.
   */
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
  /**
   * Point at a stop, from either side.
   *
   * `source` is what decides whether the **camera** answers, and it is the whole of the rule:
   * pointing at a row in the itinerary leans the camera in (that is the peek — you are reading a
   * plan and asking "where is this"), while pointing at a card *on the map* only lights it up.
   * A hover on the map is already looking at the place; moving the ground under the pointer that
   * put itself there is the map arguing with the hand.
   *
   * The **highlight is identical either way** — both surfaces read the same index, which is what
   * makes it bidirectional. Only the flight is conditional. Defaulted to `"itinerary"` so a new
   * list of stops peeks without having to know this exists, and `StopMarkerLayer` is the one
   * caller that opts out.
   */
  setHoveredIndex: (index: number | null, source?: HoverSource) => void;
  /** Index of the selected stop — clicked, or stepped onto by a story beat. Outlives hover. */
  activeIndex: number | null;
  setActiveIndex: (index: number | null) => void;
  /**
   * Select a stop given the stop *object* rather than its index into `routeStops`.
   *
   * For the callers that legitimately do not have that index. `StopMarkerLayer` and Story mode's
   * controller (`storyMode.tsx`) both do and should keep using `setActiveIndex` — this is for the itinerary rows and the
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
  reframeRoute: (override?: { focusDay?: number | null; durationS?: number }) => boolean;
}

/** Where a hover came from — see `setHoveredIndex`. */
export type HoverSource = "itinerary" | "map";

const MapCameraContext = createContext<MapCameraContextValue | null>(null);

const DESTINATION_HEIGHT_M = 15000;
const PLACE_HEIGHT_M = 600;
/**
 * Story mode's arrival: camera-to-stop distance and pitch.
 *
 * 1200m puts the building and the two or three streets around it in frame — near enough that the
 * flight in from a day's framing is unmistakably a *dive*, far enough that MapLibre's extruded
 * blocks and Cesium's tiles both still read as a place rather than as a roof. -30 is shallower
 * than every other flight here (a stop is -35, a destination -45) because a film wants facades and
 * a horizon, not a plan view.
 */
export const STORY_RANGE_M = 1200;
export const STORY_PITCH_DEG = -30;
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

type Flight = [
  lat: number,
  lng: number,
  height: number,
  pitchDeg: number,
  label?: string,
  centreHeightM?: number,
  framing?: { contextRadiusM?: number; minRangeM?: number },
];

/** A named town near the destination, for the marker layer to label. */
export interface NearbyPlaceMarker {
  name: string;
  lat: number;
  lng: number;
  kind: string;
}

/** A whole trip's worth of routes, held for replay when the request beats the renderer. */
interface TripRouteRequest {
  days: RouteStop[][];
  focusedDay: number | null;
  soloFocus: boolean;
  panelVisible: boolean;
}

export function MapCameraProvider({
  engine,
  onEngineChange,
  children,
}: {
  /** The engine currently drawing. Owned by `AppShell` because it also decides which background
   *  component to render; the provider adds the camera handoff around changing it. */
  engine: MapEngine;
  onEngineChange: (engine: MapEngine) => void;
  children: ReactNode;
}) {
  const rendererRef = useRef<MapRenderer | null>(null);
  /** Every engine that has been built this session, by name.
   *
   *  Neither map is destroyed on a toggle — the reasoning `GlobeBackground`'s construction effect
   *  gives for never swapping a viewer applies just as much to swapping *between* two — so the
   *  second toggle onto an engine is instant and costs no tiles. This is where the inactive one
   *  waits. */
  const renderersRef = useRef<Partial<Record<MapEngine, MapRenderer>>>({});
  /** The view the outgoing engine was showing, waiting for the incoming one to arrive. */
  const handoffRef = useRef<CameraState | null>(null);
  /** The active engine, readable synchronously from callbacks that must not close over a stale
   *  render's value — `setRenderer` in particular, which fires from an async construction. */
  const engineRef = useRef<MapEngine>(engine);
  /** What the pointer is on, in the (day, index-within-day) space `applyEmphasis` takes. Mirrored
   *  into a ref so a replay onto a freshly-built engine can restore it without the effect below
   *  having to re-run. */
  const emphasisRef = useRef<{ day: number; index: number } | null>(null);
  /** The last overlays drawn, kept so the incoming engine can be given them without refetching.
   *  Overpass answers take seconds and are throttled by IP; paying for them again on every toggle
   *  would make the toggle the most expensive control in the app. */
  const lastHighwaysRef = useRef<{ points: { lat: number; lng: number }[] }[] | null>(null);
  /** The focused day's street paths, held for the same reason the highways are: the Map/Satellite
   *  toggle replays every overlay onto the incoming engine from cache rather than refetching. */
  const lastLegPathsRef = useRef<LegPathDrawRequest | null>(null);
  const lastCityRef = useRef<{ lat: number; lng: number }[][] | null>(null);
  const lastPinRef = useRef<{ lat: number; lng: number; label?: string } | null>(null);
  const pendingRef = useRef<Flight | null>(null);
  const pendingRouteRef = useRef<TripRouteRequest | null>(null);
  /** The last route asked for, kept after it is drawn rather than cleared like `pendingRouteRef`,
   *  so `reframeRoute` can replay its framing without rebuilding any geometry. */
  const lastRouteRef = useRef<TripRouteRequest | null>(null);
  /** Altitude the current route was drawn at, so new geometry lands on the arcs. */
  const routeAltitudeRef = useRef(0);
  /** Bumped per showTripRoute call so a slow height sample from an older trip can't win. */
  const routeGenerationRef = useRef(0);
  const pendingHighwaysRef = useRef<[lat: number, lng: number] | null>(null);
  /** Bumped per showHighways call so a slow, superseded fetch (e.g. re-picking a destination
   *  before the previous city's highways landed) can't draw over the newer city's roads. */
  const highwayGenerationRef = useRef(0);
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
  /**
   * Whether `showTripRoute` should draw without also reframing — see `setRouteFramingSuspended`.
   *
   * A ref rather than state, and that is load-bearing: `showTripRoute`'s identity is a dependency
   * of `ItineraryCard`'s route effect, so putting this in state would rebuild the callback and
   * redraw the entire route the moment it flipped.
   */
  const routeFramingSuspendedRef = useRef(false);
  const connectorsHiddenRef = useRef(false);
  /** Every stop of every day, flattened, each carrying its own `day`. Flat rather than nested
   *  because `hoveredIndex`/`activeIndex` index into it and always have — keeping one index
   *  space means StopMarkerLayer, Story mode and the peek logic needed no reworking when the
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
  const [hoveredIndex, setHoveredIndexState] = useState<number | null>(null);
  /** Which surface the current hover came from. A ref rather than state: it is set synchronously
   *  alongside the index and read by the peek effect that the index change schedules, so it is
   *  always current by the time anything looks — and routing it through state would re-render
   *  every consumer of this context for a value none of them render. */
  const hoverSourceRef = useRef<HoverSource>("itinerary");
  const setHoveredIndex = useCallback(
    (index: number | null, source: HoverSource = "itinerary") => {
      hoverSourceRef.current = source;
      setHoveredIndexState(index);
    },
    []
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  /** Where the camera was before the current run of hover peeks began, so leaving the list puts
   *  it back. Null means no peek is in flight — and any real camera command clears it, which is
   *  what stops an unhover from yanking the camera off a stop that was just clicked. */
  const peekReturnRef = useRef<CameraPose | null>(null);
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
      /** Altitude of the point to centre in frame. Zero aims at the ground, which for a stop means
       *  aiming below the street; a stop flight passes its card's height instead. */
      centreHeightM = 0,
      /** How the renderer should frame it — see `FlyToPointOptions`. A stop asks for its
       *  neighbourhood; a destination is already a city-wide view and asks for nothing.
       *
       *  `headingRad` and `durationS` ride along here rather than as their own parameters because
       *  this bag is already spread straight into `flyToPoint` *and* already stored in
       *  `pendingRef`, so a flight queued before the renderer exists replays with its facing and
       *  its timing intact. Both are optional the whole way down: omitting `headingRad` is not the
       *  same as passing 0, which is a claim that north is the direction of travel. */
      framing: {
        contextRadiusM?: number;
        minRangeM?: number;
        headingRad?: number;
        durationS?: number;
      } = {}
    ) => {
      // A real flight supersedes any hover peek, including one still waiting out its dwell.
      cancelPeek();
      const renderer = rendererRef.current;
      if (!renderer?.isAlive()) {
        // The renderer registers only once its map is ready — Cesium's 3D tileset takes seconds,
        // long after a trip page has fetched its trip and asked to fly. Hold the request and
        // replay it on registration instead of dropping it.
        pendingRef.current = [lat, lng, height, pitchDeg, label, centreHeightM, framing];
        return;
      }
      // One marker at a time: the pin always sits wherever the camera last flew, so a labelless
      // flight (the global reset) just clears it. Cached so an engine swap can put it back.
      lastPinRef.current = label ? { lat, lng, label } : null;
      renderer.setPin(lastPinRef.current);
      renderer.flyToPoint({ lat, lng, rangeM: height, pitchDeg, centreHeightM, ...framing });
    },
    [cancelPeek]
  );

  const showTripRoute = useCallback(
    (days: RouteStop[][], focusDay: number | null, panelVisible = true, soloFocus = false) => {
      // A new route reframes the camera, so any peek's saved pose belongs to a view that is about
      // to stop existing.
      cancelPeek();
      const flat = days.flat();
      // Published before the renderer check: the cards are plain DOM and cost nothing to mount
      // early, and they stay hidden until the per-frame loop has a map to project them with.
      routeStopsRef.current = flat;
      lastRouteRef.current = { days, focusedDay: focusDay, panelVisible, soloFocus };
      setRouteStops(flat);
      // Only for days that will actually be drawn. Under `soloFocus` the others have no route
      // under them, and a "Day 4" badge hanging over bare imagery names nothing.
      setRouteClusters(
        buildDayClusters(days).filter((c) => !soloFocus || focusDay === null || c.day === focusDay)
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
      const renderer = rendererRef.current;
      if (!renderer?.isAlive()) {
        // Same race as flyTo: the itinerary renders in a few hundred ms, the tileset takes
        // seconds. Dropping the request here meant the route silently never drew on a cold load.
        pendingRouteRef.current = { days, focusedDay: focusDay, panelVisible, soloFocus };
        return;
      }
      const generation = ++routeGenerationRef.current;
      if (flat.length === 0) {
        renderer.clearRoute();
        return;
      }

      // Framing first, and deliberately before the draw resolves: it needs no heights, and its
      // 2s flight covers whatever the renderer's own sampling costs.
      //
      // Skipped outright while a generation streams: this function is called once per arriving
      // stop then, and each call is a 2s flight to a *different* pose — measured on a live 4-day
      // Rome run, the framing heading swung 25° → 23° → 53° → 276° → 281° across five clumps of
      // stops, because "face the route across its long axis" means something new every time a
      // stop lands. `useStreamingCamera` owns the camera for the length of a run instead.
      if (!routeFramingSuspendedRef.current) {
        renderer.frameRoute({
          days,
          focusDay,
          panelVisible,
          routeAltitudeM: routeAltitudeRef.current,
        });
      }

      void renderer
        .drawRoute({
          days,
          focusDay,
          soloFocus,
          altitudeHintM: routeAltitudeRef.current,
          connectors: !connectorsHiddenRef.current,
          stateFor: (day) => dayVisualState(day, focusDay, hoveredDayRef.current),
        })
        .then((altitude) => {
          // A fast day-tab switch can land a newer route mid-sample; the newest request wins.
          if (generation !== routeGenerationRef.current) return;
          routeAltitudeRef.current = altitude;
        });
    },
    [cancelPeek, setHoveredIndex]
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
    rendererRef.current?.applyDayStates((day) => dayVisualState(day, focusedDay, hoveredDay));
  }, [focusedDay, hoveredDay, routeStops]);

  // Hover wins over selection: while the pointer is on something, that is what the map should be
  // pointing at. Falls back to the selected stop when the pointer leaves.
  useEffect(() => {
    // `hoveredIndex` indexes the flat stop list, but emphasis is per-route, so it has to be
    // resolved back to (which day, which stop within it).
    const emphasised = hoveredIndex ?? activeIndex;
    const emphasisedStop = emphasised === null ? null : routeStops[emphasised];
    if (!emphasisedStop) {
      emphasisRef.current = null;
      rendererRef.current?.applyEmphasis(null, null);
      return;
    }
    const dayStart = routeStops.findIndex((st) => st.day === emphasisedStop.day);
    emphasisRef.current = { day: emphasisedStop.day, index: emphasised! - dayStart };
    rendererRef.current?.applyEmphasis(emphasisRef.current.day, emphasisRef.current.index);
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
   * - **A map must already exist.** Hovering must never be the thing that boots one — a pointer
   *   crossing a list would otherwise spin up a WebGL context and a tile stream on a surface that
   *   had declined the globe.
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
    const renderer = rendererRef.current;
    if (!ready || !renderer?.isAlive()) return;
    if (prefersReducedMotion()) return;
    // An editing surface is open. Not merely "don't start a new peek": a peek already in flight
    // when the editor opened would otherwise leave the camera leaned in on a stop with the plan
    // no longer on screen, so the pending dwell is dropped and the lean-out is allowed to run.
    if (peekSuspended) {
      if (peekReturnRef.current) flyHomeRef.current?.();
      else cancelPeek();
      return;
    }

    // A hover that came from the map is deliberately read as *no* stop here. Not an early return:
    // routing it through the same `null` path is what makes a peek already in flight lean back
    // out when the pointer leaves an itinerary row and lands on a marker card, instead of being
    // stranded leaned in with its saved pose abandoned.
    const stop =
      hoverSourceRef.current === "map" || hoveredIndex === null ? null : routeStops[hoveredIndex];

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
      if (!home || !renderer.isAlive()) return;
      renderer.flyToPose(home, peekFlightRef.current, () => {
        // Forgotten on *arrival*, not on departure. Clearing it on departure was a real bug: a row
        // hovered while this flight was still running found no saved pose, captured the camera
        // mid-flight as its own "home", and the next lean-out went to that meaningless
        // intermediate point — measured 4.5km from where the run had started. Deep dives made it
        // easy to hit, since they take longer to fly and leave a wider window to interrupt.
        // Guarded by identity so a newer run's pose is never the one dropped.
        if (peekReturnRef.current === home) peekReturnRef.current = null;
      });
    };

    const fire = () => {
      peekTimerRef.current = null;
      if (!stop || !renderer.isAlive()) return;
      // Captured once per run of peeks, not per row: hovering four rows in sequence should
      // return to where the camera was before the first of them, not to the third one.
      peekReturnRef.current ??= renderer.capturePose();
      const home = peekReturnRef.current;
      if (!home) return;
      // Every other stop of the *hovered stop's own day* — the pocket it sits in is what decides
      // whether a lean is enough to tell it apart from its neighbours. Other days are excluded:
      // they are drawn, but dimmed and unnamed, and they are not what the pointer is reading.
      const neighbourDistancesM = routeStops.reduce<number[]>((acc, other, i) => {
        if (i !== hoveredIndex && other.day === stop.day) acc.push(metresBetween(stop, other));
        return acc;
      }, []);
      // Aim at the stop's floating card rather than the ground, same as a click does, so the peek
      // centres on the thing that names the place.
      const centreHeightM = routeAltitudeRef.current + STEM_HEIGHT_M;
      const cameraDistanceM = renderer.distanceFromPoseM(home, stop.lat, stop.lng, centreHeightM);
      const homePitch = renderer.posePitchRad(home);
      const range = peekRangeM(cameraDistanceM, neighbourDistancesM, homePitch);
      peekFlightRef.current = peekFlightSeconds(cameraDistanceM, range);
      renderer.flyToPoint({
        lat: stop.lat,
        lng: stop.lng,
        // **No `minRangeM` here, and that is load-bearing.** `peekRangeM` already carries the only
        // floor this flight should have (`PEEK_MIN_HEIGHT_M` converted through the pitch, so a
        // shallow angle over a dense downtown does not fly the camera through a tower), and it
        // chooses the range from concentric rings around the hovered stop — 250m for a café
        // inside its own market, 11km for a day that crosses a region.
        //
        // A second floor at neighbourhood scale swallowed that table whole: measured against the
        // saved trips, every ring from 250m to 2800m clamped to the same number, so a pocket 80m
        // across framed identically to a day spanning 12km and the feature was dead while looking
        // like it worked. The click path is where the over-zoom complaint actually lived, and it
        // is handled there with `contextRadiusM`.
        rangeM: range,
        // The pre-peek heading and pitch, deliberately kept rather than snapped to the click's
        // -35°. Re-tilting on hover is what made this read as "the camera went somewhere":
        // holding the angle already being looked from leaves only the distance changing.
        pitchDeg: (homePitch * 180) / Math.PI,
        headingRad: renderer.poseHeadingRad(home),
        centreHeightM,
        durationS: peekFlightRef.current,
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
      let data: {
        boundary: { segments: { lat: number; lng: number }[][] } | null;
        nearby: NearbyPlaceMarker[];
      };
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
      // renderer registers — capturing the ref up front therefore captured `null` every time, and
      // the outline was silently dropped while the fetch it had just paid for sat there complete.
      // `showHighways` survives the same race only because it queues into `pendingHighwaysRef`;
      // the Overpass round-trip here is seconds long, which is more than enough for the map to
      // arrive, so re-reading is all this needs.
      const renderer = rendererRef.current;
      if (!renderer?.isAlive() || !data.boundary) {
        // Let the next attempt try again rather than caching the failure forever.
        cityKeyRef.current = null;
        return;
      }
      lastCityRef.current = data.boundary.segments;
      renderer.drawCityBoundary(data.boundary.segments);
    })();
  }, []);

  const showLegPaths = useCallback((request: LegPathDrawRequest | null) => {
    lastLegPathsRef.current = request;
    // No pending-queue dance: unlike the route and the destination flight, nothing here is racing
    // a cold tileset. If the renderer is not up yet the paths simply arrive with `replayOverlays`
    // when it is, which is the same path the engine toggle uses.
    rendererRef.current?.drawLegPaths(request);
  }, []);

  const showHighways = useCallback((lat: number, lng: number) => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive()) {
      // Same cold-load race as flyTo/showTripRoute: the destination flight can be requested
      // before the map (and thus the renderer) registers. Replayed from setRenderer below.
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
      if (generation !== highwayGenerationRef.current) return;
      lastHighwaysRef.current = segments;
      rendererRef.current?.drawHighways(segments);
    })();
  }, []);

  /**
   * Hand a renderer everything the trip has already put on the map.
   *
   * The toggle's whole job, really. Geometry is rebuilt from `lastRouteRef` and the overlays from
   * their own caches — nothing is refetched, and nothing flies: the camera is restored separately
   * and this must not fight it. `drawRoute` never moves the camera on either engine (that is
   * `frameRoute`'s job, and `showTripRoute` calls them as two steps), which is what makes the
   * separation possible.
   */
  const replayOverlays = useCallback((renderer: MapRenderer) => {
    if (lastPinRef.current) renderer.setPin(lastPinRef.current);
    if (lastHighwaysRef.current) renderer.drawHighways(lastHighwaysRef.current);
    if (lastLegPathsRef.current) renderer.drawLegPaths(lastLegPathsRef.current);
    if (lastCityRef.current) renderer.drawCityBoundary(lastCityRef.current);
    const route = lastRouteRef.current;
    if (!route) return;
    const generation = ++routeGenerationRef.current;
    void renderer
      .drawRoute({
        days: route.days,
        focusDay: route.focusedDay,
        soloFocus: route.soloFocus,
        altitudeHintM: routeAltitudeRef.current,
        // Carried across the swap like everything else here: pressing Map/Satellite mid-film must
        // not hand the incoming engine a set of arcs the film had put away.
        connectors: !connectorsHiddenRef.current,
        stateFor: (day) => dayVisualState(day, route.focusedDay, hoveredDayRef.current),
      })
      .then((altitude) => {
        if (generation !== routeGenerationRef.current) return;
        routeAltitudeRef.current = altitude;
        // The retint and emphasis effects key on state that did not change across the swap, so
        // they will not re-run — the new geometry has to be told what is selected and what the
        // pointer is on, or a toggle silently drops the highlight.
        renderer.applyDayStates((day) =>
          dayVisualState(day, route.focusedDay, hoveredDayRef.current)
        );
        const emphasised = emphasisRef.current;
        renderer.applyEmphasis(emphasised?.day ?? null, emphasised?.index ?? null);
      });
  }, []);

  /**
   * Make `engine`'s renderer the live one.
   *
   * Called from two directions — a toggle whose target engine is already built, and a background
   * finishing construction — because those are the same event seen from either side, and the
   * restore-and-replay must happen exactly once whichever arrives second.
   */
  const activate = useCallback(
    (renderer: MapRenderer | null) => {
      rendererRef.current = renderer;
      setReady(!!renderer);
      if (!renderer) return;

      // The view the outgoing engine was showing. Restored before the geometry is replayed so the
      // first frame the traveler sees is already in the right place rather than over Africa.
      const handoff = handoffRef.current;
      handoffRef.current = null;
      if (handoff) {
        renderer.restoreCamera(handoff);
        replayOverlays(renderer);
        return;
      }

      // First build of the session: no view to inherit, so the queued requests are what place the
      // camera. Cesium's tileset takes seconds and a trip page has usually asked to fly long
      // before that; dropping those requests is what used to leave the route silently undrawn.
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) flyTo(...pending);
      // Replayed after the flight so its framing wins — a queued route is the more specific
      // request, and both resolve to a camera flight where the last call cancels the first.
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
    [flyTo, showTripRoute, showHighways, replayOverlays]
  );

  const setRenderer = useCallback(
    (renderer: MapRenderer | null) => {
      if (!renderer) {
        // A background tearing down. Only the *active* engine's teardown blanks the live slot —
        // the other one going away is invisible from here.
        return;
      }
      renderersRef.current[renderer.engine] = renderer;
      // Built, but the traveler has since toggled away from it. It waits in the registry; the
      // engine effect below will pick it up if they toggle back.
      if (renderer.engine !== engineRef.current) return;
      activate(renderer);
    },
    [activate]
  );

  /**
   * Swap engines, keeping the view.
   *
   * The capture has to happen *here*, synchronously, and not in the effect that reacts to the
   * change: by the time an effect runs, React has already re-rendered and the outgoing background
   * may have hidden its canvas, and a hidden canvas is a camera nobody can read.
   */
  const setEngine = useCallback(
    (next: MapEngine) => {
      if (next === engineRef.current) return;
      handoffRef.current = rendererRef.current?.cameraState() ?? null;
      cancelPeek();
      onEngineChange(next);
    },
    [cancelPeek, onEngineChange]
  );

  // React to the engine actually changing — including the case where the target was built earlier
  // in the session and is sitting in the registry, which fires no `setRenderer` of its own.
  useEffect(() => {
    engineRef.current = engine;
    activate(renderersRef.current[engine] ?? null);
    // `activate` is stable enough for this to be keyed on the engine alone: re-running it on a
    // callback identity change would re-restore a handoff that has already been consumed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const flyToDestination = useCallback(
    (lat: number, lng: number, label?: string) => flyTo(lat, lng, DESTINATION_HEIGHT_M, -45, label),
    [flyTo]
  );
  /**
   * Fly to one stop of the current day, framing its floating card rather than the ground.
   *
   * The card is the thing that names the place, so it is what the camera should arrive on. Aiming
   * at the default ground surface put the card near the top edge of the frame — or out of it —
   * and centred a patch of road instead, which is what made both a camera flight and a marker click
   * look like they were zooming to the bottom of the marker.
   *
   * A marker click and an itinerary row go through here, so they arrive at the same range, the
   * same pitch, centred on the same card, framed in the same neighbourhood. A story beat goes
   * through `flyToStoryStop` instead, which trades the neighbourhood framing for a dive — but it
   * inherits the `motion` argument below, and for the same reason.
   *
   * **Not everything arrives facing the same way, and that is deliberate.** A story beat passes a
   * `headingRad` so each stop is framed along the direction of travel, which is what makes a
   * sequence of stops read as a journey. A marker click and an itinerary row pass nothing and stay
   * north-up, because a single click has no next stop to face — and a searched place has no route
   * at all. So the same stop is framed differently depending on how you arrived at it. That is a
   * real inconsistency rather than an oversight; the alternative is inventing a direction for a
   * lone click, which would be a claim about a journey nobody is on.
   *
   * (This arrived with the Play tour, which Story mode has since replaced. The reasoning survived
   * the replacement intact — a narrated walk through a day is the same journey the tour was.)
   */
  const flyToPlace = useCallback(
    (
      lat: number,
      lng: number,
      label?: string,
      /** The tour's facing and pacing. Omitted everywhere else. */
      motion: { headingRad?: number; durationS?: number } = {}
    ) =>
      flyTo(lat, lng, PLACE_HEIGHT_M, -35, label, routeAltitudeRef.current + STEM_HEIGHT_M, {
        // `PLACE_HEIGHT_M` is 600m, which puts the camera on the pavement outside the building
        // with nothing else in frame. That answers "where exactly is this" and not "where is this
        // in the city", which is the question somebody reading an itinerary is asking — so the
        // renderer frames the stop's neighbourhood around it and treats the 600m as a floor it is
        // no longer allowed to reach.
        contextRadiusM: STOP_CONTEXT_RADIUS_M,
        minRangeM: STOP_MIN_RANGE_M,
        ...motion,
      }),
    [flyTo]
  );
  /** See `flyToSearchResult` on the context. Same shape as `flyToPlace` and deliberately not
   *  sharing its constants — on MapLibre the context radius is what selects the `fitBounds` path
   *  over a computed zoom, so this is the call that frames a result in the panel's clear strip
   *  rather than diving onto its roof. */
  const flyToSearchResult = useCallback(
    (lat: number, lng: number) =>
      flyTo(lat, lng, PLACE_HEIGHT_M, -35, undefined, routeAltitudeRef.current + STEM_HEIGHT_M, {
        contextRadiusM: SEARCH_CONTEXT_RADIUS_M,
        minRangeM: SEARCH_MIN_RANGE_M,
      }),
    [flyTo]
  );

  /** See `flyToStoryStop` on the context — a straight dive to `STORY_RANGE_M`, with none of
   *  `flyToPlace`'s context radius or range floor. */
  /** See `flyToStoryStop` on the context. `motion` carries the leg bearing and the flight time,
   *  the two things the retired Play tour got right and a narrated walk through a day wants for
   *  exactly the same reason. */
  const flyToStoryStop = useCallback(
    (lat: number, lng: number, motion: { headingRad?: number; durationS?: number } = {}) =>
      flyTo(
        lat,
        lng,
        STORY_RANGE_M,
        STORY_PITCH_DEG,
        undefined,
        routeAltitudeRef.current + STEM_HEIGHT_M,
        // `motion` and nothing else: a story beat wants the facing and pacing the tour worked out,
        // and none of `flyToPlace`'s neighbourhood framing — see this function's note on the
        // context.
        motion
      ),
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
        (s) => s.lat === stop.lat && s.lng === stop.lng && s.name === stop.name && s.time === stop.time
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
  const reframeRoute = useCallback(
    (
      /** Frame a *different* day of the same drawn route, or take a different flight time.
       *  Omitted — the way back out of a stop — replays the framing exactly as it was, which is
       *  every existing caller. The tour uses it to walk the days of a collapsed trip without
       *  redrawing anything: the geometry on screen stays the whole trip, and only the camera
       *  moves from day to day. */
      override?: { focusDay?: number | null; durationS?: number }
    ) => {
      const request = lastRouteRef.current;
      if (!request) return false;
      cancelPeek();
      const renderer = rendererRef.current;
      if (!renderer?.isAlive()) return false;
      // `routeAltitudeRef` is the real sampled altitude by now, rather than the previous route's
      // stand-in that the first draw had to make do with — so this framing is the better of the two.
      renderer.frameRoute({
        days: request.days,
        focusDay: override && "focusDay" in override ? override.focusDay ?? null : request.focusedDay,
        panelVisible: request.panelVisible,
        routeAltitudeM: routeAltitudeRef.current,
        ...(override?.durationS !== undefined ? { durationS: override.durationS } : {}),
      });
      return true;
    },
    [cancelPeek]
  );

  const setRouteFramingSuspended = useCallback((suspended: boolean) => {
    routeFramingSuspendedRef.current = suspended;
  }, []);

  /** A ref, not state: it is read at draw time, and the caller always redraws right after setting
   *  it. Putting it in state would re-render every consumer of this context for a value only the
   *  renderer reads. */
  const setRouteConnectorsHidden = useCallback((hidden: boolean) => {
    connectorsHiddenRef.current = hidden;
  }, []);

  const resetToHome = useCallback(() => {
    cancelPeek();
    const renderer = rendererRef.current;
    // No-op before the renderer exists, which is exactly right on a cold load of `/`: the home
    // effect fires long before the map registers, so the background's own initial pose proceeds
    // untouched. On a soft navigation the renderer always exists, so this always runs.
    if (!renderer?.isAlive()) return;

    routeGenerationRef.current++;
    highwayGenerationRef.current++;
    // The map never unmounts, so without this the previous city's route, highways and pin would
    // still be drawn under the landing-page hero pose.
    renderer.clearOverlays();
    // Otherwise the day's marker cards survive a navigation back to the landing page — the map
    // never unmounts, so nothing else clears them.
    routeStopsRef.current = [];
    lastRouteRef.current = null;
    lastHighwaysRef.current = null;
    lastLegPathsRef.current = null;
    lastCityRef.current = null;
    lastPinRef.current = null;
    emphasisRef.current = null;
    setRouteStops([]);
    setRouteClusters([]);
    setFocusedDay(null);
    setHoveredIndex(null);
    setActiveIndex(null);
    // Otherwise a request queued while the map was loading replays onto the empty world.
    pendingRef.current = null;
    pendingRouteRef.current = null;
    pendingHighwaysRef.current = null;

    renderer.flyHome();
  }, [cancelPeek, setHoveredIndex]);

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
      setRenderer,
      rendererRef,
      engine,
      setEngine,
      ready,
      globeWanted,
      setGlobeWanted,
      peekSuspended,
      setPeekSuspended,
      setRouteFramingSuspended,
      setRouteConnectorsHidden,
      flyToDestination,
      flyToPlace,
      flyToSearchResult,
      flyToStoryStop,
      resetToHome,
      showTripRoute,
      showHighways,
      showLegPaths,
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
      setRenderer,
      engine,
      setEngine,
      ready,
      peekSuspended,
      globeWanted,
      flyToDestination,
      flyToPlace,
      flyToSearchResult,
      flyToStoryStop,
      resetToHome,
      showTripRoute,
      showHighways,
      showLegPaths,
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
      // `setHoveredIndex` joined them when it stopped being a bare setter and started carrying
      // the hover's source.
      setActiveStop,
      reframeRoute,
      setHoveredIndex,
      setRouteFramingSuspended,
      setRouteConnectorsHidden,
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
 * Declare that this surface is an editing one, and that the map's hover peek should hold still
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

/**
 * Declares that the calling surface puts the map on screen for as long as `wanted` holds.
 *
 * Released on unmount, so leaving a map surface hides the canvas and pauses the render loop. The
 * map is never *destroyed* — see `GlobeBackground`'s construction effect for why a swap is
 * unrecoverable — so this is a visibility gate, not a lifecycle one.
 */
export function useGlobeOnScreen(wanted: boolean) {
  const { setGlobeWanted } = useMapCamera();
  useEffect(() => {
    setGlobeWanted(wanted);
    return () => setGlobeWanted(false);
  }, [wanted, setGlobeWanted]);
}
