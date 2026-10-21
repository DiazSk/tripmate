// The package's `exports` hides this file, so it is read by path: the font's own name table.
import symbols from '../../node_modules/expo-symbols/build/android/symbols.json';

import { ANDROID_SYMBOL } from './symbol';

// A Material name the font does not have renders as an empty glyph, exactly as a missing one did.
test('every Android counterpart exists in the Material Symbols font', () => {
  const missing = Object.entries(ANDROID_SYMBOL).filter(([, android]) => !(android in symbols));
  expect(missing).toEqual([]);
});
