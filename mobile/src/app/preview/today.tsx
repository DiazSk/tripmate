import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

import { Today } from '@/components/today';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { SavedPlace, Stop, Trip } from '@/api/types';

/**
 * Today, every state, with no database and no device.
 *
 * **A design loop, not a feature.** Looking at one state of this screen used to cost a row
 * inserted into the developer's own `tripmate.db`, a terminate, a relaunch and seventeen seconds
 * of boot — per state, and there are six. That is affordable once and ruinous as a way to
 * actually design something, which is how the last pass ended up making judgements from four
 * simulator screenshots.
 *
 * Here the state is a press, the trip is a literal, and under `expo start --web` an edit to
 * `today.tsx` reloads in about a second. The real component is rendered — the same
 * `todayState`, `leaveBy` and `dayLegs` the app runs — so what is being looked at is the
 * product's own arithmetic, not a mock of it.
 *
 * **`__DEV__` only.** It returns null in a production bundle rather than being excluded by the
 * bundler, which is the same shape `/backend/pipeline` takes on the web client: unreachable in
 * production, and reachable without a flag in development.
 *
 * **The clock is real and the stops move around it.** Every scenario states its times as offsets
 * from *now in the trip's zone*, so the states hold at any hour of any day rather than only
 * while some seeded afternoon is current.
 */

const ZONE = 'Asia/Tokyo';

/**
 * The clock, read once when this module loads.
 *
 * Every scenario states its stop times as offsets from this, which keeps `tripFor` pure — React's
 * purity rule is right that reading a clock during render is a bug, and stamping it in an effect
 * only trades that for `set-state-in-effect`. It also matches how the product behaves: a plan's
 * times are fixed and *now* is what moves, so the countdown ticks down against a stationary day
 * exactly as it does on a real trip.
 */
const BOOT = { minutes: nowMinutesIn(ZONE), day: todayIn(ZONE) };

