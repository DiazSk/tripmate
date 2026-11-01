import { Image } from 'expo-image';
import { createContext, useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, type DimensionValue } from 'react-native';
import { Marker, Polyline, type Camera, type Region } from 'react-native-maps';
import Animated, { SlideInDown, SlideOutDown, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dayCost, fmtCost, fmtDur, LENS_ORDER, LENSES, PETRA_BEATS, routeAlongTrail, toMin, TRAIL, type LensId, type LngLat, type Stop } from '@shared/petraDay';
import { legBearingRad } from '@shared/tourPacing';
import MapView, { type MapViewRef } from '@/components/map-view';
import { DIVE_ALTITUDE_M, PITCH_3D } from '@/components/map-controls';
import { Polar, PolarFonts, PolarMotion, PolarRadius, PolarSpace, PolarType } from '@/constants/polar';
import { altitudeForRegion, regionForStops } from '@/lib/mapRegion';
import { PETRA_IMG } from './content';
import { Scrim } from './scrim';
import { Text } from '@/components/themed-text';

/**
 * "A day you can imagine": the day in Petra told as the hours pass (the story's ground keeping the
 * sky's time), the same day four ways, and the plan behind it on the night globe. The data is the
 * web's own `src/lib/petraDay.ts`, so the two landings tell the same day.
 */

/* ───────────────────────── Scroll ticks ───────────────────────── */

// Sections that must *change state* with the scroll (which beat is lit, whether the globe has flown
// to Petra) subscribe here; the screen's onScroll calls them. A setState that does not change the
// value re-renders nothing, so this costs a comparison per event, not a render.
export type Tick = (y: number, vh: number) => void;
export const TickContext = createContext<{ add: (f: Tick) => () => void } | null>(null);
function useTick(f: Tick) {
  const ctx = useContext(TickContext);
  const onTick = useEffectEvent(f);
  useEffect(() => ctx?.add((y, vh) => onTick(y, vh)), [ctx]);
}

const latLng = ([longitude, latitude]: LngLat) => ({ latitude, longitude });
const placeable = ([lng, lat]: LngLat) => ({ lat, lng });

/* ───────────────────────── Picture a day ───────────────────────── */

