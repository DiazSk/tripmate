import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { Marker, Polygon, Polyline } from 'react-native-maps';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import MapView, { type MapViewRef } from '@/components/map-view';
import { Meridian } from '@/components/meridian';
import { Wordmark } from '@/components/polar-landing/landing-screen';
import { Scrim } from '@/components/polar-landing/scrim';
import { Polar, PolarFonts, PolarSpace, PolarType } from '@/constants/polar';
import { dayCore, FontScale } from '@/constants/theme';
import { drawableStops, regionForStops } from '@/lib/mapRegion';
import { formatMoney } from '@shared/format';
import { HANDOFF_SECONDS, forecastLine, handoffFraction, latestStop, nowLine, waitPhrase, type PlanDay } from '@/lib/writingPlan';
import { STEP_GROUPS, generationProgress, isStepTerminal, stepGroupState, type StageProgress } from '@shared/generationStages';
import { meriForGeneration } from '@shared/meri';
import type { RawFetch } from '@shared/types';
import { Text } from '@/components/themed-text';

/**
 * The wait while a plan is written: canvas design "Phone generating · 2 At night, a Live
 * Activity", with the fixes its critique asked for.
 *
 * **Three zones, one of them live.** The fact about the place at the top, in the display face, is
 * the screen's resting point and changes every few seconds at most. The night map in the middle
 * draws each day's route as its stops arrive. The card at the foot is the only thing to read for
 * status, and it says it once: one sentence (the day being written and the stop just added), one
 * bar, and one estimate in words. It used to say it four ways at once — a ring, "2/4", a segmented
 * bar and a step label — which made the calmest-looking screen the busiest to read.
 *
 * **Place names arrive one at a time.** Only the stop just added is named, in the card; the map's
 * pins carry no labels. Reading a list of stops while it is still being written is the reveal
 * spent early, and the strain the traveller asked to be spared.
 *
 * **Orange is not spent here.** Progress is white and the pins keep their day colours, because
 * orange means "press this" and nothing on a wait is an invitation except Cancel, which is glass.
 *
 * **The ending is the map, not a cut to black.** When the plan is saved the host sets `ready`: the
 * bar fills, Meri turns to success and the card says so, over the same map, for a beat before the
 * trip opens.
 */

/** ~150s of waiting at this interval is ~21 facts, under `destinationFacts`' cap. The web's. */
const FACT_INTERVAL_MS = 7000;
/**
 * The least ground a day is framed at, about 2.2km. `regionForStops`' 400m floor suits the day map,
 * where you read one day; here a two-stop day at that floor filled the screen with a single block.
 */
const MIN_FRAME_DEG = 0.02;
/** Before any stop, the city: about 7km by 9km round the geocoded centre. */
const CITY_SPAN = { lat: 0.06, lng: 0.1 };
/**
 * The night lens: Apple's dark muted map still draws parks green and water blue, and its labels
 * fight the standfirst. A polygon is an overlay, drawn over the tiles and their labels but under
 * every annotation, so it takes the ground down and nothing else.
 */
