import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GROUP_CHOICES } from '@shared/travelCard';

import { PrimaryButton } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Colors } from '@/constants/theme';
import { useWelcome } from '@/lib/welcomeDraft';

export default function WelcomeWho() {
  const { answers, set, react, save, busy, guard } = useWelcome();
  const next = () => guard(async () => { await save(); router.push('/welcome/rhythm'); });
  return (
    <WelcomeFrame step="who" cta={<PrimaryButton title="Continue" disabled={!answers.group} busy={busy} onPress={next} />}>
      <ThemedText type="display">Who&apos;s coming with you?</ThemedText>
      <ThemedText type="detail" themeColor="muted">Most of the time. You can change it for any trip.</ThemedText>
      <View style={styles.tiles}>
        {GROUP_CHOICES.map((g) => {
          const on = answers.group === g.id;
          return (
            <Pressable key={g.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { set({ group: g.id }); react(g.line); }} style={[styles.tile, on && styles.tileOn]}>
              <Text style={styles.tileTitle}>{g.title}</Text>
              <Text style={styles.tileHint}>{g.hint}</Text>
            </Pressable>
          );
        })}
      </View>
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorder, padding: 16, gap: 6 },
  tileOn: { borderColor: Colors.accent, backgroundColor: 'rgba(40,185,129,0.10)' },
  tileTitle: { color: Colors.foreground, fontSize: 16, fontWeight: '600' },
  tileHint: { color: Colors.muted, fontSize: 12.5 },
});
