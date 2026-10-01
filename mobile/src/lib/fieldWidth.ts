/**
 * How wide the box behind a prefixed value is.
 *
 * **Only a prefixed field is sized to its content, and that is the whole point.** A plain field
 * fills the row and right-aligns, so its text ends at the column whatever its length. Put a `$` to
 * the left of that and the symbol is stranded at the far end of the row, a whole field away from
 * the number it belongs to — there is no gap to close, because the gap *is* the field.
 *
 * `ponytail:` a digit-width estimate rather than a measurement. `TextInput` does not report a
 * usable intrinsic width here — left to size itself it collapses toward its minimum and scrolls,
 * which shows the tail of a long value and nothing else. Estimating is sound for the only prefixed
 * field this app has, a numeric one, because digits share an advance width. If a prefixed *text*
 * field ever appears, measure with `onContentSizeChange` instead of widening this guess.
 *
 * **It lives here, outside `form.tsx`, because the estimate was wrong and nothing could say so.**
 * The constant below is a scale-1 number, and the width was computed from it alone — so at the
 * accessibility type sizes the digits grew and the box did not, and a budget of 2600 rendered as
 * `$ 260`. Nothing threw and nothing logged; the field simply showed a different number than the
 * one it held, which is the worst way for a form to be wrong. A component in this repo cannot be
 * tested — there is no renderer in the test setup (see `authGate.ts`) — so the arithmetic moved
 * to a module that can be, and `fieldWidth.test.ts` pins the scaling it was missing.
 */

/** The advance of one digit in the 16pt system sans the input is set in, at scale 1. */
export const DIGIT_WIDTH = 10;

/**
 * The ceiling `TextField` puts on the value through `maxFontSizeMultiplier`.
 *
 * Past it the glyphs stop growing, so the box must stop too — scaling on past the cap buys the
 * largest accessibility sizes a field of empty space and pushes `FieldRow` into stacking earlier
 * than the text actually needs.
 */
export const MAX_FONT_SCALE = 1.6;

export function prefixedWidth(value: string, placeholder: string | undefined, fontScale: number): number {
  // The placeholder's width while empty, so the box does not jump on the first keystroke. Three
  // characters is the floor once something is typed — a tap target, not a text width.
  const chars = value.length > 0 ? Math.max(value.length, 3) : (placeholder?.length ?? 4);
  return chars * DIGIT_WIDTH * Math.min(fontScale, MAX_FONT_SCALE);
}
