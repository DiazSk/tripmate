import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ShareIntentProvider } from 'expo-share-intent';

import MelodramaRegular from '../../assets/fonts/Melodrama-Regular.ttf';
import TabularMedium from '../../assets/fonts/Tabular-Medium.ttf';
import TabularSemiBold from '../../assets/fonts/Tabular-SemiBold.ttf';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { APPEARANCE } from '@/constants/appearance';
import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

/**
 * `(tabs)` is the anchor, which is what puts Home *underneath* whatever a launch opens on.
 *
 * The root layout had none: `getRoutesCore` derives one from the first child group matching the
 * layout's own route name, and the root's route is `''`, so nothing matched and every cold-start
 * deep link landed as a single-entry stack with `canGoBack() === false`. That was survivable while
 * the app always opened on Home. It is not now that `+native-intent` can open on `signin`: the
 * escape out of that screen is a `back()`, and it needs somewhere to go.
 *
 * So the gated launch resolves to `[(tabs), signin]`. Home is mounted and visible behind the sheet,
 * "Keep planning without an account" has a target, and the sheet's own swipe-down dismiss *becomes*
 * that same escape for free. Cold-start `/trip/[id]` and `/share` get the same treatment, which is
 * why `share.tsx` can now `back()` out of itself instead of replacing the route under it.
 */
export const unstable_settings = { anchor: '(tabs)' };

// A Stack root, not the tab navigator directly: NativeTabs only ever mounts screens matching
// one of its own <NativeTabs.Trigger> names (expo-router/build/native-tabs/NativeBottomTabsNavigator.js
// passes useOnlyUserDefinedScreens=true to withLayoutContext), so a non-tab route like
// trip/[id] would have no screen slot anywhere in the tree if NativeTabs were the root layout —
// router.push('/trip/...') would silently no-op. The (tabs) group keeps that filtering scoped to
// just index/trips/profile, while trip/[id] mounts as an ordinary sibling Stack screen.
export default function RootLayout() {
  // Static cuts instanced from the Swift app's variable TTFs, each keyed by its own family name.
  // The keys here ARE the family names RN resolves, so they must match `Fonts` in constants/theme.
  const [fontsLoaded] = useFonts({
    'Melodrama-Regular': MelodramaRegular,
    'Tabular-Medium': TabularMedium,
    'Tabular-SemiBold': TabularSemiBold,
  });

  // **Nothing draws until the faces are in.** `useFonts` loads asynchronously, and a screen that
  // renders first gets the system fallback — silently, since a missing family is not an error in
  // RN. Deep-linking straight into a route on a cold start showed every Melodrama heading as
  // plain sans. The splash is still up at this point, so holding here costs nothing visible.
  if (!fontsLoaded) return null;

  // **The app's own preference, never the system scheme.** Kiln is one system with two
  // appearances and the reader picks; following the OS would hand somebody a light app the
  // moment their phone dimmed at dusk, on a surface whose whole argument is that it was
  // composed. `APPEARANCE` is resolved once at module load — see `constants/appearance.ts`.
  const light = APPEARANCE === 'light';
  return (
    <ShareIntentProvider>
      <ThemeProvider value={light ? DefaultTheme : DarkTheme}>
        {/* Without this, Android's forced edge-to-edge draws dark system icons over the near-black
            canvas and the clock and battery disappear into it — and the inverse under paper. */}
        <StatusBar style={light ? 'dark' : 'light'} />
        <AnimatedSplashOverlay />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: Colors.canvas },
            headerStyle: { backgroundColor: Colors.canvas },
            headerTintColor: Colors.foreground,
            headerTitleStyle: { color: Colors.foreground },
            headerShadowVisible: false,
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* The plan flow has its own Stack, which draws the per-step headers. */}
          <Stack.Screen name="plan" options={{ headerShown: false }} />
          {/* SPIKE ONLY — replaced in Task 5. */}
          <Stack.Screen name="share" options={{ presentation: 'modal', headerShown: false }} />
          {/* **Full screen, not a sheet — the screen was drawn for the whole device.** `signin`'s
              band is explicitly full-bleed so the photograph runs under the status bar, and in a
              sheet it cannot: the card is inset from the top and rounded, so the one screen that
              has to look expensive was showing a picture with the device's own canvas above it.

              The sheet was chosen because `unstable_settings` puts `(tabs)` underneath, making the
              swipe-down dismiss indistinguishable from choosing to keep planning without an
              account. That reasoning was sound and it cost more than it bought: a swipe nobody is
              told about was carrying half the escape, and the other half was muted grey body text
              that read as a caption. The escape is now a capsule that says what it does, so the
              gesture is not load-bearing and the screen can have the device.

              `leave()` already covers the cold-start case this raises — `canGoBack()` is false when
              `+native-intent` opens here directly, and it replaces to the tabs rather than trying
              to pop. Nothing is *gated* by this screen, which is the part that has always
              mattered. */}
          <Stack.Screen name="signin" options={{ presentation: 'fullScreenModal', headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </ShareIntentProvider>
  );
}
