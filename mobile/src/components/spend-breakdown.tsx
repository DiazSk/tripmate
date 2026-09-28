import { StyleSheet, View } from 'react-native';

import type { DayPlan } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { anyActualSpend, daySpend, formatMoney, spendShares } from '@/lib/spend';

/** The composition band's height — a shade taller than the budget bar's track, because this one
 *  is the subject of its own section rather than a rule under the chrome. */
const BAND_HEIGHT = 10;

/**
 * One gold, stepped down by rank.
 *
 * Five categories and five hues would be a legend nobody can hold, and four of them would have to
 * come from outside a palette where colour already means something — jade is action, coral is
 * failure. Rank is the only thing being encoded, and alpha encodes rank without borrowing a
 * meaning. At most five are ever needed; the tail repeats rather than fading into the track.
 */
const RANK_ALPHA = ['FF', 'CC', '99', '70', '4D'];

const goldAtRank = (rank: number) => `${Colors.money}${RANK_ALPHA[Math.min(rank, RANK_ALPHA.length - 1)]}`;

/**
 * Where a day's money actually went.
 *
 * Sits at the foot of the day, after the stay — the same place the Swift app puts it, and for the
 * same reason: it is a summary of what you have just read, so it cannot come before it.
 *
 * **The total stays on the section rule rather than becoming a sixth row.** It is the sum of the
 * others, not a peer of them, and a row that adds up the rows above it invites being read as one
 * more category.
 *
 * Renders nothing for a day that costs nothing. Zero-amount categories get no row either — see
 * `spendShares`, which drops them — so a day of free walks and a day nobody has priced both look
 * like what they are rather than like five zeroes.
 */
export function SpendBreakdown({ day, dayIndex }: { day: DayPlan; dayIndex: number }) {
  const shares = spendShares(day);
  if (shares.length === 0) return null;

  const total = daySpend(day);

  // The same branch `budget-bar.tsx` makes on the bar above this, and for the same reason:
  // `daySpend` coalesces `actualCost ?? cost`, so the word has to follow the data. Two figures
  // on one screen calling the same summation by two different names is how a projection gets
  // read as a receipt.

  return (
    <View style={styles.wrap}>
      <View style={styles.sectionRule}>
        <ThemedText type="label" themeColor="muted">
          {`Day ${dayIndex + 1} ${anyActualSpend([day]) ? 'spend' : 'projected'}`}
        </ThemedText>
        <View style={styles.rule} />
        <ThemedText type="money" themeColor="money">
          {formatMoney(total)}
        </ThemedText>
      </View>

      {/* A single category is a band with one segment, which draws a solid bar saying only what
          the row beneath it already says. The rows carry it from there. */}
      {shares.length > 1 ? (
        <View style={styles.band} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {shares.map((share, rank) => (
            <View
              key={share.key}
              style={[
                styles.bandSegment,
                // The true fraction, never the rounded percent — a 34% slice must not be drawn
                // wider than it is just because its label rounded up.
                { width: `${share.fraction * 100}%`, backgroundColor: goldAtRank(rank) },
                rank > 0 && styles.bandRuled,
              ]}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.rows}>
        {shares.map((share, rank) => (
          <View key={share.key} style={[styles.row, rank > 0 && styles.rowRuled]}>
            <View style={[styles.swatch, { backgroundColor: goldAtRank(rank) }]} />
            <ThemedText type="body" style={styles.grow}>
              {share.label}
            </ThemedText>
            <ThemedText type="label" themeColor="muted" style={styles.percent}>
              {`${share.percent}%`}
            </ThemedText>
            <ThemedText type="money" themeColor="money">
              {formatMoney(share.amount)}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.read, paddingTop: Spacing.regular, gap: Spacing.tight },

  sectionRule: { flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.cardBorder },

  band: {
    flexDirection: 'row',
    height: BAND_HEIGHT,
    borderRadius: Radius.tight,
    backgroundColor: Colors.moneySoft,
    overflow: 'hidden',
  },
  bandSegment: { height: '100%' },
  // Inside the segment's own width, so the separators cost the band nothing.
  bandRuled: { borderLeftWidth: 1, borderLeftColor: Colors.canvas },

  rows: {
    backgroundColor: Colors.panel,
    borderRadius: Radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    minHeight: 40,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
  },
  rowRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  swatch: { width: 8, height: 8, borderRadius: Radius.pill },
  grow: { flex: 1 },
  // A fixed column so the percentages line up under each other rather than floating against
  // labels of different lengths.
  percent: { width: 34, textAlign: 'right' },
});
