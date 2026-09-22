import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

SplashScreen.preventAutoHideAsync();

// A Stack root, not the tab navigator directly: NativeTabs only ever mounts screens matching
// one of its own <NativeTabs.Trigger> names (expo-router/build/native-tabs/NativeBottomTabsNavigator.js
// passes useOnlyUserDefinedScreens=true to withLayoutContext), so a non-tab route like
// trip/[id] would have no screen slot anywhere in the tree if NativeTabs were the root layout —
// router.push('/trip/...') would silently no-op. The (tabs) group keeps that filtering scoped to
// just index/memories/profile, while trip/[id] mounts as an ordinary sibling Stack screen.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
