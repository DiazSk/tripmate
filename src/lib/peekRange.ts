/**
 * How close the hover peek should get to a stop.
 *
 * The peek used to be one relative number — fly to half the distance between the camera and the
 * stop being pointed at ("twice as close"), floored at a fixed range. That is the right *shape*
 * of rule, because how much zoom reads as a lot depends on where you started, but it is blind to
 * the thing that actually decides whether the peek told you anything: how crowded that stop's own
 * corner of the day is.
 *
 * A day framed at 8km halves to 4km, and if the stop being pointed at sits in a pocket of five
 * places 150m apart, 4km shows the same undifferentiated blob the day view already showed. The
 * pointer is on one row, the globe answers with five. Meanwhile a day whose stops are kilometres
 * apart is served perfectly well by the plain halving — there, going closer would throw the
 * neighbouring stops out of frame and lose the context that makes the peek legible.
 *
 * So the range is chosen from the *local* geometry, per stop, not per day. Measured against the
 * trips in this repo's database, that distinction is the whole point: one 6.9km day holds a stop
 * with a neighbour 80m away and another whose closest neighbour is 935m off. One number cannot
 * serve both, and "how spread out is this day" cannot tell them apart.
 *
 * **How it is chosen: concentric circles, not a formula scaled off the camera.** Picture rings
 * drawn around the stop being pointed at. The innermost ring that catches another stop of that day
 * names the range, and that range is an absolute altitude-like number, independent of where the
 * camera happens to be standing.
 *
 * That independence is the fix for the version before this one, which multiplied the neighbour
 * distance but then capped how much closer than the pre-peek pose a peek could go. Measured across
 * every stop of every saved trip, that cap — not the pocket — decided 33 of 57 stops: a pair 52m
 * apart on a day whose framing happened to include a far-off shrine was held at 5099m, while the
 * same pair on a tightly-framed day got 300m. Whether a crowded pocket became legible depended on
 * something the traveller can't see (how wide *the day* was framed), which is exactly the "it works
 * sometimes" that the rule is supposed to eliminate. A ring is a ring wherever the camera is.
 *
 * Bands rather than a continuous curve, deliberately: every stop inside one pocket resolves to the
 * same range, so sweeping down four rows of the same pocket pans between them at a steady altitude
 * instead of re-scaling the view on every row.
 */

const EARTH_RADIUS_M = 6_371_000;

/**
 * Neighbours closer than this are treated as the same place and ignored.
 *
 * Itineraries really do carry co-located stops — "lunch at the temple café" sits on the temple's
 * own coordinates, and the model sometimes emits two stops at identical lat/lng. Their distance is
 * 0m, and left in it would drag the local scale to zero and ask for a range no zoom can justify:
 * two stops at one point cannot be separated by looking harder.
 */
const COINCIDENT_M = 25;

/**
 * The rings, innermost first: how far away the nearest other stop is, and the range that answers.
 *
 * A neighbour d away wants a range of about 2.5·d: at range R the camera sees roughly 1.15·R of
 * ground across the frame (Cesium's default 60° field of view), so 2.5·d puts that neighbour about
 * 28% of the frame from the stop being pointed at. Two stems that far apart are unmistakably two,
 * which is the whole question a peek into a crowded pocket is being asked.
 *
 * The rings double, and each one's range is 2.5x the *geometric centre* of the ring rather than its
 * outer edge. Anchoring on the edge is what a first attempt did, and it got the middle of the table
 * wrong in the one direction that matters: a stop whose nearest neighbour was 128m away sat at the
 * inner edge of a 100-200m ring and was framed as if that neighbour were 200m off. Anchoring at the
 * centre means a stop near a ring's inner edge is framed slightly *tighter* than its own neighbour
 * strictly needs and one near the outer edge slightly wider, never off by more than ~1.4x either
 * way — while stops in one pocket still share a value.
 *
 * Every nearest-neighbour distance in this repo's saved trips lands in one of these: 52, 75, 76,
 * 80, 81, 100 · 111, 128, 134, 138, 141, 151, 172, 178 · 263, 296, 317, 377, 388 · 413, 433, 464,
 * 632, 705 · 935, 1200 · 4682, 6359, 6621 · and 12077, which is past the last ring.
 */
const RINGS: { withinM: number; rangeM: number }[] = [
  { withinM: 100, rangeM: 250 }, // next door — a café inside the market it is named after. The
  // ring's own centre asks for less than this; the mesh clearance below is the real limit here.
  { withinM: 200, rangeM: 350 }, // the same street corner
  { withinM: 400, rangeM: 700 }, // a few blocks apart
  { withinM: 800, rangeM: 1400 }, // a walk across one neighbourhood
  { withinM: 1600, rangeM: 2800 }, // the same district
  { withinM: 3200, rangeM: 5600 }, // opposite ends of a small city
  { withinM: 6400, rangeM: 11_000 }, // a day that crosses a region
];

