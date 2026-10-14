import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Marker, Polygon, Polyline } from 'react-native-maps';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Meridian } from '@/components/meridian';
import { Wordmark } from '@/components/polar-landing/landing-screen';
import { Scrim } from '@/components/polar-landing/scrim';
import { Polar, PolarFonts, PolarRadius, PolarSpace, PolarType } from '@/constants/polar';
import { dayCore } from '@/constants/theme';
import { drawableStops, regionForStops } from '@/lib/mapRegion';
import { coordLine, forecastLine, groupFills, latestStop, monumentSize, nowLine, time12, type PlanDay } from '@/lib/writingPlan';
import { formatMoney } from '@shared/format';
import { STEP_GROUPS, TYPICAL_WAIT_PHRASE, generationProgress, isStepTerminal, stepGroupState, type StageProgress } from '@shared/generationStages';
import { meriForGeneration } from '@shared/meri';
import type { RawFetch } from '@shared/types';

/**
 * The live map while a plan is written: the canvas design "Live map, writing the plan · C Monument
 * (phone)", and the phone's counterpart of the web's `WritingThePlan`. The night city fills the
 * screen; the fact is the standfirst in the display face; the days light up as the stream reaches
 * them; each new stop arrives as a small card beside its own pin; and the city's name is the
 * monument across the foot, under the four step ticks, the forecast and Cancel.
 *
 * **The camera frames into the band the standfirst and the foot leave open**, by `mapPadding`
 * measured off both, and keeps the latest pin left of the band's middle so its card fits to the
 * right. `fitToCoordinates` lands flat and north-up, as `DayMap`'s day framing does.
 */

/** ~150s of waiting at this interval is ~21 facts, under `destinationFacts`' cap. The web's. */
const FACT_INTERVAL_MS = 7000;
/** Cancel waits this long, as on the web: a stray tap in the first seconds is not a decision. */
const CANCEL_AFTER_MS = 10_000;
const CARD_W = 152;
/** The card's gap from its pin. */
const CARD_GAP = 14;
/**
 * The least ground a day is framed at, about 2.2km. `regionForStops`' 400m floor suits the day map,
 * where you read one day; here a two-stop day at that floor filled the screen with a single block.
 */
const MIN_FRAME_DEG = 0.02;
/** A new day's first card waits for MapKit's own re-frame, since its pin starts off-screen. */
const REFRAME_MS = 600;
/** Before any stop, the city: about 7km by 9km round the geocoded centre. */
const CITY_SPAN = { lat: 0.06, lng: 0.1 };
/**
 * The night lens, as the web's: Apple's dark muted map still draws parks green and water blue, and
 * its labels fight the standfirst. A view over the map cannot dim it without dimming the pins and
 * the card too, since they are the map's own annotations. A polygon is an overlay, drawn over the
 * tiles and their labels but under every annotation, so it takes the ground down and nothing else.
 * Three degrees each way covers any city the camera frames.
 */
const LENS_DEG = 3;
const LENS_FILL = 'rgba(9,11,16,0.5)';

