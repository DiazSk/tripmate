import type { DayVisualState, RouteStop } from "@/lib/mapRoute";
import type { MapEngine } from "@/lib/mapEngine";

/**
 * Everything `mapCamera.tsx` needs a map engine to do, and nothing about how either one does it.
 *
 * This exists so the camera state machine — the pending-request queues, the hover-peek dwell and
 * intent gating, the day emphasis rules, the fetch-and-fail-soft overlays — is written once. That
 * logic is the same whether the world underneath is Cesium's photogrammetry or MapLibre's vector
 * tiles, and it is the part with all the hard-won behaviour in it.
 *
 * **The contract is in metres, degrees and CSS pixels.** No `Cartesian3` and no `LngLat` crosses
 * this boundary. Camera aim is expressed the way Cesium already expressed it internally — a target
 * point plus a *range* (distance from camera to target), a pitch and a heading — because that is
 * the vocabulary the app's framing rules are written in (`frameRouteBesidePanel`, `peekRangeM`).
 * MapLibre thinks in `{center, zoom, bearing, pitch}` instead and converts on the way in; see
 * `rangeToZoom` in `maplibreRenderer.ts`.
 *
 * **Pitch is Cesium's convention throughout: negative is looking down.** -90 is nadir, -45 is the
 * house oblique, 0 is the horizon. MapLibre's is the complement (0 = nadir) and the conversion is
 * the renderer's problem, not the caller's. Getting this backwards silently inverts the tilt
 * slider, so it is stated here rather than left to be inferred.
 *
 * Anything asynchronous resolves rather than throws — the map is ambient context, and the house
 * fail-soft convention (see CLAUDE.md) applies to it as much as to a weather fetch.
 */
export interface MapRenderer {
  readonly engine: MapEngine;

  /**
   * False once the underlying map has been torn down. Every method is safe to call on a dead
   * renderer — they no-op — but callers holding an `await` across a teardown should check, the
   * same way the Cesium code checked `viewer.isDestroyed()`.
   */
  isAlive(): boolean;

  /**
   * Ask for one frame.
   *
   * Load-bearing on Cesium, which runs in `requestRenderMode` and will otherwise not repaint a
   * recolour that moved no geometry. MapLibre repaints on its own schedule and treats this as a
   * hint (`triggerRepaint`).
   */
  requestRender(): void;

  // ---------------------------------------------------------------- overlays

  /**
   * Draw the trip: a route per day, a stem and a ground pool per stop.
   *
   * Resolves with the altitude the geometry ended up at, in metres. Cesium samples the *rendered*
   * tile surface for this and takes over a second to answer, which is why the request carries
   * `altitudeHintM` — the previous route's altitude, good enough to draw at immediately and
   * corrected when the real number lands. MapLibre reads its DEM and answers instantly, and
   * resolves with the hint's replacement just the same.
   *
   * Implementations must tolerate being superseded: a newer `drawRoute` may land before an older
   * one resolves, and the caller guards with a generation counter, but the renderer must not have
   * drawn the older route's corrections over the newer one in the meantime.
   */
  drawRoute(request: RouteDrawRequest): Promise<number>;
  clearRoute(): void;

  /**
   * Retint every drawn day in place. The callback is asked per drawn day index rather than handed
   * an array, so a renderer that keeps its days sparse (Cesium's `routeGeometries` has holes by
   * design) doesn't have to reconstruct one.
   */
  applyDayStates(stateFor: (day: number) => DayVisualState): void;

  /**
   * Mark one stop as the thing being pointed at — `dayIndex` plus the stop's index *within that
   * day*, or `(null, null)` to clear. Every other day is cleared by the implementation, so two
   * days can never both read as emphasised.
   */
  applyEmphasis(dayIndex: number | null, indexWithinDay: number | null): void;

  /** The single search pin. `null` removes it. One at a time, by design. */
  setPin(pin: { lat: number; lng: number; label?: string } | null): void;

  drawHighways(segments: { points: { lat: number; lng: number }[] }[]): void;
  drawCityBoundary(segments: { lat: number; lng: number }[][]): void;

