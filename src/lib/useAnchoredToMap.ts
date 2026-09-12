"use client";

import { useEffect } from "react";
import { anchorCard, type ClearRect } from "@/lib/cardAnchor";
import { panelLeftEdgePx, type MapRenderer, type ScreenPoint } from "@/lib/mapRenderer";

/**
 * Pin a DOM node to a world coordinate, and keep it there while the camera moves.
 *
 * `StopMarkerLayer` already does this for every stop in a trip; this is the same mechanism at n=1,
 * and the discipline it inherits is the interesting part rather than the projection:
 *
 * - **The node is written to directly, never through React.** A `setState` per frame would re-render
 *   a card full of text sixty times a second to move it a few pixels. The position is a style, so
 *   it is set as one.
 * - **One preallocated `ScreenPoint`.** `project` fills it rather than returning a new object, by
 *   contract, so a frame allocates nothing.
 * - **Viewport dimensions and the itinerary panel's edge are cached and refreshed on resize.**
 *   Both are layout reads, and `StopMarkerLayer` records what happens when one is done inside the
 *   loop: reading `clientWidth` per frame forces a layout flush per frame.
 * - **`onFrame` fires only on frames where the camera moved** — that is the contract — so a still
 *   map costs nothing at all.
 *
 * Returns nothing. The caller gives it a ref and a place, and the node goes where the place is.
 */
export function useAnchoredToMap(
  nodeRef: React.RefObject<HTMLElement | null>,
  rendererRef: React.RefObject<MapRenderer | null>,
  point: { lat: number; lng: number } | null,
  ready: boolean,
  /** The left edge of the clear area — the search panel's right edge when it is open. */
  clearLeftPx: number
) {
  useEffect(() => {
    const renderer = rendererRef.current;
    const node = nodeRef.current;
    if (!renderer?.isAlive() || !node) return;

    const projected: ScreenPoint = { x: 0, y: 0 };
    let view = { width: 0, height: 0 };
    let rightEdge = 0;
    // `navHeight` is read once: the bar's height is a token, not a thing that moves.
    const navHeight =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 56;

    const measure = () => {
      const canvas = renderer.canvas();
      if (!canvas) return;
      view = { width: canvas.clientWidth, height: canvas.clientHeight };
      rightEdge = panelLeftEdgePx(true, view.width);
    };
    measure();

    const observer = new ResizeObserver(measure);
    const canvas = renderer.canvas();
    if (canvas) observer.observe(canvas);

    // Cheap enough to keep the node's last state around rather than writing the same string every
    // frame — the same `lastOpacity` discipline `StopMarkerLayer` uses to avoid redundant writes.
    let lastHidden: boolean | null = null;

    const hide = () => {
      if (lastHidden === true) return;
      lastHidden = true;
      node.style.visibility = "hidden";
    };

    const place = () => {
      if (!point || !view.width) return hide();
      renderer.project(point.lat, point.lng, 0, projected);
      const rect: ClearRect = {
        left: clearLeftPx,
        right: rightEdge,
        top: navHeight + 16,
        bottom: view.height - 16,
      };
      const spot = anchorCard(
        projected,
        { width: node.offsetWidth, height: node.offsetHeight },
        rect
      );
      if (!spot) return hide();
      node.style.transform = `translate3d(${spot.x}px, ${spot.y}px, 0)`;
      node.style.setProperty("--tail-x", `${spot.tailX}px`);
      node.dataset.side = spot.above ? "above" : "below";
      if (lastHidden !== false) {
        lastHidden = false;
        node.style.visibility = "visible";
      }
    };

    place();
    const unsubscribe = renderer.onFrame(place);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
    // `point` is a dependency, so clicking a different pin re-subscribes and repositions
    // immediately. That matters because `onFrame` fires only when the camera *moves*: reading the
    // point through a ref instead would leave the card sitting on the previous pin until something
    // happened to nudge the map, which on a still map is never.
  }, [nodeRef, rendererRef, ready, point, clearLeftPx]);
}
