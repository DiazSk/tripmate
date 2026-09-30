import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import type { Stop } from '@/api/types';
import { Invitation } from '@/components/states';
import { StopDisc } from '@/components/stop-disc';
import { ThemedText } from '@/components/themed-text';
import { APPEARANCE } from '@/constants/appearance';
import { Colors, OverPhotograph, Radius, Spacing, dayCore, dayGlow } from '@/constants/theme';
import { useHere } from '@/lib/here';
import { travelSummary } from '@/lib/dayTravel';
import { drawableStops, regionForStops } from '@/lib/mapRegion';

/**
 * A day's stops, on a map.
 *
 * **Apple Maps on iOS, Google on Android — and deliberately no `provider`.** Setting
 * `PROVIDER_GOOGLE` renders nothing at all in Expo Go on iOS, whose client carries no Google Maps
 * SDK. Left undefined, each platform draws its own, which is also what keeps this working in Expo
 * Go with no key and no development build: `react-native-maps` is compiled into the Expo Go
 * binary (verified against its exported `AIRMap` classes), while MapLibre, Mapbox and expo-maps
 * are not.
 *
 * The camera frames the day and then belongs to the reader. It re-frames when the day changes and
 * at no other time — **emphasis must never move it**, which is the specific bug the Swift app's
 * route overlay records avoiding: a map that jumps when you point at something makes it hard to
 * compare two stops.
 */
