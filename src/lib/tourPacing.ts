/**
 * How the stop tour moves: which way the camera faces on each leg, and how long the flight takes.
 *
 * Pure, and here rather than in `useStopTour` for the reason `peekRange.ts` exists: `npm test` can
 * only reach modules with no DOM in them, the renderers are browser-only and untested, and camera
 * arithmetic that nothing checks is how a tour silently starts flying backwards.
 *
 * **What this fixes.** The tour never passed a heading, so both renderers fell through to
 * `options.headingRad ?? 0` and every stop was framed due north — the same frame, four seconds
 * apart, which is what made it read as a slideshow rather than a journey. And its 6.5s metronome
 * spent 1.2s flying and ~5.3s holding still regardless of whether the next stop was 200m or 12km
 * away; that dead stillness *was* the slideshow.
 */
import { COINCIDENT_M, metresBetween, type LatLng } from "./peekRange";

/**
 * Forward azimuth from `a` to `b`, in radians clockwise from north — the compass convention
 * `FlyToPointOptions.headingRad` is in.
 *
 * The spherical formula rather than the flat `atan2(Δlng·cosφ, Δlat)` approximation, and the reason
 * is the one place the two disagree: `sin` and `cos` are 2π-periodic, so a Δλ of −359.98° and one of
 * +0.02° produce identical terms and the antimeridian costs nothing. The flat form needs an explicit
 * wrap into [−180, 180] or it reports due *south* for a twenty-metre hop across 180°. Same line
 * count either way, so take the one that is right on the edge case.
 */
