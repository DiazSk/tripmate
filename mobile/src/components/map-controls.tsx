import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import type { MapType } from 'react-native-maps';

import { ThemedText } from '@/components/themed-text';
import { Colors, Motion, Radius, Spacing } from '@/constants/theme';

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

/**
 * The map's own controls, in Apple Maps' arrangement and this app's material.
 *
 * **Placement is Apple's; the material is not, and that is the deliberate half.** Apple stacks
 * its 3D toggle at the bottom-left and puts the mode picker over the locate arrow as a single
 * capsule on the right, both sitting low and roughly level with each other — a reader who uses
 * Maps reaches there. Copying the *look* would put white circles with iOS-blue glyphs on a
 * screen whose whole argument is that it was composed, so these are the one slate at
 * `surfaceDeep` with jade ink, opaque like the summary pill for the same reason.
 *
 * **One capsule, no divider.** Apple draws the mode and locate buttons as one continuous pill,
 * and the rule this shipped with was mine rather than theirs.
 *
 * **There is no Look Around button, and it is not an omission.** Apple's binoculars open
 * `MKLookAroundViewController`, which `react-native-maps` does not expose at any version — no
 * prop, no method, nothing. Reaching it means a native module and a config plugin, which means
 * leaving Expo Go, and `day-map.tsx` records Expo Go compatibility as load-bearing.
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
  const [picking, setPicking] = useState(false);

  return (
    <>
      {/* **Labelled with the mode you will get, not the one you are in** — DESIGN.md:1323 says
          so for the web's own toggle, and Apple's button agrees: it reads "3D" while the map is
          flat. That also retires the jade edge this shipped with, because the word now carries
          the state on its own. */}
      <Pressable
        onPress={onToggle3D}
        accessibilityRole="button"
        accessibilityLabel={pitched ? 'Switch to a flat map' : 'Tilt the map'}
        style={({ pressed }) => [styles.round, styles.left, pressed && styles.pressed]}>
        <ThemedText type="label" themeColor="accent">
          {pitched ? '2D' : '3D'}
        </ThemedText>
      </Pressable>

      <View style={styles.right}>
        <Pressable
          onPress={() => setPicking(true)}
          accessibilityRole="button"
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
            style={({ pressed }) => [styles.stacked, pressed && styles.pressed]}>
            <SymbolView
              name={{ ios: 'location.fill', android: 'my_location' }}
              tintColor={Colors.accent}
              size={20}
              fallback={<Text style={styles.glyphFallback}>Here</Text>}
            />
          </Pressable>
        ) : null}
      </View>

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

/** 44, the HIG minimum, and what Apple's own controls measure. */
const SIZE = 44;
/** Clear of the caption, which takes the bottom edge when a stop is emphasised. */
const FLOOR = 76;

const styles = StyleSheet.create({
  round: {
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
  left: { left: Spacing.read, bottom: FLOOR },
  // **Bottom, level with the 3D button** — it sat at 46% of the height, which is nowhere Apple
  // puts anything and left the two groups unrelated. A pill, not a rounded box: Apple's is
  // fully round at both ends and this was `Radius.surface` by inattention.
  right: {
    position: 'absolute',
    right: Spacing.read,
    bottom: FLOOR,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  stacked: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },

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
