import type { Cartesian3, Entity, Viewer } from "cesium";

/** Cesium is always reached through `await import("cesium")` — a static import pulls the whole
 *  library into the server bundle — so every function here takes the module as a parameter
 *  rather than importing it. */
type CesiumModule = typeof import("cesium");

/** `name` rides along for the HTML marker cards; the stop's index is its array position, so
 *  there is no id field and no change to `Stop` in types.ts.
 *
 *  `day` is the stop's index in `Itinerary.days[]`, added when the globe started drawing the
 *  whole trip at once rather than one day at a time. It is what lets a flat marker list be
 *  tinted, dimmed and labelled per day without StopMarkerLayer having to know the day
 *  boundaries — `Stop` in types.ts still carries no day identity, exactly as before. */
export interface RouteStop {
  lat: number;
  lng: number;
  name: string;
  day: number;
  /** The stop's approximate start time, verbatim from `Stop.time` ("9:00 AM"). Carried purely so
   *  the globe can tint itself toward dusk or night for the stop being looked at — see
   *  `dayPhase`. Optional for the same reason `Stop.why` is: itineraries saved before this
   *  existed have no time on some stops, and a stop with no time simply gets daylight. */
  time?: string;
}

/** How lit the world should be for a given stop. `day` is the tiles' own daylight photography,
 *  untouched — the other three are tints laid over it. */
export type DayPhase = "dawn" | "day" | "dusk" | "night";

/**
 * Which phase of the day a stop's start time falls in.
 *
 * Fixed clock bands, not real sunrise/sunset. Open-Meteo does return both, but they are fetched
 * on the reconcile path and never persisted into `Itinerary` — reaching them would mean a new
 * round trip per trip view to move a boundary by an hour, on a tint whose whole job is to say
 * "this stop is in the evening". The boundaries: `dawn` from 05:30, `day` from 07:30, `dusk` from
 * 17:00 — early enough that a 5pm viewpoint stop gets golden hour, which is when you would want
 * to be at one — and `night` from 19:30, by which point it reads as night almost everywhere
 * anyone plans a trip to.
 *
 * Accepts both the "9:00 AM" the model is asked for and a bare 24-hour "19:30", because a hand
 * edit through the chat loop can produce either. Anything unparseable — or absent, on an older
 * saved trip — is `day`, which is the no-op: no overlay, tiles as photographed.
 */
export function dayPhase(time: string | undefined): DayPhase {
  const match = /(\d{1,2}):(\d{2})\s*([ap])\.?m?\.?/i.exec(time ?? "") ?? /(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!match) return "day";
  let hour = Number(match[1]);
  const minutes = Number(match[2]);
  if (hour > 23 || minutes > 59) return "day";
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return "day";
    // 12 AM is hour 0 and 12 PM is hour 12 — the one case where the modulo matters.
    hour = (hour % 12) + (meridiem === "p" ? 12 : 0);
  }
  const clock = hour + minutes / 60;
  if (clock < 5.5) return "night";
  if (clock < 7.5) return "dawn";
  if (clock < 17) return "day";
  if (clock < 19.5) return "dusk";
  return "night";
}

const colorCache = new Map<string, string>();

/**
 * Read a colour token off `:root`, so the globe's palette lives in globals.css beside the rest
 * of the design system instead of as string literals in here.
 *
 * Cached because `getComputedStyle` forces a style recalculation and this runs on every route
 * rebuild. Must be called from the client-only geometry path and never at module scope — this
 * module is reached during SSR, where there is no `document` (the same constraint that makes the
 * pin SVG in mapCamera use `encodeURIComponent` rather than `btoa`).
 *
 * Throws rather than falling back to a literal: a fallback would be a second copy of the value,
 * which is the exact thing moving these into CSS was meant to eliminate. A missing token means a
 * broken stylesheet, and this is the one place that can say which token.
 */
export function cssColor(name: string): string {
  let value = colorCache.get(name);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!value) throw new Error(`mapRoute: missing colour token ${name} — see globals.css :root`);
    colorCache.set(name, value);
  }
  return value;
}

/**
 * The per-day colour ramp, as CSS custom property names resolved through `cssColor`.
 *
 * Six rather than one because the globe now draws every day of the trip at once; DESIGN.md's
 * "per-day accent colours were considered and rejected" rested entirely on the premise that
 * "only the active day is ever drawn", which stopped being true here.
 *
 * Day 1 is `--route-blue` — the colour the single-day route already used — so a one-day trip
 * looks exactly as it always did and nothing new is introduced to earn its keep.
 *
 * Cycles for trips longer than six days. That is safe for the thing the colour has to do,
 * which is separate a cluster from its *neighbours*: consecutive entries are 70-170 degrees
 * apart in hue, and day 1 only meets day 7, by which point the two clusters are labelled and
 * usually nowhere near each other. It is not safe as an identifier, which is why every cluster
 * carries a "Day N" label rather than relying on colour alone.
 *
 * The amber/red band (roughly 0-50 degrees) is deliberately absent. `--accent` means "you are
 * pointing at this" on the globe and `--map-pin-red` is the destination pin; a day tinted into
 * either would collide with a meaning that is already taken.
 */
export const DAY_COLOR_TOKENS = [
  "--route-blue",
  "--route-day-green",
  "--route-day-purple",
  "--route-day-rose",
  "--route-day-cyan",
  "--route-day-magenta",
] as const;

