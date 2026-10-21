import { DefaultTheme, ThemeProvider, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Appearance } from 'react-native';

import AppTabs from '@/components/app-tabs';

/**
 * The tabs are paper, so while they are showing the window runs in the light trait, and the
 * system draws their chrome for paper: the tab bar's Liquid Glass and its labels, the Trips search
 * bar, keyboards. On iOS 26 the glass tab bar follows the trait and ignores the appearance props
 * (`blurEffect`, `backgroundColor`, label and icon colours measured no different in the dark
 * trait), so the trait is the lever. `Appearance.setColorScheme` is React Native's stable API for
 * it (it sets `overrideUserInterfaceStyle` on the app's windows). Scoped to this layout's focus:
 * a trip, the planner or sign-in pushed over the tabs blurs it, and `unspecified` hands those
 * night screens back to the app's own dark appearance (`userInterfaceStyle` in app.json).
 *
 * **The light theme too, for the stacks inside the tabs.** A native stack's bar takes its trait
 * from the navigation theme (`useHeaderConfigProps` turns `theme.dark` into the bar's
 * `userInterfaceStyle`), not from the window, and the root runs `DarkTheme`. Under it the Trips
 * bar stayed night over paper: a white placeholder and magnifier on a pale search field, and a
 * dark glass disc behind any bar button.
 */
export default function TabLayout() {
  useFocusEffect(
    useCallback(() => {
      Appearance.setColorScheme('light');
      return () => Appearance.setColorScheme('unspecified');
    }, []),
  );
  return (
    <ThemeProvider value={DefaultTheme}>
      <AppTabs />
    </ThemeProvider>
  );
}
