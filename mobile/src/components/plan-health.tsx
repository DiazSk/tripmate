import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { isBlocking, type Guardrail, type HealthDimension, type HealthKey, type PlanHealth as PlanHealthReport } from '@/lib/health';

/**
 * Whether this plan holds together, and where it doesn't.
 *
 * **It is a diagnostic, not a grade.** Every point withheld is a finding printed two lines below
 * the figure that withheld it, which is the only reason a number like this is worth showing at
 * all — a single opaque score is something a traveler argues with, and a decomposed one is
 * something they act on. There is deliberately no streak, no badge and no congratulation at 100.
 *
 * **The figure is paper, and that is the One Meaning Rule rather than timidity.** Jade acts and
 * only acts, so a jade score would make a colour that means "press this" into a label; gold counts
 * money and only money, so a gold score would put a health figure and a price in the same
 * register. Coral is spent only where a finding is a real consequence — a day that cannot happen,
 * a reservation about to be missed, a budget already broken. A day that merely backtracks, or an
 * outdoor stop under a wet forecast, is worth reading and is not worth alarming anyone about.
 */
export function PlanHealth({ health }: { health: PlanHealthReport }) {
  const [open, setOpen] = useState(false);

  // Nothing in this plan could be checked at all — an empty plan, or one whose stops carry no
  // times. A panel reading "Not checked" seven times tells nobody anything.
  if (health.score === null) return null;

  const all = health.dimensions.flatMap((d) => d.findings);
  const blockers = all.filter(isBlocking).length;
  const ran = health.dimensions.filter((d) => d.score !== null).length;
  const severe = health.dimensions.some((d) => isSevere(d.key) && d.findings.length > 0);
  const line = summary(all.length, blockers, ran, health.dimensions.length);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setOpen((was) => !was)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Plan health ${health.score} out of 100, ${line}`}
        style={styles.head}>
        <View style={styles.grow}>
          <ThemedText type="label" themeColor="muted">
            Plan health
          </ThemedText>
          <ThemedText type="detail" themeColor={severe ? 'alert' : 'muted'} style={styles.summary}>
            {line}
          </ThemedText>
        </View>
        <ThemedText type="title">{health.score}</ThemedText>
      </Pressable>

      {open ? (
        <View style={styles.list}>
          {health.dimensions.map((dimension) => (
            <Dimension key={dimension.key} dimension={dimension} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Dimension({ dimension }: { dimension: HealthDimension }) {
  const { label, score, findings } = dimension;
  return (
    <View style={styles.dimension}>
      <View style={styles.dimensionHead}>
        <ThemedText type="detail" themeColor={score === null ? 'muted' : 'foreground'}>
          {label}
        </ThemedText>
        <View style={styles.rule} />
        {/* A dimension nothing could check says so in words. Printing 100 there would be the one
            thing a diagnostic must never do: claim a check passed that nobody ran. */}
        {score === null ? (
          <ThemedText type="micro" themeColor="muted">
            Not checked
          </ThemedText>
        ) : (
          <ThemedText
            type="money"
            themeColor={findings.length > 0 && isSevere(dimension.key) ? 'alert' : 'muted'}>
            {score}
          </ThemedText>
        )}
      </View>
      {findings.map((finding, i) => (
        // Keyed by message: findings carry no id, and two on one day are two different sentences.
        <View key={`${finding.message}-${i}`} style={styles.finding}>
          <ThemedText type="micro" themeColor={isBlocking(finding) ? 'alert' : 'muted'}>
            {classify(finding)}
          </ThemedText>
          <ThemedText type="detail" themeColor="muted">
            {finding.dayIndex === null ? '' : `Day ${finding.dayIndex + 1} — `}
            {finding.message}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/** The three whose findings are consequences rather than observations — see the coral note above. */
const SEVERE: HealthKey[] = ['schedule', 'reservations', 'budget'];
const isSevere = (key: HealthKey) => SEVERE.includes(key);

/**
 * What the figure beside it does not say: how bad, and over how much.
 *
 * **The arithmetic is untouched — this is the interpretation.** A flat penalty per finding is the
 * right way to compute the number and the wrong way to read it: a duplicate museum and a train
 * that cannot be caught both cost eight points, and three dimensions nobody could measure are
 * simply absent from the average rather than counted against it. So 84 out of 100 can mean "two
 * connections are impossible and we only checked four things" — a sentence the score alone is
 * incapable of forming.
 *
 * Coverage prints even at full marks. "7 of 7 checks run" is a fact worth stating, and a line
 * that appears only on bad news teaches a reader to skip it on good news.
 */
const summary = (findings: number, blockers: number, ran: number, of: number) => {
  const coverage = `${ran} of ${of} checks run`;
  if (blockers > 0) return `${blockers} blocker${blockers === 1 ? '' : 's'} · ${coverage}`;
  if (findings > 0) return `${findings} thing${findings === 1 ? '' : 's'} to look at · ${coverage}`;
  return `Nothing to flag · ${coverage}`;
};

/**
 * One word above a finding, so the list stops reading as eight equal sentences.
 *
 * The rule is the classification — it is the field the check already set, and naming it is
 * cheaper than any taxonomy laid over the top. Only the split that already governs coral gets a
 * word of its own: the three blocking rules all say BLOCKER, because "travel" and "overlap" are
 * how the checker spells it and "this cannot happen" is what the reader needs.
 */
const classify = (finding: Guardrail) =>
  isBlocking(finding) ? 'BLOCKER' : finding.rule.toUpperCase();

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
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.rows },
  summary: { marginTop: 2 },
  grow: { flex: 1 },
  list: { marginTop: Spacing.tight, gap: Spacing.tight },
  dimension: { gap: Spacing.hair },
  dimensionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.cardBorder },
  finding: { paddingLeft: Spacing.rows, gap: Spacing.hair },
});