/** The token for a day, cycling. Exported because the marker layer tints its labels to match. */
export function dayColorToken(dayIndex: number): string {
  return DAY_COLOR_TOKENS[dayIndex % DAY_COLOR_TOKENS.length];
}

/**
 * Metres to lift a day's badge above the route it names, on top of the stem height every marker
 * already floats at.
 *
 * This used to be sized to clear the arcs, back when one peaked 180m above stem top. It no longer
 * can: an arc's apex is now a fraction of the hop's *ground* length (`ARC_LIFT_RATIO`), so a
 * cross-city hop peaks a kilometre up and chasing it would hang the badge in empty sky, detached
 * from the day it names. The badge stays near its route and the arcs pass over it, which is
 * survivable because the arcs are thin and faint now.
 *
 * It still has to clear the *stems*, which is what this height is actually doing: the badge is
 * anchored on the route itself (`buildDayClusters` takes the stop nearest the day's centre), so
 * without the lift it would sit on top of that stop's own pin and card.
 */
export const DAY_LABEL_LIFT_M = 260;

/** A day's label on the globe. `lat`/`lng` are the cluster's centre; `labelLat`/`labelLng` are
 *  where the badge actually hangs — see `buildDayClusters`. */
export interface RouteCluster {
  day: number;
  lat: number;
  lng: number;
  /** On the route itself — the stop nearest the day's centre. The marker layer lifts the badge
   *  `DAY_LABEL_LIFT_M` above it, so it reads as floating over the line rather than sitting on a
   *  pin. */
  labelLat: number;
  labelLng: number;
  /** The circumradius, in latitude-degrees. Exported for tests and for anything that needs to
   *  know how big a day's footprint is. */
  radiusDeg: number;
  /** "Day 3" — built here rather than in the marker layer so the globe and the panel cannot
   *  drift apart on how a day is named. */
  label: string;
  /** The token this day's geometry was drawn with, so the label can match it. */
  colorToken: string;
}

/**
 * One label per day, anchored on that day's own route.
 *
 * The centre is a plain mean, not the centre of a bounding box: a day with five stops in one
 * quarter and one across town should be centred on the five, because that is where the day
 * actually is — a bounding-box centre would sit in the empty middle, nearer to neither.
 *
 * **Longitude is scaled by cos(lat) throughout.** A degree of longitude is a degree of latitude
 * times that factor on the ground, so a circle computed in raw degrees is an ellipse in reality —
 * at Lisbon's 38.7° the error is 22%, and the label would sit visibly off its own ring to the
 * east or west. The maths runs in latitude-degree-equivalent space and converts back at the end.
 *
 * Days with no stops produce no cluster rather than a label at (0, 0) in the Gulf of Guinea.
 * `day` therefore stays the real index into `Itinerary.days[]` and is not the array position
 * here, which is what keeps the colour and the label agreeing with the geometry.
 *
 * No antimeridian handling, deliberately. Averaging longitudes breaks for a day spanning ±180°,
 * which needs a day's stops split across the Pacific — these are the walkable stops of a single
 * city, and the arc-drawing above makes the same assumption.
 */
export function buildDayClusters(days: RouteStop[][]): RouteCluster[] {
  const populated = days
    .map((stops, day) => ({ stops, day }))
    .filter(({ stops }) => stops.length > 0);
  if (populated.length === 0) return [];

  const centres = populated.map(({ stops, day }) => {
    const lat = stops.reduce((sum, s) => sum + s.lat, 0) / stops.length;
    const lng = stops.reduce((sum, s) => sum + s.lng, 0) / stops.length;
    return { day, stops, lat, lng };
  });

  // One scale factor for the whole trip rather than one per day: the days of a trip share a
  // city, and a per-day factor would put two neighbouring clusters in subtly different spaces.
  // Still needed with the badge on the route, because "nearest stop to the centre" is a distance
  // comparison and an unscaled one is wrong by 1/cos(lat) in longitude.
  const meanLat = centres.reduce((sum, c) => sum + c.lat, 0) / centres.length;
  const lonScale = Math.max(Math.cos((meanLat * Math.PI) / 180), 0.01);

  return centres.map(({ day, stops, lat, lng }) => {
    const cx = lng * lonScale;
    const cy = lat;
    // The circumradius: the smallest circle centred here that contains every stop. Not Welzl's
    // minimal enclosing circle — that would move the centre, and the centre is already the
    // answer to a different question the label placement depends on.
    const radiusDeg = stops.reduce((max, s) => {
      const dx = s.lng * lonScale - cx;
      const dy = s.lat - cy;
      return Math.max(max, Math.hypot(dx, dy));
    }, 0);

    // The badge sits *on* the route and is lifted above it, rather than offset to one side.
    //
    // Two sideways placements were tried and both read as detached: the circumradius flung a long
    // thin day's label a kilometre past its outermost stop, and a perpendicular offset put it
    // beside the line but still clearly next to rather than part of it. Height is the axis that
    // was free the whole time — the arcs already float at stem height, so lifting the badge above
    // them separates it from the pins without moving it away from the line at all. See
    // `DAY_LABEL_LIFT_M`, which is what the marker layer adds.
    //
    // Anchored to the stop nearest the day's centre, not the centre itself: a centroid sits off
    // the line whenever a day bends (an L-shaped afternoon puts it in the block the route goes
    // around), and the label has to be over the route, not over the middle of its bounding shape.
    const anchor = stops.reduce(
      (best, st) => {
        const dx = st.lng * lonScale - cx;
        const dy = st.lat - cy;
        const d = dx * dx + dy * dy;
        return d < best.d ? { st, d } : best;
      },
      { st: stops[0], d: Infinity }
    ).st;

    return {
      day,
      lat,
      lng,
      labelLat: anchor.lat,
      labelLng: anchor.lng,
      radiusDeg,
      label: `Day ${day + 1}`,
      colorToken: dayColorToken(day),
    };
  });
}

