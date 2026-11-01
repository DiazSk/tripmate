import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { STEP_LINES, readyLine, type WelcomeStep } from '@shared/travelCard';

import { SymbolView } from '@/components/symbol';
import { Glass, GlassStep } from '@/components/glass-auth';
import { Meridian } from '@/components/meridian';
import { Polar } from '@/constants/polar';
import { useWelcome } from '@/lib/welcomeDraft';
import { Text } from '@/components/themed-text';

const QUESTIONS: WelcomeStep[] = ['you', 'who', 'rhythm', 'matters', 'home'];

/**
 * Every welcome page's shell, as the canvas design "Phone welcome · 2 Postcards at night": sign-in's
 * `GlassStep` over the page's photograph (`welcome/_layout.tsx`), with the five questions as its
 * dots and Skip where sign-in has its close. The question is the headline, your TripMate's line sits
 * under it, and the answers gather at the foot with the button, in the thumb's reach.
 *
 * The travel card is not on these pages any more. It is handed over whole on the last one, the way
 * the design ends; mid-flow it was a strip of half-filled card above every question.
 */
export function WelcomeFrame({ step, title, children, cta }: { step: WelcomeStep; title: string; children?: ReactNode; cta: ReactNode }) {
  const { answers, line: said, lineStep, cheer, save, complete, busy, guard } = useWelcome();
  const index = QUESTIONS.indexOf(step);
  // A reaction belongs to the page it was said on; the next page opens on its own prompt.
  const line = lineStep === step ? said : null;

  const skip = () =>
    guard(async () => {
      if (['who', 'rhythm', 'matters', 'home'].includes(step)) await save();
      await complete(true);
      router.push('/welcome/ready');
    });

  return (
    <GlassStep
      step={index >= 0 ? index + 1 : undefined}
      count={QUESTIONS.length}
      title={title}
      trailing={
        index >= 0 ? (
          <Pressable onPress={skip} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }} hitSlop={6} style={({ pressed }) => pressed && styles.pressed}>
            <Glass style={styles.skip}>
              <Text style={styles.skipText}>Skip</Text>
            </Glass>
          </Pressable>
        ) : null
      }
      sub={
        step === 'welcome' ? undefined : (
          <View style={styles.host}>
            <Meridian state={cheer ? 'success' : 'idle'} size={26} />
            <Text style={[styles.line, line ? styles.lineSaid : null]} accessibilityLiveRegion="polite">
              {line ?? (step === 'ready' ? readyLine(answers.name) : STEP_LINES[step as keyof typeof STEP_LINES])}
            </Text>
          </View>
        )
      }>
      {children}
      <View style={styles.cta}>{cta}</View>
    </GlassStep>
  );
}

/**
 * One answer, as a glass tile: the title, a hint under it, white when chosen. `wide` is a row for a
 * list of three; otherwise two share a line, as the who-comes-along page lays four.
 */
export function GlassChoice({ title, hint, on, onPress, wide = false }: { title: string; hint?: string; on: boolean; onPress: () => void; wide?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={hint ? `${title}. ${hint}` : title}
      style={({ pressed }) => [wide ? styles.wide : styles.half, pressed && styles.pressed]}>
      {on ? (
        <View style={[styles.tile, wide && styles.tileWide, styles.tileOn]}>
          <Text style={[styles.tileTitle, styles.inkText]}>{title}</Text>
          {hint ? <Text style={[styles.tileHint, styles.inkSoft]}>{hint}</Text> : null}
        </View>
      ) : (
        <Glass style={[styles.tile, wide && styles.tileWide]}>
          <Text style={styles.tileTitle}>{title}</Text>
          {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
        </Glass>
      )}
    </Pressable>
  );
}

/** A glass chip. `badge` is a pick's order (1 to 3); `tick` marks a multi-select without one. */
export function GlassChip({ title, on, badge, tick, onPress, accessibilityLabel }: { title: string; on: boolean; badge?: number; tick?: boolean; onPress: () => void; accessibilityLabel?: string }) {
  const inner = (
    <>
      {on && badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      {on && tick ? <SymbolView name={{ ios: 'checkmark', android: 'check' }} size={12} tintColor={Polar.ink} weight="bold" /> : null}
      <Text style={[styles.chipText, on && styles.inkText]}>{title}</Text>
    </>
  );
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={accessibilityLabel} style={({ pressed }) => pressed && styles.pressed}>
      {on ? <View style={[styles.chip, styles.tileOn]}>{inner}</View> : <Glass style={styles.chip}>{inner}</Glass>}
    </Pressable>
  );
}

/** Three answers in one glass capsule, the chosen one white: the pace. */
export function GlassSegment<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <Glass style={styles.segment}>
      <View style={styles.segmentRow} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.segmentHalf, on && styles.tileOn]}>
              <Text style={[styles.segmentText, on && styles.inkText]} numberOfLines={1}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Glass>
  );
}

/** A small caps heading over a group of answers on the photograph. */
export function GlassHeading({ children }: { children: string }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export const welcomeGlass = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stack: { gap: 8 },
});

const styles = StyleSheet.create({
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  skip: { paddingVertical: 6, minHeight: 44, paddingHorizontal: 16, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 15, fontWeight: '600', color: Polar.ice },
  host: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, fontSize: 15, lineHeight: 21, color: Polar.frost88 },
  lineSaid: { color: Polar.ice },
  cta: { gap: 10, marginTop: 8 },
  // Two to a line: the gap is 8, so each takes half less four.
  half: { width: '48.8%' },
  wide: { width: '100%' },
  tile: { minHeight: 92, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
  tileWide: { minHeight: 54, justifyContent: 'center' },
  tileOn: { backgroundColor: 'rgba(255,255,255,0.94)' },
  tileTitle: { fontSize: 17, fontWeight: '600', color: Polar.ice },
  tileHint: { fontSize: 13, color: Polar.frost68 },
  inkText: { color: Polar.ink },
  inkSoft: { color: 'rgba(31,42,68,0.62)' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 20 },
  chipText: { fontSize: 15, fontWeight: '500', color: Polar.ice },
  badge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.ink },
  badgeText: { fontSize: 12, fontWeight: '700', color: Polar.ice },
  segment: { borderRadius: 999, padding: 3 },
  segmentRow: { flexDirection: 'row', gap: 2 },
  segmentHalf: { flex: 1, paddingVertical: 6, minHeight: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentText: { fontSize: 14, fontWeight: '600', color: Polar.ice },
  heading: { marginTop: 6, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: Polar.frost88 },
});
