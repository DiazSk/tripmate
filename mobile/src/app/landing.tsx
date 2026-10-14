import { CormorantGaramond_400Regular, CormorantGaramond_500Medium_Italic } from '@expo-google-fonts/cormorant-garamond';
import { InterTight_400Regular, InterTight_500Medium, InterTight_600SemiBold } from '@expo-google-fonts/inter-tight';
import { Oswald_400Regular } from '@expo-google-fonts/oswald';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { PolarLandingScreen } from '@/components/polar-landing/landing-screen';
import { Polar } from '@/constants/polar';

/**
 * `/landing` — the Polar Interior landing, and what a signed-out launch opens on (`launchTarget` in
 * `lib/authGate.ts`). Everything on it leads somewhere real: the wizard, prefilled where it can be,
 * or sign-in, which it offers and never requires.
 *
 * **Three of the six faces load here, not in the root layout.** The root already loads Polar's
 * display cut and the two figure cuts every screen uses; the italic, Inter Tight Regular and Oswald
 * belong to this one screen, and loading them at the root would hold every cold start behind files
 * no other screen draws. Re-listing the shared three is harmless — `useFonts` resolves a loaded
 * family at once. The root's rule still applies: nothing renders until they are in, because a
 * missing family is not an error in RN.
 */
export default function LandingRoute() {
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
      {loaded ? <PolarLandingScreen /> : <View style={{ flex: 1, backgroundColor: Polar.night }} />}
    </>
  );
}
