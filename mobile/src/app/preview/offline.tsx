import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineScreen } from '@/components/offline-screen';

/**
 * The offline screen, with no network to lose. **`__DEV__` only**, like `preview/today.tsx`: it
 * returns null in a production bundle. Try again fails after a beat, as it would underground, unless
 * the pill says the next try gets through, which plays the screen's back-online moment and holds it. The trips it
 * lists are this simulator's real cache, so open a trip or two first.
 */
export default function OfflinePreview() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [nextGetsThrough, setNextGetsThrough] = useState(false);
  if (!__DEV__) return null;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineScreen
        onBack={router.canGoBack() ? router.back : undefined}
        retry={() =>
          new Promise((resolve) =>
            // Getting through commits nothing, so the back-online state stays up to be looked at.
            setTimeout(() => resolve(nextGetsThrough ? () => {} : null), 1200)
          )
        }
      />
      <Pressable
        onPress={() => setNextGetsThrough((v) => !v)}
        accessibilityRole="switch"
        accessibilityState={{ checked: nextGetsThrough }}
        style={[styles.pill, { top: insets.top + 8 }]}>
        <Text style={styles.pillText}>{nextGetsThrough ? 'Next try: gets through' : 'Next try: fails'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // A design-loop control, drawn plainly so nobody mistakes it for the screen's own.
  pill: {
    position: 'absolute',
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#9a9a9a',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  pillText: { fontSize: 11, color: '#3d3d3d' },
});
