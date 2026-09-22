import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import MelodramaRegular from '../../assets/fonts/Melodrama-Regular.ttf';
import TabularMedium from '../../assets/fonts/Tabular-Medium.ttf';
import TabularSemiBold from '../../assets/fonts/Tabular-SemiBold.ttf';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

// A Stack root, not the tab navigator directly: NativeTabs only ever mounts screens matching
// one of its own <NativeTabs.Trigger> names (expo-router/build/native-tabs/NativeBottomTabsNavigator.js
// passes useOnlyUserDefinedScreens=true to withLayoutContext), so a non-tab route like
// trip/[id] would have no screen slot anywhere in the tree if NativeTabs were the root layout —
// router.push('/trip/...') would silently no-op. The (tabs) group keeps that filtering scoped to
// just index/memories/profile, while trip/[id] mounts as an ordinary sibling Stack screen.
export default function RootLayout() {
  // Static cuts instanced from the Swift app's variable TTFs, each keyed by its own family name.
  // The keys here ARE the family names RN resolves, so they must match `Fonts` in constants/theme.
  useFonts({
    'Melodrama-Regular': MelodramaRegular,
    'Tabular-Medium': TabularMedium,
    'Tabular-SemiBold': TabularSemiBold,
  });

  // Unconditionally dark. Kiln has one ground and no light variant, so reading the system scheme
  // could only ever produce a surface the design system does not define.
  return (
    <ThemeProvider value={DarkTheme}>
      {/* Without this, Android's forced edge-to-edge draws dark system icons over the near-black
          canvas and the clock and battery disappear into it. */}
      <StatusBar style="light" />
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
      </Stack>
    </ThemeProvider>
  );
}