export function bearingRad(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const φ1 = a.lat * rad;
  const φ2 = b.lat * rad;
  const Δλ = (b.lng - a.lng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (θ + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Which way to face while standing at `stops[i]` — the direction of travel, so the next place is
 * straight ahead as you arrive.
 *
 * **Deliberately not `routeViewHeadingDeg`.** That one returns the principal axis of the day's
 * cloud of stops ±90°, tie-broken toward north: it answers "which way should I stand to see this
 * day laid out", which is the right question for framing a whole day and the wrong one for
 * travelling through it. Reusing it here is also what once made the camera appear to spin on the
 * spot during streaming, because a route's long axis changes completely every time a stop lands on
 * it. A leg bearing is a different quantity and is stable by construction.
 *
 * `null` means the question has no answer, and the caller must then omit `headingRad` entirely
 * rather than pass 0 — 0 is due north, which is a claim, where omitting it is today's behaviour.
 */
export function legBearingRad(stops: readonly LatLng[], i: number): number | null {
  const here = stops[i];
  if (!here) return null;

  // Forward first: the next place you are actually going.
  for (let j = i + 1; j < stops.length; j++) {
    if (metresBetween(here, stops[j]) > COINCIDENT_M) return bearingRad(here, stops[j]);
  }
  // Nothing ahead — the last stop of the day, or every stop after it shares these coordinates.
  // Keep facing the way you arrived rather than snapping north on the final frame of the tour.
  for (let j = i - 1; j >= 0; j--) {
    if (metresBetween(stops[j], here) > COINCIDENT_M) return bearingRad(stops[j], here);
  }
  // A single-stop day, or a whole day at one coordinate. There is no direction of travel.
  return null;
}

/** What a `contextRadiusM` flight already takes on both engines, so a short hop is unchanged. */
const TOUR_FLIGHT_BASE_S = 1.2;
/** `STOP_CONTEXT_RADIUS_M` is 800m, so the camera holds ~1.6km of ground: a hop shorter than this
 *  never leaves the frame and is a pan, not a journey. Below it, distance buys no extra time. */
const TOUR_FLIGHT_NEAR_M = 500;
/** Four times `peekFlightSeconds`' stinginess, deliberately: a hover is unrequested and holds the
 *  camera hostage, where a tour is a thing the traveller pressed a button for. */
const TOUR_FLIGHT_PER_DOUBLING_S = 0.5;
/** A day that doubles back reverses the heading, and 180° inside the base flight is a whip pan.
 *  A full reversal buys a whole extra second and reads as a deliberate sweep. */
const TOUR_TURN_S_PER_90DEG = 0.5;
/** Just above the two slowest moves the app already makes — `frameRoute`'s 2.0s and streaming's
 *  2.4s. The tour's longest leg is the biggest move there is, so it may be the slowest, but not by
 *  much: past about three seconds a transition stops reading as travel and starts reading as a wait. */
const TOUR_FLIGHT_MAX_S = 2.8;

/**
 * Seconds to fly one leg of the tour.
 *
 * **Distance belongs here and not in the hold**, which is the whole change to the tour's pacing.
 * The hold is reading time for a card naming a place and a time; it does not become more
 * interesting because you travelled twelve kilometres to reach it. The flight is the part that is
 * actually about the distance — the same argument `peekFlightSeconds` makes for the hover, on the
 * other axis.
 */
export function tourFlightSeconds(legM: number, turnRad = 0): number {
  const doublings = Math.max(0, Math.log2(Math.max(legM, 1) / TOUR_FLIGHT_NEAR_M));
  // Shortest way round: a 350° turn is a 10° turn the other way, and both engines interpolate the
  // bearing over that shorter arc, so charging for 350 would buy time for travel that never happens.
  const turn = Math.abs(((turnRad + Math.PI) % (2 * Math.PI)) - Math.PI);
  const seconds =
    TOUR_FLIGHT_BASE_S +
    doublings * TOUR_FLIGHT_PER_DOUBLING_S +
    (turn / (Math.PI / 2)) * TOUR_TURN_S_PER_90DEG;
  return Math.min(seconds, TOUR_FLIGHT_MAX_S);
}

/**
 * Stillness at each stop, in milliseconds.
 *
 * Fixed, and lower than the ~5300ms the old metronome left over. The budget moved into the flight:
 * a tour whose camera is still for five seconds at a time is a slideshow with a transition, and the
 * card it is holding on says a name, a time and a duration — three or four seconds of reading.
 */
export const TOUR_HOLD_MS = 3600;

/**
 * The fastest the ground may pass under a travel beat, in metres per second.
 *
 * A ceiling, not a target — it only bites on a leg long enough that covering it in the time the
 * sentence takes would blur the ground. 150 m/s is ~540 km/h seen from 1200m. The first version
 * allowed 400, which on a 900m leg under a one-sentence line worked out at 650 km/h and read as a
 * lurch rather than as going somewhere.
 */
const TRAVEL_SPEED_MAX_MPS = 150;
/** Under this the movement is over before it registers as one, however short the ground. */
const TRAVEL_MIN_S = 4;

/**
 * How long the camera takes to walk a leg.
 *
 * **The narration is the target and the speed ceiling is the only thing that overrides it.** The
 * beat should end about when the sentence does; silence over a camera still travelling is dead
 * air, and it is what a cruise-speed version of this produced — a 900m leg held open for twenty
 * seconds under a five-second line.
 *
 * So: the sentence's length, unless that would mean moving faster than `TRAVEL_SPEED_MAX_MPS`, in
 * which case the leg takes as long as that speed needs and the difference is a second or two of
 * silence at the end. A genuinely long leg cannot be both slow and over when the voice stops, and
 * this resolves that in favour of legible ground.
 *
 * The caller holds the beat open for whatever this returns, so the camera is never cut off
 * mid-street.
 */
export function travelFollowSeconds(pathM: number, narrationMs: number): number {
  const narrationS = Math.max(narrationMs, 0) / 1000;
  if (!(pathM > 0)) return narrationS;
  return Math.max(narrationS, pathM / TRAVEL_SPEED_MAX_MPS, TRAVEL_MIN_S);
}

/**
 * Turn `from` toward `to` by fraction `k`, the short way round.
 *
 * Used to settle the fly-along's tangent heading into the heading the arriving stop beat will use,
 * so the handoff has no swing left to perform. Without the shortest-arc reduction a turn from 350°
 * to 10° goes the long way — 340° of spin at the exact moment the camera should be coming to rest.
 */
export function blendHeadingRad(from: number, to: number, k: number): number {
  const delta = (((to - from + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return from + delta * k;
}