/** Camera distance as a multiple of the framed radius, and the floor under it. A tight cluster
 *  of stops otherwise puts the camera inside the building mesh. */
const RANGE_RADIUS_RATIO = 2.5;
const MIN_RANGE_M = 800;
/** Fallback when the frustum cannot be read (2D/orthographic mode): Cesium's default 60° fov. */
const DEFAULT_TAN_HALF_FOV_X = Math.tan(Math.PI / 6);
/**
 * Ceiling on how far the camera will pull back to clear the panel.
 *
 * Without it, a viewport where the panel leaves only a sliver free — a narrow desktop window at
 * the panel's 360px minimum — divides by that sliver and flings the camera into orbit to fit a
 * city block into 80 pixels. Better to let the route run slightly under the panel's edge than to
 * lose it entirely to altitude.
 */
const MAX_FIT_SCALE = 2.5;

/**
 * How much longer a route's long axis has to be than its short one before the heading below
 * bothers turning. A compact day has no meaningful axis, and a coin-flip between two arbitrary
 * headings is worse than always facing north — a day-tab click would spin the map for no reason.
 */
const MIN_ROUTE_AXIS_RATIO = 1.25;

/**
 * Which way to face a route, in compass degrees, so its stops spread *across* the frame.
 *
 * This was hardcoded to 0 — due north — and that is the single worst angle for the routes this
 * app actually draws. A day threads a corridor, and looking along a corridor stacks every stop in
 * it into one line on screen: Mumbai's trip runs almost due north-south, so eight days of arcs
 * piled into the same few hundred pixels and no amount of lifting them (`ARC_LIFT_RATIO`) or
 * pitching the camera over could separate them, because the separation was all in the axis the
 * camera was pointed down. Turned side-on, the same route lays itself out left to right.
 *
 * The long axis comes from the principal axis of the stops — the eigenvector of their 2x2
 * covariance — rather than the bounding box, which answers a different question: a diagonal route
 * has a near-square box and the box would report no axis at all. Longitude is scaled by cos(lat)
 * throughout for the same reason `buildDayClusters` does it, or the axis of a route at Reykjavik's
 * latitude would come out rotated toward east-west.
 *
 * Of the two perpendicular headings, the one nearer north wins. Both frame the route identically
 * — mirrored — so the tiebreak is free, and spending it on "stay as north-up as you can" means an
 * east-west route keeps facing north exactly as it always did, and only the corridor case turns.
 *
 * Returns 0 for anything with no axis worth naming: fewer than two stops, every stop on one
 * coordinate, or a cluster rounder than `MIN_ROUTE_AXIS_RATIO`.
 */
export function routeViewHeadingDeg(stops: RouteStop[]): number {
  if (stops.length < 2) return 0;
  const meanLat = stops.reduce((sum, s) => sum + s.lat, 0) / stops.length;
  const meanLng = stops.reduce((sum, s) => sum + s.lng, 0) / stops.length;
  const lonScale = Math.max(Math.cos((meanLat * Math.PI) / 180), 0.01);

  let east2 = 0;
  let north2 = 0;
  let eastNorth = 0;
  for (const stop of stops) {
    const east = (stop.lng - meanLng) * lonScale;
    const north = stop.lat - meanLat;
    east2 += east * east;
    north2 += north * north;
    eastNorth += east * north;
  }

  // Eigenvalues of [[east2, eastNorth], [eastNorth, north2]]. These are variances, so the ratio
  // of axis *lengths* is the square root of their ratio — hence squaring the threshold rather
  // than rooting the ratio, which keeps this free of a sqrt that only feeds a comparison.
  const mid = (east2 + north2) / 2;
  const spread = Math.hypot((east2 - north2) / 2, eastNorth);
  const major = mid + spread;
  const minor = mid - spread;
  if (!(major > 0)) return 0;
  if (minor > 0 && major / minor < MIN_ROUTE_AXIS_RATIO ** 2) return 0;

  // Angle of the major eigenvector, counter-clockwise from east. Compass bearing counts clockwise
  // from north instead, hence the 90 - x.
  const axisDeg = (Math.atan2(2 * eastNorth, east2 - north2) * 90) / Math.PI;
  const axisBearing = 90 - axisDeg;
  const candidates = [axisBearing + 90, axisBearing - 90].map((h) => ((h % 360) + 360) % 360);
  const fromNorth = (h: number) => Math.min(h, 360 - h);
  return fromNorth(candidates[0]) <= fromNorth(candidates[1]) ? candidates[0] : candidates[1];
}

export interface RouteFraming {
  /** Metres to shove the aim point east of the route's centre, so the route itself lands in the
   *  free strip rather than under the panel. Zero when there is no panel to clear. */
  biasM: number;
  /** Camera distance to that aim point, in metres. */
  rangeM: number;
}

