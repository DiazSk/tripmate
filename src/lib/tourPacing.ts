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

/** Below this the camera reads as stopped rather than travelling, however long the line is. */
const TRAVEL_SPEED_MIN_MPS = 25;
/** Above this it reads as a whip pan and the ground stops being legible. */
const TRAVEL_SPEED_MAX_MPS = 400;

/**
 * How long the camera should take to walk a leg, fitted to the narration that plays over it.
 *
 * **The narration wins, and that is this controller's founding rule** — the beat lasts exactly as
 * long as the sentence takes to say. A camera allowed to set its own duration would either finish
 * travelling while the voice was still describing the journey, or still be in transit when the next
 * place was being introduced.
 *
 * So the narration's length is the target and the ground speed is what gives, clamped at both ends
 * because a value outside this band stops reading as travel at all. Both clamps resolve themselves
 * without further code:
 *
 * - **Floor hit** (a short walk, a long line): the camera arrives early and the driver stops
 *   scheduling frames. That is not dead air — it is a pre-arrival at the place the next beat is
 *   about, which is a better shot than a crawl.
 * - **Ceiling hit** (a long drive, a short line): the leg is travelled fast, and if the narration
 *   still ends first the beat advances and cancels the driver mid-path. The next stop beat flies
 *   from wherever the camera reached, and `tourFlightSeconds` caps that at 2.8s, so it reads as an
 *   ordinary transition rather than a jump.
 */
export function travelFollowSeconds(pathM: number, narrationMs: number): number {
  const narrationS = Math.max(narrationMs, 0) / 1000;
  if (!(pathM > 0)) return narrationS;
  const minS = pathM / TRAVEL_SPEED_MAX_MPS;
  const maxS = pathM / TRAVEL_SPEED_MIN_MPS;
  return Math.min(Math.max(narrationS, minS), maxS);
}
