import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ShareIntentProvider } from 'expo-share-intent';
import { StatusBar } from 'react-native';

import { CormorantGaramond_400Regular } from '@expo-google-fonts/cormorant-garamond';
import { InterTight_500Medium, InterTight_600SemiBold } from '@expo-google-fonts/inter-tight';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { APPEARANCE } from '@/constants/appearance';
import { ClerkBridge } from '@/components/clerk-bridge';
import { SettingsColors } from '@/components/settings-list';
import { Colors } from '@/constants/theme';
import { CLERK_PUBLISHABLE_KEY } from '@/lib/clerkConfig';

SplashScreen.preventAutoHideAsync();

/**
 * `(tabs)` is the anchor, which is what puts Home *underneath* whatever a launch opens on.
 *
 * The root layout had none: `getRoutesCore` derives one from the first child group matching the
 * layout's own route name, and the root's route is `''`, so nothing matched and every cold-start
 * deep link landed as a single-entry stack with `canGoBack() === false`. That was survivable while
 * the app always opened on Home. It is not now that `+native-intent` can open somewhere else: a
 * first signed-out launch opens on the welcome (`/landing?welcome=1`), and the escapes out of it and
 * out of sign-in need somewhere to go.
 *
 * So the welcome launch resolves to `[(tabs), landing]`: Skip has a Home to dismiss to, and the
 * planner or sign-in that replaces the landing closes onto Home. Cold-start `/trip/[id]` and
 * `/share` get the same treatment, which is why `share.tsx` can `back()` out of itself instead of
 * replacing the route under it.
 */
export const unstable_settings = { anchor: '(tabs)' };

type ScreenOptions = React.ComponentProps<typeof Stack.Screen>['options'];

const TRIP_SHEETS = ['budget', 'add', 'chat'] as const;

const TRIP_SHEET_OPTIONS: ScreenOptions = {
  presentation: 'formSheet',
  sheetAllowedDetents: [0.55, 1],
  sheetGrabberVisible: true,
  sheetCornerRadius: 24,
  headerShown: false,
  contentStyle: { backgroundColor: Colors.canvas },
};

/** The dev previews (`__DEV__` only, each returns null in a release bundle), with what each draws. */
const PREVIEWS: [string, ScreenOptions][] = [
  ['offline', { headerShown: false }],
  ['share', { headerShown: false }],
  ['writing', { headerShown: false }],
  ['ask', { title: '' }],
  ['today', { title: 'Today: preview' }],
];

// A Stack root, not the tab navigator directly: NativeTabs only ever mounts screens matching
// one of its own <NativeTabs.Trigger> names (expo-router/build/native-tabs/NativeBottomTabsNavigator.js
// passes useOnlyUserDefinedScreens=true to withLayoutContext), so a non-tab route like
// trip/[id] would have no screen slot anywhere in the tree if NativeTabs were the root layout —
// router.push('/trip/...') would silently no-op. The (tabs) group keeps that filtering scoped to
// just index/trips/profile, while trip/[id] mounts as an ordinary sibling Stack screen.
/**
 * The app's default status bar, set once, before anything renders.
 *
 * Without it Android's forced edge-to-edge draws dark system icons over the near-black canvas and
 * the clock and battery disappear into it. **Imperative, not a mounted `<StatusBar>`:** a mounted
 * one re-applies its style whenever it mounts or re-renders, which raced every screen's own
 * focus-scoped call (`usePolarStatusBar`): measured on a OnePlus 9R, Home opened on a cold start
 * with a white clock on paper (the root mounted after Home's effect), and expo-status-bar's version
 * re-rendered on the tabs' `Appearance.setColorScheme('light')` and did the same to Trips and
 * Profile. iOS 26 ignores the style and follows the content, which is why none of it showed there.
 */
StatusBar.setBarStyle(APPEARANCE === 'light' ? 'dark-content' : 'light-content');

