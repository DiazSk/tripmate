/** The band's ceiling, and the sliver it never goes under — `scene-band.tsx`'s values. */
const CEILING = 0.58;
const FLOOR_PT = 132;

/**
 * The most photograph a sign-in screen can show while its stack still fits under it.
 *
 * Each screen's stack is a measured constant (see `STACK_PT` beside each caller). A fixed ratio
 * either clips the stack on a short phone or leaves paper under it on a tall one, so the band takes
 * what the stack leaves, capped at 0.58 and floored at the collapsed sliver. Taller content than
 * measured (an error, larger type) scrolls rather than clips.
 */
export function ratioToFit(windowHeight: number, stackPt: number): number {
  const fits = (windowHeight - stackPt) / windowHeight;
  return Math.max(FLOOR_PT / windowHeight, Math.min(CEILING, fits));
}