/**
 * Where to point the camera so the route is centred in the space the panel leaves, rather than
 * in the viewport.
 *
 * The right-docked panel covers the right ~40% of the screen, so the visible map is the strip
 * from the left edge to the panel's left edge — and the route should sit in the middle of *that*,
 * not in the middle of a viewport whose right half the traveler cannot see. Aiming at the
 * viewport centre puts half the day under the panel and leaves a matching band of dead space on
 * the left.
 *
 * Two corrections, and they are independent:
 *
 * 1. **Pull back** by `viewWidth / freeWidth`, so a route that filled the viewport now fills only
 *    the free strip.
 * 2. **Shift the aim point east** by however many metres correspond to half the panel's width on
 *    screen. Moving the aim east moves the route west, into the strip.
 *
 * The pixels-to-metres conversion is the honest one — `2 · range · tan(½ fovₓ) / viewWidth` is the
 * width of the world at the aim point's depth — rather than the fraction-of-the-route-radius guess
 * this replaced, which had no relationship to where the panel's edge actually was and drifted with
 * every viewport and every trip. Horizontal only, so the camera's -60° pitch does not enter into
 * it: at heading 0 camera-right is local east, and pitch tilts the vertical axis, not this one.
 *
 * `range` is computed before `bias` because the conversion depends on it — the further back the
 * camera, the more metres a pixel is worth.
 */
export function frameRouteBesidePanel(
  radiusM: number,
  viewWidthPx: number,
  freeWidthPx: number,
  tanHalfFovX: number = DEFAULT_TAN_HALF_FOV_X
): RouteFraming {
  const centred = { biasM: 0, rangeM: Math.max(radiusM * RANGE_RADIUS_RATIO, MIN_RANGE_M) };
  // No panel, a panel that covers everything, or a nonsense measurement: centre it. A full-bleed
  // panel is the phone layout, where there is no strip to aim at and centred framing is correct.
  if (!(viewWidthPx > 0) || !(freeWidthPx > 0) || freeWidthPx >= viewWidthPx) return centred;

  const fitScale = Math.min(viewWidthPx / freeWidthPx, MAX_FIT_SCALE);
  const rangeM = Math.max(radiusM * RANGE_RADIUS_RATIO * fitScale, MIN_RANGE_M);
  const metresPerPx = (2 * rangeM * tanHalfFovX) / viewWidthPx;
  // The aim point moves from the viewport's centre to the free strip's centre; the distance
  // between those two is exactly half of what the panel covers.
  const shiftPx = viewWidthPx / 2 - freeWidthPx / 2;
  return { biasM: shiftPx * metresPerPx, rangeM };
}

/**
 * How present a day is on the globe. Every day is always drawn; this is the only thing that
 * separates the one being read from the rest.
 *
 * - `baseline` — nothing is selected, so every day is legible and none is louder. This is what
 *   "All Days" resets to.
 * - `active` — the selected day, at full strength and with a wider glow, so it reads as the
 *   subject rather than merely the brightest of six.
 * - `dimmed` — a day standing behind the selection. Low enough to stop competing, high enough to
 *   still show the trip's shape, which is the reason the other days are drawn at all.
 * - `hover` — a dimmed day the pointer is resting on. Brings it back most of the way *without*
 *   touching the selection, so a traveler can check what Thursday looks like without losing
 *   Tuesday.
 */
export type DayVisualState = "baseline" | "active" | "dimmed" | "hover";

const DAY_STATE_ALPHA: Record<DayVisualState, number> = {
  baseline: 0.75,
  active: 1,
  dimmed: 0.25,
  hover: 0.7,
};

/**
 * How present a day should be, given what is selected and what the pointer is on.
 *
 * Pure and exported so the rule lives in one place: it is read while building geometry, again
 * whenever selection or hover changes, and once more by the marker layer for the labels — three
 * callers that must not disagree about what "dimmed" means.
 *
 * With nothing selected every day is `baseline`; hover does nothing, because there is no
 * dimming to lift. Once a day is selected, hover only ever affects the days standing behind it.
 */
export function dayVisualState(
  day: number,
  focusedDay: number | null,
  hoveredDay: number | null
): DayVisualState {
  if (focusedDay === null) return "baseline";
  if (day === focusedDay) return "active";
  return day === hoveredDay ? "hover" : "dimmed";
}

/** The active day's arcs also thicken. Alpha alone reads as "brighter"; width reads as "nearer",
 *  which is the distinction that survives a busy satellite background. */
const ACTIVE_GLOW_WIDTH_SCALE = 1.55;
const ACTIVE_STEM_WIDTH_SCALE = 1.5;

/** Metres above the sampled surface to float the route. Small on purpose: enough to clear the
 *  road mesh without the line reading as detached when the camera drops to street level. */
const ROUTE_CLEARANCE_M = 2;
/** Opacity for route segments that fail the depth test, i.e. the parts running behind or through
 *  buildings. Dimmed rather than hidden so the whole day stays traceable at a low camera angle. */
const ROUTE_OCCLUDED_ALPHA = 0.3;

