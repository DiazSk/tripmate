import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { DiscInk } from '@/constants/theme';

/**
 * A stop's number, in its day's colour.
 *
 * **One component because it is one mark.** `theme.ts` calls this the single sanctioned crossing
 * between the interface palette and the map palette, on the grounds that the disc in a day's list
 * and the disc on the day's map are *the same thing* — carrying the day's hue across is what makes
 * the two agree about which stop is which. A copy in each file would make that claim while
 * quietly permitting the two to drift.
 *
 * The hairline is white at 30% rather than a palette token: it exists to hold the disc's edge
 * against whatever is behind it, which on the map is a photograph of the world and not a surface
 * this system controls.
 */
export function StopDisc({ ordinal, color }: { ordinal: number; color: string }) {
  return (
    <View style={[styles.disc, { backgroundColor: color }]}>
      <ThemedText type="money" style={styles.ordinal}>
        {ordinal}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  ordinal: { color: DiscInk, lineHeight: 15 },
});