export function DayStory({ top, width, onOpenStop, onWays }: { top: SharedValue<number>; width: number; onOpenStop: (id: string) => void; onWays: () => void }) {
  const [active, setActive] = useState(0);
  const beatTops = useRef<number[]>([]);
  const storyTop = useRef(0);
  const reduce = useReducedMotion();
  const sky = PETRA_BEATS[active].sky;
  useTick((y, vh) => {
    const line = y + vh * 0.55 - top.get() - storyTop.current;
    let i = 0;
    beatTops.current.forEach((t, k) => {
      if (t <= line) i = k;
    });
    setActive(i);
  });
  const photoW = width - PolarSpace.pad * 2;
  return (
    <View>
      <View style={styles.dayIntro}>
        <Text style={[PolarType.eyebrow, { color: Polar.ember }]}>Picture a day</Text>
        <Text style={[PolarType.display, { color: Polar.ink }]} accessibilityRole="header">
          What would a day here actually feel like?
        </Text>
        <Text style={[PolarType.body, { color: Polar.charcoal }]}>
          Not the sights, the hours. Here is one Wednesday in Petra, from the first coffee to the last candle, told the way you would remember it.
        </Text>
      </View>
      {/* The ground keeps the sky's time: dawn grey, sand, noon white, rose, then night. A
          Reanimated CSS transition, so the colour eases on the UI thread with no shared value. */}
      <Animated.View
        onLayout={(e) => {
          storyTop.current = e.nativeEvent.layout.y;
        }}
        style={[styles.story, { backgroundColor: sky.bg }, !reduce && { transitionProperty: 'backgroundColor', transitionDuration: 1200 }]}>
        <View style={styles.ticks}>
          {PETRA_BEATS.map((b, i) => (
            <View key={b.stop} style={[styles.tick, { backgroundColor: i <= active ? sky.fg : sky.rule }]} />
          ))}
        </View>
        {PETRA_BEATS.map((b, i) => (
          <View
            key={b.stop}
            style={styles.beat}
            onLayout={(e) => {
              beatTops.current[i] = e.nativeEvent.layout.y;
            }}>
            <View style={[styles.beatPhoto, { width: photoW, height: photoW * 1.2 }]}>
              <Image source={PETRA_IMG[b.photo]} style={StyleSheet.absoluteFill} contentFit="cover" />
              <View style={styles.beatCaption}>
                <Text style={styles.beatCaptionK}>
                  {b.part} · {b.time}
                </Text>
                <Text style={styles.beatCaptionV}>{b.caption}</Text>
              </View>
            </View>
            <Text style={[PolarType.label, { color: sky.fg2 }]}>
              {b.part} · {b.time}
            </Text>
            <Text style={[styles.beatLine, { color: sky.fg }]}>{b.line}</Text>
            <Text style={[PolarType.body, { color: sky.fg2 }]}>{b.body}</Text>
            <Pressable onPress={() => onOpenStop(b.stop)} style={({ pressed }) => [styles.selfStart, pressed && styles.dim]} accessibilityRole="button" hitSlop={6}>
              <Text style={[styles.link, { color: sky.fg, borderBottomColor: sky.fg }]}>See this stop in the plan</Text>
            </Pressable>
          </View>
        ))}
        <View style={[styles.storyEnd, { borderTopColor: sky.rule }]}>
          <Text style={[PolarType.lead, { color: sky.fg }]}>That was the slow way.</Text>
          <Pressable onPress={onWays} style={({ pressed }) => [styles.selfStart, pressed && styles.dim]} accessibilityRole="button">
            <Text style={[PolarType.lead, styles.underline, { color: sky.fg }]}>There are three others.</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

/* ───────────────────────── The same day, four ways ───────────────────────── */

export function Ways({ lens, setLens, width }: { lens: LensId; setLens: (l: LensId) => void; width: number }) {
  const cardW = (width - PolarSpace.pad * 2 - PolarSpace.gutter) / 2;
  return (
    <View style={styles.ways}>
      <Text style={[PolarType.eyebrow, { color: Polar.ember }]}>Make it yours</Text>
      <Text style={[PolarType.display, { color: Polar.ink }]} accessibilityRole="header">
        The same day, four ways.
      </Text>
      <Text style={[PolarType.body, { color: Polar.charcoal }]}>
        Same valley, same Wednesday. Tell TripMate how you like to travel and the day rearranges itself around it. Pick one and the plan below follows.
      </Text>
      <View style={styles.lensGrid} accessibilityRole="radiogroup" accessibilityLabel="How you like to travel">
        {LENS_ORDER.map((id) => {
          const x = LENSES[id];
          const on = id === lens;
          return (
            <Pressable
              key={id}
              onPress={() => setLens(id)}
              style={({ pressed }) => [styles.lens, { width: cardW }, on && styles.lensOn, pressed && styles.dim]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}>
              <View style={{ width: '100%', height: cardW * 1.15 }}>
                <Image source={PETRA_IMG[x.photo]} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={[styles.lensTag, on && { backgroundColor: Polar.signal }]}>
                  <Text style={styles.lensTagText}>{on ? 'Selected' : x.short}</Text>
                </View>
              </View>
              <View style={[styles.lensBody, on && { backgroundColor: Polar.ink }]}>
                <Text style={[styles.lensName, on && { color: Polar.ice }]}>{x.name}</Text>
                <Text style={[PolarType.caption, { color: on ? 'rgba(255,255,255,0.85)' : Polar.charcoal }]}>{x.line}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.changes} accessibilityLiveRegion="polite">
        <Text style={[PolarType.label, { color: Polar.charcoal }]}>What changes</Text>
        {LENSES[lens].changes.map((c) => (
          <Text key={c} style={[PolarType.lead, { color: Polar.ink }]}>
            {c}
          </Text>
        ))}
      </View>
    </View>
  );
}

/* ───────────────────────── The plan behind it, on the globe ───────────────────────── */

/** The whole world, from far enough out that Apple Maps draws it whole. */
const GLOBE: Camera = { center: { latitude: 30, longitude: 40 }, altitude: 22_000_000, pitch: 0, heading: 0, zoom: 1 };
const PETRA = { latitude: 30.3285, longitude: 35.4444 };
const DAY0 = 5 * 60;
const SPAN = 18 * 60;
const pct = (m: number) => `${(m / SPAN) * 100}%` as DimensionValue;

/**
 * **Apple Maps sizes a custom marker's frame from its first render, and only re-measures on a
 * later one** (measured on the previous version of this section: a marker that never re-rendered
 * drew ~110pt east of its coordinate). So every set of pins is hidden until it has had a second
 * render, and then needs no offset at all. `anchor` does nothing here either, so each pin is drawn
 * symmetric about its point: the label one side, the same width of empty space the other.
 */
const SETTLE_MS = 400;
const STOP_LABEL_W = 170;
const CITY_LABEL_W = 110;
const STOP_PIN_W = STOP_LABEL_W * 2 + 32;
const CITY_PIN_W = CITY_LABEL_W * 2 + 20;

export function PlanMap({
  top,
  width,
  lens,
  setLens,
  hot,
  setHot,
  dateLabel,
  onOpen,
}: {
  top: SharedValue<number>;
  width: number;
  lens: LensId;
  setLens: (l: LensId) => void;
  hot: string | null;
  setHot: (s: string | null) => void;
  /** "Wed 14 Apr 2027": the sample's date, computed from today by the screen. */
  dateLabel: string;
  onOpen: () => void;
}) {
  const map = useRef<MapViewRef>(null);
  const reduce = useReducedMotion();
  const height = Math.round(width * 1.05);
  const stops = LENSES[lens].stops;
  const [ready, setReady] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [far, setFar] = useState(true);
  const [playing, setPlaying] = useState(false);
  const mapTop = useRef(0);
  const hotIndex = stops.findIndex((s) => s.id === hot);
  // At Petra once it has flown there, or whenever a stop is in focus (a beat's "See this stop").
  const shown = arrived || hot !== null;
  const km = stops.reduce((s, x) => s + (x.next?.km ?? 0) + (x.walkKm ?? 0), 0);
  const route = routeAlongTrail(stops.map((s) => s.at)).map(latLng);

  const pinSet = far ? 'globe' : lens;
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const settled = ready && settledFor === pinSet;
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setSettledFor(pinSet), SETTLE_MS);
    return () => clearTimeout(t);
  }, [ready, pinSet]);

  // The first time the map is well up the screen, leave the globe for Petra.
  useTick((y, vh) => {
    if (ready && !shown && y + vh * 0.6 > top.get() + mapTop.current) setArrived(true);
  });

  // One camera for every state: the day framed, or the stop in focus facing the way you travel.
  // A new way of the day redraws in place. Apple Maps ignores the duration on this architecture,
  // so it flies at its own pace either way.
  useEffect(() => {
    if (!ready || !shown) return;
    const pts = stops.map((s) => placeable(s.at));
    let camera: Camera;
    if (hotIndex >= 0) {
      const rad = legBearingRad(pts, hotIndex);
      camera = { center: latLng(stops[hotIndex].at), altitude: DIVE_ALTITUDE_M, pitch: PITCH_3D, heading: rad === null ? 342 : (rad * 180) / Math.PI, zoom: 16 };
    } else {
      const region = regionForStops(pts)!;
      // `altitudeForRegion` reads the latitude span only; a day that runs east-west on a map this
      // shape needs its longitude span counted too, or the ends fall off the sides.
      const lngAsLat = region.longitudeDelta * Math.cos((region.latitude * Math.PI) / 180) * (height / width);
      const altitude = altitudeForRegion({ ...region, latitudeDelta: Math.max(region.latitudeDelta, lngAsLat) });
      camera = { center: { latitude: region.latitude, longitude: region.longitude }, altitude: altitude * 1.4, pitch: 42, heading: 342, zoom: 14 };
    }
    map.current?.animateCamera(camera, { duration: reduce ? 0 : 1600 });
  }, [ready, shown, hotIndex, stops, reduce, height, width]);

  // Playback: the stop in focus is the clock. The hold is the only one this app owns on iOS.
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(
      () => {
        if (hotIndex + 1 >= stops.length) {
          setPlaying(false);
          setHot(null);
        } else setHot(stops[hotIndex + 1].id);
      },
      hotIndex < 0 ? 300 : PolarMotion.hold,
    );
    return () => clearTimeout(t);
  }, [playing, hotIndex, stops, setHot]);

  const toGlobe = () => {
    setPlaying(false);
    setHot(null);
    setArrived(false);
    map.current?.animateCamera(GLOBE, { duration: reduce ? 0 : 2400 });
  };
  const focusStop = (id: string | null) => {
    setPlaying(false);
    setHot(id);
  };

  const scale = far ? 'Globe' : hotIndex >= 0 ? 'Street' : 'City';
  const focus = hotIndex >= 0 ? stops[hotIndex].at : shown ? ([PETRA.longitude, PETRA.latitude] as LngLat) : null;

  return (
    <View style={styles.night}>
      <View style={styles.nightHead}>
        <Text style={[PolarType.eyebrow, { color: Polar.signal }]}>The plan behind it</Text>
        <Text style={[PolarType.display, { color: Polar.ice }]} accessibilityRole="header">
          The same day, written down.
        </Text>
        <Text style={[PolarType.bodyS, { color: Polar.nightText2 }]}>
          Every stop with what makes it worth going, how long to give it, how far it is to the next and what it costs.
        </Text>
      </View>

      <View
        style={{ width, height }}
        onLayout={(e) => {
          mapTop.current = e.nativeEvent.layout.y;
        }}>
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          initialCamera={GLOBE}
          userInterfaceStyle="dark"
          mapType="mutedStandard"
          showsPointsOfInterests={false}
          showsCompass={false}
          // The flight is the interaction. A map that also pans would fight the page's own scroll
          // for every vertical drag that starts on it.
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          onMapReady={() => setReady(true)}
          onRegionChangeComplete={(r: Region) => setFar(r.latitudeDelta > 1.5)}>
          {far && (
            <Marker coordinate={PETRA} onPress={() => setArrived(true)} tracksViewChanges>
              <View style={[styles.cityPin, { opacity: settled ? 1 : 0 }]} accessibilityRole="button" accessibilityLabel="Fly to Petra">
                <View style={styles.cityDot} />
                <Text numberOfLines={1} style={styles.cityName}>
                  Petra
                </Text>
              </View>
            </Marker>
          )}
          {/* Order is z-order: Apple Maps ignores a Polyline's zIndex (see day-map.tsx). */}
          <Polyline coordinates={TRAIL.map(latLng)} strokeColor="rgba(168,172,179,0.35)" strokeWidth={1.2} lineDashPattern={[3, 3]} />
          <Polyline coordinates={route} strokeColor={Polar.route} strokeWidth={2.4} lineCap="round" lineJoin="round" />
          {stops.map((s, i) => {
            const on = s.id === hot;
            const past = hotIndex >= 0 && i < hotIndex;
            // The Treasury at dawn and by candlelight: nudge the second pin off the first.
            const dup = stops.slice(0, i).some((p) => p.at[0] === s.at[0] && p.at[1] === s.at[1]);
            return (
              <Marker key={`${lens}-${s.id}`} coordinate={latLng(s.at)} zIndex={on ? 999 : i} tracksViewChanges onPress={() => focusStop(s.id)}>
                <View style={[styles.stopPin, { opacity: far || !settled ? 0 : 1 }, dup && styles.dup]}>
                  <View style={[styles.stopDisc, past && styles.stopDiscPast, on && styles.stopDiscOn]}>
                    <Text style={[styles.stopN, (past || on) && { color: Polar.night }]}>{i + 1}</Text>
                  </View>
                  {on && (
                    <View style={styles.stopTag}>
                      <Text style={styles.stopTime}>{s.time}</Text>
                      <Text numberOfLines={1} style={styles.stopName}>
                        {s.title}
                      </Text>
                    </View>
                  )}
                </View>
              </Marker>
            );
          })}
        </MapView>
        <Scrim stops={[[0, Polar.night, 1], [0.14, Polar.night, 0], [0.82, Polar.night, 0], [1, Polar.night, 1]]} />
        <View style={styles.hud} pointerEvents="box-none">
          <View style={styles.scaleChip}>
            <Text style={styles.scaleText}>{ready ? scale : 'Loading'}</Text>
          </View>
          {focus && (
            <Text style={styles.coord}>
              {focus[1].toFixed(4)}º N, {focus[0].toFixed(4)}º E
            </Text>
          )}
          {ready && (
            <Pressable onPress={shown ? toGlobe : () => setArrived(true)} style={({ pressed }) => [styles.hudBtn, pressed && styles.dim]} accessibilityRole="button">
              <Text style={styles.hudBtnText}>{shown ? 'Back to the globe' : 'Fly to Petra'}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* The plan, compact: the row in focus opens to its reasons; the rest stay one line. */}
      <View style={styles.planCard}>
        <View style={styles.planHead}>
          <Text style={[PolarType.label, { color: Polar.charcoal }]}>Day 2 · {dateLabel} · Sample</Text>
          <View style={styles.seg} accessibilityRole="radiogroup" accessibilityLabel="Way to travel">
            {LENS_ORDER.map((id) => {
              const on = id === lens;
              return (
                <Pressable key={id} onPress={() => setLens(id)} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <Text style={[styles.segText, on && { color: Polar.ice }]}>{LENSES[id].short}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.statRow}>
            {[
              ['Stops', String(stops.length)],
              ['On foot', `≈ ${km.toFixed(1)} km`],
              ['Per person', `$${dayCost(stops)}`],
            ].map(([k, v]) => (
              <View key={k} style={styles.flex}>
                <Text style={[PolarType.label, { color: Polar.charcoal, fontSize: 11 }]}>{k}</Text>
                <Text style={styles.statV}>{v}</Text>
              </View>
            ))}
          </View>
          <View style={styles.rhythm} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.daylight, { left: pct(toMin('06:12') - DAY0), width: pct(toMin('19:04') - toMin('06:12')) }]} />
            {stops.map((s) => (
              <View key={s.id} style={[styles.rhythmSeg, { left: pct(toMin(s.time) - DAY0), width: pct(s.min), backgroundColor: s.id === hot ? Polar.signal : Polar.ink }]} />
            ))}
          </View>
        </View>

        {stops.map((s, i) => (
          <PlanRow key={`${lens}-${s.id}`} stop={s} n={i + 1} open={s.id === hot} onPress={() => focusStop(s.id === hot ? null : s.id)} />
        ))}

        <View style={styles.planFoot}>
          <Pressable onPress={() => setPlaying((p) => !p)} style={({ pressed }) => [styles.playBtn, pressed && styles.dim]} accessibilityRole="button" accessibilityState={{ selected: playing }}>
            <Text style={styles.playText}>{playing ? 'Pause' : hotIndex >= 0 ? 'Resume' : 'Play the day'}</Text>
            <Text style={styles.playText}>{playing ? '❚❚' : '▸'}</Text>
          </Pressable>
          <Text style={[PolarType.caption, styles.flex, { color: Polar.charcoal }]} accessibilityLiveRegion="polite">
            {hotIndex >= 0 ? `Stop ${hotIndex + 1} of ${stops.length}` : `${stops.length} stops`}
          </Text>
          <Pressable onPress={onOpen} style={({ pressed }) => [styles.signal, pressed && styles.signalPressed]} accessibilityRole="button">
            <Text style={styles.signalText}>Open in planner</Text>
          </Pressable>
        </View>
      </View>
      <Text style={[PolarType.caption, styles.note]}>
        A sample journey. Costs are 2027 estimates in US dollars per person, and TripMate checks opening days and prices against your real dates.
      </Text>
    </View>
  );
}

function PlanRow({ stop: s, n, open, onPress }: { stop: Stop; n: number; open: boolean; onPress: () => void }) {
  // Opens on the reveal curve: height follows the measured body, so nothing is cut or guessed.
  const reduce = useReducedMotion();
  const h = useSharedValue(0);
  const p = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    p.set(reduce ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: 300 }));
  }, [open, reduce, p]);
  const body = useAnimatedStyle(() => ({ height: h.value * p.value, opacity: p.value }));
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.planRow, open && styles.rowOn, pressed && styles.dim]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <View style={styles.rowTime}>
        <Text style={styles.rowClock}>{s.time}</Text>
        <Text style={[PolarType.caption, { color: Polar.charcoal, fontSize: 11 }]}>{fmtDur(s.min)}</Text>
      </View>
      <View style={[styles.rowN, open && { backgroundColor: Polar.signal }]}>
        <Text style={[styles.rowNText, open && { color: Polar.ink }]}>{n}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={[PolarType.label, { color: Polar.charcoal, fontSize: 11 }]}>{s.kind}</Text>
        <Text style={styles.rowTitle}>{s.title}</Text>
        <Animated.View style={[styles.clip, body]}>
          <View
            style={styles.rowBody}
            onLayout={(e) => {
              h.set(e.nativeEvent.layout.height);
            }}>
            <Text style={[PolarType.bodyS, { color: Polar.ink }]}>{s.why}</Text>
            <Text style={[PolarType.caption, { color: Polar.charcoal }]}>● {s.practical}</Text>
            {s.next && <Text style={[PolarType.caption, { color: Polar.charcoal }]}>↓ {s.next.text}</Text>}
          </View>
        </Animated.View>
      </View>
      <Text style={styles.rowCost}>{fmtCost(s.cost)}</Text>
    </Pressable>
  );
}

