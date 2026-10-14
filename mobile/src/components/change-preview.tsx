import { formatClockLabel } from '@shared/format';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { ItineraryDiff, StopChange } from '@/lib/itineraryDiff';
import { formatMoney } from '@/lib/spend';

/**
 * What an edit would do, before it does it.
 *
 * **The plan used to change and then be described.** `/api/trip-edit` returned a new itinerary and
 * the screen swapped it in unconditionally; the only account of what had happened was the model's
 * own prose, written about its own work, and there was no way back — `updateTripItinerary`
 * overwrites and this database keeps no earlier version. Approving a computed diff first is the
 * cheap half of fixing that; Undo is the other half.
 *
 * **Every figure here is derived from the two plans, not read from the reply.** The model's
 * `warnings` and `rejected` still print on the turn above, because those say things a diff cannot
 * — why it did something, what it refused. They are its claims; this is what will happen.
 *
 * The booked line prints even when nothing is booked. The promise that marking something booked
 * keeps it still is worth restating at the one moment somebody is being asked to approve a change,
 * and a line that appears only when the promise has been broken is a line nobody learns to trust.
 */
export function ChangePreview({
  diff,
  onApply,
  onDiscard,
  busy,
}: {
  diff: ItineraryDiff;
  onApply: () => void;
  onDiscard: () => void;
  /** Applying writes the whole itinerary, which is a round trip. */
  busy?: boolean;
}) {
  const spendMoved = diff.spendBefore !== diff.spendAfter;

  return (
    <View style={styles.card}>
      <ThemedText type="label" themeColor="muted">
        What would change
      </ThemedText>

      {diff.stops.length === 0 ? (
        <ThemedText type="detail" themeColor="muted" style={styles.none}>
          Nothing moves, only what things cost.
        </ThemedText>
      ) : (
        <View style={styles.rows}>
          {diff.stops.map((change, i) => (
            <Row key={`${change.kind}-${change.name}-${i}`} change={change} />
          ))}
        </View>
      )}

      <View style={styles.totals}>
        <Total label="Spend">
          {spendMoved ? (
            <>
              <ThemedText type="money" themeColor="muted">
                {formatMoney(diff.spendBefore)}
                {' → '}
              </ThemedText>
              <ThemedText type="money" themeColor="money">
                {formatMoney(diff.spendAfter)}
              </ThemedText>
            </>
          ) : (
            <ThemedText type="money" themeColor="muted">
              Unchanged
            </ThemedText>
          )}
        </Total>
        <Total label="Booked">
          {/* Coral, because a booked stop being moved is a promise broken rather than a fact
              worth noting — the one thing on this card that would be a real consequence. */}
          <ThemedText type="detail" themeColor={diff.lockedTouched.length ? 'alert' : 'muted'}>
            {diff.lockedTouched.length
              ? `${diff.lockedTouched.join(', ')} would move`
              : 'Nothing moves'}
          </ThemedText>
        </Total>
      </View>

      <View style={styles.actions}>
        <Action label="Keep current plan" onPress={onDiscard} disabled={busy} />
        <Action label={busy ? 'Applying…' : 'Apply changes'} onPress={onApply} disabled={busy} primary />
      </View>
    </View>
  );
}

function Row({ change }: { change: StopChange }) {
  return (
    <View style={styles.row}>
      <ThemedText type="detail" style={styles.grow}>
        {describe(change)}
      </ThemedText>
      <ThemedText type="money" themeColor="muted">
        {clock(change)}
      </ThemedText>
    </View>
  );
}

/** Day numbers are 1-based here: they are being read, not indexed. */
const describe = (c: StopChange): string => {
  switch (c.kind) {
    case 'added':
      return `Added · Day ${c.dayIndex + 1} · ${c.name}`;
    case 'removed':
      return `Dropped · Day ${c.dayIndex + 1} · ${c.name}`;
    case 'moved':
      return `Day ${c.dayIndex + 1} → Day ${c.toDayIndex + 1} · ${c.name}`;
    case 'retimed':
      return `Day ${c.dayIndex + 1} · ${c.name}`;
  }
};

const clock = (c: StopChange): string => {
  const at = formatClockLabel(c.time);
  if (c.kind === 'added' || c.kind === 'removed') return at;
  const to = formatClockLabel(c.toTime);
  // A stop can move day without moving clock, and repeating the same time either side of an
  // arrow reads as a change that did not happen.
  return at === to ? at : `${at} → ${to}`;
};

function Total({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <ThemedText type="label" themeColor="muted" style={styles.grow}>
        {label}
      </ThemedText>
      <View style={styles.figures}>{children}</View>
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.action,
        primary ? styles.actionPrimary : styles.actionQuiet,
        disabled && styles.actionInert,
        pressed && !disabled && styles.actionPressed,
      ]}>
      <ThemedText type="label" themeColor={primary ? 'accentForeground' : 'foreground'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceDeep,
    borderRadius: Radius.read,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    padding: Spacing.rows,
    gap: Spacing.tight,
  },
  none: { marginTop: 2 },
  rows: { gap: Spacing.hair },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.tight },
  grow: { flex: 1 },
  figures: { flexDirection: 'row', alignItems: 'baseline' },
  totals: {
    gap: Spacing.hair,
    paddingTop: Spacing.tight,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.cardBorder,
  },
  actions: { flexDirection: 'row', gap: Spacing.tight, marginTop: Spacing.hair },
  action: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.tight,
  },
  // `Colors.control` is the same slate at 55% as the card it stands on, so composited it is the
  // same colour and the shape was invisible — the radius and the target were there all along.
  // The hairline is what makes it a control you can see, the same fix `styles.pill` took.
  actionQuiet: {
    backgroundColor: Colors.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  actionPrimary: { backgroundColor: Colors.accent },
  actionInert: { opacity: 0.4 },
  actionPressed: { opacity: 0.85 },
});
