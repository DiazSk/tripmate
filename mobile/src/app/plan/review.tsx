import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { candidatePois } from '@/api/tripMateApi';
import type { CandidatePoi } from '@/api/types';
import { FieldTrough, PrimaryButton, Question, TagGrid, TextField } from '@/components/form';
import { Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { formatRange } from '@/lib/dayDisplay';
import { CROWDS, DISCOVERIES, ENERGY, PACES, labelOf, usePlanDraft } from '@/lib/planDraft';
import { accessibilityValue, dietaryValue } from '@/lib/profileRows';
import { closestTier, tierName, tripDays } from '@/lib/tiers';

export default function ReviewStep() {
  const router = useRouter();
  const { draft } = usePlanDraft();
  const days = tripDays(draft.startDate, draft.endDate);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Review' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="display" style={styles.headline}>
          Ready when you are.
        </ThemedText>

        <FieldTrough>
          <SummaryRow label="Where" value={draft.destination} onEdit={() => router.back()} />
          <SummaryRow
            label="When"
            value={`${formatRange(draft.startDate, draft.endDate)} · ${days} ${days === 1 ? 'day' : 'days'}`}
            onEdit={() => router.dismissTo('/plan/basics')}
          />
          <SummaryRow
            label="Budget"
            value={`$${Math.round(draft.budget).toLocaleString('en-US')} · ${tierName(closestTier(draft.budget, days))}`}
            onEdit={() => router.dismissTo('/plan/basics')}
          />
          <SummaryRow
            label="Who"
            value={describeParty(draft.party, draft.group, draft.groupOther)}
            onEdit={() => router.dismissTo('/plan/group')}
          />
          <SummaryRow
            label="Into"
            value={draft.interests.length ? draft.interests.join(', ') : 'No priorities'}
            onEdit={() => router.dismissTo('/plan/preferences')}
          />
          {/* Three answers on one row because they are one question about tempo, and because
              Edit can only land on the step that holds them all anyway. Discovery gets its own
              row rather than joining them: it is a taste, not a tempo, and the two sharing one
              line is the exact conflation this wizard just stopped making. */}
          <SummaryRow
            label="Pace"
            value={[
              labelOf(PACES, draft.pace),
              labelOf(ENERGY, draft.energy),
              labelOf(CROWDS, draft.crowds),
            ].join(' · ')}
            onEdit={() => router.dismissTo('/plan/preferences')}
          />
          <SummaryRow
            label="Seeing"
            value={labelOf(DISCOVERIES, draft.discovery)}
            onEdit={() => router.dismissTo('/plan/preferences')}
          />
          {/* The last two rows print even when nothing is set, unlike everything above them.
              These are the hard constraints — a stated step-free requirement outranks pace and
              interest — and this screen exists so somebody catches a misunderstanding before a
              minute of generation is spent on it. A row that vanishes when empty is a row
              nobody can notice is empty. */}
          <SummaryRow
            label="Diet"
            value={dietaryValue(draft)}
            onEdit={() => router.dismissTo('/plan/preferences')}
          />
          <SummaryRow
            label="Access"
            value={accessibilityValue(draft.accessibility)}
            onEdit={() => router.dismissTo('/plan/preferences')}
          />
        </FieldTrough>

        <PoiPicker />

        <View style={styles.action}>
          <PrimaryButton
            title="Generate the plan"
            onPress={() => router.replace('/plan/generating')}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <View style={styles.summaryRow}>
      <ThemedText type="label" themeColor="muted" style={styles.summaryLabel}>
        {label}
      </ThemedText>
      <ThemedText type="body" style={styles.summaryValue} numberOfLines={2}>
        {value}
      </ThemedText>
      <Pressable onPress={onEdit} accessibilityRole="button" hitSlop={8}>
        <ThemedText type="detail" themeColor="accent">
          Edit
        </ThemedText>
      </Pressable>
    </View>
  );
}

/**
 * Places to pin before the plan is written.
 *
 * Three states, not two. "Couldn't reach" is a fact about the source; "nothing here" is a fact
 * about the destination, and saying the second when the first is true is a small lie about the
 * place somebody is about to visit.
 */
function PoiPicker() {
  const { draft, patch } = usePlanDraft();
  const [state, setState] = useState<'loading' | 'unavailable' | 'ready'>('loading');
  const [pois, setPois] = useState<CandidatePoi[]>([]);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    let active = true;
    candidatePois(draft.destination, draft.startDate, draft.endDate).then((result) => {
      if (!active) return;
      setPois(result.pois);
      setState(result.available ? 'ready' : 'unavailable');
    });
    return () => {
      active = false;
    };
  }, [draft.destination, draft.startDate, draft.endDate]);

  const selectedNames = draft.selectedPois.map((p) => p.name);

  function addCustom() {
    const name = custom.trim();
    if (!name) return;
    patch({ customPois: [...draft.customPois, name] });
    setCustom('');
  }

  return (
    <Question title="Anywhere you already want to go" caption="Optional.">
      {state === 'loading' ? (
        <Loading />
      ) : state === 'unavailable' ? (
        <Notice>Couldn&rsquo;t load nearby places — you can still name your own below.</Notice>
      ) : pois.length === 0 ? (
        <ThemedText type="detail" themeColor="muted">
          Nothing came back for this destination. Name your own below.
        </ThemedText>
      ) : (
        <TagGrid
          tags={pois.map((p) => p.name)}
          selected={selectedNames}
          onToggle={(name) =>
            patch({
              selectedPois: selectedNames.includes(name)
                ? draft.selectedPois.filter((p) => p.name !== name)
                : [...draft.selectedPois, pois.find((p) => p.name === name)!],
            })
          }
        />
      )}

      {draft.customPois.length ? (
        <TagGrid
          tags={draft.customPois}
          selected={draft.customPois}
          onToggle={(name) => patch({ customPois: draft.customPois.filter((p) => p !== name) })}
        />
      ) : null}

      <FieldTrough>
        <TextField
          label="Add"
          value={custom}
          onChangeText={setCustom}
          onSubmitEditing={addCustom}
          onBlur={addCustom}
          placeholder="A place by name"
          returnKeyType="done"
        />
      </FieldTrough>
    </Question>
  );
}

function describeParty(
  party: { adults: number; children: number; infants: number },
  group: string,
  groupOther: string
): string {
  if (group === 'other' && groupOther.trim()) return groupOther.trim();
  const bits = [`${party.adults} ${party.adults === 1 ? 'adult' : 'adults'}`];
  if (party.children) bits.push(`${party.children} ${party.children === 1 ? 'child' : 'children'}`);
  if (party.infants) bits.push(`${party.infants} ${party.infants === 1 ? 'infant' : 'infants'}`);
  return bits.join(', ');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  content: { padding: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.regular },
  headline: { marginBottom: Spacing.tight },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.rows,
    minHeight: 52,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
  },
  // Natural width: a fixed 48 wrapped "BUDGET" mid-word at tracked caps.
  summaryLabel: { flexShrink: 0 },
  summaryValue: { flex: 1 },
  action: { marginTop: Spacing.tight },
});
