import { Image } from 'expo-image';
import { Stack, ThemeProvider, router, usePathname, useTheme } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { onboardingNeeded } from '@/api/tripMateApi';
import { usePolarFonts, usePolarStatusBar } from '@/components/polar-ui';
import { Scrim } from '@/components/polar-landing/scrim';
import { Polar } from '@/constants/polar';
import { WelcomeDraftProvider } from '@/lib/welcomeDraft';

import graubunden from '@/assets/images/scenes/graubunden-autumn-valley.webp';
import jaipur from '@/assets/images/scenes/jaipur-amber-fort-elephant.webp';
import spice from '@/assets/images/scenes/spice-market-barrels.webp';
import tuscany from '@/assets/images/scenes/tuscany-cypress-road.webp';
import vernazza from '@/assets/images/scenes/vernazza-blue-hour.webp';
import wadiRum from '@/assets/images/scenes/wadi-rum-desert.webp';

/**
 * The welcome's seven pages, as the canvas design "Phone welcome · 2 Postcards at night".
 *
 * **Sign-in's ground, carried on.** Sign-up ends on Wadi Rum (`signin/_layout.tsx`), so the welcome
 * opens on it and closes on it; each question between is its own photograph, crossfaded by
 * `expo-image`'s `transition` as the page changes. The photograph sits behind the `Stack`, mounted
 * once, so the ground changes under the glass while the pages slide over it, exactly as sign-in's
 * steps do (`components/glass-auth.tsx` draws both).
 */
const SCENES: Record<string, number> = {
  welcome: wadiRum,
  you: vernazza,
  who: tuscany,
  rhythm: graubunden,
  matters: spice,
  home: jaipur,
  ready: wadiRum,
};

export default function WelcomeLayout() {
  const theme = useTheme();
  const fonts = usePolarFonts();
  usePolarStatusBar(false);
  const step = usePathname().split('/')[2] ?? 'welcome';
  // Already welcomed (or reached by a stray link): straight to Trips. Signed out: to sign in.
  // Unknown (offline): let it show.
  useEffect(() => {
    onboardingNeeded().then((needed) => {
      if (needed === false) router.replace('/(tabs)/trips');
      else if (needed === 'signed-out') router.replace('/signin');
    });
  }, []);
  return (
    <WelcomeDraftProvider>
      <View style={styles.root}>
        <Image source={SCENES[step] ?? wadiRum} style={StyleSheet.absoluteFill} contentFit="cover" transition={600} accessibilityIgnoresInvertColors />
        {/* Sign-in's scrim, a shade deeper at the foot where the answers gather. */}
        <Scrim stops={[[0, Polar.night, 0.6], [0.28, Polar.night, 0.12], [0.5, Polar.night, 0.4], [0.78, Polar.night, 0.9], [1, Polar.night, 0.96]]} />
        <ThemeProvider value={{ ...theme, colors: { ...theme.colors, background: 'transparent' } }}>
          {fonts ? (
            <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: 'transparent' } }}>
              <Stack.Screen name="index" options={{ gestureEnabled: false }} />
              <Stack.Screen name="ready" options={{ gestureEnabled: false }} />
            </Stack>
          ) : null}
        </ThemeProvider>
      </View>
    </WelcomeDraftProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Polar.night },
});
