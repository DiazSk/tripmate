import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import type { MapType } from 'react-native-maps';

import { ThemedText } from '@/components/themed-text';
import { Colors, Motion, Radius, Spacing } from '@/constants/theme';

/** The pitch a 3D press flies to. Apple's own button lands near here. */
export const PITCH_3D = 55;

/**
 * The modes worth offering, of the eight `MapType` carries.
 *
 * `standard` is deliberately absent: Apple's standard map paints landcover in saturated greens
 * and purples that compete with the day's own hue, which is the whole reason this app opens on
 * `mutedStandard`. `terrain` is Android-only, and the two `*Flyover` types are `satellite` and
 * `hybrid` with 3D scenery — which the 3D button reaches anyway, without a second row.
 */
const MODES: { type: MapType; label: string }[] = [
  { type: 'mutedStandard', label: 'Map' },
  { type: 'satellite', label: 'Satellite' },
  { type: 'hybrid', label: 'Hybrid' },
];

/**
 * The map's own controls, in Apple Maps' arrangement and this app's material.
 *
 * **Placement is Apple's; the material is not, and that is the deliberate half.** Apple stacks a
 * 3D toggle bottom-left and a mode picker over a locate arrow on the right edge, and a reader who
 * uses Maps reaches for them there — copying the *position* is what makes them findable. Copying
 * the *look* would put white circles with iOS-blue glyphs on a screen whose whole argument is
 * that it was composed, so these are the one slate at `surfaceDeep` with jade ink: opaque like
 * the summary pill above them and for the same reason, because a translucent control with a
 * street name showing through it reads as a rendering fault.
 *
 * **There is no Look Around button, and it is not an omission.** Apple's binoculars open
 * `MKLookAroundViewController`, which `react-native-maps` does not expose at any version — no
 * prop, no method, nothing. Reaching it means a native module and a config plugin, which means
 * leaving Expo Go, and `day-map.tsx` records Expo Go compatibility as load-bearing: it is what
 * lets this map work with no key and no development build. That is a platform decision, not a
 * map control.
 */
export function MapControls({
  pitched,
  onToggle3D,
  mapType,
  onMapType,
  onLocate,
}: {
  pitched: boolean;
  onToggle3D: () => void;
  mapType: MapType;
  onMapType: (type: MapType) => void;
  /** Absent until the location permission is already granted — see `lib/here.ts`. */
  onLocate?: () => void;
}) {
  const [menu, setMenu] = useState(false);

  return (
    <>
      {/* Bottom-left, where Apple puts it. Text rather than a glyph, also Apple's call: "3D" is
          shorter than any icon of it and needs no legend. */}
      <Pressable
        onPress={onToggle3D}
        accessibilityRole="button"
        accessibilityState={{ selected: pitched }}
        accessibilityLabel={pitched ? 'Switch to a flat map' : 'Tilt the map'}
        style={({ pressed }) => [
          styles.button,
          styles.left,
          pitched && styles.buttonOn,
          pressed && styles.pressed,
        ]}>
        <ThemedText type="label" themeColor="accent">
          3D
        </ThemedText>
      </Pressable>

      {/* Right edge: modes over locate, joined as one capsule with a rule between — Apple draws
          them as a single object rather than two floating circles, and so does this. */}
      <View style={styles.right}>
        <Pressable
          onPress={() => setMenu((was) => !was)}
          accessibilityRole="button"
          accessibilityState={{ expanded: menu }}
          accessibilityLabel="Choose a map style"
          style={({ pressed }) => [styles.stacked, pressed && styles.pressed]}>
          <SymbolView
            // Object form, never a bare SF string: given one, the Android path renders nothing
            // at all, silently.
            name={{ ios: 'map', android: 'map' }}
            tintColor={Colors.accent}
            size={20}
            fallback={<Text style={styles.glyphFallback}>Map</Text>}
          />
        </Pressable>

        {onLocate ? (
          <Pressable
            onPress={onLocate}
            accessibilityRole="button"
            accessibilityLabel="Centre on where you are"
            style={({ pressed }) => [styles.stacked, styles.ruled, pressed && styles.pressed]}>
            <SymbolView
              name={{ ios: 'location.fill', android: 'my_location' }}
              tintColor={Colors.accent}
              size={20}
              fallback={<Text style={styles.glyphFallback}>Here</Text>}
            />
          </Pressable>
        ) : null}
      </View>

      {menu ? (
        <Animated.View
          entering={FadeIn.duration(Motion.respond)}
          exiting={FadeOut.duration(Motion.exit)}
          style={styles.menu}>
          {MODES.map((mode, index) => (
            <Pressable
              key={mode.type}
              onPress={() => {
                onMapType(mode.type);
                setMenu(false);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: mode.type === mapType }}
              style={({ pressed }) => [
                styles.mode,
                index > 0 && styles.ruled,
                mode.type === mapType && styles.buttonOn,
                pressed && styles.pressed,
              ]}>
              <ThemedText type="detail" themeColor={mode.type === mapType ? 'accent' : 'foreground'}>
                {mode.label}
              </ThemedText>
            </Pressable>
          ))}
        </Animated.View>
      ) : null}
    </>
  );
}

/** 44, the HIG minimum, and what Apple's own circles measure. */
const SIZE = 44;

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  // Clear of the caption, which takes the bottom edge when a stop is emphasised.
  left: { left: Spacing.read, bottom: 76 },
  right: {
    position: 'absolute',
    right: Spacing.read,
    // Apple sits this group above the midpoint rather than centred; measured off the reference.
    top: '46%',
    borderRadius: Radius.surface,
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  stacked: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  /**
   * **A jade edge, not a jade wash.** `accentWash` is an alpha, and setting it as
   * `backgroundColor` *replaces* the opaque base rather than layering over it — so the chosen
   * state became a translucent pane, which is invisible the moment the mode picker puts
   * satellite imagery underneath. Seen on the device, not reasoned about: the 3D button
   * disappeared into a photograph of Lisbon. The border keeps the fill opaque and says the same
   * thing.
   */
  buttonOn: { borderColor: Colors.accent },
  pressed: { opacity: 0.7 },
  menu: {
    position: 'absolute',
    right: Spacing.read + SIZE + Spacing.tight,
    top: '46%',
    minWidth: 128,
    borderRadius: Radius.surface,
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  mode: { minHeight: SIZE, justifyContent: 'center', paddingHorizontal: Spacing.read },
  glyphFallback: { color: Colors.accent, fontSize: 11 },
});
