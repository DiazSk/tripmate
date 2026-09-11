import type { Cartesian3, Entity, Viewer } from "cesium";
import { createGlassRibbonMaterial, registerGlassRibbonMaterial } from "./glassRibbon";

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
 * One day's colours: a primary core and the emissive glow that surrounds it, as CSS custom
 * property names resolved through `cssColor`.
 *
 * A pair rather than a single colour, and that is the point of this type existing. The core is
 * the *object* — the ribbon body, the ring cores, the beam core, the badge's border. The glow is
 * the *light coming off it* — the halo around the ribbon, the beam's bloom, the outermost radar
 * ring, the outer footprint disc. Making the glow a neighbouring hue rather than a dimmer copy
 * of the core is what makes a day read as lit rather than merely coloured in: real emission
 * shifts hue as it falls off, and a halo that is only a faded core reads as a blur.
 */
export interface DayPalette {
  core: string;
  glow: string;
}

/**
 * The palette pool, one entry per day, cycling.
 *
 * Five rather than one because the globe draws every day of the trip at once; DESIGN.md's
 * "per-day accent colours were considered and rejected" rested entirely on the premise that
 * "only the active day is ever drawn", which stopped being true here.
 *
 * A curated set rather than points on a hue wheel — five pairs picked for the character of the
 * pair, the way a system accent is picked. What each still has to survive is uncontrolled aerial
 * photography: an older ramp opened on Apple Maps' systemBlue and ran through a system green and
 * a rose, all of which the *background* can produce, so a mid-blue arc over water and a green one
 * over a park were the same colour as the thing behind them. Hence no earthy greens, no muted
 * yellows, no desert sand — and hence Electric Emerald being a green with more chroma than
 * chlorophyll can reach and an ambient that pulls toward cyan rather than yellow, which is the
 * direction foliage actually sits.
 *
 * **Ultra Iris is the quiet one, knowingly.** Its core is a twilight indigo at roughly a third
 * the chroma of the other four, and its ambient is *lighter* than its core rather than darker —
 * the only pair here that inverts that relationship. Over dark water or shadowed terrain it reads
 * considerably softer than days 1-4, and what keeps it legible there is the casing rather than
 * its own luminance. If a day 5 ever reads as missing rather than as recessive, raise this entry
 * rather than thickening the ribbon.
 *
 * Cycles for trips longer than five days. That is safe for the thing the colour has to do, which
 * is separate a cluster from its *neighbours*: day 1 only meets day 6, by which point the two
 * clusters are labelled and usually nowhere near each other. It is not safe as an identifier,
 * which is why every cluster carries a "Day N" label rather than relying on colour alone.
 *
 * **Solar Ember is a knowing exception to a standing rule.** The 0-50 degree amber/red band
 * belongs to `--accent` ("you are pointing at this") and `--map-pin-red` (the destination pin),
 * and every other entry stays out of it for that reason. This one is in it by explicit request.
 * The collision it creates is handled in `emphasisColorFor` below rather than left to chance —
 * read that before adding a second warm entry, because the mitigation has exactly one fallback
 * colour and this palette already spends it.
 */
export const DAY_PALETTES: readonly DayPalette[] = [
  { core: "--route-neon-cyan", glow: "--route-neon-cyan-glow" },
  { core: "--route-neon-magenta", glow: "--route-neon-magenta-glow" },
  { core: "--route-neon-amber", glow: "--route-neon-amber-glow" },
  { core: "--route-neon-lime", glow: "--route-neon-lime-glow" },
  { core: "--route-neon-violet", glow: "--route-neon-violet-glow" },
] as const;

/**
 * The palette for a day, cycling.
 *
 * Keyed on the day's index in `Itinerary.days[]` rather than on a hash of some day identifier,
 * and deliberately: the index *is* the day's identity here — `Stop` carries no day field, and
 * `RouteStop.day` is that index attached at the route boundary and nowhere else. A hash would
 * also be worse at the one job the colour has. Modulo guarantees that adjacent days never share
 * a palette until the pool wraps; a hash makes no such promise, so two consecutive days could
 * collide on the same colour by chance, which is precisely the case the palette exists to
 * prevent. Deterministic either way — this is deterministic *and* collision-free where it counts.
 */
export function dayPalette(dayIndex: number): DayPalette {
  return DAY_PALETTES[dayIndex % DAY_PALETTES.length];
}

/** The core token for a day. Exported because the marker layer and the split editor tint their
 *  own chrome to match a day without needing the rest of the palette. */
export function dayColorToken(dayIndex: number): string {
  return dayPalette(dayIndex).core;
}

/** The glow token for a day, for the surfaces that carry a day's bloom rather than its body. */
export function dayGlowToken(dayIndex: number): string {
  return dayPalette(dayIndex).glow;
}

/** Hues, in degrees, that `--accent` owns on the globe. `--accent` is around 32 and
 *  `--map-pin-red` around 4; the band is drawn wide enough to cover both plus the distance at
 *  which two saturated warm hues stop being told apart at a glance over photography. */
const ACCENT_HUE_BAND: readonly [number, number] = [0, 50];

/** A colour's hue in degrees, 0-360. Grey returns 0, which is harmless here: a desaturated
 *  colour cannot be confused with a saturated accent whatever its hue says. */
