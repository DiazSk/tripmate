"use client";

import { useEffect, useRef } from "react";
import { useMapCamera } from "@/lib/mapCamera";
import { STEM_HEIGHT_M } from "@/lib/mapRoute";

/**
 * Minimum screen-space gap between two cards before the later one gives up its name.
 *
 * Decluttering is not a nice-to-have here. PREVIEW_TRIP's day 1 puts three stops on the
 * *identical* coordinate — the hotel transfer, the hotel breakfast and the Marais shopping are
 * all "at the hotel" — and a real generation clusters the same way, because one place
 * legitimately has one coordinate. Without this the cards stack pixel-for-pixel into a pile.
 *
 * Two axes rather than one radius, because a card is wide and short: a square threshold either
 * lets side-by-side cards overlap or suppresses ones that were stacked harmlessly above each
 * other. These are roughly "half the widest card" and "one card tall".
 *
 * Losing the slot costs the stop its *name*, not its presence — the stem and glow pool are
 * Cesium entities drawn for every stop regardless. So a dense day still shows every stop and
 * reveals more names as the camera comes in and they separate, which is how a map should behave.
 */
const MIN_SEPARATION_X_PX = 132;
const MIN_SEPARATION_Y_PX = 32;

/** How far outside the viewport a card may sit and still be drawn — half a wide card, so one
 *  clipped at the edge still reads rather than popping out of existence at the boundary. */
const OFFSCREEN_MARGIN_PX = 110;

/** `scale = clamp(900000 / (distance + 260000), 0.55, 1)`. The floor is what keeps a card
 *  readable when the whole trip is in frame; the ceiling stops it dominating at street level. */
const SCALE_NUMERATOR = 900_000;
const SCALE_DISTANCE_BIAS = 260_000;
const SCALE_MIN = 0.55;
const SCALE_MAX = 1;

/**
 * The stop name cards: HTML overlays, not Cesium billboards, reprojected every frame.
 *
 * Billboards were the obvious route and the wrong one — a billboard is a texture, so it cannot
 * carry a backdrop blur, and the whole interface is built out of blurred glass. These are real
 * DOM elements that happen to be positioned from world coordinates.
 *
 * Mounted as a *sibling* of the content overlay in AppShell rather than a child: that overlay is
 * `overflow-y-auto`, and a marker layer inside it would scroll away from the globe it is pinned
 * to on any page whose content overflows.
 */
