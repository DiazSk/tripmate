import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { DayPlan, Trip } from '@/api/types';
import { clockAt, formatDayChip } from '@/lib/dayDisplay';
import { dayLegs, leaveBy } from '@/lib/dayTravel';
import { directionsUrl } from '@/lib/directions';
import { isBlocking, tripHealth } from '@/lib/health';
import { clockInZone, describeGap, nowInZone, todayState } from '@/lib/tripClock';
import { dayIndexFor, tripPhase } from '@/lib/tripPhase';

/**
 * What to do now.
 *
 * The rest of this app answers "what should my week look like". This answers the other question
 * a trip asks, which only starts being asked once the trip begins: it is 10:38 in Lisbon, where
 * am I going and when do I have to leave.
 *
 * **It is a projection, not a new feature.** Every figure here is computed by a function that
 * already existed for the day page — `leaveBy`, `dayLegs`, `tripHealth`, `directionsUrl`. What is
 * new is the selection: one next thing, hoisted, with the rest of the day demoted beneath it.
 * That is why this is its own component rather than a mode on `day-page`. The day page is a list
 * and answers "what is this day"; a list cannot answer "what now" without the reader doing the
 * scanning, which is the entire job.
 *
 * **No clock without a timezone.** `trip.timezone` is null for trips saved before it was stored
 * and for destinations that never geocoded, and the device's own clock is not a substitute —
 * measured, a phone reading 21:07 on Sep 28 is Lisbon 05:07 on Sep *29*, so it gets the wrong
 * day of the itinerary rather than merely the wrong hour. Without a zone this still draws the
 * day, its order and every leave-by, because those come from the stops' own stated times. Only
 * "now" goes quiet. Same contract as Plan Health's "Not checked".
 */

/** The live clock re-reads once a minute. Anything faster is a render nobody can perceive. */
function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

