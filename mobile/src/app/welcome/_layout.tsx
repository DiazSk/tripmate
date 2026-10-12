import { Stack, router } from 'expo-router';
import { useEffect } from 'react';

import { onboardingNeeded } from '@/api/tripMateApi';
import { WelcomeDraftProvider } from '@/lib/welcomeDraft';

/** The welcome's seven pages, one route each so the native back gesture works between them. */
export default function WelcomeLayout() {
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
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" options={{ gestureEnabled: false }} />
        <Stack.Screen name="ready" options={{ gestureEnabled: false }} />
      </Stack>
    </WelcomeDraftProvider>
  );
}
