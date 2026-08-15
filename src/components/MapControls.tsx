"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Cartesian3, Viewer } from "cesium";
import { useMapCamera } from "@/lib/mapCamera";
import { isGlobeHiddenRoute } from "@/lib/globeVisibility";

type CesiumModule = typeof import("cesium");

/** Pitch the "3D" button returns to — matches the day-route framing in mapCamera. */
const OBLIQUE_PITCH = -60;
/** Never exactly -90: at ±π/2 a HeadingPitchRange's heading component is degenerate, so the
 *  camera snaps to an arbitrary yaw and the next compass reset or 3D toggle visibly jumps. */
const TOPDOWN_PITCH = -89.9;
/** Below this pitch the map is "flat enough" to call 2D, so the button offers 3D instead. */
const FLAT_THRESHOLD_RAD = -1.48; // ≈ -85°
const TILT_MIN = 25;
const TILT_MAX = 90;
/** Fraction of the distance-to-target each +/- press covers, so the step scales with proximity. */
const ZOOM_STEP_RATIO = 0.35;
/** `camera.zoomIn`/`zoomOut` bypass screenSpaceCameraController, so its minimumZoomDistance
 *  does NOT apply to them — verified: repeated presses drive the camera to height 0, inside the
 *  building mesh. These bound the button steps instead. The ceiling matches the controller's. */
const MIN_ZOOM_DISTANCE_M = 80;
const MAX_ZOOM_DISTANCE_M = 25_000_000;
const READOUT_INTERVAL_MS = 100;
/** Shorter than the 2D/3D and compass flights: those reframe the whole view, a zoom step only
 *  dollies, and anything longer makes repeated presses feel like they're queueing. */
const ZOOM_FLIGHT_SECONDS = 0.45;

/**
 * The point the camera should pivot around: whatever is under the middle of the screen.
 * Falls back down a chain because each stage can miss — `pickPosition` needs depth-texture
 * support, `pickEllipsoid` returns nothing when the boresight is aimed at sky, and the final
 * nadir fallback is the only one that can never fail.
 */
function pickCenter(viewer: Viewer, Cesium: CesiumModule): Cartesian3 {
  const { scene, camera } = viewer;
  const mid = new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
  let point = scene.pickPositionSupported ? scene.pickPosition(mid) : undefined;
  if (!Cesium.defined(point)) point = camera.pickEllipsoid(mid, Cesium.Ellipsoid.WGS84);
  if (!Cesium.defined(point)) {
    const carto = camera.positionCartographic;
    point = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
  }
  return point;
}

/**
 * Re-aim the camera at a new pitch, heading and/or distance while keeping the same ground point
 * centred — the difference between "tilting the view" and "flying somewhere". Every camera move
 * this component makes routes through here, zoom included: `camera.zoomIn`/`zoomOut` are
 * instantaneous, which is what made the +/- buttons feel abrupt next to the eased 2D/3D snap.
 *
 * `range` overrides the current camera distance (that's a zoom); `target` skips the re-pick when
 * the caller has already picked one, so an accumulated zoom target and the flight that consumes
 * it are guaranteed to share a pivot point even when the camera is moving between the two.
 */
function pivot(
  viewer: Viewer,
  Cesium: CesiumModule,
  {
    pitchDeg,
    headingRad,
    range,
    target,
    fly,
    duration = 0.6,
    onSettled,
  }: {
    pitchDeg?: number;
    headingRad?: number;
    range?: number;
    target?: Cartesian3;
    fly: boolean;
    duration?: number;
    onSettled?: () => void;
  }
) {
  const pivotPoint = target ?? pickCenter(viewer, Cesium);
  const offsetRange = range ?? Cesium.Cartesian3.distance(viewer.camera.positionWC, pivotPoint);
  const pitch =
    pitchDeg === undefined
      ? viewer.camera.pitch
      : Cesium.Math.toRadians(Math.max(TOPDOWN_PITCH, Math.min(-1, pitchDeg)));
  const offset = new Cesium.HeadingPitchRange(
    headingRad === undefined ? viewer.camera.heading : headingRad,
    pitch,
    offsetRange
  );

  if (fly) {
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(pivotPoint, 0), {
      offset,
      duration,
      // Ease in *and* out, so a zoom step settles rather than stopping dead.
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      complete: onSettled,
      cancel: onSettled,
    });
    return;
  }
  viewer.camera.lookAtTransform(Cesium.Transforms.eastNorthUpToFixedFrame(pivotPoint), offset);
  // Releasing the transform is mandatory — leave it set and every subsequent drag pans in
  // that local frame forever instead of around the globe.
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

/**
 * Apple Maps-style map chrome: zoom, a 2D/3D snap, a tilt slider and a compass. Rendered once
 * from AppShell as a sibling of the globe, so it sits outside the `pointer-events-none` overlay.
 */
