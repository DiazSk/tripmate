import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { DayPlan } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDayChip } from '@/lib/dayDisplay';
import {
  SURENESS_LABEL,
  daySpend,
  formatMoney,
  spendOf,
  spendShares,
  surenessOf,
  surenessSplit,
  tripShares,
  tripSpend,
  type SpendShare,
  type Sureness,
} from '@/lib/spend';

const NEXT: Record<Sureness, Sureness> = { estimate: 'booked', booked: 'paid', paid: 'estimate' };

/** Money has no hue: one white, stepped down by rank, so the largest share is the brightest. */
const RANK_ALPHA = ['FF', 'B8', '80', '57', '3D'];
const atRank = (rank: number) => `${Colors.money}${RANK_ALPHA[Math.min(rank, RANK_ALPHA.length - 1)]}`;

/**
 * Where the money went, as one band: a span per category, widths from the true fraction (never
 * the rounded percent). A single category draws nothing — a solid bar says only what its one row
 * already does.
 */
export function MoneyBand({ shares }: { shares: SpendShare[] }) {
  if (shares.length < 2) return null;
  return (
    <View style={styles.band} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {shares.map((share, rank) => (
        <View
          key={share.key}
          style={[styles.span, { width: `${share.fraction * 100}%`, backgroundColor: atRank(rank) }, rank > 0 && styles.spanRuled]}
        />
      ))}
    </View>
  );
}

/**
 * The trip's money, opened from the budget ring or from a day's total.
 *
 * Two tabs because there are two questions. **Trip**: how much, how sure, and where it went, by
 * category and by day — a day row opens that day. **Day**: the day stop by stop, where each cost's
 * state is set with one tap (Estimate, then Booked, then Paid), which also locks the stop — see
 * `surenessFields`. The amount itself is entered on the stop, where you know what it was.
 *
 * The body of the `trip/[id]/budget` form-sheet route (see `lib/tripSheets.ts`); mounting with the
 * route is the reset, so it opens on the tab it was asked for.
 */
export function BudgetSheet({
  initial,
  days,
  budget,
  dayIndex,
  offline,
  onDay,
  onSureness,
  onClose,
}: {
  initial: 'trip' | 'day';
  days: DayPlan[];
  budget: number;
  dayIndex: number;
  offline: boolean;
  onDay: (dayIndex: number) => void;
  onSureness: (dayIndex: number, stopIndex: number, sureness: Sureness) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Two children, header then the ScrollView, and the header not flattened: that is the
          shape react-native-screens' form sheet sizes to the detent (`RNSScreenContentWrapper`
          coerces a ScrollView at index 0 or 1 and gives up past two siblings). A wrapping View,
          or a header flattened into its Text and Pressable, left the ScrollView at the sheet's
          top, over the title and over Done. */}
      <View collapsable={false} style={styles.bar}>
        <ThemedText type="title">Budget</ThemedText>
        <SheetDone onPress={onClose} />
      </View>
      <Body
        initial={initial}
        days={days}
        budget={budget}
        dayIndex={dayIndex}
        offline={offline}
        onDay={onDay}
        onSureness={onSureness}
      />
    </>
  );
}

/**
 * The way out of a sheet that changes nothing on the way out: "Done", trailing, in the accent.
 * Shared by Budget and the chat history so the trip's sheets say it one way; Add a stop says
 * Cancel instead, because closing it drops a search and a chosen place.
 */
