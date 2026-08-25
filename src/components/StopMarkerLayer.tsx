"use client";

import { CSSProperties, useEffect, useMemo, useRef } from "react";
import { dayVisualState, useMapCamera } from "@/lib/mapCamera";
import { DAY_LABEL_LIFT_M, DayVisualState, STEM_HEIGHT_M } from "@/lib/mapRoute";

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
/** One thing to place on screen this frame: either a stop's name or a day's cluster label. Both
 *  project identically, so they share one anchor array, one declutter scan and one loop —
 *  running a second postRender listener for the labels would let the two disagree about which
 *  of them owns a piece of screen. */
type Marker =
  | { kind: "stop"; lat: number; lng: number; name: string; flatIndex: number }
  | {
      kind: "cluster";
      lat: number;
      lng: number;
      label: string;
      colorToken: string;
      day: number;
      state: DayVisualState;
    };

/**
 * How far a day badge is kept from the viewport edge, in CSS pixels.
 *
 * Generous at the top because the card is drawn a full card-height *above* its anchor
 * (`translate(-50%, -100%)`), so an anchor sitting at y = 10 puts the label itself off-screen.
 */
const CLUSTER_EDGE_MARGIN_PX = 56;

export default function StopMarkerLayer() {
  const {
    viewerRef,
    ready,
    routeStops,
    routeClusters,
    focusedDay,
    hoveredDay,
    setHoveredDay,
    routeAltitudeRef,
    flyToPlace,
    hoveredIndex,
    setHoveredIndex,
    activeIndex,
    setActiveIndex,
  } = useMapCamera();
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);

  /** Which day, if any, gets its stops named: the panel's selection, or the day the pointer is
   *  resting on. */
  const namedDay = focusedDay ?? hoveredDay;

  /**
   * Everything to place, clusters first.
   *
   * Order is load-bearing: the declutter scan below is first-come-first-served in array order, so
   * putting the day labels ahead of the stop names is what guarantees a label is never suppressed
   * by a stop standing where it wanted to be.
   *
   * **Every day keeps its label, in every state.** That used to be impossible — the badge sat on
   * the cluster's centroid, which is exactly where its own pins are, so a labelled day and a
   * named day could not both be legible and the label had to be dropped whenever its stops were
   * showing. `buildDayClusters` now hangs it out on the circumcircle instead, naming the group
   * from outside it, so there is nothing left to trade off.
   *
   * Stop names are still only ever emitted for one day. All of them at once is ~45 names over
   * photography, which no amount of colour makes readable, and the declutterer would spend the
   * frame arbitrating between days rather than within one.
   */
  const markers = useMemo<Marker[]>(() => {
    const clusters: Marker[] = routeClusters.map((c) => ({
      kind: "cluster",
      // The perimeter point, not the centre — see buildDayClusters.
      lat: c.labelLat,
      lng: c.labelLng,
      label: c.label,
      colorToken: c.colorToken,
      day: c.day,
      state: dayVisualState(c.day, focusedDay, hoveredDay),
    }));
    const stops: Marker[] =
      namedDay === null
        ? []
        : routeStops.flatMap((stop, flatIndex) =>
            stop.day === namedDay
              ? [{ kind: "stop" as const, lat: stop.lat, lng: stop.lng, name: stop.name, flatIndex }]
              : []
          );
    return [...clusters, ...stops];
  }, [routeStops, routeClusters, focusedDay, hoveredDay, namedDay]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || markers.length === 0) return;

    let cancelled = false;
    let listener: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    import("cesium").then((Cesium) => {
      if (cancelled || viewer.isDestroyed()) return;
      const scene = viewer.scene;
      const ellipsoid = scene.globe.ellipsoid;

      // Everything below is preallocated and reused. This runs on `postRender`, and MapControls'
      // readout established the house rule: per-frame work writes straight to the DOM and
      // allocates nothing. A `new Cartesian3()` per stop per frame is ~500 short-lived objects a
      // second for one day of eight stops. The scene now renders on demand and caps at 60fps
      // (see GlobeBackground), so this fires only on frames where the camera actually moved —
      // but it still has to be allocation-free, because those are exactly the frames under load.
      const windowPos = new Cesium.Cartesian2();
      const surfaceNormal = new Cesium.Cartesian3();
      const toCamera = new Cesium.Cartesian3();
      const anchors = markers.map(() => new Cesium.Cartesian3());
      // Flat [x0, y0, x1, y1, …] of cards already given a slot this frame, for the separation
      // check — a flat array of numbers so the check costs no objects either.
      const placed = new Float64Array(markers.length * 2);

      // The anchor sits at the *top* of the stem, and the card is then shifted up by its own
      // height in CSS. Recomputed only when the route's altitude changes — which happens once,
      // when the height sample lands — rather than every frame.
      let anchoredAt = Number.NaN;

      // CSS pixels, to match worldToWindowCoordinates. Cached and refreshed on resize rather
      // than read inside the loop: `clientWidth` is a layout read, and the previous frame wrote
      // `transform` and `--marker-depth` to these same nodes, so reading it at the top of the
      // next frame forced a synchronous style-recalc/layout flush — once per frame, on a tree
      // carrying several large backdrop-filter surfaces. These numbers only change on resize.
      let viewWidth = scene.canvas.clientWidth;
      let viewHeight = scene.canvas.clientHeight;
      resizeObserver = new ResizeObserver(() => {
        viewWidth = scene.canvas.clientWidth;
        viewHeight = scene.canvas.clientHeight;
      });
      resizeObserver.observe(scene.canvas);

      listener = () => {
        const altitude = routeAltitudeRef.current;
        if (altitude !== anchoredAt) {
          markers.forEach((marker, i) => {
            Cesium.Cartesian3.fromDegrees(
              marker.lng,
              marker.lat,
              // A day badge floats higher than a stop name. It is anchored *on* the route now
              // rather than off to one side, so height is the only thing separating it from the
              // pins and arcs underneath — and it has to clear the arcs, which peak well above
              // the stems. See DAY_LABEL_LIFT_M.
              altitude + STEM_HEIGHT_M + (marker.kind === "cluster" ? DAY_LABEL_LIFT_M : 0),
              ellipsoid,
              anchors[i]
            );
          });
          anchoredAt = altitude;
        }

        const cameraPosition = scene.camera.positionWC;
        let placedCount = 0;

        for (let i = 0; i < markers.length; i++) {
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

          // A day badge is pulled back into frame rather than dropped. It names a *group*, not a
          // point, so a few pixels of drift costs nothing — while letting it leave the screen
          // costs the day its label entirely, which is exactly what hanging it out on the
          // circumradius made likely: the ring pushes labels away from the trip's centre, and
          // the camera is usually framed on that centre. A stop name gets no such treatment,
          // because it is a claim about one building and must stay on its own stem.
          if (markers[i].kind === "cluster") {
            projected.x = Math.min(
              Math.max(projected.x, CLUSTER_EDGE_MARGIN_PX),
              viewWidth - CLUSTER_EDGE_MARGIN_PX
            );
            projected.y = Math.min(
              Math.max(projected.y, CLUSTER_EDGE_MARGIN_PX),
              viewHeight - CLUSTER_EDGE_MARGIN_PX
            );
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

          // `transform`, `visibility` and this custom property. `--marker-depth` feeds `opacity`
          // on the title card, so each write invalidates style for that subtree — but the
          // resulting change is compositor-only, and the card no longer *transitions* it (when it
          // did, every frame restarted a 400ms fade on every card at once). It also used to drive
          // a `filter: blur()`, which gave every card its own render surface to re-raster on
          // every one of these writes; that is gone. See the comments in globals.css before
          // putting either back.
          // `translate(-50%, -100%)` puts the card's bottom edge on
          // the stem tip; the anchor's `transform-origin: bottom center` keeps it there through
          // the scale. `--marker-depth` is the same already-computed `scale` (0.55-1), handed to
          // the title card below via CSS inheritance so it can drive opacity for the
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
      resizeObserver?.disconnect();
      if (listener && !viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(listener);
      }
    };
  }, [markers, viewerRef, routeAltitudeRef, ready]);

  if (markers.length === 0) return null;

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
      // Set while any stop is pointed at, from either side — a marker card here or a row in the
      // panel, since both write the same context index. Everything that is *not* the pointed-at
      // card then recedes (see `.stop-marker-layer[data-focused]` in globals.css), so the name
      // being read is the only one competing for the eye. One attribute on the container rather
      // than a per-card prop: the rule is about the set, not about any one card.
      data-focused={(hoveredIndex ?? activeIndex) !== null ? "true" : undefined}
      className="stop-marker-layer pointer-events-none absolute inset-0 z-[5] overflow-hidden"
    >
      {markers.map((marker, i) => (
        <div
          key={marker.kind === "cluster" ? `day-${marker.day}` : `stop-${marker.flatIndex}`}
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
          {marker.kind === "cluster" ? (
            <button
              type="button"
              tabIndex={-1}
              className="marker-day-label pointer-events-auto"
              // The day's own colour, so the label and the route it names are obviously the
              // same thing. This is the one place a --route-day-* token leaves the globe
              // geometry, and it is still on the globe — never in a panel, chip or button.
              style={{ "--day-color": `var(${marker.colorToken})` } as CSSProperties}
              // The badge carries its day's standing, so a dimmed day's label recedes with the
              // route it names rather than staying bright over a route that has stepped back.
              data-day-state={marker.state}
              // Hovering a badge lifts that day out of the dim without touching the selection —
              // check Thursday, keep Tuesday. The same handler reveals its stop names.
              onMouseEnter={() => setHoveredDay(marker.day)}
              onMouseLeave={() => setHoveredDay(null)}
              onFocus={() => setHoveredDay(marker.day)}
              onBlur={() => setHoveredDay(null)}
              // Frames the day without touching the panel's selection. Reading a cluster on the
              // map and choosing which day the *plan* is showing are different intents, and
              // conflating them meant a stray click on the globe rewrote the panel under the
              // traveler.
              onClick={() => flyToPlace(marker.lat, marker.lng)}
            >
              {marker.label}
            </button>
          ) : (
            <button
              type="button"
              tabIndex={-1}
              // The layer is pointer-events-none so the globe stays draggable through the gaps
              // between cards; each card opts back in. See DESIGN.md's Pointer-Events Opt-In Rule.
              className="marker-title-card pointer-events-auto"
              // Drives the lift/glow via CSS, and is also what the itinerary panel sets remotely
              // when the pointer is on its matching row — one attribute, both directions.
              data-hovered={
                hoveredIndex === marker.flatIndex || activeIndex === marker.flatIndex
                  ? "true"
                  : undefined
              }
              onMouseEnter={() => setHoveredIndex(marker.flatIndex)}
              onMouseLeave={() => setHoveredIndex(null)}
              // Pointer events rather than mouse events would fire on touch too, where there is
              // no hover to speak of and a tap would leave the card stuck lit.
              onFocus={() => setHoveredIndex(marker.flatIndex)}
              onBlur={() => setHoveredIndex(null)}
              // No label passed, so this flies the camera without dropping the red search pin —
              // the card already names the place, and a pin plus a card is one label too many.
              onClick={() => {
                setActiveIndex(marker.flatIndex);
                flyToPlace(marker.lat, marker.lng);
              }}
            >
              {marker.name}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