  /**
   * Pins for places the traveler searched for, distinct from the trip's own stops.
   *
   * **MapLibre only, by product decision rather than by capability.** Exploring is what the vector
   * map is for — it has the street network, the labels and the venue data underneath it — while
   * satellite is for looking at a plan that already exists. `CesiumRenderer` implements this as a
   * clear, so switching to Satellite puts the search results away rather than carrying them over
   * into a view that has nothing to say about them. A place added to the itinerary is a *stop* by
   * then, and stops are drawn on both.
   */
  showSearchResults(places: SearchPin[]): void;

  /**
   * The ground the camera can currently see, as a polygon in visit order.
   *
   * Four corners in the ordinary case — the viewport's quadrilateral projected onto the ground,
   * which under pitch is a trapezoid rather than a rectangle. Empty when the engine cannot answer
   * (no canvas yet, a degenerate viewport).
   *
   * **Clamped to something finite.** Above the horizon a screen ray never meets the ground, and a
   * tilted camera puts the top of the viewport there routinely; the naive answer is a coordinate
   * at infinity, or a wrap-around that reads as the far side of the planet. Each engine walks the
   * sample point down the screen until the ray lands within `MAX_FOOTPRINT_M` of the centre, so
   * the polygon is always a real, bounded piece of ground.
   */
  visibleFootprint(): { lat: number; lng: number }[];

  /** Route, highways, city outline and pin — everything a trip put on the map. */
  clearOverlays(): void;

  // ---------------------------------------------------------------- camera

  /**
   * Frame a point: put it at the centre of the view, `rangeM` away, at this pitch and heading.
   *
   * Not "fly the camera to these coordinates" — that lands the camera *on* the place, which at a
   * downward pitch puts the place itself outside the frustum. `centreHeightM` lifts the aim point
   * off the ground so a stop's floating card is what gets centred rather than the road under it.
   */
  flyToPoint(options: FlyToPointOptions): void;

  /** Frame a whole route, biased clear of the itinerary panel. See `frameRouteBesidePanel`. */
  frameRoute(options: FrameRouteOptions): void;

  /** The landing-page pose. */
  flyHome(durationS?: number): void;

  /**
   * The view, in terms neither engine owns — the point under the middle of the screen, how far the
   * camera is from it, and which way it is facing.
   *
   * This is the handoff. Toggling between Map and Satellite swaps one renderer for the other, and
   * without it the new engine would arrive at whatever pose it was last left in — usually the hero
   * view over Africa — throwing away the place the traveler was actually looking at. Read from the
   * outgoing engine, applied to the incoming one.
   *
   * Null before there is a camera to read.
   */
  cameraState(): CameraState | null;

  /**
   * Put the camera exactly where `cameraState` said, with no flight and no framing correction.
   *
   * Deliberately not `flyToPoint`: that centres its target in the strip the itinerary panel leaves,
   * which is right for "show me this stop" and wrong here — the point being restored *is* the
   * screen centre already, so biasing it again would slide the view sideways on every toggle.
   */
  restoreCamera(state: CameraState): void;

  /**
   * Snapshot the camera, for the hover peek to lean back out to.
   *
   * Opaque: only this renderer can read it back. Null when there is no camera yet.
   */
  capturePose(): CameraPose | null;
  flyToPose(pose: CameraPose, durationS: number, onArrive?: () => void): void;
  /** Heading and pitch of a snapshot, in radians, so the peek can hold the angle it was at. */
  poseHeadingRad(pose: CameraPose): number;
  posePitchRad(pose: CameraPose): number;
  /** Metres from a snapshot's camera position to a world point. Drives `peekRangeM`. */
  distanceFromPoseM(pose: CameraPose, lat: number, lng: number, heightM: number): number;

  // ------------------------------------------------- projection & chrome

  /**
   * Run `cb` after every rendered frame. Returns the unsubscribe.
   *
   * This is the marker layer's clock and the map chrome's readout. It must fire on frames where
   * the camera moved and cost nothing on frames where it did not.
   */
  onFrame(cb: () => void): () => void;

  /** The drawing surface, for a `ResizeObserver` and for CSS-pixel dimensions. */
  canvas(): HTMLCanvasElement | null;

  /**
   * World point to CSS pixels, written into `out`. Returns false when the point should not be
   * drawn at all — behind the camera, or over the horizon on a globe.
   *
   * CSS pixels, not device pixels: Cesium runs a custom `resolutionScale` here, so the two
   * genuinely differ. Allocation-free by contract — this runs per marker per frame.
   */
  project(lat: number, lng: number, heightM: number, out: ScreenPoint): boolean;