export function SheetDone({ onPress, label = 'Done' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={12} style={styles.done}>
      <ThemedText type="body" themeColor="accentText" style={{ fontWeight: '600' }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function Body({
  initial,
  days,
  budget,
  dayIndex,
  offline,
  onDay,
  onSureness,
}: Omit<Parameters<typeof BudgetSheet>[0], 'onClose'>) {
  const [tab, setTab] = useState(initial);
  const spent = tripSpend(days);
  const day = days[dayIndex];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.switch}>
        {(['trip', 'day'] as const).map((option) => {
          const on = tab === option;
          return (
            <Pressable
              key={option}
              onPress={() => setTab(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.half, on && styles.halfOn]}>
              <ThemedText type="detail" style={{ color: on ? Colors.accentForeground : Colors.foreground, fontWeight: '600' }}>
                {option === 'trip' ? 'Trip' : `Day ${dayIndex + 1}`}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {tab === 'trip' ? (
        <TripTab days={days} budget={budget} spent={spent} dayIndex={dayIndex} onOpenDay={(i) => { onDay(i); setTab('day'); }} />
      ) : day ? (
        <DayTab day={day} dayIndex={dayIndex} offline={offline} onSureness={onSureness} />
      ) : null}
    </ScrollView>
  );
}

function TripTab({
  days,
  budget,
  spent,
  dayIndex,
  onOpenDay,
}: {
  days: DayPlan[];
  budget: number;
  spent: number;
  dayIndex: number;
  onOpenDay: (dayIndex: number) => void;
}) {
  const split = surenessSplit(days);
  const scale = Math.max(spent, budget, 1);
  const over = budget > 0 && spent > budget;
  const largest = Math.max(1, ...days.map(daySpend));
  const order: Sureness[] = ['paid', 'booked', 'estimate'];

  return (
    <>
      <View style={styles.total}>
        <ThemedText type="moneyLarge" style={[styles.figure, over && styles.over]}>
          {formatMoney(spent)}
        </ThemedText>
        {budget > 0 ? (
          <ThemedText type="detail" themeColor="muted">{`of ${formatMoney(budget)}`}</ThemedText>
        ) : null}
      </View>
      <View style={styles.certainty} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {order.map((key, i) => (
          <View key={key} style={[styles.span, { width: `${(split[key] / scale) * 100}%` }, CERTAINTY[key], i > 0 && styles.spanRuled]} />
        ))}
      </View>
      {budget > 0 ? (
        <ThemedText type="detail" themeColor={over ? 'alert' : 'muted'}>
          {over ? `${formatMoney(spent - budget)} over budget` : `${formatMoney(budget - spent)} left in the budget`}
        </ThemedText>
      ) : null}

      <View style={styles.group}>
        {order.map((key, i) => (
          <View key={key} style={[styles.row, i > 0 && styles.rowRuled]}>
            <View style={[styles.swatch, CERTAINTY[key]]} />
            <ThemedText type="body" style={styles.grow}>
              {SURENESS_LABEL[key]}
            </ThemedText>
            <ThemedText type="money" themeColor="money">
              {formatMoney(split[key])}
            </ThemedText>
          </View>
        ))}
      </View>

      <Heading>By category</Heading>
      <View style={styles.group}>
        {tripShares(days).map((share, i) => (
          <View key={share.key} style={[styles.row, i > 0 && styles.rowRuled]}>
            <ThemedText type="body" style={styles.grow}>
              {share.label}
            </ThemedText>
            <ThemedText type="detail" themeColor="muted" style={styles.percent}>
              {`${share.percent}%`}
            </ThemedText>
            <ThemedText type="money" themeColor="money" style={styles.amount}>
              {formatMoney(share.amount)}
            </ThemedText>
          </View>
        ))}
      </View>

      <Heading>By day</Heading>
      <View style={styles.group}>
        {days.map((plan, i) => {
          const chip = formatDayChip(plan.date);
          const total = daySpend(plan);
          return (
            <Pressable
              key={plan.date}
              onPress={() => onOpenDay(i)}
              accessibilityRole="button"
              accessibilityLabel={`Day ${i + 1}, ${formatMoney(total)}. Open it stop by stop.`}
              style={({ pressed }) => [styles.row, i > 0 && styles.rowRuled, pressed && styles.pressed]}>
              <ThemedText type="body" style={[styles.dayName, i === dayIndex && styles.current]}>
                {`Day ${i + 1}`}
                {chip ? (
                  <ThemedText type="detail" themeColor="muted">{`  ${chip.weekday} ${chip.dayOfMonth}`}</ThemedText>
                ) : null}
              </ThemedText>
              <View style={styles.dayTrack}>
                <View style={[styles.dayFill, { width: `${(total / largest) * 100}%` }]} />
              </View>
              <ThemedText type="money" themeColor="money" style={styles.amount}>
                {formatMoney(total)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function DayTab({
  day,
  dayIndex,
  offline,
  onSureness,
}: {
  day: DayPlan;
  dayIndex: number;
  offline: boolean;
  onSureness: (dayIndex: number, stopIndex: number, sureness: Sureness) => void;
}) {
  return (
    <>
      <View style={styles.total}>
        <ThemedText type="moneyLarge" style={styles.figure}>{formatMoney(daySpend(day))}</ThemedText>
      </View>
      <MoneyBand shares={spendShares(day)} />

      <Heading>Stop by stop</Heading>
      <View style={styles.group}>
        {day.stops.map((stop, i) => {
          const sureness = surenessOf(stop);
          return (
            <View key={`${stop.name}-${i}`} style={[styles.row, i > 0 && styles.rowRuled]}>
              <ThemedText type="body" numberOfLines={1} style={styles.grow}>
                {stop.name}
              </ThemedText>
              <Pressable
                onPress={() => onSureness(dayIndex, i, NEXT[sureness])}
                disabled={offline}
                accessibilityRole="button"
                accessibilityLabel={`${stop.name}: ${SURENESS_LABEL[sureness]}. Tap to change.`}
                accessibilityState={{ disabled: offline }}
                style={[styles.chip, CHIP[sureness], offline && styles.chipOff]}>
                <ThemedText type="caption" style={{ color: sureness === 'estimate' ? Colors.foreground : Colors.accentForeground }}>
                  {SURENESS_LABEL[sureness]}
                </ThemedText>
              </Pressable>
              <ThemedText type="money" themeColor="money" style={styles.amount}>
                {spendOf(stop) ? formatMoney(spendOf(stop)) : 'Free'}
              </ThemedText>
            </View>
          );
        })}
        {day.lodging ? (
          <View style={[styles.row, day.stops.length > 0 && styles.rowRuled]}>
            <ThemedText type="body" numberOfLines={1} style={styles.grow}>
              {day.lodging.name}
            </ThemedText>
            {/* Read-only: nothing on the phone writes a stay's cost yet, so its chip only says. */}
            <View style={[styles.chip, CHIP[surenessOf(day.lodging)]]}>
              <ThemedText
                type="caption"
                style={{ color: surenessOf(day.lodging) === 'estimate' ? Colors.foreground : Colors.accentForeground }}>
                {SURENESS_LABEL[surenessOf(day.lodging)]}
              </ThemedText>
            </View>
            <ThemedText type="money" themeColor="money" style={styles.amount}>
              {formatMoney(spendOf(day.lodging))}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText type="detail" themeColor="muted" style={styles.note}>
        Tap a state to move it on: Estimate, then Booked, then Paid. Booked and Paid stops are locked, so the planner
        will not move them.
      </ThemedText>
    </>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <ThemedText type="label" themeColor="muted" style={styles.heading}>
      {children}
    </ThemedText>
  );
}

/** Paid is solid, Booked a step down, Estimate fainter still: certainty as weight, not as hue. */
const CERTAINTY: Record<Sureness, { backgroundColor: string }> = {
  paid: { backgroundColor: Colors.money },
  booked: { backgroundColor: `${Colors.money}9E` },
  estimate: { backgroundColor: `${Colors.money}40` },
};
const CHIP: Record<Sureness, { backgroundColor: string }> = {
  paid: { backgroundColor: Colors.foreground },
  booked: { backgroundColor: `${Colors.foreground}B8` },
  estimate: { backgroundColor: Colors.control },
};

const styles = StyleSheet.create({
  done: { minHeight: 44, justifyContent: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.compact,
    paddingBottom: Spacing.tight,
  },
  content: { paddingHorizontal: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.tight },
  switch: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: Radius.surface,
    backgroundColor: Colors.control,
    marginBottom: Spacing.tight,
  },
  half: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: Radius.read },
  halfOn: { backgroundColor: Colors.foreground },
  total: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.tight },
  over: { color: Colors.alert },
  // The figures' own face at the size of a total — the display serif's old-style numerals read
  // as decoration on a sum.
  figure: { fontSize: 30, lineHeight: 36 },
  band: {
    flexDirection: 'row',
    height: 12,
    borderRadius: Radius.tight,
    backgroundColor: Colors.moneySoft,
    overflow: 'hidden',
  },
  certainty: {
    flexDirection: 'row',
    height: 12,
    borderRadius: Radius.tight,
    backgroundColor: Colors.control,
    overflow: 'hidden',
  },
  span: { height: '100%' },
  // Inside the span's own width, so the separators cost the band nothing.
  spanRuled: { borderLeftWidth: 1, borderLeftColor: Colors.canvas },
  heading: { marginTop: Spacing.regular, marginBottom: Spacing.hair },
  group: {
    marginTop: Spacing.tight,
    backgroundColor: Colors.surfaceDeep,
    borderRadius: Radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    minHeight: 46,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
  },
  rowRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  pressed: { backgroundColor: Colors.pressed },
  grow: { flex: 1 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  // Fixed columns, so every row's chip and figure line up under the row above.
  percent: { minWidth: 40, textAlign: 'right' },
  amount: { minWidth: 56, textAlign: 'right' },
  chip: { width: 84, height: 28, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  chipOff: { opacity: 0.4 },
  dayName: { width: 118 },
  current: { fontWeight: '600' },
  dayTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.moneySoft, overflow: 'hidden' },
  dayFill: { height: '100%', backgroundColor: `${Colors.money}B8` },
  note: { marginTop: Spacing.tight },
});
