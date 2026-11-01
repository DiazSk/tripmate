import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Polar, PolarFonts } from '@/constants/polar';
import type { Pill } from '@/lib/readyTrips';
import { Text } from '@/components/themed-text';

/**
 * The filter pills with their counts ("All 35 · Desert 6 · Coast 10 …"), one row that scrolls
 * sideways. They filter the carousel and the rails together; pinning them under the bar is the
 * host's `stickyHeaderIndices`, not anything here, so this is only the row.
 */
export function FilterPills({ pills, active, onChange }: { pills: { pill: Pill; count: number }[]; active: Pill; onChange: (p: Pill) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityLabel="Filter ready-made trips">
      {pills.map(({ pill, count }) => {
        const on = pill === active;
        return (
          <Pressable
            key={pill}
            onPress={() => onChange(pill)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${pill}, ${count} ${count === 1 ? 'trip' : 'trips'}`}
            style={({ pressed }) => [styles.pill, on ? styles.on : styles.off, pressed && styles.pressed]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.name, on && styles.nameOn]}>
              {pill}
              <Text style={[styles.count, on && styles.countOn]}>{`  ${count}`}</Text>
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  pill: { minHeight: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: 'center' },
  on: { backgroundColor: Polar.ink },
  off: { backgroundColor: Polar.ice, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: Polar.rule },
  pressed: { opacity: 0.75 },
  name: { fontFamily: PolarFonts.sans, fontSize: 14, color: Polar.ink },
  nameOn: { color: Polar.ice },
  count: { fontFamily: PolarFonts.sansRegular, color: Polar.secondary, fontVariant: ['tabular-nums'] },
  countOn: { color: 'rgba(255,255,255,0.75)' },
});