export function WritingThePlan({
  destination,
  dateRange,
  tripDays,
  tierName,
  budget,
  stages,
  days,
  facts,
  raw,
  onCancel,
}: {
  destination: string;
  dateRange: string | null;
  tripDays: number;
  tierName: string | null;
  budget: number;
  stages: StageProgress[];
  days: PlanDay[];
  facts: string[];
  /** The trip-fetch bundle: the city's coordinates and the forecast. Null until it lands. */
  raw: RawFetch | null;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const [ledeBottom, setLedeBottom] = useState(320);
  const [footH, setFootH] = useState(260);
  const [factIndex, setFactIndex] = useState(0);
  const [cancelReady, setCancelReady] = useState(false);

  const city = destination.split(',')[0]?.trim() || destination.trim() || 'Your trip';
  const centre = raw?.destination.resolved && raw.destination.lat !== null && raw.destination.lon !== null ? { lat: raw.destination.lat, lon: raw.destination.lon } : null;
  const latest = latestStop(days);
  const active = STEP_GROUPS.find((g) => stepGroupState(g, stages) === 'active') ?? null;
  // Between steps nothing is running; the step about to start is the one worth naming.
  const current = active ?? STEP_GROUPS.find((g) => !isStepTerminal(stepGroupState(g, stages))) ?? null;
  const lensAt = centre ?? (latest ? { lat: latest.stop.lat, lon: latest.stop.lng } : null);
  const complete = STEP_GROUPS.every((g) => isStepTerminal(stepGroupState(g, stages)));
  const streaming = days.some((d) => d.stops.length > 0);

  useEffect(() => {
    const id = setTimeout(() => setCancelReady(true), CANCEL_AFTER_MS);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (facts.length < 2) return;
    const id = setInterval(() => setFactIndex((i) => (i + 1) % facts.length), FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [facts.length]);
  // VoiceOver hears each step as it starts; the screen itself is mostly a map, which says nothing.
  useEffect(() => {
    if (active) AccessibilityInfo.announceForAccessibility(`Building your ${city} itinerary: ${active.label}.`);
  }, [active, city]);

  // The camera follows the stream: the city while it is read, then the day the latest stop belongs
  // to, re-framed as each stop lands and again when Overpass corrects the day's positions.
  const latestDay = latest ? days[latest.dayIndex].stops : null;
  const frameKey = latestDay ? `${latest!.dayIndex}:${latestDay.map((s) => `${s.lat},${s.lng}`).join(';')}` : centre ? `city:${centre.lat},${centre.lon}` : '';
  useEffect(() => {
    if (!ready || !frameKey) return;
    const edgePadding = { top: 24, bottom: 20, left: 34, right: latest ? CARD_W + CARD_GAP + 22 : 34 };
    const fitted = latestDay ? regionForStops(latestDay) : centre ? { latitude: centre.lat, longitude: centre.lon, latitudeDelta: CITY_SPAN.lat, longitudeDelta: CITY_SPAN.lng } : null;
    if (!fitted) return;
    const region = { ...fitted, latitudeDelta: Math.max(fitted.latitudeDelta, MIN_FRAME_DEG), longitudeDelta: Math.max(fitted.longitudeDelta, MIN_FRAME_DEG) };
    const corners = [
      { latitude: region.latitude - region.latitudeDelta / 2, longitude: region.longitude - region.longitudeDelta / 2 },
      { latitude: region.latitude + region.latitudeDelta / 2, longitude: region.longitude + region.longitudeDelta / 2 },
    ];
    map.current?.fitToCoordinates(corners, { edgePadding, animated: !reduce });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, frameKey, ledeBottom, footH]);

  const summary = [dateRange, `${tripDays} ${tripDays === 1 ? 'day' : 'days'}`, tierName, budget > 0 ? formatMoney(budget) : null].filter(Boolean).join(' · ');
  const forecast = forecastLine(raw);
  const word = city.toUpperCase();
  const size = monumentSize(word, width, height, PolarSpace.pad);

  return (
    <View style={styles.screen}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialCamera={{ center: { latitude: 25, longitude: 10 }, altitude: 20_000_000, pitch: 0, heading: 0 }}
        userInterfaceStyle="dark"
        // Apple's own muted type for a map carrying overlays, as on the landing's Petra map.
        mapType="mutedStandard"
        showsPointsOfInterests={false}
        showsCompass={false}
        rotateEnabled={false}
        pitchEnabled={false}
        // The band between the standfirst and the foot is the map's working area: Apple's logo and
        // legal mark (which must stay legible) ride above the foot instead of under the monument,
        // and every framing below centres in the band.
        mapPadding={{ top: ledeBottom, right: 0, bottom: footH, left: 0 }}
        onMapReady={() => setReady(true)}>
        {/* Order is z-order: Apple Maps ignores an overlay's zIndex (see day-map.tsx), so the lens
            goes first and every line is drawn over it. */}
        {lensAt ? (
          <Polygon
            coordinates={[
              { latitude: lensAt.lat - LENS_DEG, longitude: lensAt.lon - LENS_DEG },
              { latitude: lensAt.lat - LENS_DEG, longitude: lensAt.lon + LENS_DEG },
              { latitude: lensAt.lat + LENS_DEG, longitude: lensAt.lon + LENS_DEG },
              { latitude: lensAt.lat + LENS_DEG, longitude: lensAt.lon - LENS_DEG },
            ]}
            fillColor={LENS_FILL}
            strokeWidth={0}
            tappable={false}
          />
        ) : null}
        {days.map((d, i) => {
          const drawn = drawableStops(d.stops);
          return drawn.length > 1 ? (
            <Polyline key={`line-${i}`} coordinates={drawn.map(({ stop }) => ({ latitude: stop.lat, longitude: stop.lng }))} strokeColor={dayCore(i)} strokeWidth={2.5} lineCap="round" lineJoin="round" />
          ) : null;
        })}
        {days.flatMap((d, i) =>
          drawableStops(d.stops).map(({ stop, index }) => {
            const isLatest = latest?.dayIndex === i && latest.stop === stop;
            return (
              <Marker key={`${i}-${index}-${isLatest ? 'now' : ''}`} coordinate={{ latitude: stop.lat, longitude: stop.lng }} anchor={{ x: 0.5, y: 0.5 }} zIndex={isLatest ? 900 : index}>
                <View style={[styles.pin, { backgroundColor: dayCore(i) }, isLatest && styles.pinLatest]} />
              </Marker>
            );
          })
        )}
        {latest && drawableStops([latest.stop]).length > 0 && (
          <Marker key={`card-${latest.dayIndex}-${latest.stop.name}`} coordinate={{ latitude: latest.stop.lat, longitude: latest.stop.lng }} 
            // `anchor` is Google's and Apple Maps ignores it; `centerOffset` is Apple's. Both put the
            // card's left edge on the pin, so it reads beside the stop rather than over it.
            anchor={{ x: 0, y: 0.5 }}
            centerOffset={{ x: (CARD_W + CARD_GAP) / 2, y: 0 }}
            zIndex={1000}>
            <Animated.View entering={FadeIn.delay(latest.first ? REFRAME_MS : 0).duration(500)} style={styles.card}>
              <View style={styles.cardDayRow}>
                <View style={[styles.dot, { backgroundColor: dayCore(latest.dayIndex) }]} />
                <Text style={styles.cardDay}>
                  Day {latest.dayIndex + 1} · {time12(latest.stop.time)}
                </Text>
              </View>
              <Text style={styles.cardName} numberOfLines={2}>
                {latest.stop.name}
              </Text>
              {latest.stop.durationLabel ? <Text style={[PolarType.caption, styles.dim]}>{latest.stop.durationLabel}</Text> : null}
            </Animated.View>
          </Marker>
        )}
      </MapView>

      {/* Deeper than the web's: Apple Maps draws its place names above every overlay, the lens
          included, and under the standfirst they read as a second, competing line of text. */}
      <Scrim stops={[[0, Polar.night, 0.96], [0.3, Polar.night, 0.86], [0.4, Polar.night, 0.55], [0.52, Polar.night, 0]]} />
      <Scrim stops={[[0.56, Polar.night, 0], [0.78, Polar.night, 0.75], [1, Polar.night, 0.95]]} />

      <View style={[styles.header, { marginTop: insets.top }]} pointerEvents="none">
        <Wordmark light />
      </View>

      {/* The standfirst. */}
      <View
        style={[styles.lede, { top: insets.top + 44 + PolarSpace.s2 }]}
        pointerEvents="none"
        accessibilityLiveRegion="polite"
        onLayout={(e) => setLedeBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        <View style={styles.row}>
          <Meridian state={meriForGeneration({ complete, streaming })} size={36} />
          <View style={styles.flex}>
            <Text style={[PolarType.eyebrow, { color: Polar.ice }]}>{`Planning ${city}`}</Text>
            <Text style={[PolarType.caption, styles.dim, styles.tabular]} numberOfLines={1}>
              {summary}
            </Text>
          </View>
        </View>
        <Animated.Text key={factIndex} entering={FadeIn.duration(500)} style={styles.fact} numberOfLines={4}>
          {facts[factIndex] ?? `Reading everything we can find about ${city}.`}
        </Animated.Text>
        {centre ? <Text style={[PolarType.coord, styles.dim]}>{coordLine(centre.lat, centre.lon)}</Text> : null}
        <View style={styles.days} accessibilityLabel="The days">
          {days.map((d, i) => (
            <View key={i} style={[styles.day, d.stops.length > 0 && styles.dayHas, latest?.dayIndex === i && styles.dayNow]}>
              <Text style={[styles.dayN, { color: dayCore(i) }]}>{String(i + 1).padStart(2, '0')}</Text>
              <Text style={[styles.dayCount, d.stops.length > 0 && { color: Polar.ice }]}>{d.stops.length || ''}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* The foot: the step ticks, the instruments, then the monument. */}
      <View style={styles.foot} pointerEvents="box-none" onLayout={(e) => setFootH(e.nativeEvent.layout.height)}>
        <View style={styles.strip}>
          <Ticks stages={stages} />
          <StageLine stages={stages} />
          <View style={styles.instrumentRow}>
            <View style={[styles.flex, styles.instrumentText]}>
              <Text style={[PolarType.bodyS, { color: Polar.ice }]} numberOfLines={1}>
                {nowLine(days, current?.label ?? null)}
              </Text>
              {forecast ? (
                <Text style={[PolarType.caption, styles.dim, styles.tabular]} numberOfLines={1}>
                  {forecast}
                </Text>
              ) : null}
            </View>
            {cancelReady ? (
              <Animated.View entering={FadeIn.duration(500)}>
                <Pressable
                  onPress={onCancel}
                  style={({ pressed }) => [styles.cancel, pressed && styles.cancelPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel, and go back to Review">
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </Animated.View>
            ) : (
              <Text style={[PolarType.caption, styles.dim, styles.wait]}>{`Usually about\n${TYPICAL_WAIT_PHRASE}.`}</Text>
            )}
          </View>
        </View>
        {/* Line height 1: Oswald's baseline then sits ~0.05em above the box, so nothing is cropped.
            The margin keeps the word just clear of the home indicator rather than floating above it. */}
        <Text
          style={[PolarType.monument, styles.monument, { fontSize: size, lineHeight: size, marginBottom: Math.round(insets.bottom * 0.35) }]}
          numberOfLines={1}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {word}
        </Text>
      </View>
    </View>
  );
}

/**
 * The four steps as the planner's ticks: done in white, the running one filling in route blue by
 * the bar's own weights. Its own clock, so the easing between frames re-renders four bars, not the
 * map and every pin on it.
 */
function Ticks({ stages }: { stages: StageProgress[] }) {
  const [progress, setProgress] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      last.current = generationProgress(stages, Date.now() - start, last.current);
      setProgress(last.current);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [stages]);
  return (
    <View style={styles.ticks} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {groupFills(stages, progress).map(({ state, fill }, i) => (
        <View key={STEP_GROUPS[i].id} style={styles.tick}>
          <View style={[styles.tickFill, { width: `${fill * 100}%`, backgroundColor: state === 'done' ? Polar.ice : state === 'failed' ? Polar.nightText2 : Polar.route }]} />
        </View>
      ))}
    </View>
  );
}

function StageLine({ stages }: { stages: StageProgress[] }) {
  const states = STEP_GROUPS.map((g) => stepGroupState(g, stages));
  const running = states.indexOf('active');
  const i = running >= 0 ? running : Math.max(0, states.findIndex((s) => !isStepTerminal(s)));
  const state = states[i];
  const word = state === 'active' ? 'Now' : state === 'done' ? 'Done' : state === 'failed' ? 'Not run' : 'Next';
  return (
    <View style={styles.stageLine} accessible accessibilityLabel={`Step ${i + 1} of 4, ${STEP_GROUPS[i].label}, ${word}`}>
      <Text style={[PolarType.coord, styles.dim, styles.tabular]}>{`${String(i + 1).padStart(2, '0')} / 04`}</Text>
      <Text style={[PolarType.ui, styles.flex, { color: Polar.ice }]} numberOfLines={1}>
        {STEP_GROUPS[i].label}
      </Text>
      <Text style={[styles.stateWord, { color: state === 'active' ? Polar.route : Polar.nightText2 }]}>{word}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Polar.night, overflow: 'hidden' },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: PolarSpace.s2 },
  dim: { color: Polar.nightText2 },
  tabular: { fontVariant: ['tabular-nums'] },

  header: { height: 44, justifyContent: 'center', paddingHorizontal: PolarSpace.pad },
  lede: { position: 'absolute', left: PolarSpace.pad, right: PolarSpace.pad, gap: PolarSpace.s2 + 2 },
  fact: {
    fontFamily: PolarFonts.displayItalic,
    fontSize: 23,
    lineHeight: 27,
    color: Polar.ice,
    minHeight: 81,
    textShadowColor: 'rgba(9,11,16,0.6)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 2 },
  },
  days: { flexDirection: 'row', gap: 5, marginTop: 2 },
  day: {
    flex: 1,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 7,
    borderRadius: PolarRadius.sm,
    // Near-opaque rather than the web's glass: Apple's place names show through a veil.
    backgroundColor: 'rgba(9,11,16,0.84)',
    borderWidth: 1,
    borderColor: Polar.frost10,
    opacity: 0.6,
  },
  dayHas: { opacity: 1 },
  dayNow: { borderColor: 'rgba(106,240,255,0.45)', backgroundColor: 'rgba(9,11,16,0.6)' },
  dayN: { fontFamily: PolarFonts.sansSemi, fontSize: 11, fontVariant: ['tabular-nums'] },
  dayCount: { fontFamily: PolarFonts.sansSemi, fontSize: 11, color: Polar.nightText2, fontVariant: ['tabular-nums'] },

  pin: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: Polar.night },
  pinLatest: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: Polar.ice },
  // A solid night card rather than a blur: a marker's view is snapshotted on some paths, and a
  // backdrop blur inside one has nothing behind it to blur.
  card: {
    width: CARD_W,
    marginLeft: CARD_GAP,
    paddingHorizontal: 11,
    paddingVertical: 9,
    gap: 3,
    borderRadius: PolarRadius.card,
    borderWidth: 1,
    borderColor: Polar.frost10,
    backgroundColor: 'rgba(9,11,16,0.86)',
  },
  cardDayRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  cardDay: { fontFamily: PolarFonts.sansSemi, fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: Polar.nightText2, fontVariant: ['tabular-nums'] },
  cardName: { fontFamily: PolarFonts.display, fontSize: 19, lineHeight: 21, color: Polar.ice },

  foot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  strip: { marginHorizontal: PolarSpace.pad, gap: PolarSpace.s2 },
  ticks: { flexDirection: 'row', gap: 4 },
  tick: { flex: 1, height: 2, backgroundColor: Polar.frost20, overflow: 'hidden' },
  tickFill: { height: 2 },
  stageLine: { flexDirection: 'row', alignItems: 'baseline', gap: PolarSpace.s2 },
  stateWord: { fontFamily: PolarFonts.sansSemi, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' },
  instrumentRow: { flexDirection: 'row', alignItems: 'center', gap: PolarSpace.s3, minHeight: 42 },
  instrumentText: { gap: 3 },
  wait: { textAlign: 'right' },
  // The one action on the screen: the night panel's glass with a hairline you can see over the map.
  cancel: {
    height: 42,
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderRadius: PolarRadius.sm,
    backgroundColor: 'rgba(9,11,16,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  cancelPressed: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: Polar.ice },
  cancelText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ice },
  monument: { color: Polar.ice, opacity: 0.92, paddingHorizontal: PolarSpace.pad, marginTop: PolarSpace.s2 },
});
