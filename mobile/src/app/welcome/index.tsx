import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { SymbolView } from '@/components/symbol';
import { Fine, PlainButton, SignalCapsule, leaveSignIn } from '@/components/glass-auth';
import { Meridian } from '@/components/meridian';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Polar } from '@/constants/polar';
import { useWelcome } from '@/lib/welcomeDraft';
import { Text } from '@/components/themed-text';

const PROMISES = ['Days paced the way you like them', 'Food that fits how you eat', "More of what you love, less of what you don't"];

export default function WelcomeIntro() {
  const { complete, busy, guard } = useWelcome();
  // The page's way out, which it lacked: the questions' Skip marks the welcome done (`complete(true)`)
  // and so does this, so it is not offered again; then back to whatever sign-up was opened from, or
  // Home. It does not go on to the travel card as Skip does, since there is nothing on it yet.
  const notNow = () =>
    guard(async () => {
      await complete(true);
      leaveSignIn();
    });
  return (
    <WelcomeFrame
      step="welcome"
      title="Hi, I'm your TripMate. Let's make every plan yours."
      cta={
        <>
          <SignalCapsule title="Let's begin" onPress={() => router.push('/welcome/you')} />
          <PlainButton title="Not now" onPress={notNow} disabled={busy} />
          <Fine>You can change any of this later on your Profile.</Fine>
        </>
      }>
      <Meridian state="idle" size={88} />
      <Text style={styles.lead}>Five quick questions, about a minute. Each answer goes on your travel card, and every trip I plan reads it.</Text>
      <View style={styles.promises}>
        {PROMISES.map((p) => (
          <View key={p} style={styles.promise}>
            <SymbolView name={{ ios: 'checkmark', android: 'check' }} tintColor={Polar.signal} size={14} weight="bold" />
            <Text style={styles.promiseText}>{p}</Text>
          </View>
        ))}
      </View>
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 17, lineHeight: 24, color: Polar.frost68 },
  promises: { gap: 8 },
  promise: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  promiseText: { flex: 1, fontSize: 15, color: 'rgba(255,255,255,0.86)' },
});
