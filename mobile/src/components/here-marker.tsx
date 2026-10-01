import { StyleSheet, View } from 'react-native';

import { Colors, MapObjectShadow, OverPhotograph } from '@/constants/theme';

/**
 * Where the reader is, and which way they are facing.
 *
 * **It replaces Apple's own blue dot, which pulses.** `showsUserLocation` draws `MKUserLocation`,
 * and a pulse is an animation that says "live" and nothing else — on a screen somebody is holding
 * in a street, the useful thing is not that the fix is fresh but which way they are pointing, so
 * the dot stops breathing and grows a cone instead.
 *
 * **The cone cannot rotate natively on iPhone.** `Marker`'s `rotation` and `flat` props are both
 * "iOS: Google Maps only", and this map is deliberately Apple's — so the rotation is a JS
 * transform on the marker's own content, which is why `useHeading` throttles and why the caller
 * sets `tracksViewChanges`. The same limit means the marker is always billboarded: under 3D tilt
 * this cone stands up facing the camera where Apple's lies flat on the ground. A visible
 * difference from the reference, and not one reachable from here.
 *
 * **A triangle built from borders, not an SVG or a gradient.** This project has neither library,
 * and neither is worth adding for one shape — a transparent left and right border against a
 * coloured bottom border is the oldest trick there is and it costs nothing. What it cannot do is
 * Apple's fade from opaque at the dot to nothing at the far edge; a flat translucent wedge is the
 * honest approximation, and at this size the difference is small.
 *
 * The dot takes the same ring and shadow as `StopDisc`, so the reader and the stops read as one
 * family of objects the app drew, against a map it did not.
 *
 * **`OverPhotograph.accentDisc`, not `Colors.accent`** — the same catch as the emphasised stop
 * disc, and I reintroduced it here before noticing. This is a map mark standing beside four day
 * cores that do not move with the appearance, so it must not either; under the light appearance
 * `Colors.accent` darkens to `#245E48`, which would make the reader a different object on a
 * light map than on a dark one for no reason the map can see.
 */
export function HereMarker({ heading }: { heading: number | null }) {
  return (
    <View style={styles.frame}>
      {/* No cone where nothing can say which way is forward — permission refused, no
          magnetometer, or the simulator. A cone pointing at a guess is worse than no cone. */}
      {heading === null ? null : (
        <View style={[styles.cone, { transform: [{ rotate: `${heading}deg` }] }]}>
          <View style={styles.wedge} />
        </View>
      )}
      <View style={styles.lift}>
        <View style={styles.dot} />
      </View>
    </View>
  );
}

const DOT = 16;
const RING = 2;
/** How far the cone reaches, and how wide it opens. */
const CONE_LENGTH = 30;
const CONE_HALF_WIDTH = 17;
/** The frame has to hold the cone at any rotation, so it is square and sized to the diagonal. */
const FRAME = (CONE_LENGTH + DOT / 2) * 2;

const styles = StyleSheet.create({
  frame: { width: FRAME, height: FRAME, alignItems: 'center', justifyContent: 'center' },
  // The rotation box is centred on the dot, so turning it sweeps the wedge around the reader
  // rather than around the wedge's own middle.
  cone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: FRAME / 2 - CONE_LENGTH,
  },
  // Borders, not a path: transparent sides against a coloured bottom make a triangle with the
  // point at the top, which is the direction a heading of 0 means.
  wedge: {
    width: 0,
    height: 0,
    borderLeftWidth: CONE_HALF_WIDTH,
    borderRightWidth: CONE_HALF_WIDTH,
    borderBottomWidth: CONE_LENGTH,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: `${OverPhotograph.accentDisc}4D`,
    transform: [{ rotate: '180deg' }],
  },
  lift: { borderRadius: (DOT + RING * 2) / 2, ...MapObjectShadow },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: OverPhotograph.accentDisc,
    borderWidth: RING,
    borderColor: Colors.onDeep,
  },
});
