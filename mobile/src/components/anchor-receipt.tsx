import { Pressable, StyleSheet, View } from 'react-native';

import type { Itinerary } from '@/api/types';
import { anchorCoverage } from '@/lib/anchors';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

/**
 * "N of M must-see places are in the plan" — the promise the import step made, kept in writing.
 * Computed from the plan itself (`anchorCoverage`), never from what the model claimed. Mirrors the
 * web's `AnchorReceipt.tsx`.
 */
export function AnchorReceipt({
  itinerary,
  onFitAnchor,
}: {
  itinerary: Itinerary;
  /** Absent where the plan can't be regenerated: the button is then hidden. */
  onFitAnchor?: (name: string) => void;
}) {
  const cov = anchorCoverage(itinerary);
  if (!cov) return null;
  const notIn = [
    ...cov.unplaced,
    ...cov.missing.map((name) => ({ name, reason: 'Left out without a reason.' })),
  ];

  return (
    <View style={styles.card}>
      <ThemedText type="detail">
        {cov.placed.length} of {cov.total} must-see {cov.total === 1 ? 'place is' : 'places are'} in
        the plan.
      </ThemedText>
      {notIn.length > 0 ? (
        <View style={styles.list}>
          {notIn.map((u) => (
            <View key={u.name} style={styles.row}>
              <ThemedText type="detail" themeColor="muted" style={styles.grow}>
                <ThemedText type="detail">{u.name}</ThemedText>: {u.reason}
              </ThemedText>
              {onFitAnchor ? (
                <Pressable
                  onPress={() => onFitAnchor(u.name)}
                  accessibilityRole="button"
                  hitSlop={8}>
                  <ThemedText type="label" themeColor="accent">
                    Fit it anyway
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceDeep,
    borderRadius: Radius.read,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.tight,
    marginHorizontal: Spacing.read,
    marginBottom: Spacing.tight,
    gap: Spacing.tight,
  },
  list: { gap: Spacing.hair },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.rows },
  grow: { flex: 1 },
});
