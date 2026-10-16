import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Polar, PolarFonts } from '@/constants/polar';
import { clerkMessage } from '@/lib/clerkError';

/**
 * Sign-in as the canvas design "Phone auth · 3 Glass over the night": no card and no pass, the
 * desert (`signin/_layout.tsx`) is the screen and every control is glass laid straight on it, in
 * capsules. The words sit high in the landing's face; the controls gather at the foot, in the
 * thumb's reach, and ride up on the keyboard together.
 *
 * **Liquid Glass where the system has it, a blur where it does not.** `GlassView` is iOS 26's own
 * material and renders nothing of itself below it, so older iOS and Android get `BlurView` with a
 * frost fill, which is what the design's web drawing approximated.
 *
 * **The face is the system's except for the title.** Cormorant carries the brand; the fields,
 * buttons and small print are SF, so they read as the phone's own controls.
 */

const LIQUID = isLiquidGlassAvailable();

/** Out, without a cost: back if there is a back, Trips if there is not (a cold start can open
 *  here with nothing behind it, since `+native-intent` launches straight onto sign-in). */
export function leaveSignIn() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/trips');
}

/**
 * `ring` is the focus or error outline. It is drawn as its own layer over the glass because Liquid
 * Glass ignores a border set on the glass view itself: the ring was there in the style and absent
 * on screen.
 */
export function Glass({ style, ring, children }: { style?: StyleProp<ViewStyle>; ring?: string | null; children?: ReactNode }) {
  const outline = ring ? (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, { borderRadius: StyleSheet.flatten(style)?.borderRadius, borderColor: ring }]} />
  ) : null;
  if (LIQUID) {
    return (
      <GlassView glassEffectStyle="regular" colorScheme="dark" style={style}>
        {children}
        {outline}
      </GlassView>
    );
  }
  return (
    <BlurView intensity={40} tint="dark" style={[styles.blur, style]}>
      {children}
      {outline}
    </BlurView>
  );
}

type SymbolName = SymbolViewProps['name'];

function Icon({ name, size = 18, color = Polar.ice }: { name: SymbolName; size?: number; color?: string }) {
  return <SymbolView name={name} size={size} tintColor={color} weight="medium" />;
}

/**
 * One step: the top bar (back, how far, close), the headline high, the controls low. Steps are
 * screens in the group's stack, so moving on is a native push and back is the edge swipe.
 *
 * The welcome after sign-up is the same frame over its own photographs, so sign-up and the
 * questions after it read as one flow: it passes `count` for its five questions and swaps the close
 * for its Skip (`trailing`), and its `sub` is your TripMate's line rather than a sentence.
 */
export function GlassStep({
  step,
  count = 3,
  title,
  sub,
  trailing,
  children,
}: {
  step?: number;
  count?: number;
  title: string;
  sub?: ReactNode;
  /** What sits top right. Sign-in's close by default. */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.flex}>
      <View style={[styles.top, { paddingTop: insets.top + 2 }]}>
        {router.canGoBack() && step ? (
          <RoundButton icon="chevron.left" label="Back" onPress={() => router.back()} />
        ) : (
          <Text style={styles.mark}>TripMate</Text>
        )}
        {step ? <Dots step={step} count={count} /> : <View />}
        <View style={styles.topEnd}>{trailing === undefined ? <RoundButton icon="xmark" label="Not now" onPress={leaveSignIn} /> : trailing}</View>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 12 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {typeof sub === 'string' ? <Text style={styles.sub}>{sub}</Text> : sub ? <View style={styles.subRow}>{sub}</View> : null}
          <View style={styles.controls}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

export function RoundButton({ icon, label, onPress }: { icon: SymbolName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={({ pressed }) => pressed && styles.pressed}>
      <Glass style={styles.round}>
        <Icon name={icon} size={16} />
      </Glass>
    </Pressable>
  );
}

/** Sign-in is three steps at most (the address, then the password or the account, then a code); the
 *  welcome is five questions. */
function Dots({ step, count }: { step: number; count: number }) {
  return (
    <Glass style={styles.dots}>
      <View style={styles.dotsRow} accessible accessibilityLabel={`Step ${step} of ${count}`}>
        {Array.from({ length: count }, (_, i) => i + 1).map((i) => (
          <View key={i} style={[styles.dot, i < step && styles.dotPast, i === step && styles.dotOn]} />
        ))}
      </View>
    </Glass>
  );
}

/** A capsule field: glass, 54pt, an SF Symbol leading, the signal ring while it has the keyboard. */
export const GlassField = forwardRef<TextInput, TextInputProps & { icon: SymbolName; invalid?: boolean; trailing?: ReactNode }>(function GlassField(
  { icon, invalid, trailing, onFocus, onBlur, style, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <Glass style={[styles.capsule, styles.field]} ring={invalid ? Polar.alertNight : focused ? Polar.signal : null}>
      <Icon name={icon} color={Polar.frost68} />
      <TextInput
        ref={ref}
        placeholderTextColor="rgba(255,255,255,0.45)"
        selectionColor={Polar.signal}
        keyboardAppearance="dark"
        style={[styles.input, style]}
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
      {trailing}
    </Glass>
  );
});

/** A password field with its show/hide eye. `fresh` asks iOS for a new, strong one. */
export const PasswordField = forwardRef<TextInput, TextInputProps & { fresh?: boolean; invalid?: boolean }>(function PasswordField(
  { fresh, ...props },
  ref,
) {
  const [shown, setShown] = useState(false);
  return (
    <GlassField
      ref={ref}
      icon="lock"
      placeholder={fresh ? 'New password' : 'Password'}
      secureTextEntry={!shown}
      autoCapitalize="none"
      autoCorrect={false}
      // Which of the two this is, or iOS proposes a new password on a sign-in.
      autoComplete={fresh ? 'new-password' : 'current-password'}
      textContentType={fresh ? 'newPassword' : 'password'}
      passwordRules={fresh ? 'minlength: 15;' : undefined}
      trailing={
        <Pressable onPress={() => setShown((v) => !v)} accessibilityRole="button" accessibilityLabel={shown ? 'Hide password' : 'Show password'} hitSlop={8} style={styles.eye}>
          <Icon name={shown ? 'eye.slash' : 'eye'} color={Polar.frost68} />
        </Pressable>
      }
      {...props}
    />
  );
});

/** The one signal-orange action, as a capsule. */
export function SignalCapsule({ title, onPress, busy = false, disabled = false }: { title: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      style={({ pressed }) => [styles.capsule, styles.signal, disabled && styles.signalOff, pressed && styles.signalPressed]}>
      {busy ? <ActivityIndicator color={Polar.ink} /> : <Text style={styles.signalText}>{title}</Text>}
    </Pressable>
  );
}

/** A glass capsule button, for every action that is not the one. */
export function GlassButton({ title, icon, onPress, busy = false, small = false }: { title: string; icon?: SymbolName; onPress: () => void; busy?: boolean; small?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityState={{ busy }} style={({ pressed }) => [small && styles.flex, pressed && styles.pressed]}>
      <Glass style={[styles.capsule, styles.button, small && styles.buttonSmall]}>
        {busy ? (
          <ActivityIndicator color={Polar.ice} />
        ) : (
          <>
            {icon ? <Icon name={icon} /> : null}
            <Text style={[styles.buttonText, small && styles.buttonTextSmall]}>{title}</Text>
          </>
        )}
      </Glass>
    </Pressable>
  );
}

/** Text, no fill: "Not now", "Send a new code". */
export function PlainButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => [styles.plain, pressed && styles.pressed]}>
      <Text style={[styles.plainText, disabled && styles.plainOff]}>{title}</Text>
    </Pressable>
  );
}

