import { router, Stack, ThemeProvider, useTheme } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import {
  BAND_RATIO,
  BEATS,
  DWELL_MS,
  SceneBand,
  SceneContext,
  SceneWindow,
  STACK_ABOVE_SCALE,
} from '@/components/scene-band';
import { PillButton } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { CLERK_PUBLISHABLE_KEY } from '@/lib/clerkConfig';

/**
 * The auth flow: a chooser, then a form, over one photograph.
 *
 * **The band is behind the `Stack`, and that is the whole reason this is a group.** Mounted once
 * here it survives the navigation between the two screens, so the reel keeps its place and the
 * photograph does not jump.
 *
 * **Each screen decides how much of it shows, and the `Stack` never resizes.** The two screens
 * need different amounts of room (`BAND_RATIO` / `BAND_RATIO_FORM` carry the arithmetic). This
 * used to hand the band each route's height from `usePathname()`, which resized the `Stack` on
 * every navigation, off the native transition's clock both ways: the form clipped through every
 * push and the chooser's photograph arrived ~300ms after every pop. `SceneBand`'s docblock has the
 * measurements and the arrangement that replaced it.
 *
 * The beat and the collapse live here because they are the flow's, not a screen's: the reel is
 * continuous across both, and the keyboard that collapses the band is raised on one of them.
 *
 * `/signin` still resolves — to `index` — so `lib/authGate.ts`'s `launchTarget`, its tests and the
 * root layout's `fullScreenModal` registration are all untouched.
 */
/**
 * The chooser sits beneath the form, always.
 *
 * Without this a deep link straight to `/signin/form` builds the group's stack as `[form]` alone,
 * and that screen is a dead end: no header (`headerShown: false` below), no back control, no
 * escape capsule — it moved to the chooser — and no swipe-down, because the root registers
 * `signin` as a `fullScreenModal`, which iOS does not make gesture-dismissible. `launchTarget`
 * passes every non-bare path through untouched, so the link is honoured rather than redirected,
 * and a visitor who landed there and did not want an account had to force-quit the app. With the
 * anchor, back always has the chooser — and its escape — underneath it.
 */
export const unstable_settings = { anchor: 'index' };

export default function AuthLayout() {
  const { fontScale } = useWindowDimensions();
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const [beat, setBeat] = useState(0);
  const [keyboardUp, setKeyboardUp] = useState(false);

  // The reel. Stopped outright under Reduce Motion rather than slowed: the beats are decoration
  // here, and the band's own `withTiming` already honours the setting.
  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setBeat((b) => (b + 1) % BEATS.length), DWELL_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  // `will`-prefixed on iOS so the band starts moving on the same frame as the keyboard rather
  // than after it has arrived; Android only emits the `did` pair.
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // The collapse outranks the route: whichever screen is up, the keyboard and the Dynamic Type
  // threshold take the room.
  const collapsed = keyboardUp || fontScale > STACK_ABOVE_SCALE;

  return (
    <SceneContext.Provider value={{ beat, collapsed }}>
      <View style={styles.root}>
        <SceneBand beat={beat} />
        {/* Transparent, so each screen's `SceneWindow` shows the band behind it. Each screen
            paints its own canvas below that. `contentStyle` alone is not enough: native-stack
            also paints the theme's background on the stack container itself unless its parent
            is a transparent modal, and this one sits in a `fullScreenModal`. */}
        <ThemeProvider value={{ ...theme, colors: { ...theme.colors, background: 'transparent' } }}>
          {/* Without a Clerk key the root layout mounts no `ClerkProvider`, and every screen here
              calls a Clerk hook that would throw. One guard at the group covers all of them. */}
          {CLERK_PUBLISHABLE_KEY ? (
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
          ) : (
            <KeylessNotice />
          )}
        </ThemeProvider>
      </View>
    </SceneContext.Provider>
  );
}

/** Same way out as the chooser's `leave()`: back if there is a back, Trips if there is not. */
function KeylessNotice() {
  return (
    <View style={styles.flex}>
      <SceneWindow ratio={BAND_RATIO} />
      <View style={styles.keyless}>
        <ThemedText type="title">Accounts aren&apos;t set up in this build yet.</ThemedText>
        <PillButton
          block
          tone="quiet"
          title="Keep planning without an account"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/trips'))}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.canvas },
  flex: { flex: 1 },
  // Opaque and below the band's window, like each real screen's `page`.
  keyless: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.read,
    paddingHorizontal: Spacing.read,
    backgroundColor: Colors.canvas,
  },
});
