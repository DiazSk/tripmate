import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { discardTrip, getTrip, promoteTrip } from '@/api/tripMateApi';
import type { Trip } from '@/api/types';
import { DayMap } from '@/components/day-map';
import { DayPage } from '@/components/day-page';
import { PrimaryButton } from '@/components/form';
import { Invitation, Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatRange } from '@/lib/dayDisplay';

export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);
  /** `dayIndex:stopIndex` of the one expanded stop, or null. One at a time, like the Swift app. */
  const [emphasis, setEmphasis] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  /**
   * Which face you are reading, for the whole trip rather than per day.
   *
   * Trip-level on purpose: you are *in map mode*, and changing day should not silently drop you
   * back to a list. It is also what lets one map serve every day instead of one per day.
   */
  const [face, setFace] = useState<'list' | 'map'>('list');
  /**
   * One-way: false until the map is first asked for, true forever after.
   *
   * The map is never unmounted once built — the same latch the web app's map background uses.
   * Tearing down a warmed native map and its decoded tiles every time someone glances at the
   * list would make the second look as slow as the first.
   */
  const [mapBuilt, setMapBuilt] = useState(false);
  if (face === 'map' && !mapBuilt) setMapBuilt(true);

  useEffect(() => {
    getTrip(id).then((result) => setTrip(result ?? null));
  }, [id]);

  if (trip === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
        <Loading />
      </View>
    );
  }

  if (trip === null) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
        <View style={styles.stateWrap}>
          <Notice>Couldn&rsquo;t reach TripMate. Check your connection.</Notice>
        </View>
      </View>
    );
  }

  const days = trip.itinerary?.days ?? [];

  return (
    <View style={styles.screen}>
      {/* Chevron only. The back label defaults to the previous screen's title, which for a route
          group is the literal string "(tabs)" — and naming one tab would be wrong anyway, since
          a trip opens from both Home and Memories. The title stays the destination rather than
          the day: a nav title that changes on every swipe is noise, and it re-renders the native
          header each time. */}
      <Stack.Screen
        options={{ title: trip.destination, headerBackButtonDisplayMode: 'minimal' }}
      />

      {days.length === 0 ? (
        <View style={styles.stateWrap}>
          <Invitation
            title="No days in this plan yet"
            body="This trip was kept before its days were written."
          />
        </View>
      ) : (
        <>
          <View style={styles.chrome}>
            <ThemedText type="label" themeColor="muted">
              {formatRange(trip.startDate, trip.endDate)}
            </ThemedText>
            <View style={styles.chromeRow}>
              <DayStrip count={days.length} current={day} onSelect={setDay} />
              <FaceToggle face={face} onChange={setFace} />
            </View>
          </View>

          <View style={styles.faces}>
            <DayPager
              trip={trip}
              day={day}
              onDayChange={setDay}
              emphasis={emphasis}
              onEmphasise={setEmphasis}
            />

            {mapBuilt ? (
              <MapFace visible={face === 'map'}>
                <DayMap
                  stops={days[day]?.stops ?? []}
                  dayIndex={day}
                  emphasis={stopIndexFor(emphasis, day)}
                  onEmphasise={(stop) => setEmphasis(stop === null ? null : `${day}:${stop}`)}
                />
              </MapFace>
            ) : null}
          </View>
        </>
      )}

      {trip.status === 'draft' ? (
        <KeepShelf
          trip={trip}
          onKept={(endDate) => setTrip({ ...trip, status: 'saved', endDate })}
        />
      ) : null}
    </View>
  );
}

/**
 * The days, paged one per screen.
 *
 * A `ScrollView` rather than a `FlatList`, and the reason is the map that lands next: a list's one
 * real contribution here is windowing, and windowing is precisely what would unmount a built map
 * two pages away. A FlatList configured never to window *is* a ScrollView, with three more knobs
 * and two more ways to fail quietly. A trip is one to fourteen days; mounting them all is cheap.
 *
 * The strip and the swipe drive the same `day`, so the sync runs both ways. `settled` is what
 * stops it looping: a programmatic `scrollTo` fires `onMomentumScrollEnd` too, and without the
 * guard that would set the state that caused the scroll.
 */
