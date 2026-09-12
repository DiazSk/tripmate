/**
 * Where a card anchored to a map pin actually goes.
 *
 * Pure arithmetic, in its own module and with no imports, for one reason: it is the part of an
 * anchored card that fails *silently*. A hit test that breaks is obvious — nothing opens. Geometry
 * that breaks just looks slightly wrong on some screens at some pan positions, which nobody files
 * and everybody notices. So it is separated from the DOM writes and tested directly, and the
 * component that uses it holds no arithmetic at all.
 *
 * The frame is CSS pixels, origin at the viewport's top-left, which is what `MapRenderer.project`
 * returns.
 */

/** A box the card must stay inside — the map minus whatever is covering it. */
export interface ClearRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CardPlacement {
  /** Top-left of the card, for a `translate3d`. */
  x: number;
  y: number;
  /**
   * Where the tail sits along the card's own width, in pixels from its left edge.
   *
   * This is what keeps a clamped card honest. When the pin is near an edge the card stops following
   * it, and without a tail that keeps pointing, the card reads as floating near nothing in
   * particular rather than as belonging to the dot under it.
   */
  tailX: number;
  /** True when the card sits above its pin — the default — false when it had to flip below. */
  above: boolean;
}

/**
 * How close to the clear rect's edge the projected pin may get before the card is withdrawn.
 *
 * `MapRenderer.project` on MapLibre **never returns false** — there is no horizon cull, and with a
 * pitch of up to 85° a point behind the camera still projects to a number. This margin is therefore
 * the only guard there is, not a refinement of one.
 */
export const OFFSCREEN_MARGIN_PX = 160;

/** Distance from the pin to the card's near edge, leaving room for the tail. */
const TAIL_GAP_PX = 14;
/** How near the card's own corner the tail may be pushed before it stops reading as a pointer. */
const TAIL_INSET_PX = 22;

const clamp = (value: number, low: number, high: number) =>
  // `low` wins a crossed range: a clear rect narrower than the card means there is nowhere good,
  // and pinning to the left edge is the readable failure. `Math.min(Math.max())` the other way
  // round would put the card off the left of the screen instead.
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Place a card against a projected pin, or refuse.
 *
 * Returns `null` when the pin is far enough outside the clear rect that a card would be pointing at
 * something nobody can see. Otherwise the card is **clamped** into the rect rather than hidden —
 * a card that vanishes while you pan is worse than one that stops tracking for the last few pixels,
 * because the traveller reads the disappearance as having lost the place.
 *
 * Only the vertical axis flips. Horizontal flipping would swap which side of the pin the card sits
 * on mid-pan, which reads as the card jumping; clamping plus a tail that keeps pointing covers the
 * same ground without the jump.
 */
export function anchorCard(
  pin: { x: number; y: number },
  card: { width: number; height: number },
  clear: ClearRect
): CardPlacement | null {
  const outside =
    pin.x < clear.left - OFFSCREEN_MARGIN_PX ||
    pin.x > clear.right + OFFSCREEN_MARGIN_PX ||
    pin.y < clear.top - OFFSCREEN_MARGIN_PX ||
    pin.y > clear.bottom + OFFSCREEN_MARGIN_PX;
  if (outside) return null;

  // Above the pin by default: a card below covers the ground the traveller is heading toward, and
  // the pin's own label already sits below the dot.
  const wantedAboveY = pin.y - TAIL_GAP_PX - card.height;
  const above = wantedAboveY >= clear.top;
  const y = above ? wantedAboveY : pin.y + TAIL_GAP_PX;

  const x = clamp(pin.x - card.width / 2, clear.left, clear.right - card.width);
  const tailX = clamp(pin.x - x, TAIL_INSET_PX, card.width - TAIL_INSET_PX);

  return {
    x: Math.round(x),
    // Clamped after flipping, so a card taller than the clear rect lands at the top rather than
    // above it. The flip decides which side of the pin; this decides that it stays on screen.
    y: Math.round(clamp(y, clear.top, clear.bottom - card.height)),
    tailX: Math.round(tailX),
    above,
  };
}
