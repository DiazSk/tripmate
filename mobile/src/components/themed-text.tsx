import { createContext, useContext, type ReactNode } from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
  useWindowDimensions,
} from 'react-native';

import { Colors, FontScale, Fonts, type ThemeColor } from '@/constants/theme';

/**
 * The cap of the text this one is nested in. A nested span with no size of its own takes its
 * parent's size, so it must take its parent's cap too — on Fabric a child's
 * `maxFontSizeMultiplier` overrides the parent's, and a 1.6 span inside a 1.3 masthead would grow
 * past the words around it.
 */
const CapContext = createContext<number | null>(null);

const capForSize = (size: number | undefined) =>
  size !== undefined && size >= FontScale.displayFrom ? FontScale.display : FontScale.body;

/**
 * `react-native`'s `Text`, with `FontScale`'s cap applied when the call site gives none. Import this
 * rather than the platform's, and new text is capped without anyone remembering to — see `FontScale`.
 */
/**
 * The system text size, for `Text` to key its native node on.
 *
 * **A live Dynamic Type change left every text that did not re-render drawn at the new size inside
 * the frame measured for the old one**: day chips read "TUI", "WEI", buttons "Directi", headings cut
 * at the top and bottom, until the app was relaunched. Fabric keeps a text's measured layout until
 * its props change, and a size change is not a prop. Keying on the scale re-creates each text node,
 * which is re-measured, while navigation and every screen's state stay where they were. One
 * listener at the root rather than one per text.
 */
const ScaleContext = createContext(1);

export function FontScaleRoot({ children }: { children: ReactNode }) {
  const { fontScale } = useWindowDimensions();
  return <ScaleContext.Provider value={fontScale}>{children}</ScaleContext.Provider>;
}

export function Text({ maxFontSizeMultiplier, ...props }: TextProps & { ref?: React.Ref<NativeText> }) {
  const scale = useContext(ScaleContext);
  const parent = useContext(CapContext);
  const size = StyleSheet.flatten(props.style)?.fontSize;
  const cap = maxFontSizeMultiplier ?? (size === undefined && parent !== null ? parent : capForSize(size));
  return (
    <CapContext.Provider value={cap}>
      <NativeText key={scale} {...props} maxFontSizeMultiplier={cap} />
    </CapContext.Provider>
  );
}
// The instance type under the same name, so `useRef<Text>` keeps working after the import swap.
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Text = NativeText;

/** The same for inputs: what somebody types is read text, so it takes `body` unless told otherwise. */
export function TextInput({
  maxFontSizeMultiplier,
  ...props
}: TextInputProps & { ref?: React.Ref<NativeTextInput> }) {
  const size = StyleSheet.flatten(props.style)?.fontSize;
  return <NativeTextInput {...props} maxFontSizeMultiplier={maxFontSizeMultiplier ?? capForSize(size)} />;
}
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type TextInput = NativeTextInput;

/**
 * The Kiln type scale, carried over from the earlier SwiftUI client.
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
  display: FontScale.display,
  price: FontScale.display,
};

export function ThemedText({
  style,
  type = 'body',
  themeColor = 'foreground',
  maxFontSizeMultiplier,
  ...rest
}: ThemedTextProps) {
  const cap = maxFontSizeMultiplier ?? MAX_SCALE[type] ?? FontScale.body;

  /**
   * **No leading rule of our own: React Native already scales `lineHeight`.** On iOS the explicit
   * `lineHeight` is multiplied by the same effective font multiplier as the size, capped by
   * `maxFontSizeMultiplier` (`RCTAttributedTextUtils.mm`, `RCTEffectiveFontSizeMultiplier…`), and
   * Android reads it in sp. This component once multiplied it by `fontScale` again, which at AX3
   * gave every line ~1.6² its leading. Clipping seen after switching text size on a running sim is
   * stale layout: relaunch the app before judging Dynamic Type.
   */
  return (
    <Text
      maxFontSizeMultiplier={cap}
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

const TYPE = {
  // Melodrama and Tabular carry NO fontWeight — each bundled cut is its own family, and asking
  // for a weight within it is exactly the Android lookup that silently falls back to Roboto.
  display: { fontFamily: Fonts.display, fontSize: 28, letterSpacing: -0.5, lineHeight: 30 },
  price: { fontFamily: Fonts.display, fontSize: 30, letterSpacing: -0.15, lineHeight: 32 },

  title: { fontFamily: Fonts.sans, fontSize: 22, fontWeight: '600', letterSpacing: -0.26, lineHeight: 25 },
  heading: { fontFamily: Fonts.sans, fontSize: 18, fontWeight: '600', letterSpacing: -0.22, lineHeight: 21 },
  headingSmall: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '600', letterSpacing: -0.19, lineHeight: 20 },
  // `bodyLarge` is gone: at a 16 floor it was byte-identical to `body`.
  body: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 23 },
  detail: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 16 },
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

  money: { fontFamily: Fonts.money, fontSize: 14, lineHeight: 18 },
  moneyLarge: { fontFamily: Fonts.moneyBold, fontSize: 16, lineHeight: 21 },
} as const;

const styles = StyleSheet.create(TYPE);
