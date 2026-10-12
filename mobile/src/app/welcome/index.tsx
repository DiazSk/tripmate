import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { Meridian } from '@/components/meridian';
import { PrimaryButton } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Colors } from '@/constants/theme';

const PROMISES = ['Days paced the way you like them', 'Food that fits how you eat', "More of what you love, less of what you don't"];

export default function WelcomeIntro() {
  return (
    <WelcomeFrame step="welcome" cta={<><PrimaryButton title="Let's begin" onPress={() => router.push('/welcome/you')} /><Text style={styles.fine}>You can change any of this later on your Profile.</Text></>}>
      <Meridian state="idle" size={120} />
      <ThemedText type="display">Hi, I&apos;m your TripMate. Let&apos;s make every plan yours.</ThemedText>
      <ThemedText type="body" themeColor="muted">Five quick questions, about a minute. Each answer goes on your travel card, and every trip I plan reads it.</ThemedText>
      <View style={styles.promises}>
        {PROMISES.map((p) => (
          <View key={p} style={styles.promise}>
            <SymbolView name={{ ios: 'checkmark', android: 'check' }} tintColor={Colors.accent} size={14} fallback={<Text style={styles.tick}>+</Text>} />
            <Text style={styles.promiseText}>{p}</Text>
          </View>
        ))}
      </View>
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  promises: { gap: 10 },
  promise: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  promiseText: { color: Colors.muted, fontSize: 15, flex: 1 },
  tick: { color: Colors.accent, fontSize: 14 },
  fine: { color: Colors.muted, fontSize: 12, textAlign: 'center' },
});
