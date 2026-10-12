import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { healthSummary, isBlocking, type Guardrail, type HealthDimension, type HealthKey, type PlanHealth as PlanHealthReport } from '@/lib/health';

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
  // At 7 of 7 the number needs no denominator; below that it does, or a flat penalty averaged
  // over the dimensions that ran looks identical to the same penalty over all of them.
  const partial = ran < health.dimensions.length;
  const severe = health.dimensions.some((d) => isSevere(d.key) && d.findings.length > 0);
  const { verdict, coverage } = healthSummary(all.length, blockers, ran, health.dimensions.length);
  const scoreLine = `Scores ${health.score} ${partial ? 'across the checked dimensions' : 'out of 100'}`;

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setOpen((was) => !was)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          blockers > 0
            ? `${verdict}. ${coverage}. ${scoreLine}`
            : `Plan health ${health.score} out of 100, ${verdict} · ${coverage}`
        }
        style={[styles.head, blockers > 0 && styles.headStacked]}>
        {/* **A blocker outranks the score, and the type has to say so.** The figure was the most
            immediate conclusion on a screen whose whole purpose is diagnostic: a reader could
            glance at 84, decide "good enough", and never read the two findings that make the plan
            impossible. Severity leads when there is any; otherwise the figure does, because then
            nothing outranks it. Colour is untouched — the summary already went coral when severe.

            **Stepping the figure down a type size was not enough, and the review said so.** It
            still sat in its own right-hand column on the diagnosis's own baseline, so the head
            read as two answers at once — the coral one and the clean numeral. Demoting the size
            while leaving the position is the half-fix. With blockers the head becomes a single
            column and the score follows the coverage line as prose, where it cannot be read
            before the thing it is subordinate to. With none it keeps the two-column row, because
            then it *is* the answer. */}
        {/* **`grow` only in the row.** `flex: 1` is `flexBasis: 0%` on the *main* axis, so the
            same style that makes this column take the row's leftover width collapses it to zero
            height once the head becomes a column — an empty slate card that typechecks, lints
            and passes every test. Stacked, `alignItems: 'stretch'` already gives it the width. */}
        <View style={blockers > 0 ? undefined : styles.grow}>
          <ThemedText type="label" themeColor="muted">
            Plan health
          </ThemedText>
          {blockers > 0 ? (
            <>
              <ThemedText type="title" themeColor="alert" style={styles.summary}>
                {verdict}
              </ThemedText>
              <ThemedText type="detail" themeColor="muted">
                These stop the plan working as written. Change each one before you go.
              </ThemedText>
              <ThemedText type="detail" themeColor="muted">
                {coverage}
              </ThemedText>
              <ThemedText type="detail" themeColor="muted">
                {scoreLine}
              </ThemedText>
            </>
          ) : (
            <ThemedText
              type="detail"
              themeColor={severe ? 'alert' : 'muted'}
              style={styles.summary}>
              {`${verdict} · ${coverage}`}
            </ThemedText>
          )}
        </View>
        {/* **The figure says what it is a figure of.** A flat penalty averaged over the
            dimensions that could be measured is the right arithmetic and the wrong thing to
            print alone: 84 out of seven checks and 84 out of four are not the same claim, and
            the larger type makes the second one look like the first. The qualifier appears only
            when coverage is partial — at 7 of 7 the number needs no denominator. */}
        {blockers > 0 ? null : (
          <View style={styles.figure}>
            <ThemedText type="title">{health.score}</ThemedText>
            {partial ? (
              <ThemedText type="caption" themeColor="muted">
                across checked
              </ThemedText>
            ) : null}
          </View>
        )}
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
          <ThemedText type="caption" themeColor="muted">
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
          <ThemedText type="caption" themeColor={isBlocking(finding) ? 'alert' : 'muted'}>
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
 * One word above a finding, so the list stops reading as eight equal sentences.
 *
 * The rule is the classification — it is the field the check already set, and naming it is
 * cheaper than any taxonomy laid over the top. Only the split that already governs coral gets a
 * word of its own: the three blocking rules all say MUST FIX (it was BLOCKER, a word only developers read), because "travel" and "overlap" are
 * how the checker spells it and "this cannot happen" is what the reader needs.
 */
const classify = (finding: Guardrail) =>
  isBlocking(finding) ? 'MUST FIX' : finding.rule.toUpperCase();

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
  // One column when a blocker leads, so the score cannot sit on the diagnosis's baseline.
  headStacked: { flexDirection: 'column', alignItems: 'stretch' },
  summary: { marginTop: 2 },
  grow: { flex: 1 },
  figure: { alignItems: 'flex-end' },
  list: { marginTop: Spacing.tight, gap: Spacing.tight },
  dimension: { gap: Spacing.hair },
  dimensionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.cardBorder },
  finding: { paddingLeft: Spacing.rows, gap: Spacing.hair },
});
