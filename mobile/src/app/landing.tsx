import { CormorantGaramond_400Regular, CormorantGaramond_500Medium_Italic } from '@expo-google-fonts/cormorant-garamond';
import { InterTight_400Regular, InterTight_500Medium, InterTight_600SemiBold } from '@expo-google-fonts/inter-tight';
import { Oswald_400Regular } from '@expo-google-fonts/oswald';
import { useFonts } from 'expo-font';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { writeWelcomeSeen } from '@/api/session';

import { PolarLandingScreen } from '@/components/polar-landing/landing-screen';
import { Polar } from '@/constants/polar';

/**
 * `/landing` — the Polar Interior landing: the welcome a signed-out phone opens on once
 * (`launchTarget` in `lib/authGate.ts`, which adds `?welcome=1`), and the tour Profile opens after
 * that. Everything on it leads somewhere real: the wizard, prefilled where it can be, sign-in,
 * which it offers and never requires, or out to the app (Skip on the welcome, Close on the tour).
 *
 * **Seen as soon as it is shown.** The flag is written on mount, not on Skip, so somebody who
 * closes the app on the welcome opens on Home next time rather than on the welcome again.
 *
 * **Three of the six faces load here, not in the root layout.** The root already loads Polar's
 * display cut and the two figure cuts every screen uses; the italic, Inter Tight Regular and Oswald
 * belong to this one screen, and loading them at the root would hold every cold start behind files
 * no other screen draws. Re-listing the shared three is harmless — `useFonts` resolves a loaded
 * family at once. The root's rule still applies: nothing renders until they are in, because a
 * missing family is not an error in RN.
 */
export default function LandingRoute() {
  const { welcome } = useLocalSearchParams<{ welcome?: string }>();
  useEffect(() => {
    // A flag that cannot be written costs one more welcome, never a crash.
    writeWelcomeSeen(true).catch(() => {});
  }, []);
  const [loaded] = useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_500Medium_Italic,
    InterTight_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
    Oswald_400Regular,
  });

  return (
    <>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      {loaded ? <PolarLandingScreen welcome={welcome === '1'} /> : <View style={{ flex: 1, backgroundColor: Polar.night }} />}
    </>
  );
}
