import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import {
  BAND_COLLAPSED,
  BAND_RATIO,
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
 * all. The `Stack` fills what is left, so a push slides the content under a picture that holds
 * still.
 *
 * The beat and the collapse live here because they are the flow's, not a screen's: the reel is
 * continuous across both, and the keyboard that collapses the band is raised on one of them.
 *
 * `/signin` still resolves — to `index` — so `lib/authGate.ts`'s `launchTarget`, its tests and the
 * root layout's `fullScreenModal` registration are all untouched.
 */
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

  const bandHeight =
    keyboardUp || fontScale > STACK_ABOVE_SCALE ? BAND_COLLAPSED : Math.round(height * BAND_RATIO);

  return (
    <View style={styles.root}>
      <SceneBand beat={beat} height={bandHeight} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.canvas } }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.canvas },
});