function nowMinutesIn(zone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

function todayIn(zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
}

/** Minutes-since-midnight to the app's stored clock format — "1:00 PM", never "13:00". */
function clockOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${suffix}`;
}

const KYOTO = {
  kinkakuji: { lat: 35.0394, lng: 135.7292 },
  kiyomizu: { lat: 34.9949, lng: 135.785 },
  higashiyama: { lat: 35.0, lng: 135.78 },
  nishiki: { lat: 35.005, lng: 135.7649 },
  ryoanji: { lat: 35.0345, lng: 135.7183 },
};

const stop = (
  name: string,
  offsetMinutes: number,
  at: { lat: number; lng: number },
  extra: Partial<Stop> = {}
): Stop =>
  ({
    name,
    time: clockOf(BOOT.minutes + offsetMinutes),
    lat: at.lat,
    lng: at.lng,
    cost: 0,
    note: '',
    durationLabel: '1 hour',
    category: 'other',
    // Named temples and markets resolve against OpenStreetMap; areas and meals do not. The
    // scenarios below set this per stop so the photograph's gate is exercised both ways.
    located: 'osm',
    ...extra,
  }) as Stop;

type ScenarioId = 'imminent' | 'upcoming' | 'free' | 'first' | 'done';

const SCENARIOS: { id: ScenarioId; label: string; stops: () => Stop[] }[] = [
  {
    id: 'imminent',
    label: 'Imminent',
    // A stop behind you gives the next one an origin, so `leaveBy` exists and lands inside
    // IMMINENT_MINUTES. The two after it fill the After list, one of them booked.
    stops: () => [
      stop('Fushimi Inari Shrine', -70, { lat: 34.9671, lng: 135.7727 }),
      stop('Kiyomizu-dera Temple', 25, KYOTO.kiyomizu),
      stop('Lunch in Higashiyama', 110, KYOTO.higashiyama, { timeFlexibility: 'FIXED', located: 'model' }),
      stop('Nishiki Market', 200, KYOTO.nishiki),
    ],
  },
  {
    id: 'upcoming',
    label: 'Upcoming',
    stops: () => [
      stop('Fushimi Inari Shrine', -90, { lat: 34.9671, lng: 135.7727 }),
      stop('Kiyomizu-dera Temple', 70, KYOTO.kiyomizu),
      stop('Nishiki Market', 180, KYOTO.nishiki),
    ],
  },
  {
    id: 'free',
    label: 'Free',
    stops: () => [stop('Kinkaku-ji', 240, KYOTO.kinkakuji), stop('Ryoan-ji Temple', 320, KYOTO.ryoanji)],
  },
  {
    id: 'first',
    // No stop behind it, so no origin and no departure — the branch that must never invent one.
    label: 'First stop',
    stops: () => [stop('Kinkaku-ji', 45, KYOTO.kinkakuji), stop('Ryoan-ji Temple', 140, KYOTO.ryoanji)],
  },
  { id: 'done', label: 'Done', stops: () => [stop('Nishiki Market', -120, KYOTO.nishiki)] },
];

const SAVED: SavedPlace[] = [
  { id: 's1', name: 'Nishiki Market', lat: 35.005, lng: 135.7649, city: 'Kyoto, Japan', source: 'screenshot', url: null, createdAt: '2026-09-25T00:00:00.000Z' },
  { id: 's2', name: 'Gion Shirakawa', lat: 35.0037, lng: 135.7752, city: 'Kyoto, Japan', source: 'screenshot', url: null, createdAt: '2026-09-25T00:00:00.000Z' },
  { id: 's3', name: 'Arashiyama Bamboo Grove', lat: 35.017, lng: 135.672, city: 'Kyoto, Japan', source: 'screenshot', url: null, createdAt: '2026-09-25T00:00:00.000Z' },
  { id: 's4', name: 'Kyoto Station', lat: 34.9858, lng: 135.7585, city: 'Kyoto, Japan', source: 'screenshot', url: null, createdAt: '2026-09-25T00:00:00.000Z' },
];

function tripFor(scenario: ScenarioId): Trip {
  const day = BOOT.day;
  const later = (n: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const stops = SCENARIOS.find((s) => s.id === scenario)!.stops();
  return {
    id: 'preview',
    destination: 'Kyoto',
    startDate: day,
    endDate: later(2),
    budget: 1800,
    status: 'saved',
    timezone: ZONE,
    chatSessionId: null,
    userAnswers: null,
    itinerary: {
      tier: 'midrange',
      days: [
        { date: day, theme: 'Temples and the east', summary: 'A day in the east of the city.', stops },
        { date: later(1), theme: 'West', summary: '', stops: [] },
        { date: later(2), theme: 'Centre', summary: '', stops: [] },
      ],
    },
  } as Trip;
}

/** A fixed stamp. `new Date()` during render is impure and the lint rule is right to say so. */
const CACHED_AT = '2026-09-30T05:12:00.000Z';

export default function TodayPreview() {
  const [scenario, setScenario] = useState<ScenarioId>('imminent');
  const [offline, setOffline] = useState(false);

  if (!__DEV__) return null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Stack.Screen options={{ title: 'Today — preview' }} />
      <View style={styles.bar}>
        {SCENARIOS.map((s) => (
          <Switch key={s.id} label={s.label} on={scenario === s.id} onPress={() => setScenario(s.id)} />
        ))}
        <Switch label="Offline" on={offline} onPress={() => setOffline((v) => !v)} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Today
          trip={tripFor(scenario)}
          today={BOOT.day}
          cachedAt={offline ? CACHED_AT : null}
          onOpenTrip={() => {}}
          onAsk={offline ? undefined : () => {}}
          onPlanAnother={() => {}}
          saved={SAVED}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Deliberately plain. The harness must not be mistaken for the thing being designed. */
function Switch({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.switch, on && styles.switchOn]}>
      <ThemedText type="micro" themeColor={on ? 'accentForeground' : 'muted'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.tight,
    padding: Spacing.read,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.cardBorder,
  },
  switch: {
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.hair + 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  switchOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  content: { padding: Spacing.read },
});