/**
 * How far above the route each stop's stem rises, in metres, and therefore where its HTML card
 * anchors. Exported because StopMarkerLayer has to resolve the same point in world space to put
 * the card on top of the stem — if these two ever disagree the card floats off its own stem.
 *
 * Fixed metres rather than a screen-space offset: the stem is a thing standing on the ground, so
 * it should grow and shrink with everything else as the camera moves. 150m clears Paris' ~35m
 * rooftops with room to spare, which is the point — the card has to sit above the skyline it is
 * labelling, not behind it.
 */
export const STEM_HEIGHT_M = 150;
const STEM_WIDTH = 4;
/** Low power keeps a bright thin core with a soft falloff; higher values wash the whole width out. */
const STEM_GLOW_POWER = 0.25;

/** Ground footprint under each stop. Two concentric discs at falling alpha — Cesium ellipses take
 *  a flat fill with no gradient, so a soft edge has to be faked by stacking. Drawn as circles, not
 *  oblong: at any pitch the app actually frames a route at, a ground circle already reads as an
 *  ellipse in perspective, and a real oblong would need an arbitrary rotation to point somewhere. */
const POOL_RADIUS_M = 42;
const POOL_OUTER_RATIO = 2.1;
const POOL_ALPHA = 0.22;
const POOL_OUTER_ALPHA = 0.09;

/** Points sampled along each arc. High on purpose: at `ARC_LIFT_RATIO` below, a cross-city hop is
 *  a kilometre-tall parabola, and 96 points across one of those is visibly faceted at street
 *  level — the curve is the whole point of the shape. 256 across a 30-day trip is ~11k vertices,
 *  which is nothing next to the photorealistic tileset sharing the frame. */
const ARC_SAMPLES = 256;
/**
 * Arc apex above its endpoints, as a fraction of the segment's ground length, so a cross-city hop
 * bows high and a next-door step stays shallow, clamped at both ends.
 *
 * **Height is the decluttering mechanism.** A day doubling back over its own ground — which is
 * most days — used to draw both hops at nearly the same altitude, so they crossed and merged into
 * one unreadable tangle. Lifted this far they separate vertically instead: the eye can follow one
 * arc over another because they are at different heights, not just different colours.
 *
 * This means arcs now launch well *above* the marker cards rather than staying inside the band
 * they occupy, which earlier revisions of this file deliberately avoided. That was the wrong call:
 * the apex leaving frame at street range reads as a route arcing away over the city, and the arc's
 * *ends* are what tie it to a card. Don't shrink this back to keep the apex under the labels.
 */
const ARC_LIFT_RATIO = 0.3;
const MIN_ARC_LIFT_M = 80;
/** Only bites on intercity legs. A 1000km hop lifts 30km rather than 300km — high enough to read
 *  as a flight path, low enough that the camera framing the two endpoints still contains it. */
const MAX_ARC_LIFT_M = 30_000;
/**
 * Segments shorter than this get no arc at all.
 *
 * Consecutive stops on one coordinate are normal rather than bad data — PREVIEW_TRIP's day 1
 * has the transfer, breakfast and shopping all at the same hotel — and a zero-length geodesic
 * has no unique path, so EllipsoidGeodesic would produce NaN positions and Cesium would draw
 * nothing while logging nothing. There is also no arc to see between a place and itself.
 */
const MIN_ARC_LENGTH_M = 5;

/**
 * How high one hop's arc peaks above its endpoints, in metres, from its ground distance.
 *
 * Pulled out of `buildRouteGeometry` purely so it can be tested — the geometry builder needs a
 * live Cesium viewer and can't be reached from a `.mjs` test, but this is the part with a rule in
 * it. Non-finite input (a NaN coordinate reaching `EllipsoidGeodesic`) returns the floor rather
 * than propagating NaN into a vertex, where Cesium draws nothing and logs nothing.
 */
export function arcLift(surfaceDistanceM: number): number {
  if (!Number.isFinite(surfaceDistanceM)) return MIN_ARC_LIFT_M;
  return Math.min(Math.max(surfaceDistanceM * ARC_LIFT_RATIO, MIN_ARC_LIFT_M), MAX_ARC_LIFT_M);
}

/**
 * The halo under each arc: wide, soft and *faint*.
 *
 * Every number here came down. A 9px halo at alpha 0.5 and glowPower 0.2 was legible over busy
 * photography and also the single loudest thing on screen — with a dozen days drawn at once the
 * halos bloomed into each other and the route read as a smear of light rather than a set of
 * lines. The halo's job is to keep a thin line from disappearing against a mid-grey rooftop, not
 * to be seen in its own right. Legibility over photography now comes mostly from the arcs being
 * lifted clear of the ground (`ARC_LIFT_RATIO`) rather than from brightness.
 */
const ARC_GLOW_WIDTH = 6;
const ARC_GLOW_POWER = 0.12;
const ARC_GLOW_ALPHA = 0.22;
/**
 * The arc's core line. Solid, not dashed.
 *
 * Dashes were the other half of the clutter: an 18px dash pattern along a kilometre-tall parabola
 * breaks one continuous shape into a stipple, and a screen holding six days of stipple has no
 * followable lines left in it. A thin solid stroke is what reads as "this connects to that".
 *
 * **3, not 2.** At 2 the arcs stippled themselves back into dashes wherever the scene renders
 * below native — `resolutionScale` is `1.5 / devicePixelRatio`, so a 2x display renders the
 * canvas at 0.75 and a 2px line lands on 1.5 buffer pixels, which an upscale with no FXAA breaks
 * into dots. Verified against the highway lines, which share the buffer at a similar alpha and
 * stay solid because they are wider. Don't shave this back down.
 */
