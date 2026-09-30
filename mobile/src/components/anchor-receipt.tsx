import { StyleSheet, View } from 'react-native';

import type { Itinerary } from '@/api/types';
import { anchorCoverage } from '@/lib/anchors';
import { PillButton } from '@/components/form';
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
  kept,
}: {
  itinerary: Itinerary;
  /** Absent where the plan can't be regenerated: the button is then hidden. */
  onFitAnchor?: (name: string) => void;
  /** A kept trip with every must-see placed has nothing left to act on, so it shows nothing. */
  kept?: boolean;
}) {
  const cov = anchorCoverage(itinerary);
  if (!cov) return null;
  const notIn = [
    ...cov.unplaced,
    ...cov.missing.map((name) => ({ name, reason: 'Left out without a reason.' })),
  ];
  if (kept && notIn.length === 0) return null;

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
                <PillButton
                  compact
                  title="Fit it anyway"
                  accessibilityLabel={`Fit ${u.name} anyway`}
                  onPress={() => onFitAnchor(u.name)}
                />
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
  // `flex-start`, not `baseline`: a 44pt capsule has no text baseline to share with a sentence
  // that may run to three lines, and baseline-aligning it dropped the whole row by its height.
  // Wraps rather than squeezing, since the reason is long and the capsule is not.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.rows,
  },
  grow: { flex: 1 },
});
