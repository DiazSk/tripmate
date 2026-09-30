import { StyleSheet, Text, type TextProps } from 'react-native';

import { Colors, Fonts, type ThemeColor } from '@/constants/theme';

/**
 * The Kiln type scale, from `ios/TripMateKit/Sources/TripMateKit/Typography.swift`.
 *
 * Two RN-specific conversions are baked in at authoring time rather than computed:
 *
 * - **`letterSpacing` is px here, em there.** Each value below is `em × size` already resolved.
 *   Android divides it back out to an em ratio internally (`TextAttributes.kt`), so the round
 *   trip is exact at any font scale — but the number in this file must be px.
 * - **`lineHeight` is absolute here, a multiple there.** Each is `round(multiple × size)`.
 *
 * `label` is the only positive tracking in the system and the only uppercased step.
 */
export type KilnTextType =
  | 'display'
  | 'price'
  | 'title'
  | 'heading'
  | 'headingSmall'
  | 'bodyLarge'
  | 'body'
  | 'detail'
  | 'caption'
  | 'micro'
  | 'label'
  | 'money'
  | 'moneyLarge';

export type ThemedTextProps = TextProps & {
  type?: KilnTextType;
  themeColor?: ThemeColor;
};

/**
 * Melodrama is set larger than anything else and reflows rather than shrinks, so it takes a
 * tighter cap; uncapped at AX5 a two-word masthead becomes four lines. Everything else gets the
 * ordinary cap. Nothing is ever `allowFontScaling: false` — that is an accessibility regression,
 * not a simplification. Profile's native list deliberately does not use this component at all,
 * which is what leaves its Dynamic Type uncapped (see DESIGN.md's third boundary).
 */
const MAX_SCALE: Partial<Record<KilnTextType, number>> = {
  display: 1.3,
  price: 1.3,
};

export function ThemedText({
  style,
  type = 'body',
  themeColor = 'foreground',
  maxFontSizeMultiplier,
  ...rest
}: ThemedTextProps) {
  return (
    <Text
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_SCALE[type] ?? 1.6}
      style={[base, { color: Colors[themeColor] }, styles[type], style]}
      {...rest}
    />
  );
}

/**
 * `includeFontPadding: false` is Android-only (a no-op on iOS) and is not cosmetic: Android
 * defaults it true and pads each line box by the font's own ascent/descent *on top of*
 * `lineHeight`, which pulls the whole scale out of step with iOS and wrecks Melodrama at its
 * tight display leading. The display steps below carry >=1.08 leading to pay for it, so the
 * serif's descenders still have room once the padding is gone.
 */
const base = { includeFontPadding: false } as const;

const styles = StyleSheet.create({
  // Melodrama and Tabular carry NO fontWeight — each bundled cut is its own family, and asking
  // for a weight within it is exactly the Android lookup that silently falls back to Roboto.
  display: { fontFamily: Fonts.display, fontSize: 28, letterSpacing: -0.5, lineHeight: 30 },
  price: { fontFamily: Fonts.display, fontSize: 30, letterSpacing: -0.15, lineHeight: 32 },

  title: { fontFamily: Fonts.sans, fontSize: 22, fontWeight: '600', letterSpacing: -0.26, lineHeight: 25 },
  heading: { fontFamily: Fonts.sans, fontSize: 17, fontWeight: '600', letterSpacing: -0.2, lineHeight: 20 },
  headingSmall: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '600', letterSpacing: -0.18, lineHeight: 19 },
  bodyLarge: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 23 },
  body: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20 },
  detail: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19 },
  caption: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17 },
  micro: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 15 },
  /**
   * 11, which is what DESIGN.md has said all along.
   *
   * The ratified label step is `0.6875rem` — 11px — and this shipped at 10, a drift nobody
   * chose. At that size the tracked caps were the least legible thing in the app on the one
   * screen read outdoors at arm's length, and they head every section on it.
   *
   * **Tracking moves with the size, because the token is an em.** `--tracking-label` is 0.18em:
   * 1.8 was exactly that at 10px and would be 0.164em at 11, so it goes to 2. Getting this wrong
   * is the mistake DESIGN.md's Tracking-Is-A-Token rule exists to stop — tracking belongs to the
   * face and the size, so a size change invalidates the literal beside it.
   */
  label: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    lineHeight: 13,
    textTransform: 'uppercase',
  },

  money: { fontFamily: Fonts.money, fontSize: 13, lineHeight: 17 },
  moneyLarge: { fontFamily: Fonts.moneyBold, fontSize: 15, lineHeight: 20 },
});