function hueDeg(color: import("cesium").Color): number {
  const { red: r, green: g, blue: b } = color;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/**
 * Which colour means "you are pointing at this" for a day drawn in `dayColor`.
 *
 * Normally `--accent`, and DESIGN.md's one sanctioned exception to keeping interface colour off
 * the globe: amber there means hover or selection, never "this is a Tuesday".
 *
 * That rule assumed no *day* would ever be amber, which the Electric Amber palette breaks. On
 * that day the emphasis tint would land within a few degrees of the colour the day is already
 * drawn in, so pointing at a stop would change nothing visible — the interaction would still
 * fire, the feedback would simply be gone. When the day's own core falls inside the accent's
 * band this returns white instead: the one colour guaranteed to read against a saturated hue
 * whatever that hue is, and the only one left that has no other meaning on the globe.
 *
 * Pure and exported so it can be tested without a viewer, and so the rule lives in one place —
 * emphasis is applied from three call sites (the ribbon body, the radar rings, and `applyTints`
 * for everything painted imperatively) and they must not disagree about what amber means.
 */
export function emphasisColorFor(
  dayColor: import("cesium").Color,
  accent: import("cesium").Color,
  white: import("cesium").Color
): import("cesium").Color {
  const hue = hueDeg(dayColor);
  const collides = hue >= ACCENT_HUE_BAND[0] && hue <= ACCENT_HUE_BAND[1];
  return collides ? white : accent;
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
  /** The core token this day's geometry was drawn with, so the label's border and text can
   *  match the ribbons it names. */
  colorToken: string;
  /** The same day's glow token, for the label's bloom — see `DayPalette`. Kept alongside rather
   *  than re-derived in the marker layer, so the badge and the geometry cannot pick different
   *  entries out of the pool. */
  glowToken: string;
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
      glowToken: dayGlowToken(day),
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
 * How many metres sideways to shove a *point* the camera is flying to, so it lands in the middle
 * of the strip the itinerary panel leaves rather than in the middle of the viewport.
 *
 * The same correction `frameRouteBesidePanel` applies to a whole route, split out for the case
 * where the range is already decided rather than derived from a radius — a stop flight, a hover
 * peek. Without it, hovering a row on the far side of the plan flies the camera to a point that
 * ends up *underneath* the panel: dead centre of the window is well inside the covered 40%.
 *
 * Positive means "move the aim point toward the panel", which moves the subject away from it.
 * Zero when there is no panel to clear, which is also the phone layout (full-bleed panel, no strip
 * to aim into) and any nonsense measurement.
 */
export function lateralPanelBiasM(
  rangeM: number,
  viewWidthPx: number,
  freeWidthPx: number,
  tanHalfFovX: number = DEFAULT_TAN_HALF_FOV_X
): number {
  if (!(rangeM > 0) || !(viewWidthPx > 0) || !(freeWidthPx > 0)) return 0;
  if (freeWidthPx >= viewWidthPx) return 0;
  const metresPerPx = (2 * rangeM * tanHalfFovX) / viewWidthPx;
  return (viewWidthPx / 2 - freeWidthPx / 2) * metresPerPx;
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

/** Exported so a renderer that paints with plain alpha rather than Cesium materials — the
 *  MapLibre one — reads the same table the ribbon shader does. */
export const DAY_STATE_ALPHA: Record<DayVisualState, number> = {
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
 *  which is the distinction that survives a busy satellite background.
 *
 *  The ribbon core scales less than its halo: the core carries a dark casing whose width is
 *  fixed in pixels, so growing the body too far would leave the border looking thin against it
 *  and the ribbon would lose the edge that separates it from the photography. */
const ACTIVE_GLOW_WIDTH_SCALE = 1.55;
const ACTIVE_CORE_WIDTH_SCALE = 1.22;
const ACTIVE_STEM_WIDTH_SCALE = 1.4;

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
/**
 * The vertical anchor under each card is a **light pillar**, built in three layers rather than as
 * one line: a translucent cylinder of world-space volume, a wide emissive halo, and a thin hard
 * core inside both.
 *
 * The cylinder is what makes it a beam instead of a stroke. A polyline's width is screen-space,
 * so a "beam" made only of polylines stays the same thickness whether the camera is at 300m or
 * 30km — it reads as a drawn line at every range, which is exactly what a shaft of light does
 * not do. The cylinder is metres, so it fattens as you descend into it and vanishes to nothing
 * from orbit, and the polylines inside it keep the pillar visible once it does.
 *
 * Wider at the bottom than the top, which is the opposite of a searchlight and deliberate: the
 * light reads as pooling into the ground ring underneath it rather than being projected up from
 * it, so the ring and the pillar are one object.
 */
const BEAM_BOTTOM_RADIUS_M = 9;
const BEAM_TOP_RADIUS_M = 3.5;
const BEAM_COLUMN_ALPHA = 0.16;
/** Slices the column is stacked from, to fake a vertical gradient a single Cesium material
 *  cannot express. Three is enough: the beam is 150m of translucent volume, the steps are hidden
 *  by the halo around it, and each slice is an entity multiplied by every stop in the trip. */
const BEAM_COLUMN_SLICES = 3;
/** Alpha at the top of the beam as a fraction of the bottom's, so the pillar dissolves upward
 *  into the card rather than ending on a hard disc. */
const BEAM_TOP_ALPHA_SCALE = 0.35;
const BEAM_HALO_WIDTH = 16;
const BEAM_HALO_POWER = 0.16;
const BEAM_HALO_ALPHA = 0.3;
const STEM_WIDTH = 7;
/** Total across both edges, like `ARC_CASING_WIDTH` — 3 here is a 4px body between 1.5px edges. */
const STEM_CASING_WIDTH = 3;

/**
 * Ground footprint under each stop: a stack of discs plus two glowing rings, replacing the flat
 * pair of filled discs that used to sit here.
 *
 * The discs are the heatmap — Cesium ellipses take a flat fill with no gradient, so a soft
 * falloff has to be faked by stacking translucent circles at falling alpha. On their own they
 * read as a stain rather than a marker, which is why the rings are the actual figure: a crisp,
 * emissive circle has an *edge*, and an edge is the thing photography cannot fake underneath it.
 *
 * Drawn as circles, not oblong: at any pitch the app actually frames a route at, a ground circle
 * already reads as an ellipse in perspective, and a real oblong would need an arbitrary rotation
 * to point somewhere.
 */
const POOL_RADIUS_M = 42;
const POOL_OUTER_RATIO = 2.1;
const POOL_ALPHA = 0.24;
const POOL_OUTER_ALPHA = 0.07;

/**
 * The rings. Polylines traced around the circle rather than `ellipse.outline`, and that is not a
 * stylistic choice: `outlineWidth` above 1 is silently ignored on Windows/ANGLE, so an ellipse
 * outline is a hairline on a large share of machines. A polyline's width is honoured everywhere,
 * and it can carry a glow material, which an ellipse outline cannot.
 *
 * 48 samples is smooth at street level for a 40-90m circle — the arc between two samples is
 * under 6m — and a stop carries two of them, so this is the number multiplied by every stop in
 * the trip.
 */
const RING_SAMPLES = 48;

/**
 * Three concentric rings per stop, brightening in sequence from the inside out, which is what
 * turns a static circle into a radar sweep: at any instant one ring is near its peak and the
 * others are falling, so the eye tracks a wave travelling outward.
 *
 * **The wave is alpha, not radius**, and that is a hard constraint rather than an approximation.
 * A real expanding ring means a `CallbackProperty` on `positions` (or on an ellipse's
 * `semiMajorAxis`), which moves that geometry into Cesium's dynamic batch and rebuilds it every
 * frame — for every ring of every stop of every day on screen. A material colour is a uniform,
 * so this costs nothing per frame. Three rings at fixed radii with staggered phase buys the
 * reading a moving radius would, at zero geometry cost.
 *
 * Radii, widths and alphas fall outward together: the innermost is the tight bright one sitting
 * on the stop itself, the outermost is a wide faint halo at the edge of the footprint.
 */
const RING_RADII_RATIO = [0.7, 1.35, 2.1] as const;
const RING_WIDTHS = [5, 3.5, 2.5] as const;
const RING_ALPHAS = [0.85, 0.5, 0.3] as const;
/** Soft-edged rather than a hard stroke: the ring is meant to read as light on the ground. */
const RING_GLOW_POWER = 0.3;

/** The radar sweep. One full cycle, the lag each ring adds behind the one inside it (a third of
 *  a cycle, so the three are evenly spread around it), and a further lag per stop so a day looks
 *  like it is being counted out rather than blinking at once. Held flat under
 *  `prefers-reduced-motion`, like the arc shimmer and the travelling dash. */
const PULSE_PERIOD_MS = 2400;
const PULSE_RING_LAG = 0.33;
const PULSE_STOP_LAG = 0.13;
const PULSE_ALPHA_MIN = 0.42;
const PULSE_ALPHA_RANGE = 0.58;
const PULSE_ALPHA_STATIC = 0.8;

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
 * The emissive halo around each arc: wide, soft, and now genuinely visible.
 *
 * The halo's numbers came *down* once, to 6px at alpha 0.22, because a thin bright line plus a
 * bright halo bloomed into a smear once a dozen days were drawn at once. That reasoning applied
 * to a 3px line whose only defence against the photography was brightness. The ribbon below no
 * longer relies on brightness — it has a dark casing, so its edge survives whatever is behind it
 * — and the halo's job changed with it: it is the emissive bleed that says the ribbon is lit
 * rather than painted, and it lifts the shape off the tiles at a distance where the casing is
 * sub-pixel.
 *
 * Wide and *low-powered* is what keeps that from becoming the old smear. `glowPower` is the
 * falloff exponent, not the brightness: at 0.1 across 20px almost all of the width is nearly
 * transparent, so two neighbouring days bleed into each other far less than the old 6px halo at
 * 0.12 did, despite covering three times the pixels.
 */
const ARC_GLOW_WIDTH = 20;
const ARC_GLOW_POWER = 0.1;
const ARC_GLOW_ALPHA = 0.3;
/**
 * The arc's body: a thick neon ribbon with a hard dark stroke down both edges, drawn as one
 * `PolylineOutlineMaterialProperty` rather than a bright line stacked on a wider dark one.
 *
 * One material, not two entities, and it matters: two stacked polylines are two draws whose
 * depth ordering against each other is not guaranteed on a scene that also holds translucent 3D
 * tiles, and the casing flickered through the core wherever they tied. The outline material
 * resolves the edge inside a single fragment shader, so it cannot come apart.
 *
 * **The casing is the whole point.** The background here is Google Photorealistic 3D Tiles —
 * uncontrolled aerial photography that can put any colour, at any luminance, behind any pixel of
 * the route. A stroke of colour alone has no guaranteed contrast against that; a stroke of
 * colour with a near-black border does, because the border supplies its own local contrast
 * wherever it lands. This is the same reason the labels carry an omnidirectional halo.
 *
 * **`outlineWidth` is the total across both edges, not the width of one.** Cesium's
 * PolylineOutlineMaterial shades `halfInteriorWidth = 0.5 * (width - outlineWidth) / width`, so
 * 16/5 is an 11px neon body between two 2.5px dark edges — not two 5px ones. Halve any number
 * you mean per-edge before putting it here, and note that only `width` scales with the active
 * state (`ACTIVE_CORE_WIDTH_SCALE`), so the casing takes a larger share as the ribbon narrows.
 *
 * **The ribbon tapers**, from `ARC_WIDTH_START` at the stop being left to `ARC_WIDTH_END` at the
 * stop being arrived at, so the shape itself says which way the day runs before any animation
 * does. Cesium has no per-vertex width — a polyline has exactly one — so the taper is built by
 * cutting the arc into `ARC_TAPER_SEGMENTS` consecutive polylines, each a constant width sampled
 * at its own midpoint. Segments share their boundary vertex, so there is no seam to see through;
 * what there is instead is a step of `(start - end) / segments` px at each join, which is why
 * that ratio is kept under about 1.5px. The casing stays a fixed pixel count, so the neon body
 * narrows faster than the ribbon does — 11px of colour at the start against 4px at the end,
 * which is a much stronger taper than the outline widths alone suggest.
 *
 * The cost is the reason not to raise the segment count casually: this multiplies the core
 * entity count per arc by `ARC_TAPER_SEGMENTS`. They are all static (constant positions, constant
 * widths) so they batch, but a 6-day trip is now several hundred entities on the globe.
 *
 * Static dashes are still out — an 18px dash pattern along a kilometre-tall parabola breaks one
 * continuous shape into a stipple, and a screen holding six days of stipple has no followable
 * lines left in it. The travelling pulse below is a separate, thin layer *over* an unbroken
 * ribbon, which is a different thing: the line stays continuous and the light moves along it.
 */
const ARC_WIDTH_START = 16;
const ARC_WIDTH_END = 9;
const ARC_TAPER_SEGMENTS = 6;
const ARC_CASING_WIDTH = 5;

/**
 * The travelling pulse: light running along each arc in the direction of travel, so the route
 * shows the *order* of the day and not merely its shape.
 *
 * Built as a `PolylineDashMaterialProperty` with a transparent `gapColor` and an **animated
 * `dashPattern`**, which is the whole trick here. `dashPattern` is a 16-bit mask the shader
 * tests per fragment (`maskTest = floor(dashPattern / pow(2, maskIndex))`), so rotating the mask
 * by one bit per step slides the lit band one sixteenth of a dash along the line. Rotating
 * *left* moves it toward increasing vertex index, which is stop N to stop N+1 — chronological.
 * It is a uniform, so the geometry never rebuilds; an animation done by re-sampling positions
 * instead would put every arc in the dynamic batch.
 *
 * Two consequences of that shader worth knowing before touching this. The dash is measured in
 * **screen space** (`gl_FragCoord.xy` rotated by the polyline angle), not along the curve's
 * arclength, so dash spacing is constant in pixels at any zoom and the pulse neither stretches
 * nor bunches as the camera moves. And the pattern's period is the dash length, so the pulse
 * repeats along the arc rather than being one comet head — which is the correct reading for a
 * *route*, where every part of the leg is being travelled, not a vehicle position.
 *
 * `0b0000000000000111` is three lit bits in sixteen: a short bright streak with a long dark gap,
 * so the ribbon underneath stays the thing you read and the pulse is a highlight moving over it.
 */
const PULSE_DASH_PATTERN = 0b0000000000000111;
const PULSE_DASH_LENGTH_PX = 56;
const PULSE_DASH_WIDTH = 5;
const PULSE_DASH_ALPHA = 0.95;
/** How long the mask takes to travel one full dash, i.e. 16 single-bit rotations. */
const PULSE_TRAVEL_PERIOD_MS = 1100;
/** Metres above the ribbon the pulse rides. Coincident polylines z-fight; a metre of separation
 *  is invisible on an arc hundreds of metres up and puts the pulse cleanly in front. */
const PULSE_LIFT_M = 1;
/** How opaque the dark casing runs. Not 1: a fully opaque border on a translucent body reads as
 *  two separate objects, a black line with a coloured filling. Just under, and it reads as one
 *  extruded thing with a shaded edge. */
const CASING_ALPHA = 0.88;

/**
 * How hard the ribbon's specular highlight burns — see `glassRibbon.ts` for the shader that
 * draws it and for what "along the top curve" can and cannot mean on a polyline.
 *
 * Low, and it has to stay low. The highlight is added to a body that is *already* a saturated
 * neon at high lightness, so anything approaching 1 blows the streak to white and the ribbon
 * stops carrying its day's colour where the eye lands hardest — which is the one place it most
 * needs to. At 0.34 the streak reads as a sheen on the surface rather than as a second white
 * line drawn down the middle of a coloured one.
 */
const RIBBON_SPECULAR_INTENSITY = 0.34;
/** The colour of the reflection itself. Not pure white: a cool near-white is what a sky reflects,
 *  and it keeps the highlight from reading as a blown-out gap in the ribbon. */
const RIBBON_SPECULAR_TINT = "#dff2ff";
/** The highlight fades with the day's standing, like everything else on the route — a receded
 *  day with a full-strength sheen would be the brightest thing about it. */
const SPECULAR_DIM_FLOOR = 0.35;
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
  palette: DayPalette = DAY_PALETTES[0],
  /** Draw the arcs between stops. False in Story mode — see `connectors` on `RouteDrawRequest`.
   *  Defaulted so every existing caller is unchanged. */
  connectors = true
): RouteGeometry {
  const positionsAt = (h: number) =>
    stops.map((s) => Cesium.Cartesian3.fromDegrees(s.lng, s.lat, h));
  const positions = positionsAt(altitude);
  const ellipsoid = viewer.scene.globe.ellipsoid;
  // This route's pair. `dayColor` is the object — ribbon body, ring cores, beam core — and
  // `glowColor` is the light coming off it: the arc halo, the beam bloom, the outermost radar
  // ring, the outer footprint disc. See `DayPalette`. Defaulted so a caller with only one route
  // to draw does not have to know the pool exists.
  const dayColor = Cesium.Color.fromCssColorString(cssColor(palette.core));
  const glowColor = Cesium.Color.fromCssColorString(cssColor(palette.glow));
  // Idempotent, and it has to run before the first ribbon is added: `Material.fromType` resolves
  // the fabric out of a global cache at the moment a material is first built.
  registerGlassRibbonMaterial(Cesium);
  const specularTint = Cesium.Color.fromCssColorString(RIBBON_SPECULAR_TINT);

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
  // Leaving `segments` empty is the whole of "no connectors", and that is why the flag is applied
  // here rather than at the four places arcs are added to the scene: `arcs`, `arcGlowTints`, the
  // pulses and `applyTints`'s arc loop are all derived from this array, so they all become empty
  // together and cannot drift out of step with each other.
  for (let i = 1; connectors && i < stops.length; i++) {
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

  /** What "you are pointing at this" is drawn in *on this day*. Amber almost always; white on a
   *  day whose own colour is already amber, or the hover would be invisible — see
   *  `emphasisColorFor`. Resolved once here rather than per callback, so the ribbon, the rings
   *  and `applyTints` cannot disagree about it. */
  const accent = emphasisColorFor(
    dayColor,
    Cesium.Color.fromCssColorString(cssColor("--accent")),
    Cesium.Color.WHITE
  );
  /** The dark stroke down both edges of every ribbon — arcs and stems alike. Read from the same
   *  stylesheet the day colours are, so the route's whole palette stays in globals.css. */
  const casing = Cesium.Color.fromCssColorString(cssColor("--route-casing"));
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

  /** The dark casing's colour at the current day state, as a live property.
   *
   *  It has to follow `stateAlpha` rather than being a constant, and that is the one non-obvious
   *  thing about drawing an outlined ribbon here: a dimmed day fades its *body* to 0.25, and a
   *  casing left at full opacity would leave the receded days reading as black lines with a
   *  ghost of colour inside them — louder dimmed than they were lit. Both edges of the ribbon
   *  fade together or the ribbon comes apart. */
  const casingProperty = () =>
    new Cesium.CallbackProperty(
      (_time, result) =>
        casing.withAlpha(CASING_ALPHA * stateAlpha(), result as import("cesium").Color),
      false
    );

  /**
   * One taper segment's slice of the sampled arc, and the width to draw it at.
   *
   * Each slice ends on the vertex the next one starts on (`end` is inclusive), so consecutive
   * polylines meet exactly rather than leaving a hairline gap that shows as a dotted arc at
   * street level. The width is sampled at the slice's midpoint, so the first and last segments
   * sit slightly inside `ARC_WIDTH_START`/`_END` rather than hitting them exactly — which is
   * what keeps the two end steps the same size as the interior ones.
   */
  const taperSlices = Array.from({ length: ARC_TAPER_SEGMENTS }, (_, k) => {
    const start = Math.round((k * (ARC_SAMPLES - 1)) / ARC_TAPER_SEGMENTS);
    const end = Math.round(((k + 1) * (ARC_SAMPLES - 1)) / ARC_TAPER_SEGMENTS);
    const mid = (k + 0.5) / ARC_TAPER_SEGMENTS;
    return { start, end, width: ARC_WIDTH_START + (ARC_WIDTH_END - ARC_WIDTH_START) * mid };
  });

  const arcs = segments.map((_, index) => {
    const arcPositions = arcPositionsAt(index, altitude);

    /** The ribbon's live colour, shared by every taper segment of this arc.
     *
     *  One property object handed to all of them rather than one each: they are the same ribbon
     *  and must shimmer in lockstep, and six `CallbackProperty` instances evaluating the same
     *  clock is six times the work to arrive at the same colour. */
    const bodyColor = new Cesium.CallbackProperty((_time, result) => {
      const base = isArcEmphasised(index) ? accent : dayColor;
      if (reduceMotion) {
        return base.withAlpha(
          SHIMMER_ALPHA_STATIC * stateAlpha(),
          result as import("cesium").Color
        );
      }
      const phase = (performance.now() - startedAt) / SHIMMER_PERIOD_MS - index * SHIMMER_ARC_LAG;
      const wave = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
      return base.withAlpha(
        (SHIMMER_ALPHA_MIN + SHIMMER_ALPHA_RANGE * wave) * stateAlpha(),
        result as import("cesium").Color
      );
    }, false);
    const bodyCasing = casingProperty();

    // The emissive bleed. Wide and very low-powered, so it reads as light coming off the ribbon
    // rather than as a second, fuzzier line beside it — see ARC_GLOW_POWER. Not tapered: a halo
    // is a soft field with no edge to read a width off, so segmenting it would spend six
    // entities on a difference nobody can see.
    const glow = viewer.entities.add({
      polyline: {
        positions: arcPositions,
        width: ARC_GLOW_WIDTH,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: ARC_GLOW_POWER,
          // The palette's *glow*, not a faded core — the halo is the light coming off the
          // ribbon, and shifting hue as it falls off is what emission actually does.
          color: glowColor.withAlpha(ARC_GLOW_ALPHA),
        }),
      },
    });

    // The ribbon proper, in `ARC_TAPER_SEGMENTS` pieces of falling width — see ARC_WIDTH_START.
    const cores = taperSlices.map((slice) =>
      viewer.entities.add({
        polyline: {
          positions: arcPositions.slice(slice.start, slice.end + 1),
          width: slice.width,
          // NONE, not GEODESIC: these vertices already describe the curve, and asking Cesium to
          // re-trace a great circle between each adjacent pair would flatten the lift back out.
          arcType: Cesium.ArcType.NONE,
          // Neon body, dark stroke down both edges, a specular sheen along the shoulder — one
          // material, drawn by the custom shader in `glassRibbon.ts`. This was a
          // `PolylineOutlineMaterialProperty`, before that a `ColorMaterialProperty`, and before
          // that a `PolylineDashMaterialProperty`; see ARC_WIDTH_START for the first two. The
          // casing half of the shader is a verbatim copy of the stock outline material, so the
          // edge behaves exactly as it did and `ARC_CASING_WIDTH` keeps its meaning.
          material: createGlassRibbonMaterial(Cesium, {
            color: bodyColor,
            outlineColor: bodyCasing,
            outlineWidth: ARC_CASING_WIDTH,
            // Also a callback: the sheen recedes with the day, or a dimmed route would keep the
            // brightest pixel on screen. Scaled on **rgb**, not alpha — the shader adds
            // `specularColor.rgb` to the body and never reads its alpha, so fading this the way
            // every other material here fades would have done nothing at all. Floored rather
            // than taken to zero, so a stepped-back ribbon still reads as the same material as
            // the active one rather than as a flat stripe.
            specularColor: new Cesium.CallbackProperty((_time, result) => {
              const dim = SPECULAR_DIM_FLOOR + (1 - SPECULAR_DIM_FLOOR) * stateAlpha();
              return Cesium.Color.multiplyByScalar(
                specularTint,
                dim,
                result as import("cesium").Color
              );
            }, false),
            specularIntensity: RIBBON_SPECULAR_INTENSITY,
          }) as unknown as import("cesium").MaterialProperty,
          // Stretches behind buildings draw dimmed rather than disappearing, so the whole day
          // stays traceable from a low angle. Only available unclamped. Matters much less now
          // that the arcs are lifted clear of the rooftops — it still catches the run down to
          // each card, which is the part that passes through the city. Flat colour rather than
          // the outlined material: this is the see-through state, and a casing on it would draw
          // a dark edge *through* the building in front, which is the opposite of receding.
          depthFailMaterial: new Cesium.ColorMaterialProperty(
            dayColor.withAlpha(ROUTE_OCCLUDED_ALPHA)
          ),
        },
      })
    );

    // The travelling pulse, riding a metre above the ribbon it highlights. See
    // PULSE_DASH_PATTERN for how the motion is done and why it costs no geometry.
    const pulse = viewer.entities.add({
      polyline: {
        positions: arcPositionsAt(index, altitude + PULSE_LIFT_M),
        width: PULSE_DASH_WIDTH,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({
          color: new Cesium.CallbackProperty(
            (_time, result) =>
              // Near-white rather than the day's colour: this is the *light* moving along the
              // ribbon, and tinting it the same neon underneath makes it disappear into it. It
              // still takes `stateAlpha`, so a dimmed day's pulse recedes with the day.
              Cesium.Color.WHITE.withAlpha(
                PULSE_DASH_ALPHA * stateAlpha(),
                result as import("cesium").Color
              ),
            false
          ),
          // Transparent gaps, not a second colour: the ribbon underneath is the gap.
          gapColor: Cesium.Color.TRANSPARENT,
          dashLength: PULSE_DASH_LENGTH_PX,
          dashPattern: new Cesium.CallbackProperty(() => {
            if (reduceMotion) return PULSE_DASH_PATTERN;
            // One bit of rotation per 1/16th of a travel period, left-rotated within 16 bits so
            // the streak advances toward increasing vertex index. `>>> 0` keeps the intermediate
            // out of the sign bit; the shader wants a plain positive number.
            const steps = Math.floor(
              (((performance.now() - startedAt) / PULSE_TRAVEL_PERIOD_MS) % 1) * 16
            );
            return (
              (((PULSE_DASH_PATTERN << steps) | (PULSE_DASH_PATTERN >>> (16 - steps))) &
                0xffff) >>>
              0
            );
          }, false),
        }),
      },
    });

    return { glow, cores, pulse };
  });

  const stemTopAt = (i: number, h: number) =>
    Cesium.Cartesian3.fromDegrees(stops[i].lng, stops[i].lat, h + STEM_HEIGHT_M);

  // A light pillar standing in the ground rings, replacing the flat blue dot that used to mark
  // each stop and, before that, the thin drop line that replaced it. It carries the eye from the
  // ground up to the card, and from there the arcs leave at exactly the height it ends — see
  // BEAM_BOTTOM_RADIUS_M for why one line was not enough to read as a beam.
  //
  // arcType NONE is load-bearing on both polylines: the default GEODESIC would try to trace a
  // great circle between two points that differ only in altitude, which is degenerate.
  /**
   * The beam's slices, computed once for the whole route since every stop's pillar is identical
   * in shape. `centreM` is the slice's own centre above the ground, because a cylinder is
   * anchored at its middle; `mix` walks core to glow up the beam and `alphaScale` fades it out.
   */
  const beamSlices = Array.from({ length: BEAM_COLUMN_SLICES }, (_, k) => {
    const lengthM = STEM_HEIGHT_M / BEAM_COLUMN_SLICES;
    const t0 = k / BEAM_COLUMN_SLICES;
    const t1 = (k + 1) / BEAM_COLUMN_SLICES;
    const mid = (t0 + t1) / 2;
    const radiusAt = (t: number) =>
      BEAM_BOTTOM_RADIUS_M + (BEAM_TOP_RADIUS_M - BEAM_BOTTOM_RADIUS_M) * t;
    return {
      lengthM,
      centreM: mid * STEM_HEIGHT_M,
      bottomRadiusM: radiusAt(t0),
      topRadiusM: radiusAt(t1),
      mix: mid,
      alphaScale: 1 + (BEAM_TOP_ALPHA_SCALE - 1) * mid,
    };
  });

  const beams = stops.map((_, i) => {
    const foot = positions[i];
    const head = stemTopAt(i, altitude);

    // The volume, as a vertical gradient: `BEAM_COLUMN_SLICES` stacked cylinders running from
    // the core colour at the ground to the glow colour at the top, thinning and fading as they
    // rise. A Cesium material is a single uniform with no gradient of its own, so a graded beam
    // has to be built out of slices — the same reason the ground discs are stacked rather than
    // drawn with a radial falloff.
    //
    // A cylinder takes its position at its own *centre*, not its base, and its altitude comes
    // from that position rather than from any height property — so every slice's centre point
    // has to be rebuilt in `reposition`.
    const columns = beamSlices.map((slice) =>
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(stops[i].lng, stops[i].lat, altitude + slice.centreM),
        cylinder: {
          length: slice.lengthM,
          topRadius: slice.topRadiusM,
          bottomRadius: slice.bottomRadiusM,
          material: new Cesium.ColorMaterialProperty(
            Cesium.Color.lerp(
              dayColor,
              glowColor,
              slice.mix,
              new Cesium.Color()
            ).withAlpha(BEAM_COLUMN_ALPHA * slice.alphaScale)
          ),
        },
      })
    );

    const halo = viewer.entities.add({
      polyline: {
        positions: [foot, head],
        width: BEAM_HALO_WIDTH,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: BEAM_HALO_POWER,
          color: glowColor.withAlpha(BEAM_HALO_ALPHA),
        }),
      },
    });

    const core = viewer.entities.add({
      polyline: {
        positions: [foot, head],
        width: STEM_WIDTH,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineOutlineMaterialProperty({
          color: dayColor,
          outlineColor: casingProperty(),
          outlineWidth: STEM_CASING_WIDTH,
        }),
      },
    });

    return { columns, halo, core };
  });

  // Ellipse geometry takes its centre from `entity.position` but its altitude from `ellipse.height`
  // — the position's own height is ignored — so both have to be written here and in `reposition`.
  //
  // The discs are the soft half of the footprint: a small bright one inside a wide faint one,
  // which is as close to a radial falloff as a flat ellipse fill gets. The radar rings below are
  // the half that actually reads.
  const pools = stops.map((_, i) =>
    (
      [
        [POOL_RADIUS_M, POOL_ALPHA, dayColor],
        [POOL_RADIUS_M * POOL_OUTER_RATIO, POOL_OUTER_ALPHA, glowColor],
      ] as const
    ).map(([radius, alpha, tint]) =>
      viewer.entities.add({
        position: positions[i],
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          height: altitude,
          // Core inside, glow outside: the footprint falls off in hue as well as alpha, the same
          // way the ribbon's halo does.
          material: new Cesium.ColorMaterialProperty(tint.withAlpha(alpha)),
        },
      })
    )
  );

  /**
   * A circle of positions on the ground around a stop.
   *
   * Flat-earth offsets rather than a geodesic walk: these circles are 40-90m across, where the
   * error from treating a degree of latitude as a constant 111.32km is centimetres, and a stop
   * near a pole is not a case this app has — every stop is a place someone visits. The cosine
   * term keeps the circle round rather than an ellipse squashed east-west at high latitude,
   * which at 60°N would otherwise be a 2:1 oval.
   */
  const ringPositionsAt = (i: number, radius: number, h: number) => {
    const dLat = radius / 111_320;
    const dLng = dLat / Math.max(Math.cos((stops[i].lat * Math.PI) / 180), 0.01);
    const out: import("cesium").Cartesian3[] = new Array(RING_SAMPLES + 1);
    for (let k = 0; k <= RING_SAMPLES; k++) {
      const a = (k / RING_SAMPLES) * Math.PI * 2;
      out[k] = Cesium.Cartesian3.fromDegrees(
        stops[i].lng + dLng * Math.cos(a),
        stops[i].lat + dLat * Math.sin(a),
        h,
        ellipsoid
      );
    }
    return out;
  };

  /**
   * Three concentric radar rings per stop, brightening from the inside out — see RING_RADII_RATIO
   * for the sweep and why it is alpha rather than a moving radius.
   *
   * Rings are the figure and the discs are the ground: a translucent disc alone reads as a stain
   * on the photograph, while a circle has an *edge*, which is the thing satellite imagery cannot
   * fake underneath it.
   */
  const rings = stops.map((_, i) =>
    RING_RADII_RATIO.map((ratio, r) =>
      viewer.entities.add({
        polyline: {
          positions: ringPositionsAt(i, POOL_RADIUS_M * ratio, altitude),
          width: RING_WIDTHS[r],
          // The ring's own vertices already trace the circle; GEODESIC would re-trace between
          // each adjacent pair, which is the same trap the arcs document.
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: RING_GLOW_POWER,
            // Every ring pulses, each a third of a cycle behind the one inside it, which is what
            // makes the brightness read as a wave travelling outward rather than three circles
            // blinking together. The callback also reads `emphasised`, so the amber
            // "you are pointing at this" tint reaches the rings without a second write path.
            color: new Cesium.CallbackProperty((_time, result) => {
              // Inner two rings in the core, the outermost in the glow — the footprint reads as
              // one light source falling off outward rather than three circles of one colour.
              const base =
                i === emphasised ? accent : r === RING_RADII_RATIO.length - 1 ? glowColor : dayColor;
              if (reduceMotion) {
                return base.withAlpha(
                  RING_ALPHAS[r] * PULSE_ALPHA_STATIC * stateAlpha(),
                  result as import("cesium").Color
                );
              }
              const phase =
                (performance.now() - startedAt) / PULSE_PERIOD_MS -
                i * PULSE_STOP_LAG -
                r * PULSE_RING_LAG;
              const wave = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
              return base.withAlpha(
                RING_ALPHAS[r] * (PULSE_ALPHA_MIN + PULSE_ALPHA_RANGE * wave) * stateAlpha(),
                result as import("cesium").Color
              );
            }, false),
          }),
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
      // `PolylineGlowMaterialProperty` and `PolylineOutlineMaterialProperty` both expose `color`
      // and nothing else here touches the casing, which follows `stateAlpha` through its own
      // callback — so one closure still covers a glow halo, a ring and an outlined stem.
      (entity.polyline!.material as import("cesium").PolylineGlowMaterialProperty).color =
        new Cesium.ConstantProperty(base.withAlpha(alpha * stateAlpha()));
    };
  const tintEllipse =
    (entity: Entity, alpha: number) =>
    (base: import("cesium").Color) => {
      (entity.ellipse!.material as import("cesium").ColorMaterialProperty).color =
        new Cesium.ConstantProperty(base.withAlpha(alpha * stateAlpha()));
    };
  /** The beam's volume, which is a `cylinder` and so reaches its material by a third path. */
  const tintCylinder =
    (entity: Entity, alpha: number) =>
    (base: import("cesium").Color) => {
      (entity.cylinder!.material as import("cesium").ColorMaterialProperty).color =
        new Cesium.ConstantProperty(base.withAlpha(alpha * stateAlpha()));
    };

  /** Arc and beam widths follow the active flag. Written imperatively for the same reason
   *  the tints are: a `CallbackProperty` here would move these polylines into Cesium's dynamic
   *  batch and rebuild their geometry every frame, to animate a number that changes on a click.
   *
   *  Every taper segment scales by the same factor rather than to a common width — scaling to a
   *  single number would flatten the taper the moment a day was selected, which is precisely
   *  when the day is being read most closely. */
  const applyWidths = () => {
    const active = dayState === "active";
    const glowWidth = active ? ARC_GLOW_WIDTH * ACTIVE_GLOW_WIDTH_SCALE : ARC_GLOW_WIDTH;
    const coreScale = active ? ACTIVE_CORE_WIDTH_SCALE : 1;
    const stemWidth = active ? STEM_WIDTH * ACTIVE_STEM_WIDTH_SCALE : STEM_WIDTH;
    for (const arc of arcs) {
      arc.glow.polyline!.width = new Cesium.ConstantProperty(glowWidth);
      arc.cores.forEach((core, k) => {
        core.polyline!.width = new Cesium.ConstantProperty(taperSlices[k].width * coreScale);
      });
    }
    for (const beam of beams) beam.core.polyline!.width = new Cesium.ConstantProperty(stemWidth);
  };

  // Every piece of a beam takes the tint at its own alpha, and the column's slices keep their
  // own gradient step — emphasis must light the whole pillar without flattening the fade that
  // makes it read as a beam rather than a stick.
  const beamTints = beams.map((beam) => [
    tintPolyline(beam.core, 1),
    tintPolyline(beam.halo, BEAM_HALO_ALPHA),
    ...beam.columns.map((column, k) =>
      tintCylinder(column, BEAM_COLUMN_ALPHA * beamSlices[k].alphaScale)
    ),
  ]);
  const poolTints = pools.map((pair) => [
    tintEllipse(pair[0], POOL_ALPHA),
    tintEllipse(pair[1], POOL_OUTER_ALPHA),
  ]);
  const arcGlowTints = arcs.map((a) => tintPolyline(a.glow, ARC_GLOW_ALPHA));

  /** Repaint every imperatively-tinted piece from the current `emphasised` and `dayState`.
   *  Shared by `setEmphasis` and `setDayState`: both change the same colours, and two copies of
   *  this loop is how one of them ends up forgetting the pools.
   *
   *  Three things are deliberately absent and must stay absent: the ribbon's body, the travelling
   *  pulse and the radar rings. All three drive their colour from a per-frame `CallbackProperty`
   *  that reads `emphasised` and `stateAlpha` directly, so they are already correct — writing a
   *  `ConstantProperty` over them here would replace the callback and stop the animation dead on
   *  the first hover, which is the exact bug this note exists to prevent. */
  const applyTints = () => {
    stops.forEach((_, i) => {
      const base = i === emphasised ? accent : dayColor;
      beamTints[i].forEach((tint) => tint(base));
      poolTints[i].forEach((tint) => tint(base));
    });
    arcGlowTints.forEach((tint, k) => tint(isArcEmphasised(k) ? accent : dayColor));
  };

  return {
    entities: [
      ...arcs.flatMap((a) => [a.glow, ...a.cores, a.pulse]),
      ...beams.flatMap((b) => [...b.columns, b.halo, b.core]),
      ...pools.flat(),
      ...rings.flat(),
    ],
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
      // The halo and every taper segment share one freshly sampled array — they trace the same
      // curve at different widths, so re-sampling per entity would only cost time. The pulse is
      // the exception: it rides a metre higher and needs its own trace.
      arcs.forEach(({ glow, cores, pulse }, index) => {
        const sampled = arcPositionsAt(index, h);
        glow.polyline!.positions = new Cesium.ConstantProperty(sampled);
        cores.forEach((core, k) => {
          core.polyline!.positions = new Cesium.ConstantProperty(
            sampled.slice(taperSlices[k].start, taperSlices[k].end + 1)
          );
        });
        pulse.polyline!.positions = new Cesium.ConstantProperty(
          arcPositionsAt(index, h + PULSE_LIFT_M)
        );
      });
      // All three layers of a beam move together. The cylinder is the awkward one: its altitude
      // lives in its own centre position rather than in any height property, so it is re-anchored
      // half a beam above the new ground rather than on it.
      beams.forEach(({ columns, halo, core }, i) => {
        const span = new Cesium.ConstantProperty([corrected[i], stemTopAt(i, h)]);
        halo.polyline!.positions = span;
        core.polyline!.positions = span;
        columns.forEach((column, k) => {
          column.position = new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(stops[i].lng, stops[i].lat, h + beamSlices[k].centreM)
          );
        });
      });
      pools.forEach((pair, i) =>
        pair.forEach((e) => {
          e.position = new Cesium.ConstantPositionProperty(corrected[i]);
          e.ellipse!.height = new Cesium.ConstantProperty(h);
        })
      );
      // The rings are polylines, so their altitude lives in the vertices rather than in a
      // `height` property — they have to be re-traced, not just re-anchored. Forgetting this is
      // exactly the failure `reposition`'s doc comment is about: they would stay on the first,
      // pre-sample altitude and detach from the discs underneath them at an oblique angle.
      rings.forEach((ringSet, i) =>
        ringSet.forEach((e, r) => {
          e.polyline!.positions = new Cesium.ConstantProperty(
            ringPositionsAt(i, POOL_RADIUS_M * RING_RADII_RATIO[r], h)
          );
        })
      );
    },
  };
}