const ARC_CORE_WIDTH = 3;
/** One full shimmer cycle. Slow on purpose — this is meant to read as a breath along the route,
 *  not a chase light. */
const SHIMMER_PERIOD_MS = 2600;
/** Fraction of a cycle each successive arc lags by, which is what makes the pulse appear to
 *  travel along the day rather than every arc breathing in unison. */
const SHIMMER_ARC_LAG = 0.16;
/** A narrow band, near the top. The old 0.5-0.9 swing was a pulse you watched instead of a route
 *  you read; this is the same motion at a tenth of the amplitude — present if you look for it,
 *  invisible if you are reading the map. */
const SHIMMER_ALPHA_MIN = 0.78;
const SHIMMER_ALPHA_RANGE = 0.14;
/** Held alpha when the visitor has asked for reduced motion — mid-range, so the line reads at the
 *  same weight it averages to when animating. */
const SHIMMER_ALPHA_STATIC = 0.85;

/**
 * One altitude for the whole day's route, just above street level.
 *
 * `clampToHeightMostDetailed` samples the *tile surface*, and stops sit on buildings — Paris
 * came back 81-139m against ~35m of actual street. Probing the midpoints between consecutive
 * stops as well, then taking the minimum, biases the answer toward the ground: the gaps between
 * venues are usually road or open space. It's an approximation, not a true street elevation, but
 * a flat ribbon a few metres off is invisible at any framing the app actually uses.
 */
export async function sampleRouteAltitude(
  viewer: Viewer,
  Cesium: CesiumModule,
  groundPositions: Cartesian3[]
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
      .filter((c): c is Cartesian3 => Cesium.defined(c))
      .map((c) => Cesium.Cartographic.fromCartesian(c).height)
      .filter((h) => Number.isFinite(h));
    if (heights.length === 0) return ROUTE_CLEARANCE_M;
    return Math.min(...heights) + ROUTE_CLEARANCE_M;
  } catch {
    // A sampling failure should cost the route its float, not its existence.
    return ROUTE_CLEARANCE_M;
  }
}

export interface RouteGeometry {
  /** Everything added to the entity collection, for the caller to remove wholesale. */
  entities: Entity[];
  /**
   * Tint one stop and the arcs touching it with the interface accent, or `null` to clear.
   *
   * This is the single deliberate exception to DESIGN.md's rule that interface colours stay off
   * the globe: amber here means "you are pointing at this", never "this is a Tuesday". Keep it
   * confined to interaction state.
   */
  setEmphasis: (index: number | null) => void;
  /**
   * Set how present this whole day is against the others — see `DayVisualState`.
   *
   * Distinct from `setEmphasis`, which marks one stop the pointer is on *within* a route; this
   * changes the standing of the route itself against the days beside it.
   */
  setDayState: (state: DayVisualState) => void;
  /**
   * Move every piece of this route to a new altitude.
   *
   * The reason this is a closure rather than the caller patching entities itself: the route is
   * drawn before its real altitude is known (see the comment at the `showTripRoute` call site),
   * so *every* piece of geometry has to be repositionable through one call. A new entity type
   * that forgets to handle itself here detaches from the rest at an oblique camera angle, and
   * that is the failure mode this whole module is shaped around.
   */
  reposition: (altitude: number) => void;
}

/**
 * The day's route as Cesium entities, floating at `altitude`.
 *
 * The line used to use `clampToGround`, which is not "drape on the ground" — it builds a
 * classification primitive that projects onto the Google 3D tile geometry, rooftops included, so
 * a straight hop across a block climbed every building in its path. Switching classificationType
 * can't help: CESIUM_3D_TILE is that same behaviour, and TERRAIN draws nothing at all here
 * because the classification shader reads back the globe depth texture and this app runs with
 * `globe.show = false`. So the line is unclamped and floats just above the surface instead.
 */
