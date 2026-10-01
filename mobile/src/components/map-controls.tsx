import { BlurView } from 'expo-blur';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';
import MapView, { type MapType, type Region } from 'react-native-maps';

import { ToggleRow } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { APPEARANCE } from '@/constants/appearance';
import {
  Colors,
  ControlShadow,
  Curve,
  Motion,
  OverPhotograph,
  Radius,
  Spacing,
} from '@/constants/theme';
import { angleBetween } from '@/lib/here';

/**
 * The altitude a 3D press dives to, and the pitch it lands at.
 *
 * **1200m is not a taste, it is a ceiling MapKit enforces.** Above roughly a kilometre and a
 * half MapKit refuses pitch outright and quietly returns a plan view — which is what "it flies
 * up and then shows 2D" was: a wide day computed a high altitude, the camera rose to it, and the
 * tilt was declined with no error. The same 1200m appears in this repo's web client for the same
 * job (`flyToStoryStop`), chosen there because it wants facades and a horizon rather than a plan
 * view. A day already closer than this keeps its own altitude; the clamp only stops it rising.
 */
export const DIVE_ALTITUDE_M = 1200;
export const PITCH_3D = 55;

/**
 * The three modes, named for Apple's own and checked against MapKit's documentation rather than
 * against the list of `MapType` strings — which is what the previous three were.
 *
 * **`satellite` is gone, and `hybrid` is what "Satellite" means.** MapKit defines
 * `MKImageryMapConfiguration` as "an imagery-based map presentation" and
 * `MKHybridMapConfiguration` as "a satellite image of the area *with road and road name
 * information layers on top*" — so `satellite` carries no label layer at all: no roads, no
 * names, no POIs, and no prop adds them, because their absence *is* the mode. Apple Maps has
 * never offered it; its own Satellite button is hybrid. Offering both cost this map its POIs on
 * imagery and put two tiles in the sheet that differ only by the one layer a 100pt thumbnail
 * cannot draw.
 *
 * **Driving is `standard` plus traffic, and `standard` rather than muted is not a preference.**
 * Apple Maps' own Driving mode was driven on the same simulator: it drops to the unmuted
 * emphasis, thickens the road network and sheds its POI pins, because the roads *are* the
 * content there. `showsTraffic` is also one of the few props on this view that is not "iOS:
 * Google Maps only" — `ios/AirMaps/RNMapsMapView.mm` remaps it onto `MKMapView.showsTraffic`.
 * It still needs the one-render lag `day-map.tsx` applies; the comment on `traffic` there has
 * the measurement.
 *
 * **There is no Transit mode, and no amount of native work would add one.** `MKMapConfiguration`
 * has exactly three subclasses — Standard, Hybrid, Imagery — and `MKStandardMapConfiguration`
 * exposes `emphasisStyle`, `pointOfInterestFilter` and `showsTraffic` and nothing else. There is
 * no transit configuration, overlay or filter at any version; Apple Maps' transit mode is
 * first-party rather than API. Unlike Look Around, this one is not waiting on a native module.
 *
 * Explore stays muted: `standard`'s landcover greens and purples compete with the day's own hue,
 * which is why the map opens on the muted type and why Driving is the only mode that spends it.
 * `terrain` is Android-only.
 *
 * **`flyover` is the 3D half of a mode, and it is a separate type rather than a camera.** This
 * docblock used to say the `*Flyover` pair was "imagery with 3D scenery, which the 3D button
 * reaches anyway". It does not: `satellite` and `hybrid` are MapKit's *flat* imagery types and
 * refuse pitch outright, so pressing 3D over Satellite dived, flipped the button to "2D" and
 * left a plan view — reported, then reproduced, then fixed by swapping the type. Measured both
 * ways on the simulator: `hybrid` stays flat under a 55° camera, `hybridFlyover` tilts into
 * photorealistic relief with the route drawn over it.
 */
export interface MapMode {
  type: MapType;
  label: string;
  /**
   * What this mode sets the Traffic switch to when it is picked. **A preset, not a lock** —
   * Driving turns traffic on and the switch owns it from there, so "Driving is the unmuted
   * basemap with traffic on" stays literally true and you can still turn it off without
   * leaving the mode. The other two leave the switch alone, because clearing it for you would
   * put traffic-over-satellite out of reach.
   */
  traffic?: true;
  /** The type to swap to while the camera is tilted. Absent on the vector modes, which pitch
   *  perfectly well as they are. */
  flyover?: MapType;
}

