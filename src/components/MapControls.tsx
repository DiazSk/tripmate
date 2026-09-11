"use client";

import { useEffect, useRef, useState } from "react";
import { useMapCamera } from "@/lib/mapCamera";
import { ROUTE_FRAME_PITCH_DEG } from "@/lib/mapRenderer";

/**
 * The pitch "3D" returns to, and it is **imported rather than restated**.
 *
 * It used to be a local `-60` with a comment claiming it matched the day-route framing. That was
 * true when it was written and stopped being true the moment the framing moved to -45 — a change
 * made for a documented reason (at 30° off straight down a day's arcs project back onto the ground
 * line they span, which is exactly what lifting them was for). Nothing failed, so nothing said so:
 * pressing 2D and then 3D quietly left the camera at an angle the app uses nowhere else, neither
 * the pose a route is framed at nor the one the landing hero opens on.
 *
 * Reading it from `ROUTE_FRAME_PITCH_DEG` means "back to 3D" means "back to the pose this app
 * considers normal", and that it cannot drift again without the framing drifting with it.
 */
const OBLIQUE_PITCH = ROUTE_FRAME_PITCH_DEG;
/** Never exactly -90: at ±π/2 a heading-pitch-range's heading component is degenerate, so the
 *  camera snaps to an arbitrary yaw and the next compass reset or 3D toggle visibly jumps. */
const TOPDOWN_PITCH = -89.9;
/** Below this pitch the map is "flat enough" to call 2D, so the button offers 3D instead. */
const FLAT_THRESHOLD_RAD = -1.48; // ≈ -85°
const TILT_MIN = 25;
const TILT_MAX = 90;
/** Fraction of the distance-to-target each +/- press covers, so the step scales with proximity. */
const ZOOM_STEP_RATIO = 0.35;
/** Cesium's `camera.zoomIn`/`zoomOut` bypass screenSpaceCameraController, so its
 *  minimumZoomDistance does NOT apply to them — verified: repeated presses drive the camera to
 *  height 0, inside the building mesh. These bound the button steps instead, on both engines, so
 *  the two bottom out in the same place. The ceiling matches Cesium's controller. */
const MIN_ZOOM_DISTANCE_M = 80;
const MAX_ZOOM_DISTANCE_M = 25_000_000;
const READOUT_INTERVAL_MS = 100;
/** Shorter than the 2D/3D and compass flights: those reframe the whole view, a zoom step only
 *  dollies, and anything longer makes repeated presses feel like they're queueing. */
const ZOOM_FLIGHT_SECONDS = 0.45;

/**
 * Apple Maps-style map chrome: zoom, a 2D/3D snap, a tilt slider and a compass. Rendered once
 * from AppShell as a sibling of the globe, so it sits outside the `pointer-events-none` overlay.
 *
 * **Not rendered at all while the map search is open** — `AppShell` owns that, and the note there
 * records why unmounting beats dimming. Nothing in this component needs to know: its compass
 * angle and tilt position are read from the live camera on the first frame after mount, so coming
 * back is indistinguishable from never having left.
 */
