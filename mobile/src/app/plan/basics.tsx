import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { geocode } from '@/api/tripMateApi';
import { usePlanDraft } from '@/lib/planDraft';
import { DateField, FieldTrough, PrimaryButton, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { closestTier, isEndBeforeStart, isTripTooLong, tierName, tripDays } from '@/lib/tiers';

export default function Basics() {
  const router = useRouter();
  const { draft, patch } = usePlanDraft();
  const { destination, startDate, endDate, budget } = draft;
  /** Held as a string, not a number: a numeric binding renders "$ 01800" while you type. */
  const [budgetText, setBudgetText] = useState(budget ? String(budget) : '');

  // Real defaults rather than empty. A native date picker always draws *some* date, so an
  // "unset" field is indistinguishable from one showing today — it reads as answered when it
  // isn't. A month out, a week long, is a trip somebody might actually take.
  useEffect(() => {
    if (!startDate || !endDate) {
      patch({ startDate: isoDaysFromNow(30), endDate: isoDaysFromNow(36) });
    }
    // Once, on first mount: re-running would fight the traveller's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDestination = (value: string) => patch({ destination: value });
  const setStartDate = (value: string) => patch({ startDate: value });
  const setEndDate = (value: string) => patch({ endDate: value });
  const setBudget = (text: string) => {
    setBudgetText(text);
    patch({ budget: Number(text.replace(/[^0-9.]/g, '')) || 0 });
  };
  const missed = draft.destinationMissed;
  const problem = crossFieldProblem(startDate, endDate);
  const complete =
    destination.trim().length > 0 && !!startDate && !!endDate && budget > 0 && !problem;

  const days = startDate && endDate && !problem ? tripDays(startDate, endDate) : 0;
  const readout =
    days > 0 && budget > 0
      ? `${days} ${days === 1 ? 'day' : 'days'} · ${tierName(closestTier(budget, days))}`
      : undefined;

  /**
   * Geocode on blur rather than per keystroke — a debounced lookup walks every prefix of what is
   * being typed and reports a miss on half of them. **Nothing here blocks:** a miss is worth
   * mentioning, an outage is not, and neither stops a plan being written.
   */
  async function checkDestination() {
    const name = destination.trim();
    if (!name) {
      patch({ destinationMissed: false });
      return;
    }
    const result = await geocode(name);
    patch({ destinationMissed: result !== undefined && 'missed' in result });
  }



  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Where and when', headerBackButtonDisplayMode: 'minimal' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="display" style={styles.headline}>
          Where are you going?
        </ThemedText>

        <FieldTrough>
          <TextField
            label="Where"
            value={destination}
            onChangeText={setDestination}
            onBlur={checkDestination}
            placeholder="Kyoto, Japan"
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="next"
          />
          <DateField label="Arrive" value={startDate} onChange={setStartDate} />
          <DateField
            label="Leave"
            value={endDate}
            minimumDate={startDate || undefined}
            onChange={setEndDate}
          />
          <TextField
            label="Budget"
            value={budgetText}
            onChangeText={setBudget}
            placeholder="2,600"
            keyboardType="number-pad"
            prefix="$"
          />
        </FieldTrough>

        {/* A miss is a fact about the geocoder's index, not a verdict on the trip — so it is said
            plainly and the button stays enabled. A failed lookup says nothing at all. */}
        {missed ? (
          <ThemedText type="detail" themeColor="muted" style={styles.note}>
            We couldn&rsquo;t find that place, but the plan will still work.
          </ThemedText>
        ) : null}

        {problem ? (
          <ThemedText type="detail" themeColor="alert" style={styles.note}>
            {problem}
          </ThemedText>
        ) : null}

        {/* There is no spending-style picker anywhere in this product: the style is derived from
            the budget, so a stored one could only ever contradict the number just typed. */}
        {readout ? (
          <ThemedText type="label" themeColor="muted" style={styles.readout}>
            {readout}
          </ThemedText>
        ) : null}

        {/* Two ways on. The optional steps sharpen the plan; they never gate it, so the fast
            path stays one tap from here. */}
        <View style={styles.action}>
          <PrimaryButton
            title="Next"
            onPress={() => router.push('/plan/group')}
            disabled={!complete}
          />
          <Pressable
            onPress={() => router.replace('/plan/generating')}
            disabled={!complete}
            style={[styles.skip, !complete && styles.skipInert]}>
            <ThemedText type="detail" themeColor="muted">
              Skip the questions and generate
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** `YYYY-MM-DD`, n days from today, read with local accessors to match the date picker. */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Copy taken from the Swift wizard, which had already settled the wording. */
function crossFieldProblem(startDate: string, endDate: string): string | undefined {
  if (!startDate || !endDate) return undefined;
  if (isEndBeforeStart(startDate, endDate)) return 'End date must be on or after the start date.';
  if (isTripTooLong(startDate, endDate)) {
    return "Trips over 30 days aren't supported — please choose a shorter date range.";
  }
  return undefined;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  content: { padding: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.read },
  headline: { marginBottom: Spacing.tight },
  note: { marginTop: -Spacing.tight },
  readout: { marginTop: -Spacing.tight },
  action: { marginTop: Spacing.tight, gap: Spacing.rows },
  skip: { alignItems: 'center', paddingVertical: Spacing.tight },
  skipInert: { opacity: 0.4 },
});