/* ───────────────────────── Open this day in the planner ───────────────────────── */

export function OpenDaySheet({
  visible,
  lens,
  dateLabel,
  onClose,
  onDismiss,
  onOpen,
}: {
  visible: boolean;
  lens: LensId;
  dateLabel: string;
  onClose: () => void;
  onDismiss: () => void;
  onOpen: (adults: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [adults, setAdults] = useState(2);
  const L = LENSES[lens];
  const word = (n: number) => (n === 1 ? 'adult' : 'adults');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismiss} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <Animated.View entering={SlideInDown.duration(450)} exiting={SlideOutDown.duration(300)} style={[styles.sheet, { paddingBottom: insets.bottom + PolarSpace.s3 }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetBody}>
          <Text style={[PolarType.label, { color: Polar.charcoal }]}>Open in the planner</Text>
          <Text style={styles.sheetTitle} accessibilityRole="header">
            This day comes with you.
          </Text>
          <View style={styles.dl}>
            {[
              ['Where', 'Petra, Jordan'],
              ['When', `${dateLabel} · day 2`],
              ['The way', L.name],
              ['Estimate', `$${dayCost(L.stops)} per person`],
            ].map(([k, v]) => (
              <View key={k} style={styles.dlRow}>
                <Text style={[PolarType.bodyS, { color: Polar.charcoal }]}>{k}</Text>
                <Text style={[PolarType.ui, { color: Polar.ink }]}>{v}</Text>
              </View>
            ))}
            <View style={styles.dlRow}>
              <Text style={[PolarType.bodyS, { color: Polar.charcoal }]}>Travellers</Text>
              {/* One adjustable element for VoiceOver (swipe up and down), the two buttons for touch. */}
              <View
                style={styles.stepper}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="Travellers"
                accessibilityValue={{ text: `${adults} ${word(adults)}` }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={(e) => setAdults((a) => (e.nativeEvent.actionName === 'increment' ? Math.min(8, a + 1) : Math.max(1, a - 1)))}>
                <Pressable onPress={() => setAdults((a) => Math.max(1, a - 1))} disabled={adults <= 1} hitSlop={6} accessibilityRole="button" style={[styles.stepBtn, adults <= 1 && styles.disabled]} accessibilityLabel="One fewer adult">
                  <Text style={styles.stepSign}>−</Text>
                </Pressable>
                <Text style={[PolarType.ui, styles.stepValue]}>
                  {adults} {word(adults)}
                </Text>
                <Pressable onPress={() => setAdults((a) => Math.min(8, a + 1))} disabled={adults >= 8} hitSlop={6} accessibilityRole="button" style={[styles.stepBtn, adults >= 8 && styles.disabled]} accessibilityLabel="One more adult">
                  <Text style={styles.stepSign}>+</Text>
                </Pressable>
              </View>
            </View>
          </View>
          <View style={styles.sheetActions}>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.ghostInk, styles.flex, pressed && styles.dim]} accessibilityRole="button">
              <Text style={[PolarType.ui, { color: Polar.ink }]}>Not yet</Text>
            </Pressable>
            <Pressable onPress={() => onOpen(adults)} style={({ pressed }) => [styles.signal, styles.signalLg, { flex: 1.4 }, pressed && styles.signalPressed]} accessibilityRole="button">
              <Text style={styles.signalText}>Open the planner</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

/* ───────────────────────── Styles ───────────────────────── */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  selfStart: { alignSelf: 'flex-start' },
  dim: { opacity: 0.72 },
  disabled: { opacity: 0.35 },
  clip: { overflow: 'hidden' },
  link: { fontFamily: PolarFonts.sansSemi, fontSize: 14, borderBottomWidth: 1, paddingBottom: 2 },
  underline: { textDecorationLine: 'underline' },

  dayIntro: { paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s12, paddingBottom: PolarSpace.s8, gap: PolarSpace.s4, backgroundColor: Polar.ice },
  story: { paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s5, paddingBottom: PolarSpace.s8 },
  ticks: { flexDirection: 'row', gap: 4, marginBottom: PolarSpace.s5 },
  tick: { flex: 1, height: 2 },
  beat: { gap: PolarSpace.s2, paddingBottom: PolarSpace.s10 },
  beatPhoto: { borderRadius: PolarRadius.sm, overflow: 'hidden', marginBottom: PolarSpace.s3, backgroundColor: Polar.night },
  beatCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: PolarSpace.s3, paddingTop: PolarSpace.s8, backgroundColor: 'rgba(9,11,16,0.35)' },
  beatCaptionK: { fontFamily: PolarFonts.condensed, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.9)' },
  beatCaptionV: { fontFamily: PolarFonts.displayItalic, fontSize: 20, lineHeight: 24, color: Polar.ice },
  beatLine: { fontFamily: PolarFonts.display, fontSize: 36, lineHeight: 39 },
  storyEnd: { borderTopWidth: 1, paddingTop: PolarSpace.s5, gap: 2 },

  ways: { paddingHorizontal: PolarSpace.pad, paddingVertical: PolarSpace.s12, gap: PolarSpace.s4, backgroundColor: Polar.ice },
  lensGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: PolarSpace.gutter, marginTop: PolarSpace.s3 },
  lens: { borderRadius: PolarRadius.sm, overflow: 'hidden', borderWidth: 1, borderColor: Polar.rule, backgroundColor: Polar.ice },
  lensOn: { borderColor: Polar.ink },
  lensTag: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 7, paddingVertical: 4, borderRadius: PolarRadius.hairline, backgroundColor: 'rgba(255,255,255,0.92)' },
  lensTagText: { fontFamily: PolarFonts.sansSemi, fontSize: 11, color: Polar.ink },
  lensBody: { padding: PolarSpace.s2, gap: 2, flexGrow: 1 },
  lensName: { fontFamily: PolarFonts.display, fontSize: 22, lineHeight: 25, color: Polar.ink },
  changes: { borderTopWidth: 1, borderTopColor: Polar.rule, paddingTop: PolarSpace.s4, marginTop: PolarSpace.s3, gap: 4 },

  night: { backgroundColor: Polar.night, paddingBottom: PolarSpace.s10 },
  nightHead: { paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s12, paddingBottom: PolarSpace.s5, gap: PolarSpace.s3 },
  hud: { position: 'absolute', top: PolarSpace.s3, left: PolarSpace.pad, right: PolarSpace.pad, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  scaleChip: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Polar.frost20, borderRadius: PolarRadius.hairline, backgroundColor: 'rgba(9,11,16,0.5)' },
  scaleText: { fontFamily: PolarFonts.condensed, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: Polar.nightText2 },
  coord: { fontFamily: PolarFonts.sans, fontSize: 11, letterSpacing: 0.6, color: Polar.ice, flex: 1 },
  hudBtn: { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.frost20, backgroundColor: 'rgba(9,11,16,0.55)', marginLeft: 'auto' },
  hudBtnText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ice },
  cityPin: { width: CITY_PIN_W, height: 28, alignItems: 'center', justifyContent: 'center' },
  cityDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Polar.route, borderWidth: 2, borderColor: 'rgba(106,240,255,0.35)' },
  cityName: { ...PolarType.label, position: 'absolute', left: CITY_LABEL_W + 18, width: CITY_LABEL_W, color: Polar.ice, textShadowColor: Polar.night, textShadowRadius: 6 },
  stopPin: { width: STOP_PIN_W, height: 44, alignItems: 'center', justifyContent: 'center' },
  dup: { transform: [{ translateX: 14 }, { translateY: -14 }] },
  stopDisc: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.night, borderWidth: 1.5, borderColor: Polar.ice },
  stopDiscPast: { backgroundColor: Polar.ice },
  stopDiscOn: { backgroundColor: Polar.route, borderColor: Polar.route },
  stopN: { fontFamily: PolarFonts.sansSemi, fontSize: 11, color: Polar.ice },
  stopTag: { position: 'absolute', left: STOP_LABEL_W + 30, top: 2, width: STOP_LABEL_W },
  stopTime: { fontFamily: PolarFonts.displayItalic, fontSize: 13, color: Polar.nightText2 },
  stopName: { fontFamily: PolarFonts.condensed, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: Polar.ice, textShadowColor: Polar.night, textShadowRadius: 6 },

  planCard: { marginHorizontal: PolarSpace.pad, marginTop: -PolarSpace.s5, borderRadius: PolarRadius.card, backgroundColor: Polar.ice, overflow: 'hidden' },
  planHead: { padding: PolarSpace.s3, gap: PolarSpace.s3, borderBottomWidth: 1, borderBottomColor: Polar.rule },
  seg: { flexDirection: 'row', padding: 2, gap: 2, borderRadius: 3, backgroundColor: Polar.paper },
  segBtn: { flex: 1, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: PolarRadius.hairline },
  segOn: { backgroundColor: Polar.ink },
  segText: { fontFamily: PolarFonts.sansSemi, fontSize: 12, color: Polar.ink },
  statRow: { flexDirection: 'row', gap: PolarSpace.s2 },
  statV: { fontFamily: PolarFonts.sansRegular, fontSize: 18, color: Polar.ink },
  rhythm: { height: 12, borderRadius: PolarRadius.hairline, backgroundColor: Polar.paper, overflow: 'hidden' },
  daylight: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(255,126,21,0.14)' },
  rhythmSeg: { position: 'absolute', top: 2, bottom: 2, borderRadius: 1 },
  planRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: PolarSpace.s3, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Polar.rule },
  rowOn: { backgroundColor: 'rgba(255,126,21,0.07)' },
  rowTime: { width: 44 },
  rowClock: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },
  rowN: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.ink, marginTop: 1 },
  rowNText: { fontFamily: PolarFonts.sansSemi, fontSize: 11, color: Polar.ice },
  rowTitle: { fontFamily: PolarFonts.display, fontSize: 20, lineHeight: 23, color: Polar.ink },
  rowBody: { position: 'absolute', left: 0, right: 0, top: 0, gap: 6, paddingTop: 6 },
  rowCost: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ink, marginTop: 1 },
  planFoot: { flexDirection: 'row', alignItems: 'center', gap: PolarSpace.s2, padding: PolarSpace.s3 },
  playBtn: { minHeight: 36, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: PolarRadius.hairline, backgroundColor: Polar.ink },
  playText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ice },
  note: { color: Polar.nightText2, paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s3 },

  signal: { minHeight: 36, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, borderRadius: PolarRadius.hairline, backgroundColor: Polar.signal },
  signalPressed: { backgroundColor: Polar.signalPressed },
  signalLg: { minHeight: 46, paddingHorizontal: 20 },
  signalText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },
  ghostInk: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.ink },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(9,11,16,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Polar.ice, borderTopLeftRadius: PolarRadius.md, borderTopRightRadius: PolarRadius.md, paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s2 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: Polar.beige, marginBottom: PolarSpace.s3 },
  sheetBody: { gap: PolarSpace.s3 },
  sheetTitle: { fontFamily: PolarFonts.display, fontSize: 32, lineHeight: 35, color: Polar.ink },
  dl: { borderTopWidth: 1, borderTopColor: Polar.rule },
  dlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: PolarSpace.s3, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: Polar.rule },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.rule },
  stepSign: { fontFamily: PolarFonts.sansSemi, fontSize: 16, color: Polar.ink },
  stepValue: { minWidth: 66, textAlign: 'center', color: Polar.ink },
  sheetActions: { flexDirection: 'row', gap: PolarSpace.s2, marginTop: PolarSpace.s1 },
});
