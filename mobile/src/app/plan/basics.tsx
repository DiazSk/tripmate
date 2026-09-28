import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { suggestDestinations, suggestionLabel, type GeoSuggestion } from '@shared/weather';

import { geocode, importPlaces, listSavedPlaces } from '@/api/tripMateApi';
import type { Anchor, ImportItem, SavedPlace } from '@/api/types';
import { usePlanDraft } from '@/lib/planDraft';
import { ChoiceRow, DateField, FieldTrough, PrimaryButton, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { anchorKey, mergeAnchors } from '@/lib/anchors';
import { cityMatches, groupByCity, shouldPreselect, toAnchor } from '@/lib/savedPlaces';
import { useFocusedFetch } from '@/lib/useFocusedFetch';
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

        <SavedPlacesSection
          destination={destination}
          anchors={draft.anchors}
          onAnchorsChange={(update) => patch((prev) => ({ anchors: update(prev.anchors) }))}
        />

        <ImportSection
          destination={destination}
          anchors={draft.anchors}
          onAnchorsChange={(update) => patch((prev) => ({ anchors: update(prev.anchors) }))}
          onDestinationGuess={(guess) =>
            patch((prev) => (prev.destination.trim() ? {} : { destination: guess }))
          }
        />

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

/**
 * Places the traveller shared into TripMate before planning (Task 5), grouped by the city they
 * were saved under. Loading the destination's own city pre-selects them into `draft.anchors`, the
 * same list the chips below toggle in and out of.
 */
function SavedPlacesSection({
  destination,
  anchors,
  onAnchorsChange,
}: {
  destination: string;
  anchors: Anchor[];
  onAnchorsChange: (update: (prev: Anchor[]) => Anchor[]) => void;
}) {
  const saved = useFocusedFetch(listSavedPlaces);
  const places = saved ?? [];
  /** The destination (by `anchorKey`) the pre-select below last ran for. `null` before the first
   *  run. Guards against `useFocusedFetch` delivering fresh data — on every refocus of this tab —
   *  re-merging a chip the traveller had just deselected, for the same destination they never
   *  changed. */
  const preselectedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!saved || !shouldPreselect(destination, preselectedFor.current)) return;
    preselectedFor.current = anchorKey(destination);
    const matches = places.filter((p) => p.source !== 'instagram' && cityMatches(p.city, destination));
    if (matches.length) onAnchorsChange((prev) => mergeAnchors(prev, matches.map(toAnchor)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per distinct destination, once the list has loaded
  }, [destination, saved]);
  if (places.length === 0) return null;
  const chosen = new Set(anchors.map((a) => anchorKey(a.name)));
  const reminders = places.filter((p) => p.source === 'instagram');

  /**
   * Here, then everywhere else — because the two answer different questions.
   *
   * This library is global and the trip is not. Amber Fort sitting unlabelled under a Kyoto
   * destination reads as a candidate for the Kyoto trip, and the reader has to work out that it
   * is not — on the one screen whose whole job is establishing where the trip goes. The
   * destination's own cities are already the ones pre-selected into `draft.anchors` above, so
   * this only makes that split visible rather than inventing one.
   *
   * The rest stay on screen. They are still reachable by hand for a trip that really does pass
   * through two cities, which is a thing the wizard permits and this section should not quietly
   * take away.
   */
  const groups = groupByCity(places);
  const here = groups.filter((g) => cityMatches(g.city, destination));
  const elsewhere = groups.filter((g) => !cityMatches(g.city, destination));

  const Group = ({ g }: { g: { city: string; places: SavedPlace[] } }) => (
    <View style={styles.savedGroup}>
      <ThemedText themeColor="muted">{g.city}</ThemedText>
      <View style={styles.chips}>
        {g.places.map((p) => {
          const on = chosen.has(anchorKey(p.name));
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${on ? 'Remove' : 'Add'} ${p.name}`}
              onPress={() =>
                onAnchorsChange((prev) =>
                  on ? prev.filter((a) => anchorKey(a.name) !== anchorKey(p.name)) : mergeAnchors(prev, [toAnchor(p)])
                )
              }
              style={[styles.chip, on && styles.chipOn]}>
              <ThemedText type="detail">{p.name}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.saved}>
      <ThemedText type="label">Your saved places ({places.length - reminders.length})</ThemedText>
      {here.map((g) => (
        <Group key={g.city} g={g} />
      ))}
      {elsewhere.length > 0 ? (
        <ThemedText type="label" themeColor="muted">
          Saved elsewhere
        </ThemedText>
      ) : null}
      {elsewhere.map((g) => (
        <Group key={g.city} g={g} />
      ))}
      {reminders.map((r) => (
        <Pressable key={r.id} accessibilityRole="link" onPress={() => r.url && Linking.openURL(r.url)}>
          <ThemedText type="detail" themeColor="muted">
            Instagram post: screenshot it to add places
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * "Chaos in, trip out" — paste what you already saved (screenshots, links, notes) and get the
 * places back as starrable chips. Mirrors the web's `ImportDropZone.tsx`.
 *
 * Holds its own pending text/images/busy/unread state — none of that belongs in the draft, which
 * only ever wants the finished `Anchor[]`. `onAnchorsChange` always goes through the draft's own
 * `patch`, functional-form, so a star tapped mid-import merges against the *latest* anchors rather
 * than whatever this component saw when the request started.
 */
function ImportSection({
  destination,
  anchors,
  onAnchorsChange,
  onDestinationGuess,
}: {
  destination: string;
  anchors: Anchor[];
  onAnchorsChange: (update: (prev: Anchor[]) => Anchor[]) => void;
  onDestinationGuess: (guess: string) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<
    { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [unread, setUnread] = useState<string[]>([]);

  async function pickScreenshots() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 20,
      quality: 0.5,
      base64: true,
    });
    if (result.canceled) return;
    const picked = result.assets
      .filter((asset) => asset.base64)
      .map((asset) => ({
        mediaType: mediaTypeOf(asset.mimeType),
        data: asset.base64!,
      }));
    setImages((prev) => [...prev, ...picked]);
  }

  async function findPlaces() {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const urls = lines.filter((l) => /^https?:\/\/\S+$/.test(l));
    const rest = lines.filter((l) => !urls.includes(l)).join('\n');
    const items: ImportItem[] = [
      ...images.map((img) => ({ kind: 'image' as const, mediaType: img.mediaType, data: img.data })),
      ...urls.map((url) => ({ kind: 'url' as const, url })),
      ...(rest ? [{ kind: 'text' as const, text: rest }] : []),
    ];
    if (items.length === 0) return;

    setBusy(true);
    setUnread([]);
    const result = await importPlaces(items, destination.trim() || undefined);
    setBusy(false);

    if (result === undefined) {
      setUnread(["Couldn't read these right now."]);
      return;
    }
    if (typeof result === 'string') {
      setUnread([result]);
      return;
    }
    onAnchorsChange((prev) => mergeAnchors(prev, result.places));
    if (result.destinationGuess) onDestinationGuess(result.destinationGuess);
    setUnread(result.unread.map((u) => u.reason));
    setText('');
    setImages([]);
  }

  const toggleMust = (name: string) =>
    onAnchorsChange((prev) =>
      prev.map((a) => (a.name === name ? { ...a, priority: a.priority === 'must' ? 'want' : 'must' } : a))
    );
  const remove = (name: string) => onAnchorsChange((prev) => prev.filter((a) => a.name !== name));
  const canFind = !busy && (text.trim().length > 0 || images.length > 0);

  return (
    <View style={styles.import}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Paste links or notes"
        placeholderTextColor={Colors.muted}
        selectionColor={Colors.accent}
        multiline
        maxFontSizeMultiplier={1.6}
        style={styles.importInput}
      />

      <View style={styles.importActions}>
        <Pressable
          onPress={() => void pickScreenshots()}
          accessibilityRole="button"
          style={styles.importButton}>
          <ThemedText type="label" themeColor="foreground">
            {images.length > 0 ? `Screenshots (${images.length})` : 'Add screenshots'}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => void findPlaces()}
          disabled={!canFind}
          accessibilityRole="button"
          style={[styles.importButton, styles.importButtonPrimary, !canFind && styles.importButtonInert]}>
          {busy ? (
            <ActivityIndicator color={Colors.accentForeground} />
          ) : (
            <ThemedText type="label" themeColor="accentForeground">
              Find the places
            </ThemedText>
          )}
        </Pressable>
      </View>

      {unread.length > 0 ? (
        <View accessibilityLiveRegion="polite" style={styles.importUnread}>
          {unread.map((reason, i) => (
            <ThemedText key={i} type="detail" themeColor="muted">
              {reason}
            </ThemedText>
          ))}
        </View>
      ) : null}

      {anchors.length > 0 ? (
        <View style={styles.chips}>
          {anchors.map((a) => (
            <View key={a.name} style={styles.chip}>
              <Pressable
                onPress={() => toggleMust(a.name)}
                accessibilityRole="button"
                accessibilityState={{ selected: a.priority === 'must' }}
                accessibilityLabel={`Must-see: ${a.name}`}
                hitSlop={8}>
                <ThemedText type="detail">{a.priority === 'must' ? '★' : '☆'}</ThemedText>
              </Pressable>
              <ThemedText type="detail" themeColor="muted" style={styles.chipName} numberOfLines={1}>
                {a.name}
                {a.lat === null ? ' · couldn’t place it' : ''}
              </ThemedText>
              <Pressable
                onPress={() => remove(a.name)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${a.name}`}
                hitSlop={8}>
                <ThemedText type="detail" themeColor="muted">
                  ×
                </ThemedText>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function mediaTypeOf(mimeType: string | undefined | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (mimeType === 'image/png') return 'image/png';
  if (mimeType === 'image/webp') return 'image/webp';
  return 'image/jpeg';
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
  saved: { gap: Spacing.tight },
  savedGroup: { gap: Spacing.hair },
  chipOn: { backgroundColor: Colors.accent },
  import: { gap: Spacing.tight },
  importInput: {
    minHeight: 72,
    color: Colors.foreground,
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: Colors.panel,
    borderColor: Colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.surface,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
    textAlignVertical: 'top',
  },
  importActions: { flexDirection: 'row', gap: Spacing.tight },
  importButton: {
    minHeight: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
    paddingHorizontal: Spacing.rows,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importButtonPrimary: { backgroundColor: Colors.accent },
  importButtonInert: { opacity: 0.4 },
  importUnread: { gap: Spacing.hair },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.tight },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.hair,
    maxWidth: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.tight,
  },
  chipName: { flexShrink: 1 },
  suggestionPressed: { backgroundColor: Colors.pressed },
  note: { marginTop: -Spacing.tight },
  readout: { marginTop: -Spacing.tight },
  action: { marginTop: Spacing.tight, gap: Spacing.rows },
  skip: { alignItems: 'center', paddingVertical: Spacing.tight },
  skipInert: { opacity: 0.4 },
});