export function DayMap({
  stops,
  dayIndex,
  emphasis,
  onEmphasise,
}: {
  stops: Stop[];
  dayIndex: number;
  /** Index of the emphasised stop within this day, or null. */
  emphasis: number | null;
  onEmphasise: (index: number | null) => void;
}) {
  const map = useRef<MapView>(null);
  const { here } = useHere();
  const drawn = drawableStops(stops);
  const region = regionForStops(stops);

  useEffect(() => {
    if (region) map.current?.animateToRegion(region, 420);
    // Framing follows the day, not the stops object — a re-render with equal stops must not
    // yank a camera the reader has panned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIndex]);

  // An empty day is legitimate; a map of nowhere is not.
  if (!region) {
    return (
      <View style={styles.empty}>
        <Invitation
          title="Nothing placed on this day"
          body="Days with no stops have nothing to draw."
        />
      </View>
    );
  }

  const line = drawn.map(({ stop }) => ({ latitude: stop.lat, longitude: stop.lng }));
  const named = emphasis === null ? undefined : stops[emphasis]?.name;

  return (
    <View style={styles.fill}>
      <MapView
        ref={map}
        style={styles.fill}
        initialRegion={region}
        // Both platforms, one prop: `overrideUserInterfaceStyle` on Apple Maps and Google's own
        // colour scheme on Android — so no hand-written style JSON. **It follows the app, not
        // the system**, for the same reason `_layout.tsx` does: a dark map inside a paper app is
        // the `--postcard-paper` failure with the polarity swapped.
        userInterfaceStyle={APPEARANCE}
        // Dark alone is not enough. Apple's dark standard map still paints landcover in saturated
        // greens and purples, which on this canvas reads as a different application's map and
        // competes with the day's own hue for attention. `mutedStandard` is Apple's own answer —
        // the type they provide for maps carrying overlays. iOS-only; Android gets the same
        // restraint from Google's dark colour scheme above.
        mapType="mutedStandard"
        // **Apple's own POI labels are the densest thing on this screen and none of them are
        // ours.** Counted on the Lisbon fixture: 23 restaurant, café and museum labels against
        // 4 numbered stops, several of them overlapping a disc. They also make a promise the app
        // cannot keep — a tap on one does nothing, because `onPress` is deliberately absent (see
        // the note below). The day's own stops are what this map is for.
        showsPointsOfInterests={false}
        // **Only when the permission is already granted.** `useHere` reports that without ever
        // prompting; left unguarded, `react-native-maps` raises the system dialog the moment the
        // map mounts — a prompt asked before the reason for it is on screen, which is answered
        // "no" once and then forever. See `lib/here.ts`.
        showsUserLocation={here !== null}
        // Defaults to white, and would flash against the near-black canvas on every first draw.
        loadingBackgroundColor={Colors.canvas}
        // The reference map is flat. Keeping it flat is also what lets every pitch-corrected
        // distance calculation in the Swift original stay deleted.
        rotateEnabled={false}
        pitchEnabled={false}
        // Android otherwise puts Google's own directions buttons over the map on a marker press.
        toolbarEnabled={false}>
        {/* No `onPress` on the map, and that is deliberate twice over. A marker press bubbles to
            it on iOS, so a handler here sees the same gesture that set the emphasis and clears it
            — the disc never changes colour and the tap looks dead. And a plain tap on a map is
            *pointing*: it means "that one", which presumes a referent. Apple's own POI labels are
            not ours to make tappable, so a tap here points at nothing and any answer would be a
            guess. "What is near here" now hangs off a stop, which is a referent. Clearing the
            emphasis is reachable two ways: press the marker again, or press the caption. */}
        {line.length >= 2 ? (
          <>
            {/* Two strokes, glow first: a thin core inside a soft spill. Order is the z-order —
                Apple Maps ignores a Polyline's `zIndex` entirely. The Swift original blurs its
                halo for real; a wide low-alpha stroke is a fake of that, and the honest word for
                it is fake. */}
            <Polyline
              coordinates={line}
              strokeColor={`${dayGlow(dayIndex)}54`}
              strokeWidth={14}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={line}
              strokeColor={`${dayCore(dayIndex)}80`}
              strokeWidth={2}
              lineCap="round"
              lineJoin="round"
            />
          </>
        ) : null}

        {drawn.map(({ stop, index }) => (
          <StopMarker
            key={`${stop.name}-${index}`}
            stop={stop}
            index={index}
            dayIndex={dayIndex}
            emphasised={emphasis === index}
            onPress={() => onEmphasise(emphasis === index ? null : index)}
          />
        ))}
      </MapView>

      {/* What the map cannot draw. A route is visibly a shape and invisibly a cost, and the
          cost is the half somebody is deciding on — "is this the day I do Belém" is a question
          about how much of it is spent moving. Time rather than distance, for the reason
          `TravelSegment` records: nothing here knows whether the reader thinks in miles. */}
      <View style={styles.summary} pointerEvents="none">
        <ThemedText type="detail" themeColor="muted">
          {travelSummary(stops)}
        </ThemedText>
      </View>

      {/* The name lives here rather than on the map. The Swift app reached the same conclusion:
          a pile of labelled chips is unreadable, so the bubble carries the order and something
          else carries the name. Here that something else is the list face — this pill is just
          the bridge while you are looking at the map. */}
      {named ? (
        <Pressable style={styles.caption} onPress={() => onEmphasise(null)}>
          <ThemedText type="headingSmall" numberOfLines={2}>
            {named}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One numbered stop.
 *
 * `tracksViewChanges` is the reason this is its own component. On Android every marker with
 * children is re-snapshotted to a bitmap on **every frame** while the flag is true, which is a
 * visible stutter under a pan with eight of them; pinned false from the start, the marker never
 * rasterises at all and renders blank. Neither failure says anything. So it starts true, drops
 * after a beat, and re-arms whenever the colour changes so emphasis actually repaints.
 */
function StopMarker({
  stop,
  index,
  dayIndex,
  emphasised,
  onPress,
}: {
  stop: Stop;
  index: number;
  dayIndex: number;
  emphasised: boolean;
  onPress: () => void;
}) {
  // `OverPhotograph.accentDisc`, not `Colors.accent` — see its docblock. The disc is a map mark
  // standing beside four day cores that do not move with the appearance, and `DiscInk` is
  // measured against that lightness.
  const color = emphasised ? OverPhotograph.accentDisc : dayCore(dayIndex);
  const [tracking, setTracking] = useState(true);
  // Re-arm during render rather than from an effect. React supports adjusting state when a prop
  // changes this way, and it is the same shape as the map's build latch; setting state
  // synchronously *inside* an effect is the thing that is not supported, and the lint says so.
  const [painted, setPainted] = useState(color);
  if (color !== painted) {
    setPainted(color);
    setTracking(true);
  }

  useEffect(() => {
    if (!tracking) return;
    const settle = setTimeout(() => setTracking(false), 300);
    return () => clearTimeout(settle);
  }, [tracking]);

  return (
    <Marker
      coordinate={{ latitude: stop.lat, longitude: stop.lng }}
      // Android anchors a custom marker at its bottom edge, iOS at its centre. Without this the
      // disc sits on its coordinate on one platform and floats a radius above it on the other —
      // plausible-looking on both, wrong on one.
      anchor={{ x: 0.5, y: 0.5 }}
      // Deterministic stacking for the stop pairs that sit ten metres apart, with the one you
      // are pointing at always on top.
      zIndex={emphasised ? 999 : index}
      tracksViewChanges={tracking}
      onPress={onPress}>
      {/* A symmetric 44pt target around a 26pt disc: symmetric so the centre does not move and
          no anchor arithmetic is needed. Google hit-tests the bitmap's bounds, alpha included. */}
      <View style={styles.target}>
        <StopDisc ordinal={index + 1} color={color} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  empty: { flex: 1, paddingTop: Spacing.regular },
  target: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  /**
   * The caption's twin at the other end of the map.
   *
   * Two differences from it, both earned. It is **content width and centred** rather than a
   * full-width strip: the caption holds a stop's name and needs the room, while this is six
   * words that read as a label rather than as a bar across the view. And it is the **opaque**
   * slate rather than the bar's 72%, because a map crowds its labels at the top and an
   * always-present panel with a café's name showing through it reads as a rendering fault —
   * the caption gets away with translucency by appearing only when a stop is emphasised.
   *
   * `pointerEvents: none` because it is a label, and an overlay that swallowed a pan would be
   * worse than no overlay.
   */
  summary: {
    position: 'absolute',
    alignSelf: 'center',
    top: Spacing.read,
    maxWidth: '90%',
    backgroundColor: Colors.surfaceDeep,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    paddingHorizontal: Spacing.regular,
    paddingVertical: Spacing.tight,
  },
  caption: {
    position: 'absolute',
    left: Spacing.read,
    right: Spacing.read,
    bottom: Spacing.read,
    backgroundColor: Colors.bar,
    borderRadius: Radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.tight,
  },
});