export const MODES: MapMode[] = [
  // "Explore", not "Map": the trip screen's LIST/MAP toggle already owns that word for the
  // surface, and One Meaning Rule says a mode of the map cannot also be called the map. Apple
  // calls it Explore for the same reason.
  { type: 'mutedStandard', label: 'Explore' },
  { type: 'standard', label: 'Driving', traffic: true },
  { type: 'hybrid', label: 'Satellite', flyover: 'hybridFlyover' },
];

// Every type that draws photography, including the two no mode selects — `chrome()` is asked
// about whatever the map is showing, and the Flyover pair is reachable by pitching.
export const IMAGERY: MapType[] = ['satellite', 'hybrid', 'satelliteFlyover', 'hybridFlyover'];

/**
 * The glass and the ink it carries, which are one decision rather than two.
 *
 * **The material follows what is underneath, not the appearance** — the generalisation DESIGN.md
 * already states for the photograph scrim, applied to chrome. Over the vector basemap the glass
 * takes the appearance's own side; over satellite or hybrid it goes dark in both, because bright
 * imagery is the single case Darken-Never-Lighten was written from ("a white wash would cut
 * contrast exactly where the terrain is brightest") and it is also the case Apple darkens in.
 *
 * `systemChromeMaterial` is UIKit's material *for floating chrome* — the one Maps itself uses.
 * The explicit `…Light` / `…Dark` variants rather than the bare value, because `app.json` pins
 * `userInterfaceStyle: "dark"`: the bare one follows the *system* and would render dark chrome
 * inside our light appearance. Same named gap as the keyboard and the tab bar.
 *
 * ponytail: on Android `expo-blur` draws a semi-transparent view rather than a true blur unless
 * `experimentalBlurMethod` is set, which is documented as experimental. The fallback is the
 * material minus the blur, which is what this screen already shipped — acceptable until somebody
 * is looking at an Android build.
 */
export function chrome(mapType: MapType) {
  const overImagery = IMAGERY.includes(mapType);
  const dark = overImagery || APPEARANCE === 'dark';
  return {
    tint: dark ? ('systemChromeMaterialDark' as const) : ('systemChromeMaterialLight' as const),
    // `onDeep` is the token that does not move between appearances — paper over anything dark.
    ink: dark ? Colors.onDeep : Colors.foreground,
    inkMuted: dark ? Colors.onDeepMuted : Colors.muted,
    // A figure on this material is standing on the ground too — see `OverPhotograph.money`.
    money: dark ? OverPhotograph.money : Colors.money,
  };
}

/**
 * The map's own controls: Apple's arrangement and material mechanics, this app's ink.
 *
 * **Measured against Apple Maps on the same simulator rather than inferred from a screenshot**,
 * which is what the three previous attempts did. What that found: the buttons are **48pt**, not
 * the 44 that is the HIG floor and DESIGN.md's figure for the *web* stack; the material is
 * translucent, blurred, hairlined and shadowed, never an opaque fill; the mode and locate
 * buttons are one pill with no divider; and the glyphs are neutral, with the tint reserved for
 * *state* — Apple's arrow is blue only while it is actually tracking you, white otherwise.
 *
 * **The material is the part the port had dropped.** The web separates floating chrome with a
 * blur and DESIGN.md's `Control` shadow; this client had neither, anywhere, and substituted an
 * opaque slate. That is why it never read as floating, and it is not something a radius or an
 * inset could have fixed.
 *
 * **There is no Look Around button, and it is not an omission.** Apple's binoculars open
 * `MKLookAroundViewController`, which `react-native-maps` does not expose at any version. It
 * needs a native module and a development build, and `day-map.tsx` records Expo Go compatibility
 * as load-bearing.
 */