function DayPager({
  trip,
  day,
  onDayChange,
  emphasis,
  onEmphasise,
}: {
  trip: Trip;
  day: number;
  onDayChange: (day: number) => void;
  emphasis: string | null;
  onEmphasise: (key: string | null) => void;
}) {
  // `useWindowDimensions`, not `Dimensions.get()` — this one re-renders on rotation, and a page
  // whose width disagrees with the pager's by even a point drifts out of alignment by day 8.
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const settled = useRef(0);
  const days = trip.itinerary?.days ?? [];

  useEffect(() => {
    if (settled.current === day) return;
    settled.current = day;
    pager.current?.scrollTo({ x: day * width, animated: true });
  }, [day, width]);

  function onMomentumScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const landed = Math.round(event.nativeEvent.contentOffset.x / width);
    if (landed === settled.current) return;
    settled.current = landed;
    onDayChange(landed);
  }

  return (
    <ScrollView
      ref={pager}
      horizontal
      pagingEnabled
      // iOS-only, harmless elsewhere: stops a diagonal drag jiggling the page sideways while the
      // day's own list is scrolling vertically.
      directionalLockEnabled
      // Explicit, because a clipped subview is how a native map goes black on Android.
      removeClippedSubviews={false}
      showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={onMomentumScrollEnd}>
      {days.map((dayPlan, index) => (
        // A fixed width, never `flex: 1`: a flex child inside a horizontal ScrollView collapses
        // to zero width and renders blank, with no warning.
        <View key={dayPlan.date} style={{ width }}>
          <DayPage
            day={dayPlan}
            dayIndex={index}
            dayCount={days.length}
            destination={trip.destination}
            emphasis={stopIndexFor(emphasis, index)}
            onEmphasise={(stop) => onEmphasise(stop === null ? null : `${index}:${stop}`)}
          />
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * Which day you are on, and that there are others.
 *
 * The masthead already prints "Day 3 of 7", so this is not information — it is the affordance. It
 * also outlives the swipe: once the map face is pannable it takes the horizontal drag, and tapping
 * a chip is then the only way to change day. Tapping one is also how you reach day 6 without
 * swiping six times.
 *
 * Not jade. Jade means action, and where-you-are is not an action.
 */
function DayStrip({
  count,
  current,
  onSelect,
}: {
  count: number;
  current: number;
  onSelect: (day: number) => void;
}) {
  const strip = useRef<ScrollView>(null);

  // Keep the active chip on screen — a fourteen-day trip runs off the edge.
  useEffect(() => {
    strip.current?.scrollTo({ x: Math.max(0, current * CHIP_STRIDE - CHIP_STRIDE), animated: true });
  }, [current]);

  return (
    <ScrollView
      ref={strip}
      horizontal
      showsHorizontalScrollIndicator={false}
      // The box explicitly takes the room the toggle leaves, rather than inheriting it. A
      // seven-day strip at the largest text size already bounded correctly without this, so it
      // fixes nothing observed — it states the constraint the layout is relying on instead of
      // depending on how a ScrollView happens to size itself inside a row.
      style={styles.stripBox}
      contentContainerStyle={styles.strip}>
      {Array.from({ length: count }, (_, index) => {
        const active = index === current;
        return (
          <Pressable
            key={index}
            onPress={() => onSelect(index)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Day ${index + 1} of ${count}`}
            style={[styles.chip, active && styles.chipActive]}>
            <ThemedText type="money" themeColor={active ? 'foreground' : 'muted'}>
              {index + 1}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * The map face, faded over the list rather than swapped with it.
 *
 * **Hidden by opacity, never unmounted and never `display: none`.** Both of those throw the
 * native map away; `pointerEvents` is what actually takes the hidden face out of hit-testing, so
 * a drag meant for the list underneath is not swallowed by an invisible map on top.
 *
 * Opacity and a slight scale together are Material's shared-axis Z — the canonical "two views of
 * one thing" transition, and unremarkable on iOS.
 */
function MapFace({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: visible ? 220 : 160 }),
    transform: [{ scale: withTiming(visible ? 1 : 0.96, { duration: visible ? 220 : 160 }) }],
  }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents={visible ? 'auto' : 'none'}>
      {children}
    </Animated.View>
  );
}

/**
 * List or map, for the trip.
 *
 * A two-up control rather than a card flip: neither platform ships a flip — it is iOS 6-era
 * skeuomorphism Apple removed, and Material has no equivalent — and a flip would also force both
 * faces to stay mounted for backface-visibility, keeping a live map behind the list forever.
 *
 * The selected side is paper on slate, not jade. Jade means action, and which view you are
 * looking at is not an action.
 */
function FaceToggle({
  face,
  onChange,
}: {
  face: 'list' | 'map';
  onChange: (face: 'list' | 'map') => void;
}) {
  return (
    <View style={styles.toggle}>
      {(['list', 'map'] as const).map((option) => {
        const active = face === option;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.toggleHalf, active && styles.toggleHalfActive]}>
            <ThemedText type="label" themeColor={active ? 'foreground' : 'muted'}>
              {option === 'list' ? 'List' : 'Map'}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The stop index within `dayIndex`, or null when the emphasis belongs to another day. */
function stopIndexFor(emphasis: string | null, dayIndex: number): number | null {
  if (!emphasis) return null;
  const [day, stop] = emphasis.split(':');
  return Number(day) === dayIndex ? Number(stop) : null;
}

/**
 * An unkept plan's shelf.
 *
 * A generated trip is a `draft` row from the moment it exists, so nothing is lost on a back
 * press — but a draft is invisible on the memories wall (`listTrips` defaults to saved), so
 * without this it could only be reached by going back through generation. Keeping promotes the
 * same row rather than inserting a second one, which is what keeps its `runId` link intact.
 */
function KeepShelf({ trip, onKept }: { trip: Trip; onKept: (endDate: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'keep' | 'discard' | null>(null);
  const [failed, setFailed] = useState(false);

  async function keep() {
    setBusy('keep');
    setFailed(false);
    const update = await promoteTrip(trip.id, trip.itinerary);
    setBusy(null);
    // The returned endDate is recomputed from the itinerary server-side, so it is the one to
    // keep — not whatever was sent.
    if (update) onKept(update.endDate);
    else setFailed(true);
  }

  async function discard() {
    setBusy('discard');
    setFailed(false);
    const ok = await discardTrip(trip.id);
    if (ok) router.replace('/(tabs)/memories');
    else {
      setBusy(null);
      setFailed(true);
    }
  }

  return (
    <View style={styles.shelf}>
      {failed ? (
        <ThemedText type="detail" themeColor="alert" style={styles.shelfError}>
          That didn&rsquo;t go through. Try again.
        </ThemedText>
      ) : (
        <ThemedText type="detail" themeColor="muted" style={styles.shelfError}>
          Not kept yet — it won&rsquo;t appear under Memories until you do.
        </ThemedText>
      )}
      <PrimaryButton title="Keep this trip" onPress={keep} busy={busy === 'keep'} disabled={!!busy} />
      <Pressable onPress={discard} disabled={!!busy} style={styles.discard}>
        <ThemedText type="detail" themeColor="muted">
          {busy === 'discard' ? 'Discarding…' : 'Discard'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** Chip width plus its gap — what one step along the strip measures. */
const CHIP_STRIDE = 44;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  stateWrap: { paddingTop: Spacing.regular },

  chrome: {
    paddingHorizontal: Spacing.read,
    paddingBottom: Spacing.tight,
    gap: Spacing.tight,
  },
  chromeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },
  faces: { flex: 1 },
  stripBox: { flex: 1 },
  strip: { gap: Spacing.tight, paddingRight: Spacing.tight, alignItems: 'center' },
  toggle: {
    flexDirection: 'row',
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
    padding: 3,
    gap: 2,
  },
  toggleHalf: {
    paddingHorizontal: Spacing.rows,
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  toggleHalfActive: { backgroundColor: Colors.surfaceDeep },
  chip: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: Spacing.tight,
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },

  shelf: {
    backgroundColor: Colors.bar,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.cardBorder,
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.rows,
    paddingBottom: Spacing.regular,
    gap: Spacing.rows,
  },
  shelfError: { textAlign: 'center' },
  discard: { alignItems: 'center', paddingVertical: Spacing.tight },
});