export default function StopMarkerLayer() {
  const {
    viewerRef,
    ready,
    routeStops,
    routeAltitudeRef,
    flyToPlace,
    hoveredIndex,
    setHoveredIndex,
    activeIndex,
    setActiveIndex,
  } = useMapCamera();
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || routeStops.length === 0) return;

    let cancelled = false;
    let listener: (() => void) | null = null;

    import("cesium").then((Cesium) => {
      if (cancelled || viewer.isDestroyed()) return;
      const scene = viewer.scene;
      const ellipsoid = scene.globe.ellipsoid;

      // Everything below is preallocated and reused. This runs on `postRender`, which in this app
      // ticks at ~160fps, and MapControls' readout established the house rule: per-frame work
      // writes straight to the DOM and allocates nothing. A `new Cartesian3()` per stop per frame
      // is ~1,300 short-lived objects a second for one day of eight stops.
      const windowPos = new Cesium.Cartesian2();
      const surfaceNormal = new Cesium.Cartesian3();
      const toCamera = new Cesium.Cartesian3();
      const anchors = routeStops.map(() => new Cesium.Cartesian3());
      // Flat [x0, y0, x1, y1, …] of cards already given a slot this frame, for the separation
      // check — a flat array of numbers so the check costs no objects either.
      const placed = new Float64Array(routeStops.length * 2);

      // The anchor sits at the *top* of the stem, and the card is then shifted up by its own
      // height in CSS. Recomputed only when the route's altitude changes — which happens once,
      // when the height sample lands — rather than every frame.
      let anchoredAt = Number.NaN;

      listener = () => {
        const altitude = routeAltitudeRef.current;
        if (altitude !== anchoredAt) {
          routeStops.forEach((stop, i) => {
            Cesium.Cartesian3.fromDegrees(
              stop.lng,
              stop.lat,
              altitude + STEM_HEIGHT_M,
              ellipsoid,
              anchors[i]
            );
          });
          anchoredAt = altitude;
        }

        const cameraPosition = scene.camera.positionWC;
        // CSS pixels, to match worldToWindowCoordinates. Read once per frame rather than per
        // stop — these are layout reads, and the whole point is to touch layout as little as
        // possible from inside a render callback.
        const viewWidth = scene.canvas.clientWidth;
        const viewHeight = scene.canvas.clientHeight;
        let placedCount = 0;

        for (let i = 0; i < routeStops.length; i++) {
          const node = nodeRefs.current[i];
          if (!node) continue;
          const anchor = anchors[i];

          // Horizon check: the geodetic surface normal at the stop against the vector to the
          // camera. A positive dot product means the stop is on the near face of the globe.
          // Without it, stops on the far side project to plausible-looking screen coordinates
          // and their cards smear across the limb.
          ellipsoid.geodeticSurfaceNormal(anchor, surfaceNormal);
          Cesium.Cartesian3.subtract(cameraPosition, anchor, toCamera);
          if (Cesium.Cartesian3.dot(surfaceNormal, toCamera) <= 0) {
            node.style.visibility = "hidden";
            continue;
          }

          // CSS pixel space. Deliberately not `worldToDrawingBufferCoordinates`, which is the
          // same transform in device pixels — GlobeBackground sets a custom `resolutionScale`
          // and `useBrowserRecommendedResolution: false`, so the two genuinely differ here.
          // Returns undefined behind the camera or near the ellipsoid centre.
          const projected = Cesium.SceneTransforms.worldToWindowCoordinates(
            scene,
            anchor,
            windowPos
          );
          if (!projected) {
            node.style.visibility = "hidden";
            continue;
          }

          // Reject anything projected off-screen. The layer's `overflow-hidden` already clips
          // these, so the visible result looks the same either way — but an off-screen card
          // still claimed a slot in the separation scan below and silently suppressed an
          // on-screen one, which is why zooming in never revealed more names. The margin keeps
          // a card that is only half out of frame, since part of it still reads.
          if (
            projected.x < -OFFSCREEN_MARGIN_PX ||
            projected.y < -OFFSCREEN_MARGIN_PX ||
            projected.x > viewWidth + OFFSCREEN_MARGIN_PX ||
            projected.y > viewHeight + OFFSCREEN_MARGIN_PX
          ) {
            node.style.visibility = "hidden";
            continue;
          }

          const distance = Cesium.Cartesian3.distance(cameraPosition, anchor);
          const scale = Math.min(
            SCALE_MAX,
            Math.max(SCALE_MIN, SCALE_NUMERATOR / (distance + SCALE_DISTANCE_BIAS))
          );

          // Declutter in visit order rather than nearest-camera-first. Visit order is stable, so
          // a card never flickers as two stops trade places by a metre; distance order does
          // exactly that when stops are near-equidistant, which in one city is most of them.
          //
          // Thresholds scale with the card, since that is how much room it actually takes up —
          // a fixed pixel gap over-suppresses names at the zoomed-out end, where every card is
          // down at the 0.55 floor and half the size the threshold assumes.
          // ponytail: O(n²) separation scan, fine for n ≤ ~15 stops/day. Swap for a screen-space
          // grid if a day ever carries dozens.
          let clashes = false;
          for (let p = 0; p < placedCount; p++) {
            if (
              Math.abs(placed[p * 2] - projected.x) < MIN_SEPARATION_X_PX * scale &&
              Math.abs(placed[p * 2 + 1] - projected.y) < MIN_SEPARATION_Y_PX * scale
            ) {
              clashes = true;
              break;
            }
          }
          if (clashes) {
            node.style.visibility = "hidden";
            continue;
          }
          placed[placedCount * 2] = projected.x;
          placed[placedCount * 2 + 1] = projected.y;
          placedCount++;

          // `transform`, `visibility` and this custom property — all three composited/inherited,
          // so no layout is triggered. `translate(-50%, -100%)` puts the card's bottom edge on
          // the stem tip; the anchor's `transform-origin: bottom center` keeps it there through
          // the scale. `--marker-depth` is the same already-computed `scale` (0.55-1), handed to
          // the title card below via CSS inheritance so it can drive opacity/blur for the
          // rack-focus effect — not a second distance calculation.
          node.style.setProperty("--marker-depth", scale.toFixed(3));
          node.style.transform = `translate3d(${projected.x.toFixed(1)}px, ${projected.y.toFixed(
            1
          )}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
          node.style.visibility = "visible";
        }
      };

      scene.postRender.addEventListener(listener);
    });

    return () => {
      cancelled = true;
      if (listener && !viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(listener);
      }
    };
  }, [routeStops, viewerRef, routeAltitudeRef, ready]);

  if (routeStops.length === 0) return null;

  // z-[5]: above the globe, *below* the content overlay at z-10. Sitting above it was the obvious
  // choice and the wrong one — a stop near the right edge then drew its card on top of the
  // itinerary panel, straddling the panel's edge. These cards belong to the world behind the
  // glass, so they occlude like the globe does: the panel covers them, and the route framing
  // already biases east (PANEL_BIAS_RATIO) to keep the day clear of it in the first place.
  // Clicks still land, because the overlay above is pointer-events-none.
  return (
    // aria-hidden, and every card taken out of the tab order below. These cards name
    // the same stops the itinerary panel already lists as focusable rows, so leaving
    // them focusable put up to eight duplicate tab stops between the wordmark and the
    // panel — each one flying the camera on activation with nothing announced. The
    // panel's rows are the keyboard path to a stop, and focusing one already lights
    // its marker here; this layer is the pointer and touch affordance for the same
    // thing.
    <div
      aria-hidden="true"
      className="stop-marker-layer pointer-events-none absolute inset-0 z-[5] overflow-hidden"
    >
      {routeStops.map((stop, i) => (
        <div
          key={i}
          ref={(el) => {
            nodeRefs.current[i] = el;
          }}
          // `visibility` is deliberately NOT a React-managed inline style, even though the
          // initial state is hidden. React re-applies its inline styles on every re-render, so
          // a `style={{ visibility: "hidden" }}` here blanked every placed card for one frame
          // each time the provider re-rendered — the next postRender put it back, which is
          // exactly the kind of one-frame flicker that is miserable to track down later.
          // `.marker-anchor` starts hidden in CSS instead, and only the render loop writes it.
          className="marker-anchor"
        >
          <button
            type="button"
            tabIndex={-1}
            // The layer is pointer-events-none so the globe stays draggable through the gaps
            // between cards; each card opts back in. See DESIGN.md's Pointer-Events Opt-In Rule.
            className="marker-title-card pointer-events-auto"
            // Drives the lift/glow via CSS, and is also what the itinerary panel sets remotely
            // when the pointer is on its matching row — one attribute, both directions.
            data-hovered={hoveredIndex === i || activeIndex === i ? "true" : undefined}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            // Pointer events rather than mouse events would fire on touch too, where there is
            // no hover to speak of and a tap would leave the card stuck lit.
            onFocus={() => setHoveredIndex(i)}
            onBlur={() => setHoveredIndex(null)}
            // No label passed, so this flies the camera without dropping the red search pin —
            // the card already names the place, and a pin plus a card is one label too many.
            onClick={() => {
              setActiveIndex(i);
              flyToPlace(stop.lat, stop.lng);
            }}
          >
            {stop.name}
          </button>
        </div>
      ))}
    </div>
  );
}
