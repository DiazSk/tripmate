import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, DiscInk, FontScale, MapObjectShadow } from '@/constants/theme';

/**
 * A stop's number, in its day's colour.
 *
 * **One component because it is one mark.** `theme.ts` calls this the single sanctioned crossing
 * between the interface palette and the map palette, on the grounds that the disc in a day's list
 * and the disc on the day's map are *the same thing* — carrying the day's hue across is what makes
 * the two agree about which stop is which. A copy in each file would make that claim while
 * quietly permitting the two to drift.
 *
 * **The ring and the shadow are what make it findable on photography.** It shipped with a
 * white-at-30% hairline and nothing else, which is enough on the vector basemap and disappears
 * entirely over satellite — a small saturated circle on a field of saturated circles. DESIGN.md's
 * Shadow Vocabulary specifies this exact case ("**Object on the map**… the marker title card,
 * sitting on real photography") and names the ring as part of it: a 1px inset white highlight.
 * Opaque and 2pt here rather than a hairline at 30%, because the thing being separated is 26pt
 * across and the ground underneath it can be any colour at all.
 *
 * The fill and the ink do not change. `dayCore` is map-native and `DiscInk` is measured against
 * it; the ring sits outside both.
 */
export function StopDisc({ ordinal, color }: { ordinal: number; color: string }) {
  // The numeral grows to chrome's cap and the disc grows with it, or at the large text sizes the
  // number spills over its own ring.
  const { fontScale } = useWindowDimensions();
  const size = Math.round(DISC_SIZE * Math.min(Math.max(fontScale, 1), FontScale.chrome));
  return (
    // Two boxes, because a view that clips its children clips its own shadow with them — the
    // same split the floating map controls make, for the same reason.
    <View style={[styles.lift, { borderRadius: size / 2 + RING }]}>
      <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
        <ThemedText type="money" maxFontSizeMultiplier={FontScale.chrome} style={styles.ordinal}>
          {ordinal}
        </ThemedText>
      </View>
    </View>
  );
}

/** The disc, and the white ring around it. */
export const DISC_SIZE = 26;
const RING = 2;

const styles = StyleSheet.create({
  lift: { borderRadius: (DISC_SIZE + RING * 2) / 2, ...MapObjectShadow },
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: RING,
    borderColor: Colors.onDeep,
  },
  ordinal: { color: DiscInk, lineHeight: 15 },
});
