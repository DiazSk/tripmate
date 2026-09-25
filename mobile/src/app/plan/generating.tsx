import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { createTripDraft, generateTrip, saveProfile } from '@/api/tripMateApi';
import type { GenerationStage, SketchEvent, StreamedStop } from '@/api/types';
import { PrimaryButton } from '@/components/form';
import { Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing, dayCore } from '@/constants/theme';
import { formatDateline } from '@/lib/dayDisplay';
import { toGenerateRequest, toTravelerProfile, toUserAnswers, usePlanDraft } from '@/lib/planDraft';

/** Stage copy ported from the Swift wizard's `waitingLabel`. */
const STAGE_LABEL: Record<GenerationStage, string> = {
  geocode: 'Finding the place…',
  context: 'Reading up on it…',
  generate: 'Writing the days…',
  critique: 'Checking the plan…',
  placing: 'Putting it on the map…',
};

export default function Generating() {
  const router = useRouter();
  const { draft } = usePlanDraft();

  const [stage, setStage] = useState<GenerationStage>('geocode');
  const [stops, setStops] = useState<StreamedStop[]>([]);
  const [sketch, setSketch] = useState<SketchEvent['days']>([]);
  const [failure, setFailure] = useState<string | undefined>();

  // A generation is 60-246 seconds of billed work. Under React 19's development double-invoke
  // this effect runs twice, which would start two of them; the ref makes it start exactly once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const { destination, startDate, endDate, budget } = draft;
    let cancelled = false;

    generateTrip(
      toGenerateRequest(draft),
      {
        onStage: (event) => {
          if (!cancelled && event.status === 'start') setStage(event.stage);
        },
        onStop: (event) => {
          if (cancelled) return;
          // Replace by position rather than append: a stop can be re-sent as the model revises
          // its own line, and appending would show it twice.
          setStops((prev) => {
            const next = prev.filter(
              (s) => !(s.dayIndex === event.dayIndex && s.stopIndex === event.stopIndex)
            );
            next.push(event);
            return next.sort(
              (a, b) => a.dayIndex - b.dayIndex || a.stopIndex - b.stopIndex
            );
          });
        },
        onSketch: (event) => {
          if (!cancelled) setSketch(event.days);
        },
        onPlan: async (result) => {
          if (cancelled) return;
          // A row exists the moment a plan does, as a draft — so a back press cannot throw away
          // four minutes of work. Keep promotes this same row later.
          const id = await createTripDraft({
            destination,
            startDate,
            endDate,
            budget,
            itinerary: result.itinerary,
            status: 'draft',
            runId: result.runId,
            chatSessionId: result.sessionId,
            // Stored so the edit loop can reuse the answers without asking again.
            userAnswers: toUserAnswers(draft),
          });
          // The durable half of the draft becomes the traveller profile. Unawaited: a plan is
          // not worth blocking on a preference write, and the Profile tab reads it next time.
          void saveProfile(toTravelerProfile(draft));
          if (cancelled) return;
          if (!id) {
            setFailure('The plan was written, but saving it failed. Try generating again.');
            return;
          }
          // Replace, not push: the wait is not somewhere to come back to.
          router.replace(`/trip/${id}`);
        },
      }
    ).then((error) => {
      if (!cancelled && error) setFailure(error.message);
    });

    return () => {
      cancelled = true;
    };
    // params is a fresh object each render; the ref above is what actually guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failure) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
        <View style={styles.failure}>
          <Notice>{failure}</Notice>
          <View style={styles.retry}>
            <PrimaryButton title="Back to the details" onPress={() => router.back()} />
          </View>
        </View>
      </View>
    );
  }

  const byDay = groupByDay(stops);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{ title: '', headerBackButtonDisplayMode: 'minimal', gestureEnabled: false }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="label" themeColor="muted">
          {draft.destination}
        </ThemedText>
        <ThemedText type="display" style={styles.stage}>
          {STAGE_LABEL[stage]}
        </ThemedText>
        <ThemedText type="detail" themeColor="muted">
          This takes a few minutes. The days appear as they are written.
        </ThemedText>

        {/* The sketch arrives before any stop does — a day-by-day outline worth showing on its
            own while the detail is still being written. */}
        {sketch.length > 0 ? (
          <View style={styles.sketch}>
            {sketch.map((day, index) => (
              <ThemedText key={day.date || index} type="detail" themeColor="muted">
                {`Day ${index + 1}: ${day.theme}`}
              </ThemedText>
            ))}
          </View>
        ) : null}

        {byDay.map(({ dayIndex, date, items }) => (
          <View key={dayIndex} style={styles.day}>
            <View style={styles.dayHead}>
              <ThemedText type="label" themeColor="muted">
                {`Day ${dayIndex + 1}`}
              </ThemedText>
              <View style={styles.rule} />
            </View>
            {date ? (
              <ThemedText type="heading" style={styles.dayDate}>
                {formatDateline(date)}
              </ThemedText>
            ) : null}
            {items.map((item) => (
              <View key={`${item.dayIndex}:${item.stopIndex}`} style={styles.stop}>
                <View style={[styles.disc, { backgroundColor: dayCore(dayIndex) }]} />
                <ThemedText type="body" style={styles.stopName}>
                  {item.stop?.name ?? ''}
                </ThemedText>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function groupByDay(stops: StreamedStop[]) {
  const days = new Map<number, { dayIndex: number; date: string; items: StreamedStop[] }>();
  for (const stop of stops) {
    const existing = days.get(stop.dayIndex);
    if (existing) existing.items.push(stop);
    else days.set(stop.dayIndex, { dayIndex: stop.dayIndex, date: stop.date, items: [stop] });
  }
  return [...days.values()].sort((a, b) => a.dayIndex - b.dayIndex);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  content: { padding: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.hair },
  stage: { marginTop: Spacing.tight, marginBottom: Spacing.hair },
  failure: { paddingTop: Spacing.regular, gap: Spacing.read },
  sketch: { marginTop: Spacing.tight, gap: Spacing.hair },
  retry: { paddingHorizontal: Spacing.read },
  day: { marginTop: Spacing.compact },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.cardBorder },
  dayDate: { marginTop: Spacing.hair, marginBottom: Spacing.tight },
  stop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.rows, paddingVertical: 5 },
  disc: { width: 8, height: 8, borderRadius: 4 },
  stopName: { flex: 1 },
});
