"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMapCamera } from "./mapCamera";
import { prefersReducedMotion } from "./reducedMotion";
import { geocodeDestination } from "./weather";
import { Itinerary, PlaceDetail, Stop } from "./types";

export type GeocodeOutcome = "found" | "missed" | "unreachable";

/** How long the streaming camera takes to reach each new framing, in seconds. Longer than the
 *  2s a finished route gets: this flight is unrequested, and a slow drift reads as the map
 *  keeping up with the plan where a quick snap reads as the map being yanked. */
const STREAM_FRAME_SECONDS = 2.4;

/**
 * Moves the camera as a plan is written, and keeps everything else off the camera while it does.
 *
 * Two halves, and both are needed for either to work:
 *
 * 1. **`showTripRoute`'s own framing is suspended for the length of the run.** `ItineraryCard`
 *    redraws the route on every arriving stop, which is right — the pins and ribbons *are* the
 *    reveal — but each of those calls also re-aimed the camera at a freshly-computed pose. On a
 *    live 4-day Rome generation that meant five flights in 22 seconds whose headings went
 *    25° → 23° → 53° → 276° → 281°, because `routeViewHeadingDeg` faces a route across its long
 *    axis and a route's long axis changes completely every time a stop lands on it. Read as the
 *    map spinning on the spot.
 * 2. **One framing per day, when that day's real coordinates land.** `coordsDay` is the highest
 *    day index a `day-coords` event has corrected, so it is both the trigger and the debounce —
 *    no timer. It has to be the trigger rather than the stops themselves: the model writes
 *    latitudes and longitudes from memory and has been measured 11km out, so the bounds of the
 *    stops as *written* frame the wrong part of the city until Overpass answers.
 *
 * The framing is the growing trip, not the newest day — every day corrected so far, held in
 * frame together. Following the newest day's centroid at a fixed range was built and watched
 * against the same 4-day Rome generation, and lost on three counts: at any fixed range tight
 * enough to be worth flying to, a real day in a real city already runs off both edges; two
 * `day-coords` frames landing in the same CLI clump cancel each other's flight, so a day is
 * silently skipped; and the run ends leaned in on one day with nothing to pull back out, since
 * the finished plan's route shape equals the draft's and `ItineraryCard`'s route effect never
 * re-fires. Growing bounds settle instead of churning by construction — each new day moves the
 * accumulated bounds less than the last (measured: zoom 14.9 → 14.02 → 13.82 → 13.76).
 *
 * `running` rather than `draft !== null` gates the suspension, so it is in force from the button
 * press: child effects commit before parent ones, and keyed on the draft the first clump of stops
 * would frame itself on hallucinated coordinates before this hook ever ran.
 *
 * Also drives a refine, which streams the same events into the same draft.
 */
