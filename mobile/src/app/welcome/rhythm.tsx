import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { CROWD_CHOICES, PACE_CHOICES } from '@shared/travelCard';

import { ChoiceRow, PrimaryButton, Question } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Colors, dayCore } from '@/constants/theme';
import { useWelcome } from '@/lib/welcomeDraft';

export default function WelcomeRhythm() {
  const { answers, set, react, save, busy, guard } = useWelcome();
  const pace = PACE_CHOICES.find((p) => p.id === (answers.pace ?? 'balanced'))!;
  const next = () => guard(async () => {
    const a = { ...answers, pace: answers.pace ?? 'balanced', crowds: answers.crowds ?? 'mixed' };
    set(a);
    await save(a);
    router.push('/welcome/matters');
  });
  return (
    <WelcomeFrame step="rhythm" cta={<PrimaryButton title="Continue" busy={busy} onPress={next} />}>
      <ThemedText type="display">Find your rhythm.</ThemedText>
      <Question title="Pace">
        <ChoiceRow value={pace.id} options={PACE_CHOICES.map((p) => ({ value: p.id, label: p.label }))} onChange={(id) => { set({ pace: id }); react(PACE_CHOICES.find((p) => p.id === id)!.line); }} />
      </Question>
      <View style={styles.day}>
        <Text style={styles.dayHead}>A DAY, YOUR WAY · {pace.times.length} STOPS</Text>
        <View style={styles.track}>
          {pace.times.map((t, i) => (
            <View key={t} style={styles.stop}><View style={[styles.dot, { backgroundColor: dayCore(i) }]} /><Text style={styles.time}>{t}</Text></View>
          ))}
        </View>
      </View>
      <Question title="Crowds">
        <ChoiceRow value={answers.crowds ?? 'mixed'} options={CROWD_CHOICES.map((c) => ({ value: c.id, label: c.label }))} onChange={(id) => { set({ crowds: id }); react(CROWD_CHOICES.find((c) => c.id === id)!.line); }} />
      </Question>
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  day: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.cardBorder, padding: 14, gap: 12 },
  dayHead: { color: Colors.muted, fontSize: 10.5, fontWeight: '600', letterSpacing: 1.6 },
  track: { flexDirection: 'row', justifyContent: 'space-between' },
  stop: { alignItems: 'center', gap: 6 },
  dot: { width: 13, height: 13, borderRadius: 7 },
  time: { color: Colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
});
