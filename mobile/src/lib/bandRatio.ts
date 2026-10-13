/** The chooser's band ceiling, and the sliver it never goes under — `scene-band.tsx`'s values. */
const CEILING = 0.58;
const FLOOR_PT = 132;

/**
 * The most photograph the chooser can show while its stack still fits under it.
 *
 * Five actions on iOS (Apple, Google, Sign up, Log in, Keep planning) need ~470pt; a fixed ratio
 * either clips them on a short phone or leaves paper under the mark on a tall one. So the band
 * takes what the stack leaves, capped at the old 0.58 and floored at the collapsed sliver.
 */
export function chooserRatio(windowHeight: number, stackPt: number): number {
  const fits = (windowHeight - stackPt) / windowHeight;
  return Math.max(FLOOR_PT / windowHeight, Math.min(CEILING, fits));
}