export function MapControls({
  pitched,
  onToggle3D,
  mode: current,
  onMode,
  onLocate,
  locating,
  heading,
  onResetNorth,
  traffic,
  onTraffic,
  poi,
  onPoi,
  floor = MAP_FLOOR,
  region,
}: {
  pitched: boolean;
  onToggle3D: () => void;
  /** The whole mode, not its `MapType` — Explore and Driving share one, so the type alone
   *  cannot say which tile is chosen. */
  mode: MapMode;
  onMode: (mode: MapMode) => void;
  /** Absent until the location permission is already granted — see `lib/here.ts`. */
  onLocate?: () => void;
  /** True while the map is centred on the reader, which is the one place jade belongs here. */
  locating?: boolean;
  /** The camera's bearing in degrees. The *map's*, not the phone's — `useHeading` is the other
   *  one, and they are never the same number. */
  heading: number;
  onResetNorth: () => void;
  /** Both switches are global rather than per-mode: the library's POI prop is one boolean, and
   *  remembering a pair of them per mode is state nobody asked for. */
  traffic: boolean;
  onTraffic: (on: boolean) => void;
  poi: boolean;
  onPoi: (on: boolean) => void;
  /** Where the bottom of the stack sits. Raised while the stop card is up, the way Apple's own
   *  controls step aside for its place card. */
  floor?: number;
  /** The day's own framing, so each thumbnail previews this trip rather than a stock junction. */
  region: Region;
}) {
  const [picking, setPicking] = useState(false);
  const { tint, ink, inkMuted } = chrome(current.type);

  /**
   * The lift, as a transform rather than as `bottom`.
   *
   * Animating `bottom` would re-run layout on every frame for no gain; a `translateY` of the
   * same distance is the compositor's own job and lands in the same place.
   *
   * `Motion.settle` and the house curve, not `Motion.respond` and Reanimated's default easing.
   * This is not a control answering a touch — it is the chrome getting out of the way of a card
   * arriving, so it takes the arrival's own duration, and `Easing.bezier(...Curve)` is how the
   * rest of this client spends it (`signin.tsx`, `today.tsx`).
   */
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(floor - MAP_FLOOR, {
      duration: Motion.settle,
      easing: Easing.bezier(...Curve),
    });
  }, [floor, lift]);
  const rise = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value }] }));

  // Apple's compass is adaptive — present only while the map is turned. One degree rather than
  // zero because a float heading rarely lands on it exactly.
  const turned = angleBetween(heading, 0) >= 1;

  /**
   * The tile's size, computed rather than left to flex.
   *
   * **This does not silence what it was written to silence, and that is worth recording.** Each
   * thumbnail logs `CAMetalLayer ignoring invalid setDrawableSize width=0.000000` once on open,
   * and the main map does the same on mount. Sizing the wrapper did not stop it and neither did
   * sizing the `MapView` itself — `MKMapView` creates its Metal layer during its own setup,
   * before React Native applies any frame, so there is nothing to reach from here. Harmless:
   * Metal ignores the call and the tiles render correctly. Don't spend another afternoon on it.
   *
   * The arithmetic stays because a known width is the honest way to size three tiles in a row.
   */
  const tile = Math.floor(
    (useWindowDimensions().width - Spacing.read * 2 - Spacing.rows * (MODES.length - 1)) /
      MODES.length,
  );

  return (
    <>
      {/* **Labelled with the mode you will get, not the one you are in** — DESIGN.md:1323 for the
          web's own toggle, and Apple's button agrees: it reads "3D" while the map is flat. Set at
          `heading` rather than `label`, because this is a word on a button and not a tracked-caps
          section opener; Apple's is plain ~17pt system text and 11pt at 2pt tracking read as a
          caption somebody had shrunk. */}
      <Group tint={tint} style={[styles.left, rise]}>
        <Pressable
          onPress={onToggle3D}
          accessibilityRole="button"
          accessibilityLabel={pitched ? 'Switch to a flat map' : 'Tilt the map'}
          style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
          <ThemedText type="heading" style={{ color: ink }}>
            {pitched ? '2D' : '3D'}
          </ThemedText>
        </Pressable>
      </Group>

      {/* **One column, so the compass needs no arithmetic.** It has to sit directly above a pill
          whose height depends on whether there is a locate button, and stacking them in a
          flex column is the way not to encode that twice. */}
      <Animated.View style={[styles.right, rise]}>
        {turned ? (
          <Animated.View entering={FadeIn.duration(Motion.respond)} exiting={FadeOut.duration(Motion.exit)}>
            <Group tint={tint} style={styles.loose}>
              <Pressable
                onPress={onResetNorth}
                accessibilityRole="button"
                accessibilityLabel="Point the map north"
                style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
                <Needle heading={heading} ink={ink} inkMuted={inkMuted} />
              </Pressable>
            </Group>
          </Animated.View>
        ) : null}

      <Group tint={tint} style={styles.loose}>
        <Pressable
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel="Choose a map style"
          style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
          <SymbolView
            // Object form, never a bare SF string: given one, the Android path renders nothing
            // at all, silently.
            name={{ ios: 'map.fill', android: 'map' }}
            tintColor={ink}
            size={22}
            fallback={<Text style={[styles.glyphFallback, { color: ink }]}>Map</Text>}
          />
        </Pressable>

        {onLocate ? (
          <Pressable
            onPress={onLocate}
            accessibilityRole="button"
            accessibilityState={{ selected: !!locating }}
            accessibilityLabel="Centre on where you are"
            style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
            {/* The one tinted glyph, and only while it is doing something. Apple's arrow is blue
                while tracking and white otherwise; jade means "act on this", so spending it on
                chrome that is always on screen is spending it on nothing. */}
            <SymbolView
              name={{ ios: 'location.fill', android: 'my_location' }}
              tintColor={locating ? Colors.accent : ink}
              size={22}
              fallback={
                <Text style={[styles.glyphFallback, { color: locating ? Colors.accent : ink }]}>
                  Here
                </Text>
              }
            />
          </Pressable>
        ) : null}
      </Group>
      </Animated.View>

      {/* **A sheet at the bottom, and each style shown rather than described.** Apple presents
          map modes as a titled sheet of thumbnails, and both halves of that are right: choosing a
          style changes the whole surface behind it, so the choice belongs in front of the map and
          not hanging off one corner — and a picture of the thing is what separates Explore from
          Driving, which are the same basemap and differ only by the traffic drawn on it. The
          sheet leaves the map readable above it, which is what makes comparing a thumbnail to
          the real thing possible. */}
      {picking ? (
        <Animated.View
          entering={FadeIn.duration(Motion.respond)}
          exiting={FadeOut.duration(Motion.exit)}
          style={styles.scrim}>
          {/* The scrim dismisses, which is what a reader tries first. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close map styles"
            onPress={() => setPicking(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.cardHead}>
              <ThemedText type="headingSmall" style={styles.cardTitle}>
                Map style
              </ThemedText>
              <Pressable
                onPress={() => setPicking(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
                <SymbolView
                  name={{ ios: 'xmark', android: 'close' }}
                  tintColor={Colors.foreground}
                  size={14}
                  fallback={<Text style={styles.glyphFallback}>Close</Text>}
                />
              </Pressable>
            </View>

            <View style={styles.tiles}>
              {MODES.map((mode) => {
                const chosen = mode === current;
                return (
                  <Pressable
                    // The label, not the type: two modes share `mutedStandard`.
                    key={mode.label}
                    onPress={() => {
                      onMode(mode);
                      setPicking(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${mode.label} style`}
                    accessibilityState={{ selected: chosen }}
                    style={[styles.tile, { width: tile }]}>
                    {/* **A real map, not a shipped screenshot.** `cacheEnabled` renders it once
                        to a bitmap, which is the whole thumbnail mechanism — and because it is
                        MapKit drawing its own tiles there is no question of caching or
                        redistributing somebody's map imagery, which bundling cropped renders
                        would raise. It previews *this* day rather than Apple's stock junction. */}
                    <View
                      style={[
                        styles.thumb,
                        { width: tile, height: tile },
                        chosen && styles.thumbChosen,
                      ]}>
                      <MapView
                        style={{ width: tile, height: tile }}
                        region={region}
                        mapType={mode.type}
                        // Survives here where the main map needed a lag, because `standard` is
                        // the native default, so the `mapType` assignment that wipes traffic
                        // never fires on this tile. Worth having: a tile that is only a lighter
                        // basemap would not say what Driving is for.
                        showsTraffic={!!mode.traffic}
                        // Same as the real map. Without it the thumbnail follows `app.json`'s
                        // pinned dark style and the "Map" tile renders a dark map inside the
                        // light appearance — a preview of a thing the app will not show you.
                        userInterfaceStyle={APPEARANCE}
                        cacheEnabled
                        scrollEnabled={false}
                        zoomEnabled={false}
                        rotateEnabled={false}
                        pitchEnabled={false}
                        toolbarEnabled={false}
                        pointerEvents="none"
                      />
                    </View>
                    <ThemedText
                      type="caption"
                      themeColor={chosen ? 'accent' : 'muted'}
                      numberOfLines={1}>
                      {mode.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {/* **Apple has no equivalent and that was checked, not assumed** — its own Map Modes
                sheet in iOS 26 is four thumbnails and an attribution line, nothing more. These
                two are ours, and they earn their place by composing with the modes: traffic over
                satellite is a pairing no single mode can express, and the labels are worth
                dropping precisely where imagery is already dense.

                `ToggleRow` straight from `form.tsx`, with no material question to answer — the
                sheet is `surfaceDeep`, an ordinary page surface, unlike everything else this
                file draws over the map.

                **Only over imagery, and that is not a cosmetic scoping.** Built global, they
                left a state that could be set and not unset: traffic on over Satellite, move to
                Explore, and the switch is still on with no switch left to reach it. `day-map`
                applies them over imagery only for the same reason. */}
            {IMAGERY.includes(current.type) ? (
              <View style={styles.switches}>
                <ToggleRow label="Traffic" value={traffic} onChange={onTraffic} />
                <ToggleRow label="Points of interest" value={poi} onChange={onPoi} />
              </View>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

/**
 * One floating group: a shadow box wrapping a clipping box.
 *
 * **They cannot be the same view.** `overflow: 'hidden'` is what gives the blur its pill, and a
 * view that clips its children clips its own shadow with them. So the outer `View` carries
 * `ControlShadow` and nothing else, and the `BlurView` inside it carries the radius, the clip and
 * the hairline.
 */
export function Group({
  tint,
  style,
  radius = Radius.pill,
  onLayout,
  entering,
  exiting,
  children,
}: {
  tint: 'systemChromeMaterialLight' | 'systemChromeMaterialDark';
  /** Animated, because the stack slides up for the stop card. */
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** `Radius.pill` for the control stacks, a card radius for the stop card. */
  radius?: number;
  /** On the shadow box, which is the one that has the group's real height. */
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Reanimated layout animations, for the groups that arrive and leave rather than just sit
   *  there — the stop card is the only one so far. */
  entering?: React.ComponentProps<typeof Animated.View>['entering'];
  exiting?: React.ComponentProps<typeof Animated.View>['exiting'];
  children: React.ReactNode;
}) {
  return (
    <Animated.View
      onLayout={onLayout}
      entering={entering}
      exiting={exiting}
      style={[styles.lift, { borderRadius: radius }, style]}>
      <BlurView tint={tint} intensity={70} style={[styles.glass, { borderRadius: radius }]}>
        {children}
      </BlurView>
    </Animated.View>
  );
}

/**
 * The compass needle: two triangles meeting at the centre, north filled, south faded.
 *
 * **Drawn, because `compassOffset` is a dead prop.** `react-native-maps` 1.27.2 declares it
 * "@platform iOS: Apple Maps only", bridges it on both architectures and stores it on the view —
 * and nothing ever reads it; there is no `MKCompassButton` in the package at all. (It does
 * implement exactly this for `legalLabelInsets` and `appleLogoInsets`, so the gap is an
 * omission rather than an indirection.) The only native lever is `mapPadding`, and reaching the
 * bottom-right with it needs a top inset that leaves the camera a strip.
 *
 * **No colour.** Apple's north needle is red; here coral means an alert and jade means "act on
 * this", and a third meaning for a hue that already has one is what the One Meaning Rule is
 * for. The two tones of the chrome's own ink carry it instead.
 *
 * Border triangles rather than an SVG, the same technique `here-marker.tsx` uses for the
 * vision cone — this app ships no vector library and does not need one for two triangles.
 */
function Needle({ heading, ink, inkMuted }: { heading: number; ink: string; inkMuted: string }) {
  return (
    <View style={{ transform: [{ rotate: `${-heading}deg` }] }}>
      <View style={[styles.half, { borderBottomWidth: NEEDLE_NORTH, borderBottomColor: ink }]} />
      <View style={[styles.half, { borderTopWidth: NEEDLE_SOUTH, borderTopColor: inkMuted }]} />
    </View>
  );
}

/**
 * 48, which is what Apple's own map chrome measures — 144px at 3x, read off a clean column scan
 * of the simulator. 44 is the HIG *minimum* and DESIGN.md's figure for the web stack; it is a
 * floor rather than the size, and this one is sized to its reference.
 */
const SIZE = 48;
/**
 * Where the bottom of the map's chrome rests — the controls *and* the stop card, which used to
 * carry a second constant of their own for the same fact.
 *
 * **It is a floor rather than a preference.** Apple's logo and `Legal` link are a licence
 * condition, and read off the device at 3x they occupy **42.3pt to 56.7pt** up from the bottom
 * edge, in the left region where the 3D button stands. 62 clears them by 5.3. Going lower means
 * moving Apple's marks — `legalLabelInsets` and `appleLogoInsets` do that, Apple-only, by
 * rewriting a private subview's frame, and `mapPadding` would do it on both platforms at the
 * cost of the camera's height. Both were considered and neither was wanted.
 */
export const MAP_FLOOR = 62;
/**
 * The needle, as three numbers.
 *
 * It shipped as one — a half-length equal to the half-width — and that draws a rhombus, which on
 * the device read as a kite rather than as an instrument. A needle is long and thin and its tail
 * is shorter than its point: `5` of width against `13` forward and `9` back is roughly the
 * proportion Apple's own needle carries, and the asymmetry is what says which end is north
 * before the two tones do.
 */
const NEEDLE_WIDTH = 5;
const NEEDLE_NORTH = 13;
const NEEDLE_SOUTH = 9;


const styles = StyleSheet.create({
  // The shadow box. It must not clip, or the shadow is clipped with its children.
  lift: {
    position: 'absolute',
    borderRadius: Radius.pill,
    backgroundColor: 'transparent',
    ...ControlShadow,
  },
  // The clipping box. `overflow: 'hidden'` is what gives the blur its pill, and is also why it
  // cannot be the same view as the one carrying the shadow.
  glass: {
    borderRadius: Radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  left: { left: Spacing.read, bottom: MAP_FLOOR },
  // The column, not a group: `position` and the inset live here and the two groups inside it
  // stack normally, so the compass never has to know how tall the pill is.
  right: { position: 'absolute', right: Spacing.read, bottom: MAP_FLOOR, alignItems: 'flex-end', gap: Spacing.tight },
  // A group inside that column has already been positioned by it.
  loose: { position: 'relative' },
  half: {
    borderLeftWidth: NEEDLE_WIDTH,
    borderRightWidth: NEEDLE_WIDTH,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  cell: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  // **Darken on press, never fade.** DESIGN.md's control ramp is 0.55 → 0.72 → 0.82 of the one
  // slate and the rest of this app presses to `Colors.pressed`; the `opacity: 0.7` this shipped
  // with was mine alone, and on glass it dimmed the map showing through rather than the control.
  pressed: { backgroundColor: Colors.pressed },

  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Bottom, not centred: the map stays readable above the sheet, which is what lets a
    // thumbnail be compared against the thing it is a thumbnail of.
    justifyContent: 'flex-end',
    // **A dim, not a wash, and light enough to leave the map readable.** It shipped at the canvas
    // colour over 72%, which in the light appearance is paper — so the "scrim" *lightened* the map
    // into near-nothing and defeated the whole reason the sheet sits at the bottom, which is that
    // you can compare a thumbnail against the thing it is a thumbnail of. The one slate at 35%
    // darkens in both appearances, which is what Darken-Never-Lighten asks for over a map.
    backgroundColor: '#1C1A1859',
  },
  sheet: {
    backgroundColor: Colors.surfaceDeep,
    // Top corners only — it is anchored to the device edge, and rounding the bottom of something
    // flush against the edge draws two corners of canvas that mean nothing.
    borderTopLeftRadius: Radius.surface,
    borderTopRightRadius: Radius.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    paddingBottom: Spacing.regular,
  },
  tiles: {
    flexDirection: 'row',
    gap: Spacing.rows,
    paddingHorizontal: Spacing.read,
    paddingBottom: Spacing.tight,
  },
  tile: { gap: Spacing.hair, alignItems: 'center' },
  // A rule above them, because they are a different kind of choice from the tiles: the tiles
  // are one-of-three, these are each their own yes or no.
  switches: {
    paddingHorizontal: Spacing.read,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.cardBorder,
  },
  thumb: {
    borderRadius: Radius.read,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  // Apple rings the chosen tile in its tint; ours is jade, which is what the checkmark this
  // replaces already used.
  thumbChosen: { borderWidth: 2, borderColor: Colors.accent },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.read,
    paddingRight: Spacing.tight,
    paddingVertical: Spacing.tight,
  },
  cardTitle: { flex: 1 },
  close: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  glyphFallback: { color: Colors.accent, fontSize: 11 },
});
