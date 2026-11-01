import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlurView } from '@/components/blur';
import { SymbolView } from '@/components/symbol';
import { apiBaseUrl } from '@/api/config';
import { copySharedTrip, getSharedTrip } from '@/api/tripMateApi';
import type { SharedTrip } from '@/api/types';
import { DayMap } from '@/components/day-map';
import { COVER_HEIGHT, Cover, DayHead, DayTiles, LinkOff, SharedColors, StopSheet, ThumbBar, Timeline } from '@/components/shared-trip';
import { Polar } from '@/constants/polar';
import { Text } from '@/components/themed-text';

/**
 * A trip somebody sent you, opened in the app: `tripmate://s/<token>`, the same token as the web's
 * `/s/<token>` link. Read-only — nothing here writes to the sender's trip. What the recipient can do
 * is read every day, see it on the map, get directions, pass the link on, and save a copy, which is
 * a trip of their own from then on (`POST /api/shared/[token]/copy`).
 *
 * **The list stays mounted under the map**, faded rather than unmounted, so coming back from the map
 * keeps your place — the same reason the trip screen's `MapFace` never unmounts.
 *
 * **The day tiles stick by the ScrollView's own sticky header**, not by a second copy floated over
 * it. The sticky element carries a transparent spacer the height of the compact bar, and the cover
 * overlaps that spacer by the same amount, so in the flow the tiles sit right under the photograph
 * and, stuck, they sit right under the bar that fades in over the spacer.
 */
type Load = SharedTrip | null | undefined | 'loading';
type Save = 'idle' | 'saving' | 'saved' | 'failed';