export function useStreamingCamera(
  running: boolean,
  draft: Itinerary | null,
  coordsDay: number | null
) {
  const { setRouteFramingSuspended, rendererRef, routeAltitudeRef } = useMapCamera();

  useEffect(() => {
    setRouteFramingSuspended(running);
    return () => setRouteFramingSuspended(false);
  }, [running, setRouteFramingSuspended]);

  useEffect(() => {
    if (coordsDay === null || !draft) return;
    const renderer = rendererRef.current;
    if (!renderer?.isAlive()) return;
    // Only the days whose coordinates have been corrected. A day still holding the model's own
    // guesses would widen the bounds by however far it guessed wrong, and then snap back.
    const days = draft.days
      .slice(0, coordsDay + 1)
      // `filter` and not a bare `map`: a `stop` frame writes into `stops[stopIndex]`, so the array
      // can legitimately be sparse, and a hole would count toward the centroid's divisor.
      .map((day, i) =>
        day.stops
          .filter(Boolean)
          .map((s) => ({ lat: s.lat, lng: s.lng, name: s.name, day: i, time: s.time }))
      );
    if (!days.some((d) => d.length)) return;
    // ponytail: no outlier rule, and the last day usually has one — the departure transfer. A
    // Rome plan ending at Fiumicino frames 30km of Lazio on its final move and the city collapses
    // into a clump. That is `frameRoute`'s own whole-trip answer, shared with the finished plan's
    // overview, so this arrives at it early rather than inventing a worse one; fix it there (for
    // both) if it ever needs fixing, not here. Trimming outliers *here* would misframe a genuine
    // day trip, which looks identical to an airport run from this side.
    renderer.frameRoute({
      days,
      // No day is singled out during a run: the panel is a capsule and the whole trip so far is
      // the subject. `panelVisible` is still true so the framing measures the panel rather than
      // assuming it away — `panelLeftEdgePx` reports the full width for a collapsed capsule, and
      // reports the strip correctly if the traveller opens the plan mid-run.
      focusDay: null,
      panelVisible: true,
      routeAltitudeM: routeAltitudeRef.current,
      // Unrequested camera movement, which is what `prefers-reduced-motion` asks us to skip — but
      // skipping it outright would leave the plan drawing itself off screen. Arrive instantly
      // instead: the framing is the information, the flight is the decoration.
      durationS: prefersReducedMotion() ? 0 : STREAM_FRAME_SECONDS,
    });
    // `draft` is read from the closure on purpose and is deliberately absent from the deps: it
    // changes identity on every arriving stop, and this must fire once per *day*. On the render
    // where `coordsDay` moves, the closure's `draft` is that render's own value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordsDay, rendererRef, routeAltitudeRef]);
}

export function useTripCamera(destination: string, tripId?: string) {
  const {
    flyToDestination,
    flyToPlace,
    showHighways,
    showCityContext,
    setActiveStop,
    reframeRoute,
  } = useMapCamera();
  const [destinationCoords, setDestinationCoords] = useState<{
    lat: number;
    lon: number;
    name: string;
  } | null>(null);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  /**
   * Geocodes `name` and records the coordinates (closeDetail flies back to them). `fly`
   * additionally moves the camera there — pass `false` when an itinerary is about to frame
   * its own route, since the geocode resolves a few hundred ms later and would otherwise
   * land second and clobber the better framing with a visible double flight.
   *
   * Returns `"found"`, `"missed"` or `"unreachable"`. Three outcomes rather than a
   * nullable result because a miss and a dropped connection need different words on
   * screen: collapsing both to null meant a network failure was reported to the user
   * as "we couldn't find that place", which is a claim about their typing.
   *
   * The home page calls this from the destination field's blur handler, where an empty
   * string or a thrown fetch is routine rather than exceptional — hence the guard and
   * the catch here rather than at that one call site.
   */
  const flyToDestinationByName = useCallback(
    async (name: string, fly = true): Promise<GeocodeOutcome> => {
      if (!name.trim()) return "missed";
      let geo: Awaited<ReturnType<typeof geocodeDestination>>;
      try {
        geo = await geocodeDestination(name);
      } catch {
        return "unreachable";
      }
      if (!geo) return "missed";
      setDestinationCoords(geo);
      // Independent of `fly`: highways are ambient map context for wherever the trip's
      // destination turns out to be, not tied to whether the camera itself flies there (a
      // saved trip with stops already frames its own day route and skips the flight).
      showHighways(geo.lat, geo.lon);
      // Same independence as the highways, and for the same reason: the outline and the towns
      // around it are ambient context for wherever the destination turns out to be, not tied to
      // whether the camera flies there.
      showCityContext(geo.lat, geo.lon, geo.name);
      if (fly) flyToDestination(geo.lat, geo.lon, geo.name);
      return "found";
    },
    [flyToDestination, showHighways, showCityContext]
  );

  /** Same as flyToDestinationByName, but for callers (e.g. an autocomplete suggestion) that
   *  already know the coordinates — skips the redundant re-geocode round-trip. */
  const flyToDestinationByCoords = useCallback(
    (lat: number, lon: number, name: string) => {
      setDestinationCoords({ lat, lon, name });
      showHighways(lat, lon);
      showCityContext(lat, lon, name);
      flyToDestination(lat, lon, name);
    },
    [flyToDestination, showHighways, showCityContext]
  );

  /** Monotonic id of the newest `/api/place-detail` lookup — see the note inside `selectStop`. */
  const detailRequestRef = useRef(0);

  const selectStop = useCallback(
    async (stop: Stop) => {
      setSelectedStop(stop);
      // Mark it selected on the globe as well, which a click on the *marker* has always done
      // (StopMarkerLayer sets the index directly) and a click on the itinerary row never did.
      // Three things ran off that and all three were quietly missing from this path: the row
      // stayed lit only while the pointer was on it, the stop's marker and the arcs touching it
      // took no emphasis, and the day/night tint reverted to daylight the moment the pointer
      // left the row — so opening an 8:45pm stop from the list put the city back in daylight.
      setActiveStop(stop);
      // No label, so no red pin — the same call StopMarkerLayer already makes when a stop's card
      // is clicked on the globe, and for the reason recorded there: the card names the place, so a
      // pin plus a Cesium label plus a card is one place labelled three times. This path passed
      // `stop.name` and got all three.
      //
      // Safe only because of the declutter promotion in StopMarkerLayer: the card *is* the label
      // now, and before that promotion the selected stop routinely lost it to a co-located
      // neighbour — clicking "Crawford Market" left "Private car to Crawford Market" holding the
      // only card on screen, so removing the pin here on its own would have replaced a duplicate
      // label with a wrong one. Don't split these two changes.
      //
      // Clearing rather than moving the pin is the intended behaviour of a labelless flight (see
      // `flyTo`), and it is what a marker click has always done. A destination pin comes back on
      // the way out: `closeDetail` flies to `destinationCoords` with its name.
      flyToPlace(stop.lat, stop.lng);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      /**
       * Which lookup this is, so a slower earlier one cannot answer for a later place.
       *
       * The call takes ~6s and nothing was cancelling it, so opening a stop, going back and
       * opening another inside that window let the *first* response land last and write itself
       * into the panel — the Markthalle's guidebook entry under the Kunsthaus's heading, with the
       * right one arriving seconds later to replace it. Every stale write is guarded, not just the
       * success one: an abandoned request that fails would otherwise put its error on the place
       * you are actually reading, and its `finally` would clear a spinner that belongs to a
       * request still in flight.
       *
       * A counter rather than an `AbortController`: aborting does not stop the model call the
       * server has already started, and it throws into the `catch` below, so the guard would be
       * needed anyway to keep that from surfacing as an error. One ref does the whole job.
       */
      const request = ++detailRequestRef.current;
      const current = () => detailRequestRef.current === request;
      try {
        const res = await fetch("/api/place-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: stop.name,
            destination,
            lat: stop.lat,
            lng: stop.lng,
            tripId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (current()) setDetail(data.detail);
      } catch (e) {
        if (current())
          setDetailError(
            e instanceof Error && e.message
              ? e.message
              : `We couldn't look up ${stop.name}. Reopening it will try again.`
          );
      } finally {
        if (current()) setDetailLoading(false);
      }
    },
    [flyToPlace, setActiveStop, destination, tripId]
  );

  const closeDetail = useCallback(() => {
    setSelectedStop(null);
    // Back to the day that is drawn, not out to the city. Flying to `destinationCoords` was the
    // original behaviour and it put the camera 15km up over the whole destination at nadir —
    // which passed for "back out" only while a day's framing looked roughly the same. A day now
    // has its own heading and pitch, so that flight visibly discarded the view being returned to.
    // The destination flight is still the fallback for the one case with no route behind the
    // panel: a stop detail opened on the home page before a trip has been drawn.
    if (reframeRoute()) return;
    if (destinationCoords)
      flyToDestination(destinationCoords.lat, destinationCoords.lon, destinationCoords.name);
  }, [reframeRoute, destinationCoords, flyToDestination]);

  return {
    /** Exposed for the arrive/depart pickers, which need somewhere to look up airports near.
     *  Set by both paths that resolve a destination — picking a suggestion and the blur geocode. */
    destinationCoords,
    flyToDestinationByName,
    flyToDestinationByCoords,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  };
}