  /** Metres from the camera to a world point. Drives marker scale. */
  cameraDistanceM(lat: number, lng: number, heightM: number): number;

  headingRad(): number;
  /** Cesium convention: negative is down. */
  pitchRad(): number;

  /**
   * Dolly toward or away from whatever is under the middle of the screen.
   *
   * The step is expressed as a fraction of the current distance so it scales with proximity, and
   * clamped in metres so repeated presses cannot end up inside the building mesh. `fromRangeM`
   * lets successive presses compound off the range the previous flight was heading for rather
   * than off wherever the camera happens to be mid-flight.
   */
  zoomStep(options: ZoomStepOptions): void;

  /** Turn to a heading, keeping the screen-centre point fixed. */
  setHeadingRad(headingRad: number, durationS?: number): void;
  /** Tilt to a pitch (negative down), keeping the screen-centre point fixed. */
  setPitchDeg(pitchDeg: number, options?: { animate?: boolean; durationS?: number }): void;
  /** Distance from the camera to the screen-centre ground point, in metres. */
  centreRangeM(): number;

  /** Clicks on the map itself, in lat/lng. Returns the unsubscribe. */
  onMapClick(cb: (lat: number, lng: number) => void): () => void;
}

/** Opaque camera snapshot. Only the renderer that produced it can read it. */
export type CameraPose = object;

/**
 * A camera pose both engines can read and write — see `MapRenderer.cameraState`.
 *
 * Distinct from `CameraPose`, which is opaque and engine-private: that one exists so the hover
 * peek can return to a pose bit-for-bit, this one exists so a *different* engine can arrive at the
 * same view. Expressed as an aim point plus a range rather than a camera position, because that is
 * the only description of a view that survives the trip between a globe and a mercator map.
 */
