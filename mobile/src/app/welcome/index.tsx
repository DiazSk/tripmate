import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { Fine, SignalCapsule } from '@/components/glass-auth';
import { Meridian } from '@/components/meridian';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Polar } from '@/constants/polar';

const PROMISES = ['Days paced the way you like them', 'Food that fits how you eat', "More of what you love, less of what you don't"];

export default function WelcomeIntro() {
  return (
    <WelcomeFrame
      step="welcome"
      title="Hi, I'm your TripMate. Let's make every plan yours."
      cta={
        <>
          <SignalCapsule title="Let's begin" onPress={() => router.push('/welcome/you')} />
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
