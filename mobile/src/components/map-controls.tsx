import { BlurView } from 'expo-blur';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import type { MapType } from 'react-native-maps';

import { ThemedText } from '@/components/themed-text';
import { APPEARANCE } from '@/constants/appearance';
import { Colors, ControlShadow, Motion, Radius, Spacing } from '@/constants/theme';

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
 * The modes worth offering, of the eight `MapType` carries.
 *
 * `standard` is deliberately absent: Apple's standard map paints landcover in saturated greens
 * and purples that compete with the day's own hue, which is the whole reason this app opens on
 * `mutedStandard`. `terrain` is Android-only, and the two `*Flyover` types are `satellite` and
 * `hybrid` with 3D scenery — which the 3D button reaches anyway, without a second row.
 */
const MODES: { type: MapType; label: string; hint: string }[] = [
  { type: 'mutedStandard', label: 'Map', hint: 'Streets and places' },
  { type: 'satellite', label: 'Satellite', hint: 'Photography, no labels' },
  { type: 'hybrid', label: 'Hybrid', hint: 'Photography with names' },
];

const IMAGERY: MapType[] = ['satellite', 'hybrid', 'satelliteFlyover', 'hybridFlyover'];

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
function chrome(mapType: MapType) {
  const overImagery = IMAGERY.includes(mapType);
  const dark = overImagery || APPEARANCE === 'dark';
  return {
    tint: dark ? ('systemChromeMaterialDark' as const) : ('systemChromeMaterialLight' as const),
    // `onDeep` is the token that does not move between appearances — paper over anything dark.
    ink: dark ? Colors.onDeep : Colors.foreground,
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
  mapType,
  onMapType,
  onLocate,
  locating,
}: {
  pitched: boolean;
  onToggle3D: () => void;
  mapType: MapType;
  onMapType: (type: MapType) => void;
  /** Absent until the location permission is already granted — see `lib/here.ts`. */
  onLocate?: () => void;
  /** True while the map is centred on the reader, which is the one place jade belongs here. */
  locating?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const { tint, ink } = chrome(mapType);

  return (
    <>
      {/* **Labelled with the mode you will get, not the one you are in** — DESIGN.md:1323 for the
          web's own toggle, and Apple's button agrees: it reads "3D" while the map is flat. Set at
          `heading` rather than `label`, because this is a word on a button and not a tracked-caps
          section opener; Apple's is plain ~17pt system text and 11pt at 2pt tracking read as a
          caption somebody had shrunk. */}
      <Group tint={tint} style={styles.left}>
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

      <Group tint={tint} style={styles.right}>
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

      {/* **A centred card, not a dropdown beside the button.** Apple presents map modes as a
          titled sheet with a close control, and the reason holds here: choosing a style changes
          the whole surface behind it, so the choice belongs in front of the map rather than
          hanging off one corner of it. */}
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
          <View style={styles.card}>
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

            {MODES.map((mode, index) => (
              <Pressable
                key={mode.type}
                onPress={() => {
                  onMapType(mode.type);
                  setPicking(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: mode.type === mapType }}
                style={({ pressed }) => [
                  styles.mode,
                  index > 0 && styles.ruled,
                  pressed && styles.pressed,
                ]}>
                <View style={styles.grow}>
                  <ThemedText type="body">{mode.label}</ThemedText>
                  <ThemedText type="detail" themeColor="muted">
                    {mode.hint}
                  </ThemedText>
                </View>
                {mode.type === mapType ? (
                  <SymbolView
                    name={{ ios: 'checkmark', android: 'check' }}
                    tintColor={Colors.accent}
                    size={16}
                    fallback={<Text style={styles.glyphFallback}>✓</Text>}
                  />
                ) : null}
              </Pressable>
            ))}
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
function Group({
  tint,
  style,
  children,
}: {
  tint: 'systemChromeMaterialLight' | 'systemChromeMaterialDark';
  style: ViewStyle;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.lift, style]}>
      <BlurView tint={tint} intensity={70} style={styles.glass}>
        {children}
      </BlurView>
    </View>
  );
}

/**
 * 48, which is what Apple's own map chrome measures — 144px at 3x, read off a clean column scan
 * of the simulator. 44 is the HIG *minimum* and DESIGN.md's figure for the web stack; it is a
 * floor rather than the size, and this one is sized to its reference.
 */
const SIZE = 48;
/** Clear of the caption, which takes the bottom edge when a stop is emphasised. */
const FLOOR = 76;

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
  left: { left: Spacing.read, bottom: FLOOR },
  right: { right: Spacing.read, bottom: FLOOR },
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${Colors.canvas}B8`,
  },
  card: {
    width: '84%',
    maxWidth: 360,
    borderRadius: Radius.surface,
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
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
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    minHeight: 56,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
  },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  grow: { flex: 1 },
  glyphFallback: { color: Colors.accent, fontSize: 11 },
});
