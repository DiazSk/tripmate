import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShareSheet, type SharedThing, type ShareState } from '@/components/share-sheet';

/**
 * Share to TripMate with no share behind it. **`__DEV__` only**, like `preview/writing.tsx`: the real
 * screen needs a share intent from another app, and it writes the places it finds to saved places.
 * `tripmate://preview/share` plays a TikTok read for four Lisbon places; the pills switch to
 * screenshots, an Instagram reel, or a read or save that fails.
 */
const PLACES = ['Time Out Market', 'Pastéis de Belém', 'Miradouro da Senhora do Monte', 'A Cevicheria'];
const THINGS: Record<string, SharedThing> = {
  tiktok: { label: 'A TikTok', icon: { ios: 'play.rectangle', android: 'smart_display' } },
  shots: { label: '3 screenshots', icon: { ios: 'photo.on.rectangle', android: 'image' } },
  insta: { label: 'An Instagram post', icon: { ios: 'camera', android: 'photo_camera' } },
};
type Mode = 'tiktok' | 'shots' | 'insta' | 'readFail' | 'saveFail';

export default function SharePreview() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('tiktok');
  const [state, setState] = useState<ShareState>({ kind: 'reading', found: [] });
  const [run, setRun] = useState(0);
  // Back to reading on every switch, set where the switch happens rather than in the effect.
  const restart = (next: Mode) => {
    setState({ kind: 'reading', found: [] });
    setMode(next);
    setRun((n) => n + 1);
  };
  useEffect(() => {
    const t = setTimeout(() => {
      if (mode === 'readFail') return setState({ kind: 'importFailed' });
      if (mode === 'saveFail') return setState({ kind: 'saveFailed', names: PLACES });
      if (mode === 'insta') return setState({ kind: 'done', names: [], city: null, reminders: 1, truncated: false, unread: [] });
      setState({ kind: 'done', names: PLACES, city: 'Lisbon', reminders: 0, truncated: false, unread: mode === 'shots' ? ['One screenshot was too blurry to read.'] : [] });
    }, 1600);
    return () => clearTimeout(t);
  }, [mode, run]);
  if (!__DEV__) return null;
  return (
    // Full screen here, so it clears the status bar the real form sheet sits below.
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ShareSheet
        shared={THINGS[mode] ?? THINGS.tiktok}
        state={state}
        onRetry={() => restart(mode)}
        onDone={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        onPlan={(city) => router.replace({ pathname: '/plan/basics', params: { destination: city } })}
      />
      <View style={styles.modes}>
        {(['tiktok', 'shots', 'insta', 'readFail', 'saveFail'] as const).map((m) => (
          <Pressable key={m} onPress={() => restart(m)} style={[styles.pill, m === mode && styles.on]}>
            <Text style={[styles.pillText, m === mode && styles.onText]}>{m}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F2F2F7' },
  modes: { position: 'absolute', bottom: 40, left: 8, right: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center' },
  pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: '#0E1118CC' },
  on: { backgroundColor: '#1F2A44' },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  onText: { color: '#FF7E15' },
});