/** The plain relative lean, kept as the widest a peek may ever be: half the distance the camera
 *  already stands at. A ring can only tighten this, never loosen it — a peek that pulled *back*
 *  to fit a sprawling neighbourhood in would be a different gesture altogether. It is also what
 *  answers a stop with no neighbour inside the outermost ring, where there is nothing local to
 *  frame and the honest answer is the city. */
export const PEEK_ZOOM_FACTOR = 2;

/**
 * Minimum height the camera must keep above the point it is framing, in metres — the only floor.
 *
 * A flat floor in *range* used to sit alongside this one, and there is nothing left for it to do:
 * the innermost ring is 300m, so a second limit below that could never bind. What can bind is this
 * one, because a range is a distance along the view direction rather than an altitude.
 *
 * The flat floor was 800m before any of this work, chosen partly so a peek stayed wider than the
 * click's 600m and selecting a hovered stop still visibly went somewhere. That ordering is given
 * up — a pocket of places 50m apart has to get inside 600m to say anything at all — and the click
 * still reads as a move, because it re-tilts to -35° and re-centres, which the peek never does.
 *
 * A range is a distance along the view direction, not an altitude, so the same 400m is a 346m-high
 * camera at -60° and a 137m-high one at -20°. The peek deliberately keeps whatever pitch the
 * camera was already at, which the traveller can have dragged as low as they like — so the floor
 * has to be expressed as a height and converted back, or a shallow angle over a dense downtown
 * flies the camera through a tower.
 *
 * Read against the *stop's card*, which floats `STEM_HEIGHT_M` (150m) above the ground, so this is
 * ~350m of real clearance. Only binds below about -50°; at the -60° the day framing uses, the flat
 * floor is the tighter of the two.
 */
export const PEEK_MIN_HEIGHT_M = 200;

/** The flight time a plain 2x lean has always taken. Short on purpose: a camera in motion renders
 *  every frame, so the render window is the cost. */
const PEEK_FLIGHT_BASE_S = 0.8;
/** Added per doubling of zoom beyond the first, so a deep dive is travelled rather than cut to. */
const PEEK_FLIGHT_PER_DOUBLING_S = 0.125;
/** Past this a hover is holding the camera hostage — the pointer will have moved on. */
const PEEK_FLIGHT_MAX_S = 1.8;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle metres between two coordinates. Straight-line and haversine agree to well under a
 *  metre at these distances; this is about framing a few hundred metres of city, not navigation. */
