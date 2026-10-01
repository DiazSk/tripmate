import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import type { Stop } from '@/api/types';
import { Invitation } from '@/components/states';
import {
  DIVE_ALTITUDE_M,
  Group,
  IMAGERY,
  MAP_FLOOR,
  MODES,
  MapControls,
  PITCH_3D,
  chrome,
  type MapMode,
} from '@/components/map-controls';
import { StopCard } from '@/components/stop-card';
import { HereMarker } from '@/components/here-marker';
import { StopDisc } from '@/components/stop-disc';
import { ThemedText } from '@/components/themed-text';
import { APPEARANCE } from '@/constants/appearance';
import { Colors, Motion, OverPhotograph, Radius, Spacing, dayCore, dayGlow } from '@/constants/theme';
import { useHeading, useHere } from '@/lib/here';
import { travelSummary } from '@/lib/dayTravel';
import { altitudeForRegion, drawableStops, regionForStops } from '@/lib/mapRegion';

/** Clear of the summary pill — see `mapPadding` below. */
const MAP_INSET = { top: 72, right: 0, bottom: 0, left: 0 };

/**
 * How far right of its coordinate Apple Maps places a custom marker, and therefore how far back
 * `centerOffset` has to pull it. See the note at the `Marker` below for why `anchor` cannot do
 * this job on iOS. Ignored on Android, where `anchor` is the working prop.
 */
const MARKER_SKEW_PT = 12;

/** Roughly every fourth frame. The compass needle is read at a glance, not to the degree, and
 *  each reading is a bridge round-trip. */
const CAMERA_POLL_MS = 66;

/** How long after a press the camera is treated as in flight, and its pitch therefore as not
 *  yet meaning anything. `Motion.settle` plus the slack a native flight does not promise. */
