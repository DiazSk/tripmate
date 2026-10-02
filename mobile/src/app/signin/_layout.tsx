import { Stack, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import {
  BAND_RATIO,
  BAND_RATIO_FORM,
  BEATS,
  DWELL_MS,
  SceneBand,
  STACK_ABOVE_SCALE,
} from '@/components/scene-band';
import { Colors } from '@/constants/theme';

/**
 * The auth flow: a chooser, then a form, under one band.
 *
 * **The band is outside the `Stack`, and that is the whole reason this is a group.** Mounted once
 * here it survives the navigation between the two screens, so the reel keeps its place and the
 * photograph does not jump — which is the only argument for the form screen keeping a band at
 * all. The `Stack` fills what is left, so a push slides the content under a picture that is
 * still the same picture.
 *
 * **Its identity holds across a push; its height does not, and that is deliberate.** This used
 * to say the picture "holds still", and one ratio served both screens — but the two screens need
 * different amounts of room, and sign up needs so much more that a single number either clips its
 * button or leaves ~95pt of paper under the chooser's mark. So the height is per-route
 * (`BAND_RATIO` / `BAND_RATIO_FORM`, which carry the arithmetic) and animates on the curve the
 * keyboard collapse already uses. What that original rule was protecting is intact: no remount,
 * no restarted reel, no different photograph on the other side.
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
  const { height, fontScale } = useWindowDimensions();
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

  // The form carries more below the fold than the chooser does, so it gets a shorter band.
  const onForm = usePathname().startsWith('/signin/form');
  const bandHeight = Math.round(height * (onForm ? BAND_RATIO_FORM : BAND_RATIO));
  // And the collapse outranks the route: whichever screen is up, the keyboard and the Dynamic
  // Type threshold take the room. `SceneBand` eases this one and applies the height above
  // directly — see its `bandStyle` for why only one of the two is animated.
  const collapsed = keyboardUp || fontScale > STACK_ABOVE_SCALE;

  return (
    <View style={styles.root}>
      <SceneBand beat={beat} height={bandHeight} collapsed={collapsed} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.canvas } }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.canvas },
});
