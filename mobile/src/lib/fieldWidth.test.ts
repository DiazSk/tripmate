import { DIGIT_WIDTH, MAX_FONT_SCALE, prefixedWidth } from './fieldWidth';

describe('prefixedWidth', () => {
  it('widens the box with the font scale', () => {
    // The defect this was extracted for: the box was a scale-1 constant, so at the type sizes
    // where the digits grow it kept its old width and "$ 2600" rendered as "$ 260". Nothing
    // threw, nothing logged — the number just read wrong.
    expect(prefixedWidth('2600', '2,600', 1.35)).toBeGreaterThan(prefixedWidth('2600', '2,600', 1));
  });

  it('stops widening where the text stops growing', () => {
    // `TextField` caps the value at `maxFontSizeMultiplier={1.6}`, so past that the glyphs do
    // not grow and neither should the box — otherwise the largest accessibility sizes buy a
    // field of empty space and push the row's label into stacking sooner than it needs to.
    expect(prefixedWidth('2600', '2,600', 3.1)).toBe(prefixedWidth('2600', '2,600', MAX_FONT_SCALE));
  });

  it('holds the placeholder’s width while empty, so the box does not jump on the first keystroke', () => {
    expect(prefixedWidth('', '2,600', 1)).toBe(5 * DIGIT_WIDTH);
  });

  it('keeps a three-character floor once something is typed', () => {
    // A tap target, not a text width: one digit must still be reachable by a thumb.
    expect(prefixedWidth('2', '2,600', 1)).toBe(3 * DIGIT_WIDTH);
  });

  it('falls back to four characters with no placeholder', () => {
    expect(prefixedWidth('', undefined, 1)).toBe(4 * DIGIT_WIDTH);
  });
});
