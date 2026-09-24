import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { suggestDestinations, suggestionLabel, type GeoSuggestion } from '@shared/weather';

import { geocode } from '@/api/tripMateApi';
import { usePlanDraft } from '@/lib/planDraft';
import { ChoiceRow, DateField, FieldTrough, PrimaryButton, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { closestTier, isEndBeforeStart, isTripTooLong, tierName, tripDays } from '@/lib/tiers';

export default function Basics() {
  const router = useRouter();
  const { draft, patch } = usePlanDraft();
  const { destination, startDate, endDate, budget } = draft;
  const budgetBasis = draft.budgetBasis ?? 'whole_party';
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

  /**
   * Type-ahead for Where, from the same free Open-Meteo geocoder `/api/geocode` wraps — reached
   * through `@shared/*` rather than a route, exactly as `DestinationSearch.tsx` reaches it on the
   * web. The Swift app uses `MKLocalSearchCompleter` instead, which answers better but is an
   * Apple framework with no reach from Expo Go.
   *
   * Picking only fills the text. `checkDestination` still runs on blur, because the "couldn't
   * find that place" notice reads the geocode and two sources answering one question would be two
   * ideas of where the trip is.
   */
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  /** Bumped per keystroke so a slow lookup cannot overwrite the answer to a newer one. */
  const lookup = useRef(0);
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setDestination = (value: string) => {
    patch({ destination: value });
    if (typing.current) clearTimeout(typing.current);
    const query = value.trim();
    // Two characters, or the list is most of the planet. Debounced rather than per keystroke for
    // the same reason `checkDestination` waits for blur: every prefix of a word is also a query.
    if (query.length < 2) {
      lookup.current++;
      setSuggestions([]);
      return;
    }
    const id = ++lookup.current;
    typing.current = setTimeout(async () => {
      const found = await suggestDestinations(query);
      if (id === lookup.current) setSuggestions(found.slice(0, 5));
    }, 300);
  };

  /** Fills the field and closes the list — deliberately not through `setDestination`, which would
   *  queue a lookup for the text it just accepted and reopen the list under the answer. */
  const pickDestination = (suggestion: GeoSuggestion) => {
    closeSuggestions();
    // The coordinates ride along, which is the whole reason a picked suggestion beats a typed
    // name: the next step's arrival points need a point, and this saves it a geocode.
    patch({
      destination: suggestionLabel(suggestion),
      destinationMissed: false,
      destinationLat: suggestion.lat,
      destinationLng: suggestion.lon,
    });
  };

  /**
   * Answering anything else puts the list away.
   *
   * **Not `onBlur`, deliberately.** Blur fires before the press it was caused by lands, so
   * clearing there unmounts the row under the finger that was choosing it — the tap is delivered
   * (`keyboardShouldPersistTaps="handled"`) but there is nothing left to deliver it to. Keying off
   * the *next* field instead has no timing in it at all: by the time one of these runs, the
   * traveller has demonstrably moved on.
   */
  const closeSuggestions = () => {
    if (typing.current) clearTimeout(typing.current);
    lookup.current++;
    setSuggestions([]);
  };

  const setStartDate = (value: string) => {
    closeSuggestions();
    patch({ startDate: value });
  };
  const setEndDate = (value: string) => {
    closeSuggestions();
    patch({ endDate: value });
  };
  const setBudget = (text: string) => {
    closeSuggestions();
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
    // The same coordinates a picked suggestion carries, for a name that was typed straight in.
    if (result && 'place' in result) {
      patch({ destinationLat: result.place.lat, destinationLng: result.place.lng });
    }
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
          {/* Inside the trough and above the next hairline, so the list reads as belonging to the
              field rather than floating over the form — the same call the Swift wizard makes. An
              overlay here would cover Arrive, and a suggestion that hides the next question is how
              you fill one field and lose another. */}
          {suggestions.length > 0 ? (
            <View>
              {suggestions.map((suggestion) => (
                <Pressable
                  key={`${suggestion.lat},${suggestion.lon}`}
                  onPress={() => pickDestination(suggestion)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}>
                  <ThemedText type="detail" themeColor="muted" numberOfLines={1}>
                    {suggestionLabel(suggestion)}
                    {suggestion.admin1 && suggestion.admin1 !== suggestion.name
                      ? ` · ${suggestion.admin1}`
                      : ''}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          ) : null}
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
          {/* The number above means nothing without this. "$2,600" for a family of four is either
              comfortable or tight, and everything downstream reads a party total — the server's
              `partyBudget()` converts a per-person figure once, so nothing here multiplies. */}
          <ChoiceRow
            options={[
              { value: 'whole_party', label: 'Total' },
              { value: 'per_person', label: 'Per person' },
            ]}
            value={budgetBasis}
            onChange={(next) => patch({ budgetBasis: next })}
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
  // 44 is the tap-target floor, and the row is the target rather than the words in it.
  suggestion: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.read },
  suggestionPressed: { backgroundColor: Colors.pressed },
  note: { marginTop: -Spacing.tight },
  readout: { marginTop: -Spacing.tight },
  action: { marginTop: Spacing.tight, gap: Spacing.rows },
  skip: { alignItems: 'center', paddingVertical: Spacing.tight },
  skipInert: { opacity: 0.4 },
});
