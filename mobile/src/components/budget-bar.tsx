import { StyleSheet, View } from 'react-native';

import type { DayPlan } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { budgetSegments, formatMoney, tripSpend } from '@/lib/spend';

/** The track's own height. Thin enough to read as a rule rather than a widget — this sits under
 *  the chrome on every screen of a trip, and a chunky meter would outrank the plan below it. */
const TRACK_HEIGHT = 6;

/**
 * Gold at 62%, for the days you are not reading.
 *
 * The same alpha the palette uses to step `foreground` down to `muted`, rather than a second
 * sampled colour: it stays correct over any surface instead of being tuned for one. Money is one
 * hue here by rule, so the days are told apart by weight and by the hairlines between them, never
 * by giving each its own colour.
 */
const SEGMENT_DIM = '#E9B44C9E';

/**
 * Spend against the trip's budget, cut into one span per day.
 *
 * **Every figure is imported.** `tripSpend` and `budgetSegments` live in the shared money module
 * and are covered by its tests; nothing is summed here. Arithmetic inside a component is
 * arithmetic nothing checks — the web's own bar is built the same way and says so.
 *
 * **One denominator, always the budget.** A span's length means the same thing under, at and over
 * it. Past the budget the days fill in order, the day that crosses is drawn partial, and the days
 * after it get nothing — which is the honest reading (*the budget ran out on day four*) rather
 * than a fallback. The rejected alternative, rescaling every span so all days stay visible,
 * quietly swaps the denominator to the spend the moment you cross: one length, two meanings.
 *
 * Renders nothing at all when no budget was set. An empty track is a claim about a number nobody
 * gave, and a trip planned without one is a normal trip.
 */
export function BudgetBar({
  days,
  budget,
  activeDayIndex,
}: {
  days: DayPlan[];
  budget: number;
  /** The day being read, drawn at full strength so the bar says where you are as you swipe. */
  activeDayIndex: number;
}) {
  if (!(budget > 0)) return null;

  const spent = tripSpend(days);
  const segments = budgetSegments(days, budget);
  const over = spent > budget;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <ThemedText type="label" themeColor="muted">
          Budget
        </ThemedText>
        <View style={styles.figures}>
          <ThemedText type="money" themeColor={over ? 'alert' : 'money'}>
            {formatMoney(spent)}
          </ThemedText>
          <ThemedText type="money" themeColor="muted">
            {` of ${formatMoney(budget)}`}
          </ThemedText>
        </View>
      </View>

      {/* Decorative: the two figures above already say everything this draws, and a screen reader
          reading a row of unlabelled spans would only be in the way of them. */}
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {segments.map((segment, index) => (
          <View
            key={segment.dayIndex}
            style={[
              styles.segment,
              // Percent widths, so the spans lay themselves out and no pixel measurement is
              // needed. They sum to at most 100 by construction.
              { width: `${segment.width}%` },
              segment.dayIndex === activeDayIndex ? styles.segmentActive : styles.segmentDim,
              // A hairline in the canvas colour, drawn *inside* the span's own width so the
              // separators cost the track nothing and the spans still add up.
              index > 0 && styles.segmentRuled,
            ]}
          />
        ))}
      </View>

      {over ? (
        <ThemedText type="caption" themeColor="alert">
          {`${formatMoney(spent - budget)} over budget`}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.read, paddingBottom: Spacing.tight, gap: Spacing.hair },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  // Baseline-aligned so the spend and the budget sit on one line even as the type scales.
  figures: { flexDirection: 'row', alignItems: 'baseline' },
  track: {
    flexDirection: 'row',
    height: TRACK_HEIGHT,
    borderRadius: Radius.pill,
    backgroundColor: Colors.moneySoft,
    overflow: 'hidden',
  },
  segment: { height: '100%' },
  segmentActive: { backgroundColor: Colors.money },
  segmentDim: { backgroundColor: SEGMENT_DIM },
  segmentRuled: { borderLeftWidth: 1, borderLeftColor: Colors.canvas },
});