export function metresBetween(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance to the nearest neighbour worth telling this stop apart from, in metres.
 *
 * The nearest one, not an average of the nearest few. An average was tried first and it failed the
 * case that motivates the whole rule: Nishiki Market and the sushi counter 76m from it sit in a
 * day whose other stops are kilometres away, so the mean of the three nearest is thousands of
 * metres and the pair — the one place on the day where two stems overlap into one blob — got no
 * extra zoom at all. The nearest neighbour is the stop that blends with this one, so it is the
 * stop that decides how close is close enough.
 *
 * That makes the statistic sensitive to a single coordinate, which is deliberate but is also why
 * `peekRangeM` keeps a floor and a cap: a next-door pair asks for a range no camera should use,
 * and the guards are what turn that into "as close as is sane" instead.
 *
 * `null` means the question has no answer — the stop is alone in its day, or every other stop
 * shares its coordinates. Both fall back to the plain relative lean rather than inventing a
 * scale, because there is nothing on screen for a closer look to separate.
 */
export function nearestSeparableM(neighbourDistancesM: number[]): number | null {
  const separable = neighbourDistancesM.filter((d) => d > COINCIDENT_M);
  return separable.length === 0 ? null : Math.min(...separable);
}

/**
 * The range named by the innermost ring that catches another stop, or `null` when none of them do.
 *
 * `null` covers both "nothing near enough to be confused with this stop" and "no neighbour at all",
 * which want the same answer: there is no pocket to frame, so the caller falls back to the plain
 * relative lean.
 */
export function ringRangeM(neighbourDistancesM: number[]): number | null {
  const nearest = nearestSeparableM(neighbourDistancesM);
  if (nearest === null) return null;
  return RINGS.find((ring) => nearest <= ring.withinM)?.rangeM ?? null;
}

/**
 * The range to hand `flyToBoundingSphere` for a hover peek.
 *
 * `cameraDistanceM` is the distance from the pre-peek camera position to the point being framed,
 * `neighbourDistancesM` the distances from the hovered stop to every other stop in its day, and
 * `pitchRad` the pitch the peek is going to hold (negative, looking down).
 *
 * Never wider than the plain lean, never closer than the floors, and never *behind* where the
 * camera already is: a stop the camera is practically on top of should produce no flight rather
 * than a backwards one.
 */
export function peekRangeM(
  cameraDistanceM: number,
  neighbourDistancesM: number[],
  pitchRad = -Math.PI / 4
): number {
  const lean = cameraDistanceM / PEEK_ZOOM_FACTOR;
  const ringRange = ringRangeM(neighbourDistancesM);
  const wanted = ringRange === null ? lean : Math.min(lean, ringRange);
  // Guarded against a horizontal camera, where the height floor would divide by ~0 and demand a
  // range measured in kilometres. Nothing looking level at the horizon needs mesh clearance.
  const descent = Math.max(Math.sin(Math.abs(pitchRad)), 0.25);
  return Math.min(cameraDistanceM, Math.max(wanted, PEEK_MIN_HEIGHT_M / descent));
}

/**
 * How long the flight in (or back out) should take, in seconds.
 *
 * Dropping the zoom cap is what makes this necessary. A pocket 50m across inside a day framed at
 * 12km is now a 40x dive, and 40x in the 0.8s a 2x lean takes is a jump cut — the frames in between
 * carry no information because nothing is on screen long enough to see. Time therefore grows with
 * the *ratio*, an eighth of a second per doubling, so a deep dive reads as travelling rather than
 * cutting. The plain 2x lean is one doubling and keeps exactly the 0.8s it always had.
 *
 * Capped, because past a couple of seconds a hover is holding the camera hostage: the pointer has
 * moved on long before the flight it started has landed.
 */
export function peekFlightSeconds(fromRangeM: number, toRangeM: number): number {
  const doublings = Math.abs(Math.log2(Math.max(fromRangeM, 1) / Math.max(toRangeM, 1)));
  const seconds = PEEK_FLIGHT_BASE_S + Math.max(0, doublings - 1) * PEEK_FLIGHT_PER_DOUBLING_S;
  return Math.min(seconds, PEEK_FLIGHT_MAX_S);
}

/** Mercator constants, duplicated from the renderer rather than imported: this module is pure and
 *  reachable from a `.test.mjs`, and `maplibreRenderer` pulls in `maplibre-gl`, which needs a DOM. */
const EQUATOR_M = 40_075_016.686;
const WORLD_TILE_PX = 512;

/**
 * How far *down* the ground point has to sit so a thing floating `heightM` above it lands on the
 * centre of the frame — MapLibre's answer to Cesium's `centreHeightM`.
 *
 * MapLibre genuinely cannot aim at a point in the air: `flyTo` takes a `center` on the ground. But
 * it does take a pixel `offset` for where that centre should land, and the screen displacement of
 * a vertical column is computable. At pitch 0 (straight down) a column projects to a point and the
 * offset is zero; at the horizon it is the column's full height in pixels. In between it is
 * `h·sin(pitch)`, converted through the scale at the destination zoom.
 *
 * Orthographic, so it ignores the perspective foreshortening across the frame. That is accurate at
 * the centre, which is the only place this is measured, and the residual at the edges is far below
 * the size of the card being centred.
 *
 * **Uncapped, deliberately, and that is the whole point of the function.** This was clamped to a
 * third of the viewport for a while, on the reasoning that an extreme pitch with a tall anchor
 * would otherwise drive the ground point clean off the bottom of the screen. What the clamp
 * actually bought was the failure it was meant to prevent: truncating the lift does not move the
 * stop back into frame, it moves the *card* out of centre and up towards the top edge, so a close
 * peek showed a name stranded at the top of the screen with its stop still down at the bottom —
 * both halves badly placed instead of one. Measured on a 900px viewport at a 250m peek, where a
 * 150m stem projects to ~664px: the clamp put the card at y=92 and the stop at y=750.
 *
 * Cesium has no equivalent clamp — it aims at the real 3D point and lands the card's bottom edge
 * on centre at every range — and the satellite view is the one that reads correctly. This is the
 * flat-map arithmetic for the same aim, so it matches rather than second-guesses it. Where the
 * column is genuinely taller than the frame the stop does leave the bottom, exactly as it does on
 * Cesium; the name is what a hover is asking to be shown, and the stem still runs down out of
 * frame to say where it points.
 */
export function centreHeightOffsetPx(
  heightM: number,
  zoom: number,
  lat: number,
  maplibrePitchDeg: number
): [number, number] | undefined {
  if (!(heightM > 0)) return undefined;
  const metresPerPixel =
    (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (WORLD_TILE_PX * 2 ** zoom);
  const px = (heightM * Math.sin((maplibrePitchDeg * Math.PI) / 180)) / metresPerPixel;
  if (!(px > 0.5)) return undefined;
  return [0, px];
}
