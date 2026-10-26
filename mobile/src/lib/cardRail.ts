/**
 * Which card a snapping horizontal rail is resting on, from how far it has scrolled.
 *
 * `step` is one card plus the gap after it — the same figure the rail snaps to — so a rail at rest
 * is always a whole number of steps in, and one mid-drag rounds to whichever card is more than
 * half on screen. Clamped both ends: iOS lets a rail overscroll past its first and last card, and
 * a bounce must not focus a card that does not exist.
 */
export function activeCard(offsetX: number, step: number, count: number): number {
  if (count <= 0 || !(step > 0)) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offsetX / step)));
}