export function buildRouteGeometry(
  viewer: Viewer,
  Cesium: CesiumModule,
  stops: RouteStop[],
  altitude: number,
  colorToken: string = "--route-blue"
): RouteGeometry {
  const positionsAt = (h: number) =>
    stops.map((s) => Cesium.Cartesian3.fromDegrees(s.lng, s.lat, h));
  const positions = positionsAt(altitude);
  const ellipsoid = viewer.scene.globe.ellipsoid;
  // One route's colour, which since the globe started drawing every day at once is the day's
  // colour rather than a constant. Defaulted so a caller that has only one route to draw does
  // not have to know the ramp exists.
  const dayColor = Cesium.Color.fromCssColorString(cssColor(colorToken));

  // --- Arcs -------------------------------------------------------------------------------
  // One raised great-circle hop per consecutive pair, replacing the single flat cased line.
  // Precomputed once here and re-sampled by `reposition`, since the geodesic itself does not
  // depend on altitude — only the heights along it do.
  const scratchCarto = new Cesium.Cartographic();
  // `from`/`to` are kept so hover emphasis can find the arcs touching a given stop — segments
  // are not 1:1 with stop indices once degenerate hops are skipped.
  const segments: {
    geodesic: import("cesium").EllipsoidGeodesic;
    lift: number;
    from: number;
    to: number;
  }[] = [];
  for (let i = 1; i < stops.length; i++) {
    // Measured on the drawn positions rather than via the geodesic, because constructing a
    // geodesic is the thing being guarded against.
    if (Cesium.Cartesian3.distance(positions[i - 1], positions[i]) < MIN_ARC_LENGTH_M) continue;
    const geodesic = new Cesium.EllipsoidGeodesic(
      Cesium.Cartographic.fromDegrees(stops[i - 1].lng, stops[i - 1].lat),
      Cesium.Cartographic.fromDegrees(stops[i].lng, stops[i].lat),
      ellipsoid
    );
    segments.push({ geodesic, lift: arcLift(geodesic.surfaceDistance), from: i - 1, to: i });
  }

  const accent = Cesium.Color.fromCssColorString(cssColor("--accent"));
  /** Which stop is currently hovered or selected, or null. Read live by the core line shimmer's
   *  callback, and written by `setEmphasis` below. */
  let emphasised: number | null = null;
  /** This day's standing against the others. Read live by the shimmer callback the same way
   *  `emphasised` is, and written by `setDayState`. */
  let dayState: DayVisualState = "baseline";
  const stateAlpha = () => DAY_STATE_ALPHA[dayState];
  const isArcEmphasised = (index: number) =>
    emphasised !== null && (segments[index].from === emphasised || segments[index].to === emphasised);

  // Arcs span card to card, at stem-top height — not ground to ground. The stem already carries
  // the eye from the ground up to the card; an arc that also started on the ground drew a second,
  // competing line up the same 150m and left the card looking pinned on top of a shape rather
  // than being the thing the route runs between. Sine lift on top of that, so each hop leaves and
  // meets its card level instead of kinking at the endpoints.
  const arcPositionsAt = (index: number, h: number) => {
    const { geodesic, lift } = segments[index];
    const base = h + STEM_HEIGHT_M;
    const out: import("cesium").Cartesian3[] = new Array(ARC_SAMPLES);
    for (let k = 0; k < ARC_SAMPLES; k++) {
      const t = k / (ARC_SAMPLES - 1);
      const point = geodesic.interpolateUsingFraction(t, scratchCarto);
      out[k] = Cesium.Cartesian3.fromRadians(
        point.longitude,
        point.latitude,
        base + lift * Math.sin(t * Math.PI),
        ellipsoid
      );
    }
    return out;
  };

  const startedAt = performance.now();
  // The blanket reduced-motion rule in globals.css reaches CSS only. This shimmer is driven from
  // performance.now() into a WebGL material, so it would pulse straight through the preference
  // unless it is checked here.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const arcs = segments.map((_, index) => {
    const arcPositions = arcPositionsAt(index, altitude);

    // Soft, low-alpha halo. Just enough to keep the thin core line off a mid-grey rooftop — see
    // ARC_GLOW_ALPHA for why this is no longer carrying legibility on its own.
    const glow = viewer.entities.add({
      polyline: {
        positions: arcPositions,
        width: ARC_GLOW_WIDTH,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: ARC_GLOW_POWER,
          color: dayColor.withAlpha(ARC_GLOW_ALPHA),
        }),
      },
    });

    const core = viewer.entities.add({
      polyline: {
        positions: arcPositions,
        width: ARC_CORE_WIDTH,
        // NONE, not GEODESIC: these vertices already describe the curve, and asking Cesium to
        // re-trace a great circle between each adjacent pair would flatten the lift back out.
        arcType: Cesium.ArcType.NONE,
        // Solid. This was a PolylineDashMaterialProperty — see ARC_CORE_WIDTH for why it isn't.
        material: new Cesium.ColorMaterialProperty(
          // Always a callback, even under reduced motion, so hover emphasis has one place to
          // take effect. Second argument false = "not constant", so Cesium re-evaluates every
          // frame; `withAlpha` into the supplied result keeps that allocation-free at ~160fps.
          new Cesium.CallbackProperty((_time, result) => {
            const base = isArcEmphasised(index) ? accent : dayColor;
            if (reduceMotion) {
              return base.withAlpha(
                SHIMMER_ALPHA_STATIC * stateAlpha(),
                result as import("cesium").Color
              );
            }
            const phase =
              (performance.now() - startedAt) / SHIMMER_PERIOD_MS - index * SHIMMER_ARC_LAG;
            const wave = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
            return base.withAlpha(
              (SHIMMER_ALPHA_MIN + SHIMMER_ALPHA_RANGE * wave) * stateAlpha(),
              result as import("cesium").Color
            );
          }, false)
        ),
        // Stretches behind buildings draw dimmed rather than disappearing, so the whole day
        // stays traceable from a low angle. Only available unclamped. Matters much less now that
        // the arcs are lifted clear of the rooftops — it still catches the run down to each
        // card, which is the part that passes through the city.
        depthFailMaterial: new Cesium.ColorMaterialProperty(
          dayColor.withAlpha(ROUTE_OCCLUDED_ALPHA)
        ),
      },
    });

    return { glow, core };
  });

  const stemTopAt = (i: number, h: number) =>
    Cesium.Cartesian3.fromDegrees(stops[i].lng, stops[i].lat, h + STEM_HEIGHT_M);

  // A thin lit stem out of a pool of light on the ground, replacing the flat blue dot that used
  // to mark each stop. The dot had nowhere to put a name; this lifts the label clear of the
  // rooftops and gives the card something to stand on.
  //
  // arcType NONE is load-bearing: the default GEODESIC would try to trace a great circle between
  // two points that differ only in altitude, which is degenerate.
  const stems = stops.map((_, i) =>
    viewer.entities.add({
      polyline: {
        positions: [positions[i], stemTopAt(i, altitude)],
        width: STEM_WIDTH,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: STEM_GLOW_POWER,
          color: dayColor,
        }),
      },
    })
  );

  // Ellipse geometry takes its centre from `entity.position` but its altitude from `ellipse.height`
  // — the position's own height is ignored — so both have to be written here and in `reposition`.
  const pools = stops.map((_, i) =>
    (
      [
        [POOL_RADIUS_M, POOL_ALPHA],
        [POOL_RADIUS_M * POOL_OUTER_RATIO, POOL_OUTER_ALPHA],
      ] as const
    ).map(([radius, alpha]) =>
      viewer.entities.add({
        position: positions[i],
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          height: altitude,
          material: new Cesium.ColorMaterialProperty(dayColor.withAlpha(alpha)),
        },
      })
    )
  );

  // Recolouring closures rather than a loop over entities, so each piece keeps its own alpha —
  // emphasis must not flatten the pool's soft edge or the glow base's transparency into solid
  // amber. Colours are reassigned imperatively here rather than driven by CallbackProperties:
  // hover changes a few times a second, and making 16 ellipse materials non-constant would move
  // them into Cesium's dynamic batch and rebuild that geometry every frame.
  const tintPolyline =
    (entity: Entity, alpha: number) =>
    (base: import("cesium").Color) => {
      (entity.polyline!.material as import("cesium").PolylineGlowMaterialProperty).color =
        new Cesium.ConstantProperty(base.withAlpha(alpha * stateAlpha()));
    };
  const tintEllipse =
    (entity: Entity, alpha: number) =>
    (base: import("cesium").Color) => {
      (entity.ellipse!.material as import("cesium").ColorMaterialProperty).color =
        new Cesium.ConstantProperty(base.withAlpha(alpha * stateAlpha()));
    };

  /** Arc glow and stem widths follow the active flag. Written imperatively for the same reason
   *  the tints are: a `CallbackProperty` here would move these polylines into Cesium's dynamic
   *  batch and rebuild their geometry every frame, to animate a number that changes on a click. */
  const applyWidths = () => {
    const active = dayState === "active";
    const glowWidth = active ? ARC_GLOW_WIDTH * ACTIVE_GLOW_WIDTH_SCALE : ARC_GLOW_WIDTH;
    const stemWidth = active ? STEM_WIDTH * ACTIVE_STEM_WIDTH_SCALE : STEM_WIDTH;
    for (const arc of arcs) arc.glow.polyline!.width = new Cesium.ConstantProperty(glowWidth);
    for (const stem of stems) stem.polyline!.width = new Cesium.ConstantProperty(stemWidth);
  };

  const stemTints = stems.map((e) => tintPolyline(e, 1));
  const poolTints = pools.map((pair) => [
    tintEllipse(pair[0], POOL_ALPHA),
    tintEllipse(pair[1], POOL_OUTER_ALPHA),
  ]);
  const arcGlowTints = arcs.map((a) => tintPolyline(a.glow, ARC_GLOW_ALPHA));

  /** Repaint every imperatively-tinted piece from the current `emphasised` and `dayState`.
   *  Shared by `setEmphasis` and `setDayState`: both change the same colours, and two copies of
   *  this loop is how one of them ends up forgetting the pools. */
  const applyTints = () => {
    stops.forEach((_, i) => {
      const base = i === emphasised ? accent : dayColor;
      stemTints[i](base);
      poolTints[i].forEach((tint) => tint(base));
    });
    // The core line needs no write here — its callback reads `emphasised` directly, every frame.
    arcGlowTints.forEach((tint, k) => tint(isArcEmphasised(k) ? accent : dayColor));
  };

  return {
    entities: [...arcs.flatMap((a) => [a.glow, a.core]), ...stems, ...pools.flat()],
    setEmphasis: (index: number | null) => {
      if (index === emphasised) return;
      emphasised = index;
      applyTints();
    },
    setDayState: (next: DayVisualState) => {
      if (next === dayState) return;
      const wasActive = dayState === "active";
      dayState = next;
      applyTints();
      // Width is a separate write from colour, and only when the *active* flag actually
      // flips — reassigning a ConstantProperty is cheap but not free, and this runs on every
      // hover across a six-day trip.
      if (wasActive !== (next === "active")) applyWidths();
    },
    reposition: (h: number) => {
      const corrected = positionsAt(h);
      // Both polylines of an arc share one freshly sampled array — they trace the same curve at
      // different widths, so re-sampling twice would only cost time.
      arcs.forEach(({ glow, core }, index) => {
        const resampled = new Cesium.ConstantProperty(arcPositionsAt(index, h));
        glow.polyline!.positions = resampled;
        core.polyline!.positions = resampled;
      });
      stems.forEach((e, i) => {
        e.polyline!.positions = new Cesium.ConstantProperty([corrected[i], stemTopAt(i, h)]);
      });
      pools.forEach((pair, i) =>
        pair.forEach((e) => {
          e.position = new Cesium.ConstantPositionProperty(corrected[i]);
          e.ellipse!.height = new Cesium.ConstantProperty(h);
        })
      );
    },
  };
}
