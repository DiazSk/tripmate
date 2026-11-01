import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { CROWD_CHOICES, PACE_CHOICES } from '@shared/travelCard';

import { Glass, SignalCapsule } from '@/components/glass-auth';
import { GlassChoice, GlassHeading, GlassSegment, WelcomeFrame, welcomeGlass } from '@/components/welcome-frame';
import { Polar } from '@/constants/polar';
import { dayCore } from '@/constants/theme';
import { useWelcome } from '@/lib/welcomeDraft';
import { Text } from '@/components/themed-text';

export default function WelcomeRhythm() {
  const { answers, set, react, save, busy, guard } = useWelcome();
  const pace = PACE_CHOICES.find((p) => p.id === (answers.pace ?? 'balanced'))!;
  const next = () =>
    guard(async () => {
      const a = { ...answers, pace: answers.pace ?? 'balanced', crowds: answers.crowds ?? 'mixed' };
      set(a);
      await save(a);
      router.push('/welcome/matters');
    });
  return (
    <WelcomeFrame step="rhythm" title="Find your rhythm." cta={<SignalCapsule title="Continue" busy={busy} onPress={next} />}>
      <GlassHeading>Pace</GlassHeading>
      <GlassSegment
        label="Pace"
        value={pace.id}
        options={PACE_CHOICES.map((p) => ({ value: p.id, label: p.label }))}
        onChange={(id) => {
          set({ pace: id });
          react(PACE_CHOICES.find((p) => p.id === id)!.line);
        }}
      />
      {/* The day a pace makes, so the choice is a picture rather than an adjective. */}
      <Glass style={styles.day}>
        <Text style={styles.dayHead}>{`A day, your way · ${pace.times.length} stops`}</Text>
        <View style={styles.track}>
          {pace.times.map((t, i) => (
            <View key={t} style={styles.stop}>
              <View style={[styles.dot, { backgroundColor: dayCore(i) }]} />
              <Text style={styles.time}>{t}</Text>
            </View>
          ))}
        </View>
      </Glass>
      <GlassHeading>Crowds</GlassHeading>
      <View style={welcomeGlass.stack} accessibilityRole="radiogroup" accessibilityLabel="Crowds">
        {CROWD_CHOICES.map((c) => (
          <GlassChoice
            key={c.id}
            wide
            title={c.label}
            on={(answers.crowds ?? 'mixed') === c.id}
            onPress={() => {
              set({ crowds: c.id });
              react(c.line);
            }}
          />
        ))}
      </View>
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  day: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  dayHead: { fontSize: 11, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase', color: Polar.frost68 },
  track: { flexDirection: 'row', justifyContent: 'space-between' },
  stop: { alignItems: 'center', gap: 6 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  time: { fontSize: 12, fontVariant: ['tabular-nums'], color: Polar.frost68 },
});
