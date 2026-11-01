import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

import { formatDateRange } from '@shared/format';
import { city, country, phase } from '@shared/memories';

import type { Trip } from '@/api/types';
import { Meridian } from '@/components/meridian';
import { QuietLink, SignalButton, monumentFontSize, usePolarFonts, usePolarStatusBar } from '@/components/polar-ui';
import { Polar, PolarFonts, PolarSpace, PolarType } from '@/constants/polar';
import { tripDays } from '@/lib/tiers';
import { readCachedTrips, type Cached } from '@/lib/tripCache';
import { Text } from '@/components/themed-text';

/**
 * "You're out of range", the web's `/offline` (canvas design "Offline · 1 Out of range") at phone
 * width. A screen shows it in place of its own content when its load could not reach TripMate at all
 * and nothing was on disk to fall back to (`lastRequestReachedServer`, so a server that answered with
 * an error keeps its plain notice rather than being called a lost signal).
 *
 * **The trips are the ones this phone kept** (`readCachedTrips`): whole trips, so unlike the web's,
 * this list knows each one's dates. Opening one goes through `loadTrip`, which reads the same copy.
 *
 * **Coming back is checked, not heard.** The web has the window's `online` event; listening for the
 * network here would mean a native module and a new build, so the screen asks again on Try again and
 * whenever the app returns to the foreground. `retry` is the host's own load, handing back a
 * `commit` once it got through, so Meri's lift and ONLINE filling in play before the real screen
 * takes over.
 *
 * OFFLINE is drawn in SVG because React Native text has no stroke: an outline is the design's point
 * (the word is there, the signal is not), and it fills in when the connection is back.
 */

type Conn = 'offline' | 'checking' | 'back';

const BACK_DELAY_MS = 1000;

