import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { completePlan, readPlan } from '@/api/tripMateApi';
import type { ImportedPlan, ImportItem } from '@/api/types';
import { DateField, PillButton, PrimaryButton, TextField } from '@/components/form';
import { ImportComposer } from '@/components/import-composer';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { isFound, looseAnchors, needsStartDate, ownPlanGap, renameStop } from '@/lib/ownPlan';
import { usePlanDraft } from '@/lib/planDraft';
import { summariseUnread } from '@/lib/unreadSummary';

/**
 * Bring your own itinerary. Two steps on one screen — compose, then confirm — so the plan that
 * was read never has to travel between routes. A list of places rather than days goes to the
 * wizard as anchors (the screen shares the plan stack's draft), so nothing read is lost.
 */
export default function OwnPlan() {
  const router = useRouter();
  const { text } = useLocalSearchParams<{ text?: string }>();
  const { patch } = usePlanDraft();
  const [plan, setPlan] = useState<ImportedPlan | null>(null);
  const [renamed, setRenamed] = useState<ReadonlySet<string>>(new Set());
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  async function read(items: ImportItem[]): Promise<boolean> {
    setBusy(true);
    setProblems([]);
    const result = await readPlan(items);
    setBusy(false);
    if (result === undefined) {
      setProblems(["Couldn't read your plan right now."]);
      return false;
    }
    if (typeof result === 'string') {
      setProblems([result]);
      return false;
    }
    if (!result.isPlan) {
      patch({
        anchors: looseAnchors(result),
        ...(result.destinationGuess ? { destination: result.destinationGuess } : {}),
      });
      router.replace('/plan/basics');
      return true;
    }
    setPlan(result);
    setRenamed(new Set());
    setDestination(result.destinationGuess ?? '');
    // Said once each — four unreadable screenshots are one line with a count, not four lines.
    setProblems([...result.notes, ...summariseUnread(result.unread.map((u) => u.reason))]);
    return true;
  }

  function rename(d: number, s: number, name: string) {
    if (!plan) return;
    setPlan(renameStop(plan, d, s, name));
    setRenamed((prev) => new Set(prev).add(`${d}-${s}`));
  }

  async function build() {
    if (!plan || busy) return;
    const gap = ownPlanGap(plan, destination, startDate);
    if (gap) {
      setProblems([gap]);
      return;
    }
    setBusy(true);
    setProblems([]);
    const amount = Number(budget);
    const result = await completePlan({
      plan,
      destination: destination.trim(),
      ...(needsStartDate(plan) ? { startDate } : {}),
      ...(amount > 0 ? { budget: amount } : {}),
    });
    setBusy(false);
    if (result === undefined) {
      setProblems(["Couldn't build your trip right now."]);
      return;
    }
    if (typeof result === 'string') {
      setProblems([result]);
      return;
    }
    router.replace(`/trip/${result.id}`);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Your plan' }} />
      {plan === null ? (
        <>
          <ThemedText type="body" themeColor="muted">
            Paste your plan, or add screenshots of it. TripMate keeps your days and your order.
          </ThemedText>
          <ImportComposer
            busy={busy}
            unread={problems}
            actionTitle="Read my plan"
            placeholder="Paste your plan, or links to it"
            initialText={text ?? ''}
            onSubmit={read}
          />
        </>
      ) : (
        <>
          <TextField label="Where" value={destination} onChangeText={setDestination} placeholder="City, Country" />
          {needsStartDate(plan) ? <DateField label="Starts" value={startDate} onChange={setStartDate} /> : null}
          <TextField
            label="Budget"
            prefix="$"
            value={budget}
            onChangeText={setBudget}
            keyboardType="number-pad"
            placeholder="Optional"
          />
          {plan.days.map((day, d) => (
            <View key={d} style={styles.day}>
              <ThemedText type="heading">{day.date ? `Day ${d + 1} · ${day.date}` : `Day ${d + 1}`}</ThemedText>
              {day.stops.length === 0 ? (
                <ThemedText type="detail" themeColor="muted">
                  Nothing planned yet
                </ThemedText>
              ) : null}
              {day.stops.map((stop, s) => {
                const key = `${d}-${s}`;
                const status = renamed.has(key)
                  ? 'Looked up when you build'
                  : isFound(stop)
                    ? 'On the map'
                    : 'Not found on the map — check the spelling';
                return (
                  <View key={key}>
                    <TextField
                      label={stop.time ?? `Stop ${s + 1}`}
                      value={stop.name}
                      onChangeText={(name) => rename(d, s, name)}
                    />
                    <ThemedText
                      type="detail"
                      themeColor={renamed.has(key) || isFound(stop) ? 'muted' : 'alert'}>
                      {status}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          ))}
          {problems.map((problem) => (
            <ThemedText key={problem} type="detail" themeColor="muted">
              {problem}
            </ThemedText>
          ))}
          <PrimaryButton title="Build my trip" busy={busy} onPress={build} />
          <PillButton
            title="Start over"
            onPress={() => {
              setPlan(null);
              setProblems([]);
            }}
          />
        </>
      )}
    </ScrollView>
  );
}

// The same screen and content insets as `plan/basics.tsx`, so the two screens share a rhythm.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  content: { padding: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.read },
  day: { gap: Spacing.tight },
});
