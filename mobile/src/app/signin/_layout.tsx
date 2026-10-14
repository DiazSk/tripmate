import { Image } from 'expo-image';
import { Stack, ThemeProvider, useTheme } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { leaveSignIn } from '@/components/boarding-pass';
import { QuietLink, usePolarFonts, usePolarStatusBar } from '@/components/polar-ui';
import { Scrim } from '@/components/polar-landing/scrim';
import { Polar, PolarFonts, PolarSpace } from '@/constants/polar';
import { CLERK_PUBLISHABLE_KEY } from '@/lib/clerkConfig';

import wadiRum from '@/assets/images/scenes/wadi-rum-desert.webp';

/**
 * The auth flow, as the web's boarding pass: Wadi Rum at night behind one ice pass. The pass is the
 * form (`index`), and the code step (`code`) is the same pass at its last stage.
 *
 * **The photograph is behind the `Stack`, and that is the whole reason this is a group.** Mounted
 * once here it survives the push to the code step, so the ground does not jump.
 *
 * `/signin` still resolves to `index`, so `lib/authGate.ts`'s `launchTarget`, its tests and the
 * root layout's `fullScreenModal` registration are untouched.
 */
export const unstable_settings = { anchor: 'index' };

export default function AuthLayout() {
  const theme = useTheme();
  const fonts = usePolarFonts();
  usePolarStatusBar(false);

  return (
    <View style={styles.root}>
      <Image source={wadiRum} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      {/* The web's radial veil, as a vertical one: dark at the edges the pass does not cover. */}
      <Scrim stops={[[0, Polar.night, 0.7], [0.35, Polar.night, 0.35], [0.7, Polar.night, 0.45], [1, Polar.night, 0.85]]} />
      {/* Transparent, so each screen shows the ground behind it. `contentStyle` alone is not
          enough: native-stack also paints the theme's background on the container itself. */}
      <ThemeProvider value={{ ...theme, colors: { ...theme.colors, background: 'transparent' } }}>
        {!fonts ? null : CLERK_PUBLISHABLE_KEY ? (
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
        ) : (
          // Without a Clerk key the root mounts no `ClerkProvider`, and every screen here calls a
          // Clerk hook that would throw. One guard at the group covers all of them.
          <KeylessNotice />
        )}
      </ThemeProvider>
    </View>
  );
}

function KeylessNotice() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.keyless, { paddingTop: insets.top + PolarSpace.s5, paddingBottom: insets.bottom + PolarSpace.s5 }]}>
      <View style={styles.plain}>
        <Text style={styles.title}>Accounts aren&apos;t set up</Text>
        <Text style={styles.lead}>Accounts aren&apos;t set up in this build yet. You can keep planning without one.</Text>
        <QuietLink title="Back to planning" onPress={leaveSignIn} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Polar.night },
  keyless: { flex: 1, justifyContent: 'center', paddingHorizontal: PolarSpace.pad },
  plain: { gap: PolarSpace.s2, padding: PolarSpace.s5, borderRadius: 6, backgroundColor: Polar.ice },
  title: { fontFamily: PolarFonts.display, fontSize: 32, lineHeight: 34, color: Polar.ink },
  lead: { fontFamily: PolarFonts.sans, fontSize: 14, lineHeight: 21, color: Polar.charcoal },
});