export function OfflineScreen({
  retry,
  onBack,
  exclude,
  bottomInset = 0,
}: {
  /** The host's load again. A `commit` when it reached TripMate, null when it still could not. */
  retry: () => Promise<(() => void) | null>;
  /** Shown as Go back when the screen has somewhere to go back to. */
  onBack?: () => void;
  /** A trip not to list: the one the host failed to open. */
  exclude?: string;
  /** Room for a tab bar under the screen. */
  bottomInset?: number;
}) {
  const fonts = usePolarFonts();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  usePolarStatusBar(false);

  const [conn, setConn] = useState<Conn>('offline');
  const [lastTried, setLastTried] = useState<string | null>(null);
  // Read once: the cache only changes when a trip is opened online, which is not now.
  const [kept] = useState<Cached<Trip>[]>(() => readCachedTrips().filter((c) => c.value.id !== exclude).slice(0, 6));

  const busy = useRef(false);
  const tryAgain = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setConn('checking');
    const commit = await retry();
    busy.current = false;
    if (commit) {
      setConn('back');
      setTimeout(commit, BACK_DELAY_MS);
      return;
    }
    setConn('offline');
    setLastTried(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  }, [retry]);

  // Back in the foreground is the moment somebody has most likely found a signal.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void tryAgain();
    });
    return () => sub.remove();
  }, [tryAgain]);

  if (!fonts) return <View style={styles.screen} />;

  const measure = width - PolarSpace.pad * 2;
  // Sized for OFFLINE, the longer word, so the monument does not jump when it turns into ONLINE.
  const size = Math.round(monumentFontSize('OFFLINE', measure, 150));
  const back = conn === 'back';

  const status =
    conn === 'checking'
      ? 'Checking for a connection…'
      : back
        ? 'Back online. Opening the screen you asked for.'
        : `Waiting for a signal${lastTried ? ` · last tried ${lastTried}` : ''}`;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + PolarSpace.s6, paddingBottom: bottomInset + insets.bottom }]}
      showsVerticalScrollIndicator={false}>
      {/* Meri as everywhere else: still with no signal (its own offline state), thinking while it
          checks, the success lift once the connection is back. The words below say the state too. */}
      <Meridian state={conn === 'checking' ? 'thinking' : back ? 'success' : 'offline'} size={56} />
      <Text style={styles.eyebrow}>{back ? 'Connected' : 'No connection'}</Text>
      <Text style={styles.title} accessibilityRole="header">
        {back ? 'You’re back.' : 'You’re out of range.'}
      </Text>
      <Text style={styles.body}>
        {back
          ? 'The connection is back, so this screen can load. Your saved trips update to the latest the next time you open them.'
          : 'This screen needs the internet, and there is none right now. Trips you opened on this phone are kept, so they open without it.'}
      </Text>
      <View style={styles.status} accessibilityLiveRegion="polite">
        <View style={[styles.pip, conn !== 'offline' && styles.pipOn]} />
        <Text style={styles.statusText}>{status}</Text>
      </View>
      <View style={styles.actions}>
        {/* A pill, as in-app actions are everywhere else: the square Polar button is the landing's
            editorial voice, and this screen is the app's, shown in place of a tab or a trip. */}
        {!back ? <SignalButton large title={conn === 'checking' ? 'Checking…' : 'Try again'} onPress={tryAgain} disabled={conn === 'checking'} style={styles.pill} /> : null}
        {onBack ? <QuietLink light title="Go back" onPress={onBack} /> : null}
      </View>

      <View style={styles.kept}>
        <View style={styles.keptHead}>
          <Text style={styles.keptTitle}>Kept on this phone</Text>
          {kept.length ? <Text style={styles.keptCount}>{`${kept.length} ${kept.length === 1 ? 'trip' : 'trips'}`}</Text> : null}
        </View>
        {kept.length ? (
          kept.map(({ value: trip, cachedAt }) => {
            const days = tripDays(trip.startDate, trip.endDate);
            const when = phase(trip);
            return (
              <Pressable
                key={trip.id}
                onPress={() => router.push(`/trip/${trip.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open your saved copy of ${city(trip)}, saved ${savedLabel(cachedAt)}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowWhen}>{when === 'past' ? 'Past' : when === 'now' ? 'Now' : 'Next'}</Text>
                  <Text style={styles.rowCity} numberOfLines={1}>
                    {city(trip)}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {[country(trip), formatDateRange(trip.startDate, trip.endDate), `${days} ${days === 1 ? 'day' : 'days'}`].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={styles.rowSaved}>Saved {savedLabel(cachedAt)}</Text>
                </View>
                <Svg width={16} height={16} viewBox="0 0 16 16">
                  <Path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke={Polar.signal} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            );
          })
        ) : (
          <Text style={styles.empty}>Nothing is kept on this phone yet. Trips you open while you’re online stay here for moments like this one.</Text>
        )}
        <Text style={styles.note}>The plan, its times and notes open from here. Maps and photographs wait for a connection.</Text>
      </View>

      <View style={styles.monumentWrap} accessible={false} importantForAccessibility="no-hide-descendants">
        <Svg width={measure} height={size}>
          {/* Baseline 0.048em above the foot: Oswald at line-height 1, as the landing's monument sits. */}
          <SvgText
            x={measure / 2}
            y={size * 0.952}
            textAnchor="middle"
            fontFamily={PolarFonts.condensed}
            fontSize={size}
            letterSpacing={-0.5}
            fill={back ? Polar.ice : 'none'}
            stroke={conn === 'checking' ? 'rgba(255,126,21,0.7)' : back ? Polar.ice : 'rgba(255,255,255,0.34)'}
            strokeWidth={1.25}>
            {back ? 'ONLINE' : 'OFFLINE'}
          </SvgText>
        </Svg>
      </View>
    </ScrollView>
  );
}

/** "today at 8:15 AM", "on Tue 14 Oct at 9:40 PM", or "earlier" when the copy carries no time. */
function savedLabel(cachedAt: string | null): string {
  const date = cachedAt ? new Date(cachedAt) : null;
  if (!date || Number.isNaN(date.getTime())) return 'earlier';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return `today at ${time}`;
  return `on ${date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} at ${time}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Polar.night },
  content: { flexGrow: 1, paddingHorizontal: PolarSpace.pad },
  eyebrow: { ...PolarType.eyebrow, color: Polar.nightText2, marginTop: PolarSpace.s3 },
  title: { fontFamily: PolarFonts.display, fontSize: 42, lineHeight: 42, color: Polar.ice, marginTop: PolarSpace.s2 },
  body: { ...PolarType.body, color: Polar.nightText2, marginTop: PolarSpace.s3 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 36, marginTop: PolarSpace.s2 },
  pip: { width: 8, height: 8, borderRadius: 4, backgroundColor: Polar.stone },
  pipOn: { backgroundColor: Polar.signal },
  statusText: { ...PolarType.bodyS, color: Polar.ice, flexShrink: 1 },
  pill: { borderRadius: 999 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: PolarSpace.s4, marginTop: PolarSpace.s2 },
  kept: { marginTop: PolarSpace.s6 },
  keptHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingBottom: PolarSpace.s2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Polar.frost20,
  },
  keptTitle: { ...PolarType.eyebrow, color: Polar.nightText2 },
  keptCount: { ...PolarType.caption, color: Polar.nightText2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PolarSpace.s3,
    paddingVertical: PolarSpace.s3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Polar.frost10,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  rowText: { flex: 1, minWidth: 0 },
  rowWhen: { ...PolarType.label, color: Polar.nightText2 },
  rowCity: { ...PolarType.monument, fontSize: 28, lineHeight: 32, color: Polar.ice, marginTop: 2 },
  rowMeta: { ...PolarType.caption, color: Polar.nightText2, marginTop: 2 },
  rowSaved: { ...PolarType.caption, color: Polar.nightText2, marginTop: 1 },
  empty: { ...PolarType.lead, color: Polar.ice, paddingVertical: PolarSpace.s4 },
  note: { ...PolarType.caption, color: Polar.nightText2, marginTop: PolarSpace.s3 },
  monumentWrap: { marginTop: 'auto', paddingTop: PolarSpace.s6, alignItems: 'center' },
});