const FLIGHT_GRACE_MS = Motion.settle + 200;

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
  const heading = useHeading();
  // The whole mode rather than its `MapType`. The three types do happen to differ today, so the
  // type alone would identify the mode — but it would also mean spelling "Driving" as
  // `type === 'standard'` at the one place that turns traffic on, which is a coupling the next
  // mode breaks. The mode carries its own flag and its own name.
  const [mode, setMode] = useState<MapMode>(MODES[0]);
  /**
   * **What the reader asked for, and what is actually on the view — two things, a frame apart.**
   *
   * Traffic has to be applied a render *after* the map type, or it never appears.
   *
   * `RNMapsMapView.mm` writes `showsTraffic` onto the `MKMapView` at line 570 and `mapType` at
   * 598 — in that order, in one pass — and assigning `mapType` installs a fresh
   * `MKMapConfiguration`, whose own `showsTraffic` is off. So any update that changes both drops
   * the traffic it just set, silently. Measured: `showsTraffic` alone over a mode change drew
   * nothing in a frame where Apple Maps drew a red segment on the same stretch of the A5, and
   * pinning the type to the native default so that branch never fired drew it immediately.
   *
   * Lagging it by a frame means the second pass changes only `showsTraffic`, with the type
   * already on the native view. A frame rather than a plain re-render, because what has to have
   * happened is the *native* assignment, not React's commit — and `requestAnimationFrame` is the
   * cheapest thing that waits for it.
   *
   * Keyed on the type actually shown rather than on the mode, because a Flyover swap is a
   * `mapType` assignment too.
   *
   * **Points of interest make it worse, and measurably so.** `AIRMap`'s
   * `setShowsPointsOfInterests` does its work by *assigning* `preferredConfiguration` — and
   * assigning a configuration is the same operation that loses traffic. The three writes reach
   * the view in a fixed order that is exactly the wrong one: `showsTraffic` at
   * `RNMapsMapView.mm:570`, `showsPointsOfInterests` at `:574`, `mapType` at `:598`. So in any
   * single commit, POI beats traffic and the type beats both. Measured: turning points of
   * interest off over Satellite with traffic already on left the labels correctly gone and not
   * one traffic-coloured pixel on the whole metro area.
   *
   * **So the writes are sequenced, one commit each, with traffic last.** The type lands first
   * (it is already on the view by the time this effect runs), then the POI filter, then
   * traffic, which is the only one that has to survive the other two.
   *
   * **Traffic is cleared on the way, and that is not belt-and-braces.** React does not re-send
   * a prop whose value has not changed, so a mode change that leaves traffic on would wipe it
   * natively and then skip the write that would restore it — the value never changed, so there
   * is nothing to send. Passing through `false` makes the restore a real change.
   */
  const [trafficWanted, setTrafficWanted] = useState(false);
  const [poiWanted, setPoiWanted] = useState(true);
  const [applied, setApplied] = useState({ traffic: false, poi: true });

  const [pitched, setPitched] = useState(false);
  /**
   * The camera's bearing, for a compass this client has to draw itself.
   *
   * **Not `heading` above, which is the phone's.** The magnetometer says which way the reader is
   * facing and feeds the vision cone; this says which way the *map* is turned. Two numbers, one
   * word, never equal — hence the two names.
   *
   * **`compassOffset` is a dead prop** — see `Needle` in `map-controls.tsx` for the citation.
   * So the heading has to come from JS, and `getCamera()` is the only way to ask. There is no
   * heading event: `onRegionChange` says the view moved and nothing about which way it faces.
   *
   * Throttled to one reading per `CAMERA_POLL_MS` while a gesture is running, which is roughly
   * every fourth frame — enough for a needle nobody is reading to the degree, and far short of
   * a bridge round-trip per frame. `onRegionChangeComplete` takes one more, unthrottled, so the
   * last reading is always the true one.
   */
  const [mapHeading, setMapHeading] = useState(0);
  const lastRead = useRef(0);
  /** True while a press's own flight is still landing — a flag rather than a deadline, because
   *  a clock read in the component body is an impurity the lint is right to refuse. */
  const inFlight = useRef(false);
  /** Measured, not assumed: the card is one or two lines depending on the name and the font
   *  scale, and the controls have to clear whichever it turns out to be. */
  const [cardHeight, setCardHeight] = useState(0);

  async function readCamera() {
    try {
      const camera = await map.current?.getCamera();
      if (!camera) return;
      setMapHeading(camera.heading ?? 0);
      /**
       * **And reconcile the 3D label with what the camera actually did** — but never while the
       * camera is in flight.
       *
       * `pitched` has to be an intent rather than a derivation, because over imagery it is what
       * swaps in the Flyover type, and the Flyover type is what *allows* the tilt. Reconciling
       * without the grace window deadlocked exactly there: the press set the intent, a region
       * change fired before the new `mapType` had reached the view, the camera honestly
       * reported pitch 0, and the reconcile turned the intent off again. Measured — the map
       * dived and stayed flat, which is the same symptom as the original bug and a different
       * cause.
       *
       * Outside a flight the reading is the truth, and that is what stops the label lying after
       * a two-finger tilt.
       */
      if (!inFlight.current) setPitched((camera.pitch ?? 0) > 1);
    } catch {
      // `getCamera()` rejects when the native view has gone. A stale heading is correct then.
    }
  }

  /**
   * The 3D half of a mode is a different `MapType`, not a different camera — see `MODES`.
   * Explore and Driving pitch as they are and carry no `flyover`.
   */
  const shownType = pitched && mode.flyover ? mode.flyover : mode.type;

  /**
   * **The two switches are Satellite's, so they are applied over imagery and nowhere else.**
   *
   * Built global, they left a state that could be set and not unset — traffic on over Satellite,
   * move to Explore, and the switch is still on with nothing left to reach it. Off imagery the
   * answer comes from the mode instead, which is what `MapMode.traffic` meant before a preset
   * was invented to resolve an overlap that scoping removes.
   */
  const overImagery = IMAGERY.includes(shownType);
  const wantTraffic = overImagery ? trafficWanted : !!mode.traffic;
  const wantPoi = overImagery ? poiWanted : true;

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      setApplied({ poi: wantPoi, traffic: false });
      frame = requestAnimationFrame(() => setApplied({ poi: wantPoi, traffic: wantTraffic }));
    });
    return () => cancelAnimationFrame(frame);
  }, [shownType, wantTraffic, wantPoi]);
  // Jade on the locate glyph while the camera is actually flying to the reader, and only then —
  // see `MapControls`. The map holds no continuous tracking mode, so this is the honest span.
  const [locating, setLocating] = useState(false);

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
    inFlight.current = true;
    setTimeout(() => {
      inFlight.current = false;
    }, FLIGHT_GRACE_MS);

    if (camera.pitch > 1) {
      map.current?.animateToRegion(region, Motion.settle);
      setPitched(false);
      return;
    }

    setPitched(true);
    // **A frame, so the Flyover type reaches the view before the camera is asked to tilt.**
    // `satellite` and `hybrid` refuse pitch; asking them and swapping the type in the same
    // commit means asking the flat one. Same shape as the `showsTraffic` lag, same reason — the
    // native assignment has not happened yet when React's commit has.
    requestAnimationFrame(() => {
      map.current?.animateCamera(
        {
          center: camera.center,
          heading: camera.heading,
          pitch: PITCH_3D,
          altitude: Math.min(altitudeForRegion(region), DIVE_ALTITUDE_M),
        },
        // Accepted and ignored on the new architecture — `RNMapsMapView.mm`'s `animateCamera`
        // takes the duration and never reads it. Left as the honest intent.
        { duration: Motion.settle },
      );
    });
  }

  /**
   * **The camera it already has, turned north — and nothing else.**
   *
   * Written first with the 3D button's camera model, which recomputes the altitude from the
   * day's region. That is right there, where the point *is* to re-frame, and wrong here: on the
   * device it threw away whatever the reader had zoomed to and dived back to the day. Pressing
   * a compass means "north", not "start again".
   *
   * Still a whole camera rather than `{ heading: 0 }` alone, for the reason `toggle3D` records:
   * a partial camera lets the fields it omits fall to a default. Every value but the heading is
   * copied straight back off the camera that is already there.
   */
  async function resetNorth() {
    const camera = await map.current?.getCamera();
    if (!camera) return;
    map.current?.animateCamera({
      center: camera.center,
      heading: 0,
      pitch: camera.pitch,
      altitude: camera.altitude,
    });
  }

  /** Same camera model as the 3D button, for the same reason — a partial one drifts the zoom. */
  async function locate() {
    const camera = await map.current?.getCamera();
    if (!camera || !region || !here) return;
    setLocating(true);
    setTimeout(() => setLocating(false), Motion.settle);
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
  const shown = emphasis === null ? undefined : stops[emphasis];

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
        // Opens on Explore and the reader can change it — see `MODES` in `map-controls` for why
        // that list is three long, and why label-free `satellite` is not one of them. The muted
        // type Explore uses is Apple's own answer for a map carrying overlays; iOS-only, and
        // Android gets the same restraint from Google's colour scheme above.
        mapType={shownType}
        // Both a frame behind `mapType`, deliberately — see `applied` above.
        showsTraffic={applied.traffic}
        // **The base map's own places stay on, and turning them off was my mistake.** I removed
        // them on a density count — 23 restaurant, café and museum labels against 4 numbered
        // stops on the Lisbon fixture, several overlapping a disc — and that count is real but
        // it is not the decision. Knowing there is a café across the street from stop 3 is a
        // large part of what a map on a trip is *for*, and the day's own stops win anyway
        // because a `Marker` draws above the basemap. Crowding was a judgement that was not
        // mine to make alone.
        //
        // The reader can now turn them off, which is the honest end of the argument above: the
        // density count was real, it was just not mine to decide alone. Default on.
        showsPointsOfInterests={applied.poi}
        // **A POI tap does nothing on iPhone, and that cannot be fixed here.** `onPoiClick` is
        // "iOS: Google Maps only" and this map is deliberately Apple's (see the provider note
        // above), so there is no callback to hang anything off. These are labels rather than
        // controls — orientation, like the street names beside them, which are not tappable
        // either. Don't go looking for the handler.
        // **Our own mark, not Apple's.** `showsUserLocation` draws `MKUserLocation`, which
        // pulses and carries no direction — see `HereMarker` below for why that trade is the
        // wrong way round on a screen read in a street.
        showsUserLocation={false}
        // Android-only in effect — on iOS this is a Google Maps prop and Apple Maps ignores it,
        // which is also why there is no locate button on iPhone to turn on. Gated identically:
        // a button that raises the permission dialog is the same prompt by another route.
        showsMyLocationButton={here !== null}
        // Apple Maps only, and it appears during a zoom gesture rather than standing there. The
        // cheapest answer to "is that walk actually ten minutes" that does not cost a tap.
        // **Ours is drawn, so MapKit's is off** — `Needle` in `map-controls.tsx` carries the
        // citation for why it cannot simply be moved.
        showsCompass={false}
        // The only way to learn which way the camera faces: there is no heading event, and
        // `onRegionChange` reports that the view moved and nothing about its bearing.
        onRegionChange={() => {
          const now = Date.now();
          if (now - lastRead.current < CAMERA_POLL_MS) return;
          lastRead.current = now;
          readCamera();
        }}
        onRegionChangeComplete={() => {
          lastRead.current = Date.now();
          readCamera();
        }}
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
            {/* **A casing and a core, not a spill and a thread.** It shipped as a 14pt glow at
                33% under a 2pt core at 50%, which is a route you cannot see: scanning thirteen
                rows across a real day, the core was detectable in four of them, and over
                satellite neither stroke survives at all. A pale wash over photography is the
                same mistake the stop discs made before they got their ring.

                So the same answer as the discs — the day's own pale half, opaque, as a tight
                casing around an opaque core. Both tokens keep their meaning: `dayGlow` is still
                "the pale half of each day's pair", still drawn under, still never the core's own
                colour. What changes is that it outlines rather than spills, which is what works
                on a ground the app does not control.

                Order is the z-order: Apple Maps ignores a Polyline's `zIndex` entirely. */}
            <Polyline
              coordinates={line}
              strokeColor={dayGlow(dayIndex)}
              strokeWidth={7}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={line}
              strokeColor={dayCore(dayIndex)}
              strokeWidth={3}
              lineCap="round"
              lineJoin="round"
            />
          </>
        ) : null}

        {/* **Below the stops, deliberately.** Where the reader is standing is context for the
            day; which stop is which is the day. `zIndex: 0` puts this under every marker above,
            so it can crowd a stop but never hide one. Only drawn with a fix — there is no
            "somewhere in this city" position worth marking. */}
        {here ? (
          <Marker
            coordinate={{ latitude: here.lat, longitude: here.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            // The same correction as the stop discs — see the note on `centerOffset` below.
            centerOffset={{ x: -MARKER_SKEW_PT, y: 0 }}
            zIndex={0}
            // The cone's rotation is a JS transform on this marker's content (the native
            // `rotation` prop is Google-only on iOS), so the marker has to be re-rasterised to
            // turn. `useHeading` throttles to 5 degrees for exactly this reason.
            tracksViewChanges
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants">
            <HereMarker heading={heading} />
          </Marker>
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

      {/* The name lives here rather than on the map. The Swift app reached the same conclusion:
          a pile of labelled chips is unreadable, so the bubble carries the order and something
          else carries the name.

          **Before `MapControls`, and the order is the z-order.** The style sheet is a scrim and
          a panel rendered inside those controls; with the card after them it floated over the
          sheet and covered the thumbnails' labels. Nothing here uses `zIndex` — source order is
          what the rest of this file relies on too (Apple Maps ignores a Polyline's `zIndex`
          outright). */}
      {shown ? (
        <StopCard
          stop={shown}
          ordinal={(emphasis ?? 0) + 1}
          mapType={shownType}
          onDismiss={() => onEmphasise(null)}
          onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
        />
      ) : null}

      <MapControls
        pitched={pitched}
        onToggle3D={toggle3D}
        mode={mode}
        onMode={setMode}
        traffic={trafficWanted}
        onTraffic={setTrafficWanted}
        poi={poiWanted}
        onPoi={setPoiWanted}
        heading={mapHeading}
        onResetNorth={resetNorth}
        // Apple's own controls step aside for its place card; ours do the same, and the height
        // is measured rather than guessed so Dynamic Type cannot push the card under them.
        floor={shown ? MAP_FLOOR + cardHeight + Spacing.tight : MAP_FLOOR}
        // Absent rather than disabled when there is no fix: a locate button that cannot locate
        // is the permission prompt by another route, which `here.ts` exists to avoid.
        onLocate={here ? locate : undefined}
        locating={locating}
        region={region}
      />

      {/* What the map cannot draw. A route is visibly a shape and invisibly a cost, and the
          cost is the half somebody is deciding on — "is this the day I do Belém" is a question
          about how much of it is spent moving. Time rather than distance, for the reason
          `TravelSegment` records: nothing here knows whether the reader thinks in miles. */}
      <Group tint={chrome(shownType).tint} style={styles.summary} radius={Radius.pill}>
        <View style={styles.summaryInset} pointerEvents="none">
          <ThemedText type="detail" style={{ color: chrome(shownType).inkMuted }}>
            {travelSummary(stops)}
          </ThemedText>
        </View>
      </Group>

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
      // Android anchors a custom marker at its bottom edge, so it needs this.
      anchor={{ x: 0.5, y: 0.5 }}
      // **`anchor` does nothing on iPhone, and that is why the discs never met the route.**
      // react-native-maps documents it: "@platform iOS: Google Maps only. For Apple Maps, see
      // the `centerOffset` prop" — the fourth prop in this file with that trap, after
      // `onPoiClick`, `showsMyLocationButton` and `Marker.rotation`. So the disc has always sat
      // 12pt right of its coordinate on Apple Maps while the polyline sat on it, and the route
      // ran past the discs rather than through them.
      //
      // Measured rather than guessed: `centerOffset` responds exactly 1:1 (applying -13,-13
      // moved the disc -13.0,-13.0), and fitting the drawn line's axis against the two disc
      // centres puts the residual at 12pt on the horizontal with nothing vertical.
      centerOffset={{ x: -MARKER_SKEW_PT, y: 0 }}
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
   * The stop card's twin at the other end of the map, and now its twin in material too.
   *
   * It shipped as an **opaque** paper capsule on the argument that a map crowds its labels at
   * the top and an always-present panel with a café's name showing through reads as a
   * rendering fault. The fault in that argument is the same one the card's own docblock
   * records: over Satellite the ground is a photograph and the appearance's surfaces are
   * measured against a page. An opaque capsule does not *fail* there the way a 4% one did — it
   * simply reads as a second visual system sitting above one that gets the material right.
   *
   * So it takes `chrome()` as well, and the crowding objection is answered by what the
   * material actually is: `systemChromeMaterial` is a blur, not a window, and a café's name
   * does not survive it legibly enough to be mistaken for this pill's own text.
   *
   * It stays **content width and centred** where the card is a full-width row: the card holds a
   * name and needs the room, this is six words that read as a label.
   *
   * `pointerEvents: none` on the inside, because it is a label and an overlay that swallowed a
   * pan would be worse than no overlay — on the inner view rather than the `Group`, which
   * carries the shadow and must stay a plain box.
   */
  summary: {
    position: 'absolute',
    alignSelf: 'center',
    top: Spacing.read,
    maxWidth: '90%',
  },
  summaryInset: {
    paddingHorizontal: Spacing.regular,
    paddingVertical: Spacing.tight,
  },
});
