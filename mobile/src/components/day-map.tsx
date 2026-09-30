import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, type MapType } from 'react-native-maps';

import type { Stop } from '@/api/types';
import { Invitation } from '@/components/states';
import { DIVE_ALTITUDE_M, MapControls, PITCH_3D } from '@/components/map-controls';
import { StopDisc } from '@/components/stop-disc';
import { ThemedText } from '@/components/themed-text';
import { APPEARANCE } from '@/constants/appearance';
import { Colors, Motion, OverPhotograph, Radius, Spacing, dayCore, dayGlow } from '@/constants/theme';
import { useHere } from '@/lib/here';
import { travelSummary } from '@/lib/dayTravel';
import { altitudeForRegion, drawableStops, regionForStops } from '@/lib/mapRegion';

/** Clear of the summary pill — see `mapPadding` below. */
const MAP_INSET = { top: 72, right: 0, bottom: 0, left: 0 };

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
 *
 * **Rotate and tilt are the reader's, and the compass comes with them.** They were disabled on
 * the grounds that "the reference map is flat" and that keeping it flat is what let the Swift
 * original's pitch-corrected distance calculations stay deleted. The first half is a preference
 * and the second is not true here: nothing in `mobile/` reads the camera at all — `mapRegion.ts`
 * is lat/lng arithmetic over the stops and never asks where the camera is standing. So flatness
 * was protecting nothing, while costing the map every native control it has. `showsCompass`
 * defaults true and is *adaptive* on iOS: hidden while the map points north, which is why
 * turning it on was never the missing piece. Rotation is. It also brings this client into line
 * with the web, which has carried a reset-north compass and a tilt slider all along.
 *
 * A day change undoes both on its own: `animateToRegion` takes a *region*, and a region has
 * neither a heading nor a pitch, so the camera lands north-up and flat. Verified on the device —
 * rotate and tilt day 1, tap day 2, and it is a plan view again with the compass gone. So a
 * rotation is a look at one day rather than a state the reader has to undo, and no explicit
 * `animateCamera` is needed.
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
  const [mapType, setMapType] = useState<MapType>('mutedStandard');
  const [pitched, setPitched] = useState(false);

  /**
   * **Reads the camera rather than trusting the toggle's own state.** The reader can tilt with
   * two fingers, and a day change flies back to a region — which has no pitch — so a boolean
   * kept here would disagree with the map within two gestures. One `await` per press settles it.
   *
   * **The altitude is computed and then clamped, and the clamp is the load-bearing half.**
   * `animateCamera({ pitch })` alone lets the altitude fall to a default; spreading
   * `getCamera()` does not help either, because the altitude a region-framed map reports does
   * not describe that framing. Both were measured, and both zoomed a four-stop Alfama day out
   * to most of Lisbon. So the camera is built from the region this component already owns.
   *
   * That was still wrong on a *wide* day, and the report for it was exact: "it performs an
   * upward vanishing animation and then shows 2D". **MapKit refuses pitch above roughly a
   * kilometre and a half** and returns a plan view without saying so — so a day spanning
   * kilometres computed a high altitude, the camera rose to it, and the tilt was silently
   * declined. `DIVE_ALTITUDE_M` is the ceiling; a day already closer keeps its own altitude.
   */
  async function toggle3D() {
    const camera = await map.current?.getCamera();
    if (!camera || !region) return;

    // **Flat is `animateToRegion`, not a camera.** It is the exact call that framed this day in
    // the first place, so returning to 2D lands on the framing the reader started from rather
    // than on whatever a computed altitude approximates — and a region carries no pitch, so it
    // flattens as a side effect of doing the right thing. Only the tilted direction needs an
    // altitude guess, and there a slightly tight frame is the point: you tilted in to look at
    // the buildings.
    if (camera.pitch > 1) {
      map.current?.animateToRegion(region, Motion.settle);
      setPitched(false);
      return;
    }
    map.current?.animateCamera(
      {
        center: camera.center,
        heading: camera.heading,
        pitch: PITCH_3D,
        altitude: Math.min(altitudeForRegion(region), DIVE_ALTITUDE_M),
      },
      { duration: Motion.settle },
    );
    setPitched(true);
  }

  /** Same camera model as the 3D button, for the same reason — a partial one drifts the zoom. */
  async function locate() {
    const camera = await map.current?.getCamera();
    if (!camera || !region || !here) return;
    map.current?.animateCamera(
      {
        center: { latitude: here.lat, longitude: here.lng },
        heading: camera.heading,
        pitch: camera.pitch,
        altitude: Math.min(altitudeForRegion(region), DIVE_ALTITUDE_M),
      },
      { duration: Motion.settle },
    );
  }
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
        // Opens on `mutedStandard` and the reader can change it — see `MODES` in `map-controls`
        // for why that list is three long and why Apple's plain `standard` is not on it. The
        // muted type is Apple's own answer for a map carrying overlays; iOS-only, and Android
        // gets the same restraint from Google's colour scheme above.
        mapType={mapType}
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
        // Android-only in effect — on iOS this is a Google Maps prop and Apple Maps ignores it,
        // which is also why there is no locate button on iPhone to turn on. Gated identically:
        // a button that raises the permission dialog is the same prompt by another route.
        showsMyLocationButton={here !== null}
        // Apple Maps only, and it appears during a zoom gesture rather than standing there. The
        // cheapest answer to "is that walk actually ten minutes" that does not cost a tap.
        showsScale
        // **The compass lands where the summary already is.** Both platforms put their native
        // controls in the top corners, and the pill above is centred at 90% width and wraps to
        // two lines on a day like "8 stops · about 57 min transit · about 45 min walking" — so
        // on a rotated day the compass would sit on top of it. `mapPadding` moves every native
        // control inside the inset on both platforms, which is one prop rather than an
        // Apple-only `compassOffset` plus an Android answer.
        //
        // It insets the *camera* too, and that is the better behaviour rather than a side
        // effect: the pill has always been able to cover a stop, and framing the day below it
        // means it no longer can.
        //
        // ponytail: a fixed 72 sized to a two-line pill at Default. A three-line summary at an
        // accessibility size grows past it; give the pill an `onLayout` and feed its height back
        // if that turns up on a real trip.
        mapPadding={MAP_INSET}
        // Defaults to white, and would flash against the near-black canvas on every first draw.
        loadingBackgroundColor={Colors.canvas}
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

      <MapControls
        pitched={pitched}
        onToggle3D={toggle3D}
        mapType={mapType}
        onMapType={setMapType}
        // Absent rather than disabled when there is no fix: a locate button that cannot locate
        // is the permission prompt by another route, which `here.ts` exists to avoid.
        onLocate={here ? locate : undefined}
      />

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
