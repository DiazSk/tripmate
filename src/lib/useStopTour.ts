"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMapCamera } from "./mapCamera";

/**
 * Dwell between stops. The camera flight itself is 2.5s (see `flyTo` in mapCamera), so this
 * leaves ~4s to actually look at each place — the flight is the transition, not the point.
 */
const TOUR_INTERVAL_MS = 6500;

/**
 * Steps the camera through the current day's stops, one every ~6.5s.
 *
 * Ends at the last stop rather than looping. A tour that restarts forever is a screensaver, and
 * there is no way to tell "still going" from "went round again" without watching the whole thing.
 */
export function useStopTour() {
  const { routeStops, flyToPlace, setActiveIndex, viewerRef } = useMapCamera();
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const stops = routeStops;
    if (stops.length === 0) return;

    // Step 0 immediately — waiting a full interval before the first move makes the button feel
    // broken. The index lives here rather than in state so a tick never depends on a re-render.
    let index = 0;
    const go = () => {
      setActiveIndex(index);
      // No label: the card already names the place, and flyToPlace's own pin would be a second
      // one.
      flyToPlace(stops[index].lat, stops[index].lng);
    };
    go();

    timerRef.current = setInterval(() => {
      index += 1;
      if (index >= stops.length) {
        stop();
        return;
      }
      go();
    }, TOUR_INTERVAL_MS);

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // `routeStops` is in the deps deliberately: switching the day mid-tour restarts the tour on
    // the new day rather than stepping through indices that no longer mean anything.
  }, [playing, routeStops, flyToPlace, setActiveIndex, stop]);

  // Grabbing the globe means the visitor has taken over, so the tour gets out of the way. The
  // listener goes on the Cesium canvas rather than the window so clicking the panel's own
  // controls — including the stop button — doesn't count as taking over.
  useEffect(() => {
    if (!playing) return;
    const canvas = viewerRef.current?.scene.canvas;
    if (!canvas) return;
    canvas.addEventListener("pointerdown", stop);
    return () => canvas.removeEventListener("pointerdown", stop);
  }, [playing, viewerRef, stop]);

  const toggle = useCallback(() => setPlaying((p) => !p), []);

  return { playing, toggle, stop };
}
