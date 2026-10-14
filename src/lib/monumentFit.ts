/**
 * How wide a city's name is, in ems of the monument's own face, so it can be sized to the measure.
 *
 * The monument (the Polar city name set across a screen's foot) was sized as `letters × 0.5em`. Oswald's
 * capitals are not that regular: measured in the browser at 400 with the monument's own -0.005em
 * tracking, `I` is 0.243em and `W` 0.724em, so a name's real average ran 0.41em (Val d'Orcia) to
 * 0.56em (Warsaw). Every name above 0.5 (Rome, Mumbai, Warsaw) overflowed and lost its last letter.
 * These are the face's own advances, summed: within ~1.5% of the rendered width (kerning), and the
 * margin below covers that.
 *
 * Shared with the Expo app (`@shared/monumentFit`), which draws the same Oswald 400.
 */
const OSWALD_400: Record<string, number> = {
  A: 0.487, B: 0.519, C: 0.51, D: 0.522, E: 0.402, F: 0.386, G: 0.53, H: 0.556, I: 0.243, J: 0.296,
  K: 0.49, L: 0.392, M: 0.655, N: 0.523, O: 0.534, P: 0.475, Q: 0.536, R: 0.514, S: 0.461, T: 0.408,
  U: 0.538, V: 0.5, W: 0.724, X: 0.477, Y: 0.476, Z: 0.412, " ": 0.224, "'": 0.122, "’": 0.122, "-": 0.298, ".": 0.183,
};
/** Anything not in the table (a digit, a letter outside Latin): as wide as the widest common capital. */
const UNKNOWN = 0.56;
/** Kerning moves a rendered name by up to ~1.5% either way against the summed advances. */
const MARGIN = 1.03;
/** A short name stops here, four average letters, so "Rome" fills its line without towering over it. */
const FLOOR = 2;

export function monumentEms(word: string): number {
  // Accents ride on the letter and do not widen it: Montréal is as wide as MONTREAL.
  const letters = [...word.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()];
  const ems = letters.reduce((sum, ch) => sum + (OSWALD_400[ch] ?? UNKNOWN), 0) * MARGIN;
  return Math.max(ems, FLOOR);
}
