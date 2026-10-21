import { CormorantGaramond_400Regular, CormorantGaramond_500Medium_Italic } from '@expo-google-fonts/cormorant-garamond';
import { InterTight_400Regular, InterTight_500Medium, InterTight_600SemiBold } from '@expo-google-fonts/inter-tight';
import { Oswald_400Regular } from '@expo-google-fonts/oswald';
import { useFonts } from 'expo-font';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { forwardRef, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { monumentEms } from '@shared/monumentFit';

import { SymbolView } from '@/components/symbol';
import { APPEARANCE } from '@/constants/appearance';
import { Polar, PolarFonts, PolarRadius, PolarSpace } from '@/constants/polar';

/**
 * The pieces the Polar arrival screens share: Sign in, Trips and Profile. The landing and the
 * plan-writing screen draw their own and predate these.
 */

/**
 * The three faces only the Polar screens draw. The root loads the display cut and the two Inter
 * Tight weights every screen uses; re-listing those is harmless, `useFonts` resolves a loaded
 * family at once. Nothing should render until this is true: a missing family is not an error in RN.
 */
export function usePolarFonts(): boolean {
  const [loaded] = useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_500Medium_Italic,
    InterTight_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
    Oswald_400Regular,
  });
  return loaded;
}

/**
 * White clock and battery over a photograph, dark over paper, and the app's own back on leaving.
 *
 * **Imperative and focus-scoped, not a mounted `<StatusBar>`.** Tab screens stay mounted, so a
 * mounted one on Trips would keep ruling the bar while Home is showing; and iOS resets the bar after
 * a modal without a mounted one ever re-asserting (the landing measured that). On blur it goes back
 * to what the root sets for the appearance.
 */
export function usePolarStatusBar(overPaper: boolean) {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(overPaper ? 'dark' : 'light', true);
      return () => setStatusBarStyle(APPEARANCE === 'light' ? 'dark' : 'light', true);
    }, [overPaper]),
  );
}

/**
 * The monument's size: the name across the measure at line-height 1, from Oswald's real widths
 * (`@shared/monumentFit`), capped so a short name does not tower.
 */
export const monumentFontSize = (word: string, measure: number, cap: number) => Math.min(cap, measure / monumentEms(word));

/** The one signal-orange action on a screen. */
export function SignalButton({
  title,
  onPress,
  busy = false,
  disabled = false,
  large = false,
  style,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  large?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.signal, large && styles.signalLg, pressed && styles.signalPressed, disabled && styles.signalOff, style]}>
      {busy ? <ActivityIndicator color={Polar.ink} /> : <Text style={styles.signalText}>{title}</Text>}
    </Pressable>
  );
}

/** A way to do the screen's job another way: ink, underlined, a 44pt target, no fill. */
export function QuietLink({
  title,
  onPress,
  light = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  light?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" hitSlop={4} style={({ pressed }) => [styles.quiet, (pressed || disabled) && styles.dim, style]}>
      <Text style={[styles.quietText, light && { color: Polar.ice }]}>{title}</Text>
    </Pressable>
  );
}

/** A labelled field on paper or ice: tracked caps above, a snow trough that turns signal on focus. */
export const PaperInput = forwardRef<TextInput, TextInputProps & { label: string; note?: string }>(function PaperInput(
  { label, note, style, onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {note ? <Text style={styles.labelNote}>{note}</Text> : null}
      </View>
      <TextInput
        ref={ref}
        placeholderTextColor={Polar.stone}
        keyboardAppearance="light"
        style={[styles.input, focused && styles.inputFocused, style]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...props}
      />
    </View>
  );
});

/** The house error line on paper: alert ink beside a rule, never a filled box. */
export function PaperError({ children }: { children: string }) {
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
      {children}
    </Text>
  );
}

/**
 * Plan a trip, as the + in Home's own bar: light glass by name. The Trips header's + is a plain bar
 * item instead, whose glass iOS 26 draws, light under the tabs' light theme (`(tabs)/_layout.tsx`);
 * this one would sit inside that glass as a second disc there.
 */
export function PlusButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Plan a trip" hitSlop={6} style={({ pressed }) => pressed && styles.plusPressed}>
      {isLiquidGlassAvailable() ? (
        <GlassView glassEffectStyle="regular" colorScheme="light" isInteractive style={styles.plus}>
          <SymbolView name="plus" size={18} tintColor={Polar.ink} weight="semibold" />
        </GlassView>
      ) : (
        <View style={[styles.plus, styles.plusFallback]}>
          <SymbolView name="plus" size={18} tintColor={Polar.ink} weight="semibold" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  plus: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  plusFallback: { backgroundColor: 'rgba(255,255,255,0.85)' },
  plusPressed: { opacity: 0.8 },
  signal: { minHeight: 46, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: PolarRadius.hairline, backgroundColor: Polar.signal },
  signalLg: { minHeight: 52 },
  signalPressed: { backgroundColor: Polar.signalPressed },
  signalOff: { opacity: 0.45 },
  signalText: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ink },
  quiet: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  dim: { opacity: 0.55 },
  quietText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink, textDecorationLine: 'underline' },
  field: { gap: 7 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontFamily: PolarFonts.sansSemi, fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', color: Polar.charcoal },
  labelNote: { fontFamily: PolarFonts.sans, fontSize: 11, color: Polar.charcoal },
  input: {
    minHeight: 46,
    paddingHorizontal: 13,
    borderRadius: PolarRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(31,42,68,0.15)',
    backgroundColor: Polar.snow,
    fontFamily: PolarFonts.sans,
    fontSize: 16,
    color: Polar.ink,
  },
  inputFocused: { borderColor: Polar.signal, backgroundColor: Polar.ice },
  error: {
    paddingVertical: 9,
    paddingHorizontal: PolarSpace.s3,
    borderLeftWidth: 2,
    borderLeftColor: Polar.alertText,
    backgroundColor: 'rgba(209,15,15,0.05)',
    fontFamily: PolarFonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: Polar.alertText,
  },
});