export interface CameraState {
  /** The point under the middle of the screen. */
  lat: number;
  lng: number;
  /** Camera-to-that-point distance, in metres. */
  rangeM: number;
  headingRad: number;
  /** Cesium convention: negative is down. */
  pitchDeg: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** One searched-for place on the map. Deliberately smaller than `FoundPlace`: the renderer needs
 *  a position, a label and whether it is the one being pointed at, and nothing else. */
export interface SearchPin {
  id: string;
  lat: number;
  lng: number;
  name: string;
  selected?: boolean;
  /**
   * The colour this pin is drawn in — `#rrggbb`, resolved by the caller from the result's category.
   *
   * On the pin rather than derived in the renderer, and that is deliberate: which colour a category
   * gets is a *design* fact with a proof attached (`searchPalette.ts` asserts every one of them is
   * perceptually clear of the trip's own day colours), and burying a second copy of that mapping in
   * a paint expression is how the two would drift. The renderer's job is to draw the colour it is
   * handed. Optional, and the layer falls back to the accent, so an older caller still renders.
   */
  colorHex?: string;
  /** The row the pointer is on in the results list. At most one pin carries this, and every other
   *  pin recedes while it does — the list and the map are two views of one set, and a hover is how
   *  the traveler asks "which of these is that one". Distinct from `selected`, which is a choice
   *  that persists and survives the pointer leaving. */
  hovered?: boolean;
}

export interface RouteDrawRequest {
  /** Every day of the trip, in order. Days with no stops keep their slot. */
  days: RouteStop[][];
  /** The panel's selected day, or null for the whole-trip overview. */
  focusDay: number | null;
  /** True when the focused day should be the *only* one drawn (the itinerary panel's reading of
   *  "select a day"); false when the others stay drawn and dim (the split editor's). */
  soloFocus: boolean;
  /** Altitude to draw at right now, corrected once the real sample lands. */
  altitudeHintM: number;
  /** How present each day should be, resolved by the caller from focus and hover. */
  stateFor: (day: number) => DayVisualState;
  /**
   * Draw the line between one stop and the next. True everywhere except Story mode.
   *
   * The connectors are what make a day read as an *order* — this then this then this — and while
   * you are reading a plan that is the most useful thing on the map. A film is not reading a plan:
   * it is standing in one place at a time, being told about it, and the arc sweeping off toward
   * somewhere the narration has not reached yet is a spoiler drawn across the shot. So Story mode
   * asks for the stops alone, and the sequence is carried by the narration instead.
   *
   * "Connectors" covers both forms each engine draws, which is deliberate: on MapLibre that is the
   * elevated arc tube *and* the line draped on the terrain beneath it, and hiding only the tube
   * would leave a flat rope snaking between the stops. Nothing about a stop itself is affected —
   * its pool, its ring, its stem and its label are what the film is pointing at.
   */
  connectors?: boolean;
}

export interface FlyToPointOptions {
  lat: number;
  lng: number;
  /** Camera-to-target distance in metres. */
  rangeM: number;
  /** Negative is down. */
  pitchDeg: number;
  headingRad?: number;
  /** Altitude of the point to centre. Zero aims at the ground. */
  centreHeightM?: number;
  durationS?: number;
  /**
   * Frame at least this much ground around the point, in metres, instead of diving to `rangeM`.
   *
   * A stop is a building, and `rangeM` for one is 600m — which puts the camera on the pavement
   * outside it with nothing else in frame. That answers "where exactly is this" and not "where is
   * this *in the city*", which is the question somebody reading an itinerary is actually asking.
   * With a radius set, the renderer frames a box that size around the point and lets the stop sit
   * inside its own neighbourhood.
   *
   * MapLibre implements this as `fitBounds` over the box; Cesium pulls its range back until the
   * same ground is in frame. Both then obey `minRangeM` below.
   */
  contextRadiusM?: number;
  /**
   * Never come closer than this, in metres.
   *
   * The floor that stops a lean turning into a dive. Expressed as a distance rather than as
   * MapLibre's `maxZoom` because this contract is in metres — the renderer converts.
   */
  minRangeM?: number;
}

export interface FrameRouteOptions {
  days: RouteStop[][];
  focusDay: number | null;
  /** True when the itinerary panel is open, so the route is aimed into the strip it leaves. */
  panelVisible: boolean;
  routeAltitudeM: number;
  durationS?: number;
}

export interface ZoomStepOptions {
  direction: 1 | -1;
  /** Fraction of the current distance each press covers. */
  ratio: number;
  minRangeM: number;
  maxRangeM: number;
  /** Range the previous press was heading for, so held presses compound. */
  fromRangeM?: number | null;
  durationS?: number;
  /** The range this press settled on, so the caller can accumulate the next one off it. */
  onSettled?: (rangeM: number | null) => void;
}

/**
 * The days a draw or a framing actually puts on screen — the focused one if it has stops,
 * otherwise every day.
 *
 * Shared between the renderers and the provider so the camera, the height probe and the
 * arc-apex reservation cannot disagree about which days are on screen.
 */
export function drawnDaysOf(days: RouteStop[][], focusDay: number | null): RouteStop[][] {
  return focusDay !== null && days[focusDay]?.length ? [days[focusDay]] : days;
}

/**
 * Where the itinerary panel's left edge is, in CSS pixels, or the full width when it isn't there.
 *
 * Measured off the panel's own box rather than assumed from its width classes, so Focus Mode's
 * wider 62% split and any future width are handled without this knowing about either. Below `sm`
 * the panel is full-bleed and there is no strip to aim into, so the whole viewport is the answer.
 */
export function panelLeftEdgePx(panelVisible: boolean, viewWidthPx: number): number {
  if (!panelVisible || typeof window === "undefined" || window.innerWidth < 640) return viewWidthPx;
  const panel = document.querySelector(".docked-panel");
  // A *collapsed* panel is a capsule in the corner, not a wall — biasing away from it would shove
  // the subject left of an otherwise empty screen. `DockedPanel` marks that state itself.
  if (!panel || panel.classList.contains("docked-panel-collapsed")) return viewWidthPx;
  return panel.getBoundingClientRect().left;
}

/**
 * The width of the map a traveler can actually see, in CSS pixels — the strip from the left edge
 * to the itinerary panel, or the whole viewport when nothing covers it.
 *
 * Measured rather than passed, because the callers that need it (a stop flight, a hover peek)
 * have no idea whether a panel is open. `frameRoute` takes `panelVisible` explicitly instead,
 * since there the caller genuinely knows and the answer has to survive the panel animating.
 */
export function visibleMapWidthPx(viewWidthPx: number): number {
  return panelLeftEdgePx(true, viewWidthPx);
}

/** The landing-page pose. True altitude, unlike `flyToPoint`'s `rangeM`. */
export const HERO_VIEW = {
  lng: 8,
  lat: 22,
  heightM: 2_500_000,
  headingDeg: 5,
  pitchDeg: -45,
} as const;

/**
 * How much ground to keep around a single stop when the camera goes to it, in metres.
 *
 * Roughly a fifteen-minute walk in every direction — enough that the streets, the river or the park
 * next door are in frame and the stop reads as somewhere rather than as a pin on a texture.
 */
export const STOP_CONTEXT_RADIUS_M = 800;

/**
 * The same idea for a **searched** place, and deliberately wider than a stop's 800m.
 *
 * The two answer different questions. A stop is already in the plan, so framing it asks "where is
 * this thing I am about to visit" — its own street, near enough to read. A search result is a
 * *candidate*, and the question is "is this near anything else I am doing" — which cannot be
 * answered by a frame that holds nothing but the candidate. 1500m is roughly a twenty-minute walk,
 * which is the radius over which "near" is a real claim about a day plan, and it is usually enough
 * to bring a neighbouring stop into the same frame where one exists.
 *
 * Paired with `SEARCH_MIN_RANGE_M` rather than `STOP_MIN_RANGE_M` for the same reason: `fitBounds`
 * would otherwise honour the box and then be overruled by a floor set for a tighter question.
 */
/** How far from the camera centre a footprint corner is allowed to land. Past this the ray was
 *  effectively at the horizon, and what it hit is not "visible ground" in any useful sense. */
export const MAX_FOOTPRINT_M = 150_000;

export const SEARCH_CONTEXT_RADIUS_M = 1500;

/** The floor under a search result's framing. Above `STOP_MIN_RANGE_M` because the box it pairs
 *  with is larger; a floor below the box's own solved range is a floor that never binds. */
export const SEARCH_MIN_RANGE_M = 5000;

/**
 * The closest the camera goes to a single stop, in metres. Equivalent to MapLibre zoom ~14.5 at
 * mid latitudes, which is the scale where a neighbourhood is legible and a building is not yet a
 * roof filling the screen.
 *
 * A floor rather than a fixed distance, so the hover peek keeps the *relative* lean `peekRangeM`
 * computes from how crowded a stop's neighbours are — it just cannot lean past this.
 */
export const STOP_MIN_RANGE_M = 3500;

/** Framing floor for a day's stops, in metres — a lone stop gives a zero-radius sphere, and a
 *  tight cluster gives one small enough that the camera dives into the building mesh. */
export const MIN_ROUTE_RADIUS_M = 400;

/**
 * Camera pitch when a route is framed, in degrees.
 *
 * Was -60, which is 30 degrees off straight down, and at that angle a day's arcs project back
 * onto the ground line they span. -45 is the compromise, and the same pose the landing-page hero
 * uses: enough plan to see where the day goes, enough elevation to see the arches as arches.
 */
export const ROUTE_FRAME_PITCH_DEG = -45;

/** Fixed float height for highway lines, in metres. */
export const HIGHWAY_HEIGHT_M = 25;
/** Same reasoning: a fixed height above the ellipsoid, routinely below the real tile surface. */
export const CITY_BOUNDARY_HEIGHT_M = 40;

// Warm gold rather than the UI's amber accent or the route's Apple blue — highways are ambient
// city context, not the thing the app is asking you to look at.
export const HIGHWAY_COLOR = "#F5C242";
export const HIGHWAY_CASING = "#8A5A00";

/** Mirrors --on-deep / --surface-deep. Label builders want plain colour strings, so these can't
 *  be `var()` — update both here if those tokens move. */
export const LABEL_COLOR = "#f7f5f2";
export const LABEL_OUTLINE = "#12110f";

// Cesium's PinBuilder only draws its own squat rounded-square marker, so the classic teardrop
// comes from an inline SVG instead. `encodeURIComponent` rather than `btoa` — this module is
// imported during SSR, where `btoa` doesn't exist. Red is deliberate and follows Apple's own
// convention: red marks the place you searched for, blue marks the route through it.
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 .8C6 .8 1.2 5.6 1.2 11.6c0 8 10.8 19.6 10.8 19.6s10.8-11.6 10.8-19.6C22.8 5.6 18 .8 12 .8z" fill="#FF3B30" stroke="#C1271F" stroke-width="1.2" stroke-linejoin="round"/><circle cx="12" cy="11.6" r="4.2" fill="#fff"/></svg>`;
export const PIN_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PIN_SVG)}`;