/** The line under a field: Clerk's error when there is one, else the hint. */
export function Note({ error, children }: { error?: string | null; children?: ReactNode }) {
  if (error) {
    return (
      <Text style={[styles.note, styles.noteError]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        {error}
      </Text>
    );
  }
  return children ? <Text style={styles.note}>{children}</Text> : null;
}

/** The small print at the foot of the first step. */
export function Fine({ children }: { children: string }) {
  return <Text style={styles.fine}>{children}</Text>;
}

/** Two buttons side by side. */
export function Pair({ children }: { children: ReactNode }) {
  return <View style={styles.pair}>{children}</View>;
}

/**
 * One Clerk step, its error shown and the chain stopped on failure. Every screen in the flow runs
 * its calls through this, so a thrown error and a returned one read the same.
 */
export function useClerkStep() {
  const [error, setError] = useState<string | null>(null);
  async function step(run: () => Promise<{ error?: unknown } | void>): Promise<boolean> {
    try {
      const result = await run();
      if (result && result.error) {
        setError(clerkMessage(result.error));
        return false;
      }
      return true;
    } catch (err) {
      setError(clerkMessage(err));
      return false;
    }
  }
  return { error, setError, step };
}

export const glassText = StyleSheet.create({
  strong: { fontWeight: '600', color: Polar.ice },
  ok: { color: '#30D158' },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  blur: { overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.10)' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  topEnd: { minWidth: 44, alignItems: 'flex-end' },
  mark: { minWidth: 44, fontFamily: PolarFonts.condensed, fontSize: 17, letterSpacing: 2.7, textTransform: 'uppercase', color: Polar.ice },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dots: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  dotsRow: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotPast: { backgroundColor: 'rgba(255,255,255,0.85)' },
  dotOn: { width: 20, backgroundColor: Polar.signal },
  body: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 26 },
  title: { fontFamily: PolarFonts.display, fontSize: 44, lineHeight: 46, color: Polar.ice },
  sub: { marginTop: 10, fontSize: 15, lineHeight: 21, color: Polar.frost68 },
  subRow: { marginTop: 12 },
  controls: { gap: 10, marginTop: 'auto', paddingTop: 24 },
  capsule: { height: 54, borderRadius: 27, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  field: { justifyContent: 'flex-start', gap: 10, paddingLeft: 18, paddingRight: 8 },
  ring: { borderWidth: 1.5 },
  input: { flex: 1, height: '100%', fontSize: 17, color: Polar.ice },
  eye: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  signal: { height: 52, borderRadius: 26, backgroundColor: Polar.signal },
  signalPressed: { backgroundColor: Polar.signalPressed, transform: [{ scale: 0.98 }] },
  // Waiting on an answer, as the welcome's Continue does until one is chosen.
  signalOff: { opacity: 0.4 },
  signalText: { fontSize: 17, fontWeight: '600', color: Polar.ink },
  button: { height: 50, borderRadius: 25, gap: 8 },
  buttonSmall: { height: 44, borderRadius: 22 },
  buttonText: { fontSize: 17, fontWeight: '600', color: Polar.ice },
  buttonTextSmall: { fontSize: 15 },
  plain: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  plainText: { fontSize: 16, fontWeight: '600', color: Polar.ice },
  plainOff: { color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
  note: { marginHorizontal: 8, fontSize: 13, lineHeight: 18, color: Polar.frost68 },
  noteError: { color: Polar.alertNight },
  fine: { textAlign: 'center', fontSize: 12.5, lineHeight: 17, color: 'rgba(255,255,255,0.55)' },
  pair: { flexDirection: 'row', gap: 10 },
});