export function Today({
  trip,
  today,
  cachedAt,
  onAsk,
  onOpenTrip,
}: {
  trip: Trip;
  /** Today where the *trip* is when a zone is known, else the device's — see `Home`. */
  today: string;
  /** When this copy was taken, or null when it came from the network. */
  cachedAt: string | null;
  /** Opens Ask already scoped to the day on screen. Absent while offline. */
  onAsk?: (dayIndex: number) => void;
  onOpenTrip: () => void;
}) {
  useMinuteTick();

  const phase = tripPhase(trip, today);
  if (phase !== 'today' && phase !== 'eve') return null;

  // On the eve the day in question is the first one; there is no "today" index yet.
  const dayIndex = phase === 'today' ? (dayIndexFor(trip, today) ?? 0) : 0;
  const day = trip.itinerary.days[dayIndex];
  if (!day) return null;

  const now = phase === 'today' ? nowInZone(trip.timezone) : null;
  const clock = phase === 'today' ? clockInZone(trip.timezone) : null;

  return (
    <View style={styles.wrap}>
      <Header trip={trip} day={day} phase={phase} clock={clock} onOpenTrip={onOpenTrip} />
      {cachedAt ? <Stale at={cachedAt} /> : null}
      {now === null ? (
        <WholeDay day={day} eve={phase === 'eve'} />
      ) : (
        <NowAndAfter day={day} now={now} />
      )}
      <Attention trip={trip} dayIndex={dayIndex} cachedAt={cachedAt} />
      {/* **A jade label, not a jade pill, because the hierarchy was inverted.** A full-width
          filled bar made replanning the loudest thing on the screen, while Directions — the
          thing somebody standing in a street actually presses — was a line of text. Replanning
          is the rare case on an execution surface; it needs to be findable, not shouted. So it
          takes the same idiom Directions already uses, and the 44pt target is kept on the
          pressable rather than drawn. */}
      <Pressable
        onPress={onAsk ? () => onAsk(dayIndex) : undefined}
        disabled={!onAsk}
        accessibilityRole="button"
        accessibilityState={{ disabled: !onAsk }}
        style={({ pressed }) => [styles.ask, pressed && styles.pressed]}>
        <ThemedText type="label" themeColor={onAsk ? 'accent' : 'muted'}>
          {onAsk ? 'Plans changed?' : 'Plans changed? — needs a connection'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

function Header({
  trip,
  day,
  phase,
  clock,
  onOpenTrip,
}: {
  trip: Trip;
  day: DayPlan;
  phase: 'today' | 'eve';
  clock: string | null;
  onOpenTrip: () => void;
}) {
  const chip = formatDayChip(day.date);
  return (
    <Pressable onPress={onOpenTrip} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedText type="label" themeColor="muted">
        {trip.destination.toUpperCase()}
      </ThemedText>
      <View style={styles.headRow}>
        <ThemedText type="display" style={styles.grow}>
          {phase === 'eve' ? 'Tomorrow' : 'Today'}
        </ThemedText>
        {/* Tabular figures, not the display face. The serif display cuts its zero with a bar, so
            "5:30 AM" renders as "5:3Ø AM" — fine in a headline, wrong in a clock, and wrong
            beside stop times set in this same tabular face. Paper rather than jade: it is the
            most factual thing on the screen, and jade in this product means press me. */}
        {clock ? <ThemedText type="moneyLarge">{clock}</ThemedText> : null}
      </View>
      {chip ? (
        <ThemedText type="label" themeColor="muted">
          {`${chip.weekday} ${chip.dayOfMonth}`}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

/** Says which copy this is. A cached screen that does not admit it is worse than no cache. */
function Stale({ at }: { at: string }) {
  const time = clockAt(at);
  return (
    <ThemedText type="detail" themeColor="muted">
      {time ? `Saved copy from ${time} — no connection` : 'Saved copy — no connection'}
    </ThemedText>
  );
}

/**
 * The next thing, hoisted, and everything after it demoted. The whole point of the screen.
 *
 * **What the hoisted thing says depends on how far away it is**, which is the difference between
 * a screen that works at 10:15 and one that works at 6:27. `todayState` decides; this only
 * draws. The departure leads wherever there is one, because on an execution surface the moment
 * you have to go outranks the moment you are due — and where there is none, because the day's
 * first stop has no origin to leave from, the wait is stated instead of a time being invented.
 */
function NowAndAfter({ day, now }: { day: DayPlan; now: number }) {
  const stops = day.stops ?? [];
  const state = todayState(stops, now, (i) => leaveBy(stops, i));

  if (state.kind === 'empty' || state.kind === 'done') {
    return (
      <View style={styles.block}>
        <ThemedText type="label" themeColor="muted">
          Nothing left today
        </ThemedText>
        <ThemedText type="detail" themeColor="muted">
          {state.kind === 'empty' ? 'This day has no stops.' : 'The last stop has started.'}
        </ThemedText>
      </View>
    );
  }

  const { index } = state;
  const stop = stops[index];
  const leg = dayLegs(stops).find((l) => l.toIndex === index);
  const after = stops.slice(index + 1);

  return (
    <>
      {/* The silence before a distant stop is itself information, and the thing somebody reopening
          the app at 6:27 actually wants. Not a filled-in mini-itinerary: an interval. */}
      {state.kind === 'free' ? (
        <View style={styles.block}>
          <ThemedText type="label" themeColor="muted">
            Until then
          </ThemedText>
          <ThemedText type="heading">{`Free for about ${describeGap(state.minutes)}`}</ThemedText>
        </View>
      ) : null}

      <View style={styles.block}>
        <ThemedText type="label" themeColor="muted">
          Next
        </ThemedText>
        <ThemedText type="heading">{stop.name}</ThemedText>
        {/* The departure on its own line, above the appointment, wherever one exists. */}
        {state.kind === 'imminent' ? (
          <ThemedText type="heading" themeColor="alert">
            {`Leave in ${describeGap(state.minutes)}`}
          </ThemedText>
        ) : state.kind === 'upcoming' && state.leaveBy ? (
          <ThemedText type="heading">{`Leave by ${state.leaveBy}`}</ThemedText>
        ) : null}
        <ThemedText type="detail" themeColor="muted">
          {[
            stop.time,
            state.kind === 'upcoming' && !state.leaveBy ? `in ${describeGap(state.minutes)}` : null,
            state.kind === 'imminent' ? `leave by ${state.leaveBy}` : null,
            leg ? `${leg.minutes} min by ${leg.mode}` : null,
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </ThemedText>
        {stop.lat !== 0 || stop.lng !== 0 ? (
          <Pressable
            onPress={() => Linking.openURL(directionsUrl(stop)).catch(() => {})}
            accessibilityRole="link"
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="label" themeColor="accent">
              Directions
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {after.length > 0 ? (
        <View style={styles.block}>
          <ThemedText type="label" themeColor="muted">
            After
          </ThemedText>
          {after.map((s, i) => (
            <Row
              key={`${s.name}-${i}`}
              time={s.time}
              name={s.name}
              booked={s.timeFlexibility === 'FIXED'}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

/**
 * The day with no "now" in it — the eve, or a trip with no timezone on record.
 *
 * Still worth drawing in full: the times, the order and the leave-bys are all properties of the
 * plan rather than of the clock, so none of them is unknown just because the hour is.
 */
function WholeDay({ day, eve }: { day: DayPlan; eve: boolean }) {
  const stops = day.stops ?? [];
  return (
    <View style={styles.block}>
      <ThemedText type="label" themeColor="muted">
        {eve ? 'Starts with' : 'The day'}
      </ThemedText>
      {stops.length === 0 ? (
        <ThemedText type="detail" themeColor="muted">
          This day has no stops.
        </ThemedText>
      ) : (
        stops.map((s, i) => <Row key={`${s.name}-${i}`} time={s.time} name={s.name} booked={s.timeFlexibility === 'FIXED'} />)
      )}
    </View>
  );
}

function Row({ time, name, booked }: { time?: string; name: string; booked?: boolean }) {
  return (
    <View style={styles.row}>
      <ThemedText type="money" themeColor="muted" style={styles.time}>
        {time ?? ''}
      </ThemedText>
      {/* Booked is stated rather than implied: it is the one thing on this screen nothing may
          move, and on the eve it is the reason to read the row at all.
          **It sits against the name, not at the far margin.** Right-aligned, it drifted a whole
          phone-width away from the thing it qualifies, and on a list where only some rows carry
          it the reader had to track back across empty space to find out which. The name shrinks
          to make room, so a long one truncates rather than pushing the badge off the row. */}
      <View style={styles.named}>
        <ThemedText type="detail" numberOfLines={1} style={styles.shrink}>
          {name}
        </ThemedText>
        {booked ? (
          <ThemedText type="micro" themeColor="muted" style={styles.firm}>
            BOOKED
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Only what stops today working, and only for today.
 *
 * `tripHealth` returns findings across the whole trip; a conflict on day 5 is not something to
 * act on this morning. Filtered to blocking findings on this day, so the section is empty far
 * more often than not — which is the point. A heading that is always there stops being read.
 */
function Attention({
  trip,
  dayIndex,
  cachedAt,
}: {
  trip: Trip;
  dayIndex: number;
  cachedAt: string | null;
}) {
  const findings = tripHealth(trip)
    .dimensions.flatMap((d) => d.findings)
    .filter((f) => isBlocking(f) && f.dayIndex === dayIndex);

  const rain = trip.itinerary.days[dayIndex]?.weatherDetail?.precipitationProbability ?? null;
  const wet = rain !== null && rain >= 50;
  if (findings.length === 0 && !wet) return null;

  return (
    <View style={styles.block}>
      <ThemedText type="label" themeColor="alert">
        Needs attention
      </ThemedText>
      {findings.map((f, i) => (
        <ThemedText key={`${f.message}-${i}`} type="detail" themeColor="muted">
          {f.message}
        </ThemedText>
      ))}
      {/* **A cached forecast changes tense; a cached itinerary does not.** A 10:30 stop read
          from disk is still a 10:30 stop, so those lines stand as written. A forecast read from
          disk is a forecast that was true when it was taken, and weather is the one thing here
          that ages inside an afternoon. The banner above says the screen is a copy; this says
          what that means for the only claim on it that decays. */}
      {wet ? (
        <ThemedText type="detail" themeColor="muted">
          {cachedAt
            ? `Rain was forecast today — ${rain}%${clockAt(cachedAt) ? `, as of ${clockAt(cachedAt)}` : ''}.`
            : `Rain likely today — ${rain}% chance.`}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.rows },
  headRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.tight },
  grow: { flex: 1 },
  block: { gap: Spacing.hair },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.rows, minHeight: 28 },
  // A fixed column so the names line up into something scannable rather than ragged.
  time: { width: 76 },
  named: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },
  shrink: { flexShrink: 1 },
  // The name yields, never the badge. Both default to shrinking, and a six-letter label clipped
  // to "BOOK" at an accessibility size says nothing — where a truncated place name still does.
  firm: { flexShrink: 0 },
  // The target is 44pt tall and only as wide as the words — a full-width tap zone on a screen
  // this dense catches presses meant for the day beneath it.
  ask: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  pressed: { opacity: 0.6 },
});