const LENS_DEG = 3;
const LENS_FILL = 'rgba(9,11,16,0.5)';
/** A city's worth of ground from above, before the fetch's own framing takes over. */
const SEED_ALTITUDE_M = 40_000;

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
  ready = false,
  seed = null,
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
  /** The plan is saved and the trip is about to open: the card says so over the same map. */
  ready?: boolean;
  /** Where the destination is, when the planner already knows (a picked suggestion or its blur
   *  geocode), so the map opens on the city rather than on a world view until the fetch lands. */
  seed?: { lat: number; lon: number } | null;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const map = useRef<MapViewRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const [ledeBottom, setLedeBottom] = useState(300);
  const [cardH, setCardH] = useState(200);
  const [factIndex, setFactIndex] = useState(0);

  const city = destination.split(',')[0]?.trim() || destination.trim() || 'your trip';
  const centre = raw?.destination.resolved && raw.destination.lat !== null && raw.destination.lon !== null ? { lat: raw.destination.lat, lon: raw.destination.lon } : null;
  const latest = latestStop(days);
  const active = STEP_GROUPS.find((g) => stepGroupState(g, stages) === 'active') ?? null;
  // Between steps nothing is running; the step about to start is the one worth naming.
  const current = active ?? STEP_GROUPS.find((g) => !isStepTerminal(stepGroupState(g, stages))) ?? null;
  const lensAt = centre ?? (latest ? { lat: latest.stop.lat, lon: latest.stop.lng } : null);
  const streaming = days.some((d) => d.stops.length > 0);

  // The forecast is one more thing worth knowing about the place, so it joins the facts rather
  // than taking a line of its own.
  const forecast = forecastLine(raw);
  const pool = forecast ? [...facts, `The forecast: ${forecast}.`] : facts;

  useEffect(() => {
    if (pool.length < 2) return;
    const id = setInterval(() => setFactIndex((i) => (i + 1) % pool.length), FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pool.length]);
  // VoiceOver hears each step as it starts, and the arrival; the rotating fact is not announced.
  useEffect(() => {
    if (active) AccessibilityInfo.announceForAccessibility(`Building your ${city} itinerary: ${active.label}.`);
  }, [active, city]);
  useEffect(() => {
    if (ready) AccessibilityInfo.announceForAccessibility(`Your ${city} trip is ready.`);
  }, [ready, city]);

  // The camera follows the stream: the city while it is read, then the day the latest stop belongs
  // to, re-framed as each stop lands and again when Overpass corrects the day's positions.
  const latestDay = latest ? days[latest.dayIndex].stops : null;
  const frameKey = latestDay ? `${latest!.dayIndex}:${latestDay.map((s) => `${s.lat},${s.lng}`).join(';')}` : centre ? `city:${centre.lat},${centre.lon}` : '';
  useEffect(() => {
    if (!mapReady || !frameKey) return;
    const edgePadding = { top: 24, bottom: 20, left: 34, right: 34 };
    const fitted = latestDay ? regionForStops(latestDay) : centre ? { latitude: centre.lat, longitude: centre.lon, latitudeDelta: CITY_SPAN.lat, longitudeDelta: CITY_SPAN.lng } : null;
    if (!fitted) return;
    const region = { ...fitted, latitudeDelta: Math.max(fitted.latitudeDelta, MIN_FRAME_DEG), longitudeDelta: Math.max(fitted.longitudeDelta, MIN_FRAME_DEG) };
    const corners = [
      { latitude: region.latitude - region.latitudeDelta / 2, longitude: region.longitude - region.longitudeDelta / 2 },
      { latitude: region.latitude + region.latitudeDelta / 2, longitude: region.longitude + region.longitudeDelta / 2 },
    ];
    map.current?.fitToCoordinates(corners, { edgePadding, animated: !reduce });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, frameKey, ledeBottom, cardH]);

  const title = ready ? 'Your trip is ready' : nowLine(days, current?.label ?? null);
  const subtitle = ready
    ? 'Opening it now'
    : latest
      ? `Just added ${latest.stop.name}`
      : days.some((d) => d.theme)
        ? 'The first stop is on its way'
        : // Before anything has streamed, the trip being planned: the reassurance that it is yours.
          [dateRange, `${tripDays} ${tripDays === 1 ? 'day' : 'days'}`, tierName, budget > 0 ? formatMoney(budget) : null].filter(Boolean).join(' · ');

  return (
    <View style={styles.screen}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialCamera={
          seed
            ? { center: { latitude: seed.lat, longitude: seed.lon }, altitude: SEED_ALTITUDE_M, pitch: 0, heading: 0 }
            : { center: { latitude: 25, longitude: 10 }, altitude: 20_000_000, pitch: 0, heading: 0 }
        }
        userInterfaceStyle="dark"
        // Apple's own muted type for a map carrying overlays, as on the landing's Petra map.
        mapType="mutedStandard"
        showsPointsOfInterests={false}
        showsCompass={false}
        rotateEnabled={false}
        pitchEnabled={false}
        // The band between the standfirst and the card is the map's working area: Apple's logo and
        // legal mark (which must stay legible) ride above the card, and every framing centres there.
        mapPadding={{ top: ledeBottom, right: 0, bottom: cardH, left: 0 }}
        onMapReady={() => setMapReady(true)}>
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
      </MapView>

      {/* Deeper than the web's: Apple Maps draws its place names above every overlay, the lens
          included, and under the standfirst they read as a second, competing line of text. */}
      <Scrim stops={[[0, Polar.night, 0.96], [0.3, Polar.night, 0.86], [0.4, Polar.night, 0.5], [0.5, Polar.night, 0]]} />
      <Scrim stops={[[0.62, Polar.night, 0], [0.8, Polar.night, 0.7], [1, Polar.night, 0.95]]} />

      <View style={[styles.header, { marginTop: insets.top }]} pointerEvents="box-none">
        <Wordmark light />
        {/* Cancel from the first moment. It used to wait 10s, as the web does, against a stray tap —
            which left the first ten seconds of a minutes-long wait with no way out at all, and a
            stray tap costs only a return to the filled-in planner. */}
        {!ready ? (
          <Animated.View entering={FadeIn.duration(400)}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.cancel, pressed && styles.cancelPressed]}
              accessibilityRole="button"
              accessibilityLabel="Cancel, and go back to the planner">
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </View>

      {/* The standfirst: where, and one thing about it. */}
      <View
        style={[styles.lede, { top: insets.top + 52 }]}
        pointerEvents="none"
        onLayout={(e) => setLedeBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        <Text style={[PolarType.eyebrow, styles.dim]}>{`Planning ${city}`}</Text>
        <Animated.Text key={factIndex} entering={reduce ? undefined : FadeIn.duration(600)} style={styles.fact} numberOfLines={4} maxFontSizeMultiplier={FontScale.display}>
          {pool[factIndex] ?? `Reading everything we can find about ${city}.`}
        </Animated.Text>
      </View>

      {/* The card: the one place status is said. */}
      <View
        style={[styles.card, { bottom: Math.max(insets.bottom, PolarSpace.s3) }]}
        onLayout={(e) => setCardH(e.nativeEvent.layout.height + Math.max(insets.bottom, PolarSpace.s3) + PolarSpace.s3)}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${title}. ${subtitle}.`}>
        <View style={styles.cardRow}>
          <Meridian state={meriForGeneration({ complete: ready, streaming })} size={40} />
          <View style={styles.flex}>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
        </View>
        <Progress stages={stages} ready={ready} />
        {/* The days as dots: filled once a day has a stop, the one being written a step larger. Not
            letters or counts — those were seven more things to decode for a fact the sentence above
            already says. */}
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {days.map((d, i) => (
            <View key={i} style={[styles.dot, d.stops.length > 0 && styles.dotOn, latest?.dayIndex === i && !ready && styles.dotNow]} />
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * The bar and its one estimate.
 *
 * Its own clock, so the easing between frames re-renders a bar and a phrase, not the map and every
 * pin on it. **The estimate only ever comes down**: `waitPhrase` is coarse, and holding the lowest
 * value seen means a slow stretch reads as a pause rather than as the wait getting longer.
 */
function Progress({ stages, ready }: { stages: StageProgress[]; ready: boolean }) {
  const [shown, setShown] = useState({ fraction: 0, secondsLeft: HANDOFF_SECONDS });
  /** Carried across stage changes, which restart the clock below, so the bar never steps back. */
  const overall = useRef(0);
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      overall.current = generationProgress(stages, Date.now() - start, overall.current);
      const fraction = handoffFraction(stages, overall.current);
      setShown((prev) => ({ fraction, secondsLeft: Math.min(prev.secondsLeft, (1 - fraction) * HANDOFF_SECONDS) }));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [stages]);
  const fraction = ready ? 1 : shown.fraction;
  return (
    <View style={styles.progress}>
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
      </View>
      <Text style={styles.left}>{ready ? 'Done' : waitPhrase(shown.secondsLeft)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Polar.night, overflow: 'hidden' },
  flex: { flex: 1, minWidth: 0 },
  dim: { color: Polar.nightText2 },

  header: { paddingVertical: 6, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: PolarSpace.pad },
  lede: { position: 'absolute', left: PolarSpace.pad, right: PolarSpace.pad, gap: PolarSpace.s2 },
  // The largest thing on the screen, deliberately: it is the one thing here worth reading slowly,
  // and the eye needs somewhere to rest that is not the progress.
  fact: {
    fontFamily: PolarFonts.displayItalic,
    fontSize: 26,
    lineHeight: 31,
    color: Polar.ice,
    // Four lines reserved, so a short fact after a long one does not pull the map up and down.
    minHeight: 124,
    textShadowColor: 'rgba(9,11,16,0.6)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 2 },
  },

  pin: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: Polar.night },
  pinLatest: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: Polar.ice },

  // Near-opaque deep slate, DESIGN.md's band: a thinner glass lets Apple's place names through.
  card: {
    position: 'absolute',
    left: PolarSpace.s2,
    right: PolarSpace.s2,
    gap: PolarSpace.s3,
    padding: PolarSpace.s3,
    borderRadius: 28,
    backgroundColor: 'rgba(14,17,24,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Polar.frost20,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: PolarSpace.s2 + 1 },
  title: { fontFamily: PolarFonts.sansSemi, fontSize: 17, lineHeight: 22, color: Polar.ice },
  subtitle: { fontFamily: PolarFonts.sans, fontSize: 15, lineHeight: 20, color: Polar.nightText2 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: PolarSpace.s2 + 1 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: Polar.frost20 },
  fill: { height: '100%', borderRadius: 3, backgroundColor: Polar.ice },
  // The figure a waiting person glances for, at reading size rather than as a footnote.
  left: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ice, fontVariant: ['tabular-nums'] },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Polar.frost20 },
  dotOn: { backgroundColor: Polar.nightText2 },
  dotNow: { width: 9, height: 9, borderRadius: 5, backgroundColor: Polar.ice },

  cancel: {
    minHeight: 38,
    paddingVertical: 6,
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  cancelPressed: { backgroundColor: 'rgba(255,255,255,0.24)' },
  cancelText: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ice },
});