export default function MapControls() {
  const { viewerRef, ready } = useMapCamera();
  const pathname = usePathname();
  const [Cesium, setCesium] = useState<CesiumModule | null>(null);
  const [flat, setFlat] = useState(false);
  const needleRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  /** Range the in-flight zoom is heading for, so held/repeated presses compound. Null when idle. */
  const pendingRangeRef = useRef<number | null>(null);
  const zoomSeqRef = useRef(0);

  // Cesium is dynamically imported everywhere in this app — a static import would pull it into
  // the server bundle. That the import has resolved doubles as the readiness gate. Skipped
  // entirely on globe-hidden routes (e.g. /backend): this used to run unconditionally on every
  // route, pulling in the multi-MB Cesium bundle even where `GlobeBackground` itself had already
  // skipped it — there is nothing here for these controls to ever attach to on that route anyway
  // (`ready` never becomes true, since no viewer gets created).
  useEffect(() => {
    if (isGlobeHiddenRoute(pathname)) return;
    let cancelled = false;
    import("cesium").then((mod) => {
      if (!cancelled) setCesium(mod);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Live readout of the camera. Compass angle and slider position are DOM properties, so they
  // get written directly rather than through state — that keeps the steady-state re-render
  // count at zero. Only the 2D/3D label is React state, and React bails out when the setter
  // receives an unchanged value, so calling it 10x a second costs nothing.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || viewer.isDestroyed()) return;
    let last = 0;
    const tick = () => {
      const now = performance.now();
      if (now - last < READOUT_INTERVAL_MS) return;
      last = now;
      const { heading, pitch } = viewer.camera;
      if (needleRef.current) {
        needleRef.current.style.transform = `rotate(${(-heading * 180) / Math.PI}deg)`;
      }
      // Suppressed mid-drag: writing back while the user holds the thumb fights their input.
      if (sliderRef.current && !draggingRef.current) {
        sliderRef.current.value = String(Math.round((-pitch * 180) / Math.PI));
      }
      setFlat(pitch < FLAT_THRESHOLD_RAD);
    };
    // postRender over `camera.changed`: the globe's auto-rotate loop moves the camera every
    // frame, so `changed` fires continuously anyway and offers no throttle of its own.
    viewer.scene.postRender.addEventListener(tick);
    return () => {
      if (!viewer.isDestroyed()) viewer.scene.postRender.removeEventListener(tick);
    };
  }, [ready, viewerRef]);

  if (!Cesium || !ready) return null;

  /** Every control implies "I'm driving now", so the idle auto-rotation stops for good. */
  function withViewer(fn: (viewer: Viewer, cesium: CesiumModule) => void) {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !Cesium) return;
    (viewer as Viewer & { stopAutoRotate?: () => void }).stopAutoRotate?.();
    fn(viewer, Cesium);
  }

  const zoom = (direction: 1 | -1) =>
    withViewer((viewer, cesium) => {
      const target = pickCenter(viewer, cesium);
      const distance = cesium.Cartesian3.distance(viewer.camera.positionWC, target);
      // Successive presses step from the range the *previous* press was heading for, not from
      // wherever the camera happens to be mid-flight — each new flight cancels the last, so
      // measuring live would undershoot and rapid presses would stall instead of accelerating.
      const base = pendingRangeRef.current ?? distance;
      const wanted = base * (direction === 1 ? 1 - ZOOM_STEP_RATIO : 1 + ZOOM_STEP_RATIO);
      // Still clamped here rather than by screenSpaceCameraController: flyToBoundingSphere
      // bypasses that controller exactly as zoomIn/zoomOut did, so these bounds remain the only
      // thing keeping repeated presses out of the building mesh.
      const clamped = Math.min(Math.max(wanted, MIN_ZOOM_DISTANCE_M), MAX_ZOOM_DISTANCE_M);
      if (Math.abs(distance - clamped) < 1) return;
      pendingRangeRef.current = clamped;
      // Only the newest flight may clear the accumulator — a cancelled older flight fires
      // `cancel` *after* its successor has already claimed it.
      const seq = ++zoomSeqRef.current;
      pivot(viewer, cesium, {
        range: clamped,
        target,
        fly: true,
        duration: ZOOM_FLIGHT_SECONDS,
        onSettled: () => {
          if (zoomSeqRef.current === seq) pendingRangeRef.current = null;
        },
      });
    });

  const toggleFlat = () =>
    withViewer((viewer, cesium) =>
      pivot(viewer, cesium, { pitchDeg: flat ? OBLIQUE_PITCH : TOPDOWN_PITCH, fly: true })
    );

  const resetNorth = () =>
    withViewer((viewer, cesium) => pivot(viewer, cesium, { headingRad: 0, fly: true }));

  const tilt = (value: number) =>
    withViewer((viewer, cesium) => pivot(viewer, cesium, { pitchDeg: -value, fly: false }));

  // Transform is transitioned alongside the fill so a press eases in and releases back out,
  // rather than snapping between two states the way transition-colors alone did.
  const buttonClass =
    "flex h-11 w-11 items-center justify-center text-white/90 transition-[background-color,transform] duration-200 ease-out hover:bg-white/10 active:scale-[0.92] active:bg-white/15";

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
        className={`glass-control pointer-events-auto hidden rounded-xl text-xs font-semibold tracking-wide sm:flex ${buttonClass}`}
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
            defaultValue={60}
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
        className={`glass-control pointer-events-auto rounded-full ${buttonClass}`}
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