export default function MapControls() {
  const { rendererRef, ready } = useMapCamera();
  const [flat, setFlat] = useState(false);
  const needleRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  /** Range the in-flight zoom is heading for, so held/repeated presses compound. Null when idle. */
  const pendingRangeRef = useRef<number | null>(null);
  const zoomSeqRef = useRef(0);

  // Live readout of the camera. Compass angle and slider position are DOM properties, so they
  // get written directly rather than through state — that keeps the steady-state re-render count
  // at zero. Only the 2D/3D label is React state, and React bails out when the setter receives an
  // unchanged value, so calling it 10x a second costs nothing.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!ready || !renderer?.isAlive()) return;
    let last = 0;
    // A per-frame hook rather than a camera-changed event: both engines render on demand, so this
    // fires exactly as often as the camera can have moved — and a "changed" event would need a
    // percentage threshold tuned to be useful.
    return renderer.onFrame(() => {
      const now = performance.now();
      if (now - last < READOUT_INTERVAL_MS) return;
      last = now;
      const heading = renderer.headingRad();
      const pitch = renderer.pitchRad();
      if (needleRef.current) {
        needleRef.current.style.transform = `rotate(${(-heading * 180) / Math.PI}deg)`;
      }
      // Suppressed mid-drag: writing back while the user holds the thumb fights their input.
      if (sliderRef.current && !draggingRef.current) {
        sliderRef.current.value = String(Math.round((-pitch * 180) / Math.PI));
      }
      setFlat(pitch < FLAT_THRESHOLD_RAD);
    });
  }, [ready, rendererRef]);

  if (!ready) return null;

  function withRenderer(fn: (renderer: NonNullable<typeof rendererRef.current>) => void) {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive()) return;
    fn(renderer);
  }

  const zoom = (direction: 1 | -1) =>
    withRenderer((renderer) => {
      // Successive presses step from the range the *previous* press was heading for, not from
      // wherever the camera happens to be mid-flight — each new flight cancels the last, so
      // measuring live would undershoot and rapid presses would stall instead of accelerating.
      // Only the newest flight may clear the accumulator; a cancelled older one settles *after*
      // its successor has already claimed it, which is what `seq` guards.
      const seq = ++zoomSeqRef.current;
      renderer.zoomStep({
        direction,
        ratio: ZOOM_STEP_RATIO,
        minRangeM: MIN_ZOOM_DISTANCE_M,
        maxRangeM: MAX_ZOOM_DISTANCE_M,
        fromRangeM: pendingRangeRef.current,
        durationS: ZOOM_FLIGHT_SECONDS,
        onSettled: (rangeM) => {
          if (rangeM !== null) pendingRangeRef.current = rangeM;
          else if (zoomSeqRef.current === seq) pendingRangeRef.current = null;
        },
      });
    });

  const toggleFlat = () =>
    withRenderer((renderer) =>
      renderer.setPitchDeg(flat ? OBLIQUE_PITCH : TOPDOWN_PITCH, { animate: true })
    );

  const resetNorth = () => withRenderer((renderer) => renderer.setHeadingRad(0));

  const tilt = (value: number) => withRenderer((renderer) => renderer.setPitchDeg(-value));

  // Transform is transitioned alongside the fill so a press eases in and releases back out,
  // rather than snapping between two states the way transition-colors alone did.
  const buttonShape =
    "flex h-11 w-11 items-center justify-center text-white/90 transition-[background-color,transform] duration-200 ease-out active:scale-[0.92]";

  /** For the two buttons *inside* the glass pill, which paint their own fill over it. */
  const buttonClass = `${buttonShape} hover:bg-white/10 active:bg-white/15`;

  /** For the two that *are* glass — the 2D/3D toggle and the compass, each carrying
   *  `.glass-control` themselves. They deliberately omit the `bg-*` utilities above, because on
   *  those elements the utilities did nothing: `.glass-control` sets `background` unlayered in
   *  `globals.css`, and unlayered author CSS outranks anything `@layer utilities` emits whatever
   *  its specificity. Both shipped with no hover and no press state for that reason. The states
   *  now live next to the base rule in `globals.css`, where they can actually win — and they
   *  darken rather than lighten, per DESIGN.md's Darken-Never-Lighten Rule, since these float
   *  over terrain that is sometimes a snowfield. The `transition` stays: it finally has a
   *  property that moves. */
  const glassButtonClass = buttonShape;

  return (
    // Hidden below `sm:` by default — that's the breakpoint where the itinerary panel goes
    // full-bleed and these would sit on top of it. A phone gets them back, in a reduced set
    // and a different corner, once DockedPanel's collapse frees the space; the rule that does
    // it is `.app-shell:has(.docked-panel-collapsed) .map-controls` in globals.css.
    // Raised clear of the Cesium attribution at bottom-left.
    <div className="map-controls pointer-events-none fixed bottom-10 left-6 z-20 hidden flex-col items-center gap-3 sm:flex">
      <div className="glass-control pointer-events-auto flex flex-col overflow-hidden rounded-xl">
        <button type="button" onClick={() => zoom(1)} aria-label="Zoom in" className={buttonClass}>
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <path
              d="M7.5 1.5v12M1.5 7.5h12"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="h-px bg-white/15" />
        <button
          type="button"
          onClick={() => zoom(-1)}
          aria-label="Zoom out"
          className={buttonClass}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <path d="M1.5 7.5h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Labelled with the mode you'll get, not the one you're in — that's what makes it a verb,
          and it's what Apple Maps does. */}
      <button
        type="button"
        onClick={toggleFlat}
        aria-label={flat ? "Switch to 3D view" : "Switch to 2D view"}
        // text-xs, on the ramp: 13px was a one-off step, and at 44px square with a
        // two-character label the difference is a pixel nobody reads.
        className={`glass-control pointer-events-auto hidden rounded-xl text-xs font-semibold tracking-wide sm:flex ${glassButtonClass}`}
      >
        {flat ? "3D" : "2D"}
      </button>

      {/* px-2.5 lands the pill at 44px wide, matching the h-11 w-11 buttons above and below. */}
      <div className="glass-control pointer-events-auto hidden justify-center rounded-full px-2.5 py-2.5 sm:flex">
        <span className="tilt-slider-wrap">
          <input
            ref={sliderRef}
            type="range"
            min={TILT_MIN}
            max={TILT_MAX}
            // The same default, expressed the way the slider reads pitch — degrees below the
            // horizon, so the thumb starts where the camera actually is instead of 15° off it
            // until the first readout frame corrects it.
            defaultValue={-OBLIQUE_PITCH}
            aria-label="Map tilt — top is looking straight down, bottom is a low 3D angle"
            className="tilt-slider"
            onPointerDown={() => {
              draggingRef.current = true;
            }}
            onPointerUp={() => {
              draggingRef.current = false;
            }}
            onPointerCancel={() => {
              draggingRef.current = false;
            }}
            onInput={(e) => tilt(Number(e.currentTarget.value))}
          />
        </span>
      </div>

      <button
        type="button"
        onClick={resetNorth}
        aria-label="Reset map to face north"
        className={`glass-control pointer-events-auto rounded-full ${glassButtonClass}`}
      >
        <span ref={needleRef} className="block will-change-transform">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <path d="M13 2.5 15.4 7h-4.8L13 2.5Z" fill="#FF3B30" />
            <text
              x="13"
              y="17.5"
              textAnchor="middle"
              fontSize="10"
              fontWeight="600"
              fill="currentColor"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              N
            </text>
          </svg>
        </span>
      </button>
    </div>
  );
}
