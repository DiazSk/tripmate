"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMapCamera } from "./mapCamera";
import { metresBetween } from "./peekRange";
import { prefersReducedMotion } from "./reducedMotion";
import { legBearingRad, tourFlightSeconds, TOUR_HOLD_MS } from "./tourPacing";

/** `frameRoute`'s own flight time on both engines. A day step is that same move, so it takes that
 *  same time rather than a number invented here. */
const TOUR_DAY_FLIGHT_S = 2.0;

/**
 * Steps the camera through the trip: the focused day's stops, or — with the panel collapsed and no
 * day focused — the days themselves.
 *
 * **Two modes, because "collapsed" already means something.** Collapsing the panel frames the whole
 * trip, so Play there is a flyover of the days, one step each. It used to walk every stop of every
 * day instead, which on a 45-stop trip was about five minutes and, in this file's own words, "not a
 * tour of anything". A day step reuses `reframeRoute`, so nothing is redrawn and the ~1.3s height
 * probe is not paid per step. It also avoids a claim a stop-level walk could not help making:
 * `frameRoute` deliberately draws no arc between the last stop of one day and the first of the
 * next, so flying that leg would travel down a line that is not on the map.
 *
 * **Each stop is framed along the direction of travel.** Every step used to arrive facing due
 * north, because nothing passed `headingRad` and both renderers default it to 0 — the same frame
 * every few seconds, which is what made this read as a slideshow. `legBearingRad` faces the next
 * stop instead, so a place arrives ahead of you. Deliberately *not* `routeViewHeadingDeg`: that
 * faces a day across its long axis, which is the right question for framing a whole day and the
 * wrong one for travelling through it.
 *
 * **The pacing is per leg, not a metronome.** The old fixed 6500ms was 1.2s of flight and ~5.3s of
 * stillness whether the next stop was 200m or 12km away, and that stillness was the slideshow. Time
 * now scales with the leg and the turn, and the hold is a flat `TOUR_HOLD_MS` — see `tourPacing`
 * for why distance belongs in the flight rather than the hold. A step is shorter than 6500ms in
 * every case, so this made the tour quicker as well as less static.
 *
 * Ends at the last step rather than looping. A tour that restarts forever is a screensaver, and
 * there is no way to tell "still going" from "went round again" without watching the whole thing.
 */
export function useStopTour() {
  const { routeStops, focusedDay, flyToPlace, setActiveIndex, reframeRoute, rendererRef, ready } =
    useMapCamera();
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;

    /** One move of the tour. `flightS` is how long the camera takes; `go` performs it, taking the
     *  duration to use so the reduced-motion branch can pass 0 without changing the pacing. */
    type Step = { flightS: number; go: (durationS: number) => void };
    const steps: Step[] = [];

    if (focusedDay === null) {
      // Whole-trip flyover: one step per day, framed the way selecting that day would frame it.
      const days = [...new Set(routeStops.map((s) => s.day))].sort((a, b) => a - b);
      for (const day of days) {
        steps.push({
          flightS: TOUR_DAY_FLIGHT_S,
          go: (durationS) => {
            // No stop is selected during a day step, and a stale selection from before the tour
            // would keep one row lit and one marker hoisted through the whole flyover.
            setActiveIndex(null);
            reframeRoute({ focusDay: day, durationS });
          },
        });
      }
    } else {
      // `routeStops` carries every day of the trip since the globe draws them all at once, so the
      // day has to be filtered back out here. The flat index is kept alongside because that is the
      // index space `setActiveIndex` and the marker cards share.
      const dayStops = routeStops.flatMap((stop, flatIndex) =>
        stop.day === focusedDay ? [{ stop, flatIndex }] : []
      );
      const coords = dayStops.map(({ stop }) => ({ lat: stop.lat, lng: stop.lng }));

      dayStops.forEach(({ stop: place, flatIndex }, i) => {
        const heading = legBearingRad(coords, i);
        const previous = i > 0 ? legBearingRad(coords, i - 1) : null;
        // ponytail: the first step is charged as a zero-length leg, so it gets the plain base
        // flight. The real distance is from wherever the day framing left the camera, and reading
        // that would mean querying the renderer mid-flight for one step's timing.
        const legM = i > 0 ? metresBetween(coords[i - 1], coords[i]) : 0;
        const turn = heading !== null && previous !== null ? heading - previous : 0;
        steps.push({
          flightS: tourFlightSeconds(legM, turn),
          go: (durationS) => {
            setActiveIndex(flatIndex);
            // No label: the card already names the place, and the pin would be a second one.
            flyToPlace(place.lat, place.lng, undefined, {
              ...(heading !== null ? { headingRad: heading } : {}),
              durationS,
            });
          },
        });
      });
    }

    if (steps.length === 0) return;

    // The index lives here rather than in state so a tick never depends on a re-render.
    let index = 0;
    const run = () => {
      const step = steps[index];
      // Read per tick rather than once: the setting can change mid-session, and one `matchMedia`
      // read every few seconds is nothing. Zero duration arrives instantly — the same trade
      // `useTripCamera` already makes for the streaming camera, where "the framing is the
      // information, the flight is the decoration". The *step* still takes as long either way, so
      // the tour runs the same length and someone who asked for less motion gets more stillness.
      step.go(prefersReducedMotion() ? 0 : step.flightS);
      index += 1;
      const waitMs = step.flightS * 1000 + TOUR_HOLD_MS;
      // The last step schedules a stop rather than calling one: stopping now would flip the button
      // back to Play while the camera is still flying to the final place.
      timerRef.current = setTimeout(index >= steps.length ? stop : run, waitMs);
    };
    run();

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // `routeStops` is in the deps deliberately: switching the day mid-tour restarts the tour on
    // the new day rather than stepping through indices that no longer mean anything. Same for
    // `focusedDay`, which is both what "the day" means and which of the two modes runs.
  }, [playing, routeStops, focusedDay, flyToPlace, setActiveIndex, reframeRoute, stop]);

  // Grabbing the globe means the visitor has taken over, so the tour gets out of the way. The
  // listener goes on the Cesium canvas rather than the window so clicking the panel's own
  // controls — including the stop button — doesn't count as taking over.
  //
  // `ready` is in the deps because the map is built on demand and its canvas may not exist
  // at the moment Play is pressed. Without a re-run once it does, dragging the freshly-arrived
  // globe would never stop the tour.
  useEffect(() => {
    if (!playing) return;
    const canvas = rendererRef.current?.canvas();
    if (!canvas) return;
    canvas.addEventListener("pointerdown", stop);
    return () => canvas.removeEventListener("pointerdown", stop);
  }, [playing, rendererRef, ready, stop]);

  const toggle = useCallback(() => setPlaying((p) => !p), []);

  return { playing, toggle, stop };
}