export default function SharedTripScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [trip, setTrip] = useState<Load>('loading');
  const [attempt, setAttempt] = useState(0);
  const [day, setDay] = useState(0);
  const [face, setFace] = useState<'list' | 'map'>('list');
  const [save, setSave] = useState<Save>('idle');
  const [copyId, setCopyId] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [emphasis, setEmphasis] = useState<number | null>(null);
  const [barHeight, setBarHeight] = useState(0);
  const [compact, setCompact] = useState(false);
  const [chromeHeight, setChromeHeight] = useState(0);
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const NAV = insets.top + 44;
  const STICK = COVER_HEIGHT - NAV;

  useEffect(() => {
    let live = true;
    getSharedTrip(token).then((next) => {
      if (live) setTrip(next);
    });
    return () => {
      live = false;
    };
  }, [token, attempt]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  useAnimatedReaction(
    () => scrollY.value > STICK - 24,
    (now, before) => {
      if (now !== before) runOnJS(setCompact)(now);
    },
    [STICK],
  );
  const navStyle = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [STICK - 60, STICK], [0, 1], 'clamp') }));

  // White over the photograph, dark once the light ground is under it. iOS 26 ignores this and picks
  // the bar's colour from what is under it, which is why the cover shades its own head (`Cover`);
  // it still governs earlier systems.
  const overPhoto = typeof trip === 'object' && trip !== null && !compact && face === 'list';
  const bar = <StatusBar style={overPhoto ? 'light' : 'dark'} />;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const passOn = () => {
    const url = `${apiBaseUrl}/s/${token}`;
    Share.share(Platform.OS === 'ios' ? { url } : { message: url }).catch(() => {});
  };

  if (trip === 'loading' || trip === null || trip === undefined) {
    return (
      <View style={styles.ground}>
        {bar}
        {trip === 'loading' ? (
          <View style={styles.skeleton} accessible accessibilityLabel="Opening the shared trip" accessibilityRole="progressbar">
            <View style={[styles.skCover, { paddingTop: insets.top }]}>
              <ActivityIndicator color={Polar.ember} />
              <Text style={styles.endText}>Opening the shared trip</Text>
            </View>
            <View style={styles.skTiles}>
              {Array.from({ length: 6 }, (_, i) => (
                <View key={i} style={styles.skTile} />
              ))}
            </View>
            <View style={[styles.skLine, { width: '55%', height: 26, marginTop: 18 }]} />
            <View style={[styles.skLine, { width: '75%' }]} />
            <View style={styles.skCard} />
          </View>
        ) : (
          <View style={styles.end}>
            <View style={styles.endIcon}>
              {trip === null ? <LinkOff /> : <SymbolView name={{ ios: 'wifi.exclamationmark', android: 'wifi_off' }} size={26} tintColor={SharedColors.grey} />}
            </View>
            <Text style={styles.endTitle} accessibilityRole="header">
              {trip === null ? "This link isn't active." : "Couldn't open this trip."}
            </Text>
            <Text style={styles.endText}>
              {trip === null ? 'Whoever sent it may have stopped sharing. Ask them for a new link.' : 'Check your connection and try again.'}
            </Text>
            <Pressable
              onPress={() => {
                if (trip === null) router.replace('/plan/basics');
                else {
                  setTrip('loading');
                  setAttempt((n) => n + 1);
                }
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.endAction, pressed && styles.pressed]}>
              <Text style={styles.endActionText}>{trip === null ? 'Plan your own trip' : 'Try again'}</Text>
            </Pressable>
          </View>
        )}
        <CloseCorner top={insets.top + 4} onPress={close} />
      </View>
    );
  }

  const days = trip.itinerary.days;
  const d = days[day] ?? days[0];
  const nights = Math.max(days.length - 1, 1);

  const pick = (index: number) => {
    if (index < 0 || index >= days.length) return;
    setDay(index);
    setEmphasis(null);
    // Reading below the cover: bring the new day's start up under the tiles.
    if (scrollY.value > STICK) scroller.current?.scrollTo({ y: STICK, animated: true });
  };

  const saveCopy = async () => {
    setSave('saving');
    const id = await copySharedTrip(token);
    if (id) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopyId(id);
      setSave('saved');
    } else setSave('failed');
  };

  const nav = (
    <View style={[styles.nav, { paddingTop: insets.top, height: NAV }]}>
      <RoundLight icon="xmark" label="Close" onPress={close} />
      <View style={styles.navTitle}>
        <Text style={styles.navCity} numberOfLines={1}>
          {trip.destination.split(',')[0].trim()}
        </Text>
        {trip.sharedBy ? <Text style={styles.navSub}>From {trip.sharedBy}</Text> : null}
      </View>
      <RoundLight icon="square.and.arrow.up" label="Share the link" onPress={passOn} />
    </View>
  );

  return (
    <View style={styles.ground}>
      {bar}
      <View style={[StyleSheet.absoluteFill, face === 'map' && styles.away]} pointerEvents={face === 'map' ? 'none' : 'auto'} importantForAccessibility={face === 'map' ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={face === 'map'}>
        <Animated.ScrollView ref={scroller} onScroll={onScroll} scrollEventThrottle={16} stickyHeaderIndices={[1]} contentContainerStyle={{ paddingBottom: barHeight + 24 }}>
          <View style={{ marginBottom: -NAV }}>
            {/* What a pull-down past the top reveals: the cover's dark, not the page's ground. */}
            <View style={styles.overscroll} />
            <Cover trip={trip} onClose={close} onShare={passOn} />
          </View>
          <View pointerEvents="box-none">
            <View style={{ height: NAV }} pointerEvents="none" />
            <View style={styles.tilesStuck}>
              <DayTiles days={days} current={day} onPick={pick} />
            </View>
          </View>
          <View
            key={day}
            onTouchStart={(e) => (touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
            onTouchEnd={(e) => {
              const start = touch.current;
              touch.current = null;
              if (!start) return;
              const dx = e.nativeEvent.pageX - start.x;
              const dy = e.nativeEvent.pageY - start.y;
              if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) pick(day + (dx < 0 ? 1 : -1));
            }}>
            <DayHead day={d} index={day} />
            <Timeline stops={d.stops} onOpen={setOpen} />
            {d.lodging?.name ? (
              <View style={styles.stay}>
                <SymbolView name={{ ios: 'bed.double.fill', android: 'bed' }} size={15} tintColor={SharedColors.grey} />
                <Text style={styles.stayText}>
                  <Text style={styles.stayName}>{d.lodging.name}</Text>
                  {day < days.length - 1 ? ` · night ${day + 1} of ${nights}` : ''}
                </Text>
              </View>
            ) : null}
            {day < days.length - 1 ? (
              <Pressable onPress={() => pick(day + 1)} accessibilityRole="button" style={({ pressed }) => [styles.next, pressed && styles.pressed]}>
                <View style={styles.nextText}>
                  <Text style={styles.nextLabel}>{days[day + 1].theme || days[day + 1].title ? `Next · Day ${day + 2}` : 'Next'}</Text>
                  <Text style={styles.nextTitle} numberOfLines={1}>
                    {days[day + 1].theme || days[day + 1].title || `Day ${day + 2}`}
                  </Text>
                </View>
                <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right' }} size={14} tintColor={SharedColors.grey} />
              </Pressable>
            ) : null}
            <Text style={styles.foot}>
              {trip.sharedBy
                ? `Shared by ${trip.sharedBy} on TripMate. A saved copy is yours to change: it won't follow ${trip.sharedBy}'s later edits, and ${trip.sharedBy}'s bookings stay with ${trip.sharedBy}.`
                : "Shared on TripMate. A saved copy is yours to change: it won't follow later edits to this plan, and its bookings stay with the sender."}
            </Text>
          </View>
        </Animated.ScrollView>
        <Animated.View style={[styles.navWrap, navStyle]} pointerEvents={compact ? 'auto' : 'none'}>
          <BlurView intensity={90} tint="systemChromeMaterialLight" style={StyleSheet.absoluteFill} />
          {nav}
        </Animated.View>
      </View>

      {face === 'map' ? (
        <>
          {/* Below the bar rather than under it, so the map's own controls stay in sight. */}
          <View style={[styles.mapArea, { top: chromeHeight }]}>
            <DayMap stops={d.stops} dayIndex={day} emphasis={emphasis} onEmphasise={setEmphasis} lift={barHeight} />
          </View>
          <View style={styles.mapChrome} onLayout={(e) => setChromeHeight(e.nativeEvent.layout.height)}>
            {nav}
            <DayTiles days={days} current={day} onPick={pick} />
          </View>
        </>
      ) : null}

      <ThumbBar
        face={face}
        onFace={setFace}
        phase={save}
        sharedBy={trip.sharedBy}
        onSave={saveCopy}
        onOpenCopy={() => copyId && router.push({ pathname: '/trip/[id]', params: { id: copyId } })}
        onHeight={setBarHeight}
      />

      <StopSheet stop={open === null ? null : (d.stops[open] ?? null)} index={open ?? 0} day={d} onClose={() => setOpen(null)} />
    </View>
  );
}

/** Close, on the light ground the loading and ended states stand on. */
function CloseCorner({ top, onPress }: { top: number; onPress: () => void }) {
  return (
    <View style={[styles.corner, { top }]}>
      <RoundLight icon="xmark" label="Close" onPress={onPress} />
    </View>
  );
}

/** A 44pt target around a 36pt grey disc: the system's light-ground round button. */
function RoundLight({ icon, label, onPress }: { icon: 'xmark' | 'square.and.arrow.up'; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.round, pressed && styles.pressed]}>
      <View style={styles.roundDisc}>
        <SymbolView name={{ ios: icon, android: icon === 'xmark' ? 'close' : 'share' }} size={15} tintColor={Polar.ink} weight="semibold" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: SharedColors.ground },
  pressed: { opacity: 0.6 },
  away: { opacity: 0 },
  overscroll: { position: 'absolute', top: -1000, left: 0, right: 0, height: 1000, backgroundColor: '#1C1C1E' },

  navWrap: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  navTitle: { flex: 1, alignItems: 'center' },
  navCity: { fontSize: 17, fontWeight: '600', color: '#000' },
  navSub: { fontSize: 12, color: SharedColors.grey },
  round: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  roundDisc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(120,120,128,0.14)' },
  tilesStuck: {
    backgroundColor: SharedColors.ground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.2)',
  },
  mapArea: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  mapChrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: SharedColors.ground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.2)',
  },

  stay: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginTop: 14 },
  stayText: { flex: 1, fontSize: 14, color: SharedColors.grey },
  stayName: { fontWeight: '500', color: '#000' },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  nextText: { flex: 1 },
  nextLabel: { fontSize: 12, color: Polar.ember },
  nextTitle: { fontSize: 16, fontWeight: '600', color: '#000' },
  foot: { marginHorizontal: 32, marginTop: 18, fontSize: 13, lineHeight: 18, textAlign: 'center', color: SharedColors.grey },

  corner: { position: 'absolute', left: 8 },
  end: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40 },
  endIcon: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 6, backgroundColor: 'rgba(120,120,128,0.14)' },
  endTitle: { fontSize: 20, fontWeight: '600', color: '#000', textAlign: 'center' },
  endText: { fontSize: 15, lineHeight: 21, color: SharedColors.grey, textAlign: 'center' },
  // The screen's one way on, so a filled pill rather than a link (the app's in-app action shape).
  endAction: { marginTop: 14, minHeight: 50, paddingHorizontal: 28, borderRadius: 25, justifyContent: 'center', backgroundColor: Polar.signal },
  endActionText: { fontSize: 17, fontWeight: '600', color: Polar.ink },

  skeleton: { flex: 1 },
  skCover: { height: COVER_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#E5E5EA' },
  skTiles: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  skTile: { width: 48, height: 52, borderRadius: 12, backgroundColor: '#fff' },
  skLine: { height: 14, marginHorizontal: 20, marginTop: 10, borderRadius: 7, backgroundColor: '#E5E5EA' },
  skCard: { height: 220, marginHorizontal: 16, marginTop: 18, borderRadius: 16, backgroundColor: '#fff' },
});
