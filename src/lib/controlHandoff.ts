/**
 * Where a control was standing when it was pressed, so the control that replaces it *somewhere
 * else on screen* can fly in from there instead of appearing out of nowhere.
 *
 * One slot, module-level, deliberately. A hand-off is a single gesture — press a button here, the
 * same button takes up its post there — and there is no world in which two are in flight at once.
 * A `useRef` in a shared context would be the same single slot with a provider around it, and the
 * two ends of a hand-off are by definition in different subtrees, so there is no tree to hang it
 * on that is not the whole app.
 *
 * Why a rect rather than Framer's `layoutId`, which this codebase already uses for exactly this
 * kind of morph (`MapSearchPanel`): `layoutId` is symmetric, and this hand-off must not be. The
 * capsule it flies *from* is clipped — `.docked-panel` and `.docked-panel-capsule` both carry
 * `overflow-hidden`, and the collapsed panel's fold depends on it — so a return flight would spend
 * most of its path invisible and the rest sliding across the trip's own title. Departure animates;
 * the return is a cut. A rect is the only way to say that.
 */
let origin: { rect: DOMRect; at: number } | null = null;

/**
 * 400ms. Long enough for the press to reach a state update and a commit, short enough that a
 * hand-off nobody claimed — a story that failed to start, a panel that never opened — cannot
 * still be sitting here when some unrelated control mounts later and flies in from a stale corner
 * of a screen that has since changed.
 */
const HANDOFF_TTL_MS = 400;

/** Record where `el` is right now. Call it on the press, before the state change that unmounts it. */
export function markHandoffOrigin(el: HTMLElement | null) {
  origin = el ? { rect: el.getBoundingClientRect(), at: Date.now() } : null;
}

/** Read and clear the pending origin. `null` when there isn't one, or it has gone stale. */
export function takeHandoffOrigin(): DOMRect | null {
  const pending = origin;
  origin = null;
  if (!pending || Date.now() - pending.at > HANDOFF_TTL_MS) return null;
  return pending.rect;
}