export default function RootLayout() {
  // Polar's faces, one static cut per family name as @expo-google-fonts registers them. The keys
  // here ARE the family names RN resolves, so they must match `Fonts` in constants/theme.
  const [fontsLoaded] = useFonts({
    CormorantGaramond_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
  });

  // **Nothing draws until the faces are in.** `useFonts` loads asynchronously, and a screen that
  // renders first gets the system fallback — silently, since a missing family is not an error in
  // RN. Deep-linking straight into a route on a cold start showed every Melodrama heading as
  // plain sans. The splash is still up at this point, so holding here costs nothing visible.
  if (!fontsLoaded) return null;

  // **The app's own preference, never the system scheme.** Polar is one system with two
  // appearances and the reader picks; following the OS would hand somebody a light app the
  // moment their phone dimmed at dusk, on a surface whose whole argument is that it was
  // composed. `APPEARANCE` is resolved once at module load — see `constants/appearance.ts`.
  const light = APPEARANCE === 'light';
  const tree = (
    <ShareIntentProvider>
      <ThemeProvider value={light ? DefaultTheme : DarkTheme}>
        <AnimatedSplashOverlay />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: Colors.canvas },
            headerStyle: { backgroundColor: Colors.canvas },
            headerTintColor: Colors.foreground,
            headerTitleStyle: { color: Colors.foreground },
            headerShadowVisible: false,
            // A chevron, never the previous screen's title: a screen without one (a preview, a
            // route mid-load) otherwise lends its raw route name to the back button.
            headerBackButtonDisplayMode: 'minimal',
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* **Every route is declared here, with options that stand on their own.** A route
              that only sets its options from inside its own render has none until that render runs,
              and pushed in a modal's context (the landing deep-linked while sign-in was up) it drew
              the default header: the raw route name, "landing", over the photograph. */}
          <Stack.Screen name="landing" options={{ headerShown: false, animation: 'fade' }} />
          {/* The trip names its own title once the trip is loaded; until then, an empty bar. */}
          <Stack.Screen name="trip/[id]" options={{ title: '' }} />
          {PREVIEWS.map(([name, options]) => (
            <Stack.Screen key={name} name={`preview/${name}`} options={options} />
          ))}
          {/* The plan flow has its own Stack, which draws the per-step headers. It rises as a
              full-screen modal, like sign-in and the welcome, because it closes with an ×. */}
          <Stack.Screen name="plan" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          {/* Share to TripMate: a form sheet at about half height over wherever it landed, so getting
              back to what you were doing is one swipe; it rises when there are many places. */}
          <Stack.Screen
            name="share"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.6, 1],
              sheetGrabberVisible: true,
              sheetCornerRadius: 24,
              headerShown: false,
              contentStyle: { backgroundColor: SettingsColors.ground },
            }}
          />
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
          {/* How it works: Apple's "What's New" sheet over Home, full height with a grabber. */}
          <Stack.Screen
            name="how-it-works"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [1],
              sheetGrabberVisible: true,
              sheetCornerRadius: 34,
              headerShown: false,
              contentStyle: { backgroundColor: SettingsColors.ground },
            }}
          />
          {/* The trip's sheets: native form sheets at the planner's detents, over the trip, on its
              night. Routes rather than RN Modals, for the detents and grabber; `lib/tripSheets.ts`
              says how they read the trip screen's state. */}
          {TRIP_SHEETS.map((name) => (
            <Stack.Screen key={name} name={`trip/[id]/${name}`} options={TRIP_SHEET_OPTIONS} />
          ))}
          {/* A trip somebody sent you: its cover runs under the status bar, so no header. */}
          <Stack.Screen name="s/[token]" options={{ headerShown: false }} />
          <Stack.Screen name="signin" options={{ presentation: 'fullScreenModal', headerShown: false }} />
          {/* New accounts only: sign-up replaces itself with this, and sign-in never opens it. */}
          <Stack.Screen name="welcome" options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }} />
        </Stack>
      </ThemeProvider>
    </ShareIntentProvider>
  );

  // No key, no Clerk: the app runs signed-out only (see `lib/clerkConfig.ts`).
  if (!CLERK_PUBLISHABLE_KEY) return tree;
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkBridge />
      {tree}
    </ClerkProvider>
  );
}
