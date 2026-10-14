import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';

import { suggestDestinations, suggestionLabel, type GeoSuggestion } from '@shared/weather';

import { geocode, importPlaces, listSavedPlaces } from '@/api/tripMateApi';
import type { Anchor, ImportItem, SavedPlace } from '@/api/types';
import { usePlanDraft } from '@/lib/planDraft';
import { ChoiceRow, DateField, FieldTrough, PillButton, PrimaryButton, Question, TextField } from '@/components/form';
import { ImportComposer } from '@/components/import-composer';
import { ThemedText } from '@/components/themed-text';
import { Colors, Curve, Motion, Radius, Spacing } from '@/constants/theme';
import { anchorKey, mergeAnchors } from '@/lib/anchors';
import { looksLikeDayPlan } from '@/lib/importItems';
import { cityMatches, groupByCity, shouldPreselect, toAnchor } from '@/lib/savedPlaces';
import { useFocusedFetch } from '@/lib/useFocusedFetch';
import { crossFieldProblem, gapSentence, planGap } from '@/lib/formGap';
import { closestTier, perPersonBudget, tierName, tripDays } from '@/lib/tiers';

export default function Basics() {
  const router = useRouter();
  const { draft, patch } = usePlanDraft();
  const { destination, startDate, endDate, budget } = draft;
  const budgetBasis = draft.budgetBasis ?? 'whole_party';
  /** Held as a string, not a number: a numeric binding renders "$ 01800" while you type. */
  const [budgetText, setBudgetText] = useState(budget ? String(budget) : '');
  /**
   * The text follows the draft when the draft changes from outside the field. A deep link's prefill
   * lands a render after this screen mounts (see `PlanDraftProvider`), so the seed above read 0 and
   * the field showed its placeholder over a budget the plan was already using. Typing never trips
   * this: what the field writes parses back to the figure it already holds.
   */
  const [budgetSeen, setBudgetSeen] = useState(budget);
  if (budget !== budgetSeen) {
    setBudgetSeen(budget);
    if (budget !== (Number(budgetText.replace(/[^0-9.]/g, '')) || 0)) setBudgetText(budget ? String(budget) : '');
  }

  /**
   * Total / Per person is Budget's second half, so it keeps Budget's company.
   *
   * It used to stand open permanently, under a field that is empty on arrival — a choice about a
   * number nobody had typed yet, and the loudest thing on the screen while it was meaningless
   * (two full-width rows, one of them washed jade). So it is shown while the field is **focused
   * or answered**: tapping Budget slides it out from under the row, so the choice is in view
   * while you type rather than arriving under your thumb afterwards, and it stays as long as
   * there is a figure for it to qualify. Clearing the amount puts it away again, because the
   * basis matters exactly as long as the number does.
   *
   * `budgetBasis` still defaults to `whole_party`, so somebody who never opens this gets Total —
   * the same answer the permanently-open version gave them by default.
   */
  const [budgetFocused, setBudgetFocused] = useState(false);
  const showBasis = budgetFocused || budgetText.trim().length > 0;

  /**
   * The slide, on a **measured** height rather than a constant.
   *
   * Two 52pt rows is 104 at scale 1 and well over 200 once `FieldRow` starts stacking its label
   * above its value, so a hardcoded height would clip the second option for exactly the readers
   * who need it most. The child reports its natural height through `onLayout` — it lays out
   * normally inside the clipped box, which is what makes this the ordinary accordion — and the
   * wrapper animates between that and nothing. Same shape as `scene-band.tsx`'s band height and
   * `map-controls.tsx`'s lift, on the same curve and duration.
   *
   * Animating the wrapper's height is also what moves everything below it: the trough grows and
   * the sections after it are pushed down by the same tween, rather than snapping into a new
   * position while the block fades in over the gap.
   */
  const reduceMotion = useReducedMotion();
  const [basisHeight, setBasisHeight] = useState(0);
  const measureBasis = (event: LayoutChangeEvent) => {
    const height = Math.round(event.nativeEvent.layout.height);
    if (height > 0 && height !== basisHeight) setBasisHeight(height);
  };
  const basisStyle = useAnimatedStyle(() => {
    // **No height at all until one has been measured**, which is the whole reason for the
    // out-of-flow first pass below: a box already clipped to nothing cannot report what its
    // contents are worth, so applying `height: 0` from the first frame measures 0 for ever and
    // the block never opens. Verified on device before it was written this way.
    if (basisHeight === 0) return {};
    return {
      height: withTiming(showBasis ? basisHeight : 0, {
        // Zero, not slower: the setting asks for no travel, and the rows still arrive.
        duration: reduceMotion ? 0 : Motion.settle,
        easing: Easing.bezier(...Curve),
      }),
    };
  }, [showBasis, basisHeight, reduceMotion]);

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

  /**
   * **Nothing here is disabled for being unfinished.** DESIGN.md: *"Disabled: avoid … The empty
   * case is handled at submit, where focus moves to the field."* The wizard used to grey `Next`
   * out until every field was in, which on an untouched draft left a screen of six controls with
   * no jade on any of them — the product's one action colour spent on nothing.
   *
   * So the gap is derived every render rather than stored, which is what makes the sentence
   * clear itself: fill the field and `gap` is `null` and the sentence goes, with no reset to
   * forget. `asked` records only whether a blocked press has happened, so the screen stays quiet
   * until the reader has actually asked for something.
   */
  const gap = planGap({ destination, startDate, endDate, budget });
  const [asked, setAsked] = useState(false);
  const destinationField = useRef<TextInput>(null);
  const budgetField = useRef<TextInput>(null);

  /**
   * One way on, whichever button was pressed. The guard lives here rather than in a `disabled`
   * prop, so the thing to be careful about is the early return: without it a second press would
   * navigate on an incomplete form.
   */
  function goOn(proceed: () => void) {
    if (gap) {
      setAsked(true);
      if (gap.field === 'destination') destinationField.current?.focus();
      // `dates` is a native picker with nothing to focus, so that gap says its piece and stops.
      if (gap.field === 'budget') budgetField.current?.focus();
      return;
    }
    proceed();
  }

  const days = startDate && endDate && !problem ? tripDays(startDate, endDate) : 0;
  const readout =
    days > 0 && budget > 0
      ? `${days} ${days === 1 ? 'day' : 'days'} · ${tierName(closestTier(perPersonBudget(budget, budgetBasis, draft.party), days))}`
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
            ref={destinationField}
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
          {/* Budget and its basis are **one** trough child, not two.
              `FieldTrough` rules every child after the first, and that rule is drawn on the
              wrapper it supplies — which still paints a hairline when the child inside it is
              collapsed to nothing. Kept together, the trough's own line lands above Budget where
              it always did, and the line between Budget and the options is the one `bare` mode
              draws, inside the box that gets clipped. */}
          <View>
            <TextField
              ref={budgetField}
              label="Budget"
              value={budgetText}
              onChangeText={setBudget}
              onFocus={() => {
                closeSuggestions();
                setBudgetFocused(true);
              }}
              onBlur={() => setBudgetFocused(false)}
              placeholder="2,600"
              keyboardType="number-pad"
              prefix="$"
            />
            {/* The number above means nothing without this. "$2,600" for a family of four is
                either comfortable or tight, and everything downstream reads a party total — the
                server's `partyBudget()` converts a per-person figure once, so nothing here
                multiplies. */}
            <Animated.View style={[styles.basis, basisStyle]}>
              <View
                onLayout={measureBasis}
                // **Out of flow for the one frame before the height is known.** Absolute, so it
                // contributes nothing to the wrapper's own height — which is how the collapsed
                // state stays collapsed on arrival instead of flashing open and animating shut
                // — and invisible to eye and screen reader while it is there. The moment
                // `onLayout` reports, this drops away and the rows are ordinary content again,
                // so a later change of font scale re-measures through the same path.
                style={basisHeight === 0 && styles.measuring}
                accessibilityElementsHidden={basisHeight === 0}
                importantForAccessibility={basisHeight === 0 ? 'no-hide-descendants' : 'auto'}>
                <ChoiceRow
                  bare
                  options={[
                    { value: 'whole_party', label: 'Total' },
                    { value: 'per_person', label: 'Per person' },
                  ]}
                  value={budgetBasis}
                  onChange={(next) => patch({ budgetBasis: next })}
                />
              </View>
            </Animated.View>
          </View>
        </FieldTrough>

        <SavedPlacesSection
          destination={destination}
          anchors={draft.anchors}
          onAnchorsChange={(update) => patch((prev) => ({ anchors: update(prev.anchors) }))}
        />

        {/* Two labelled jobs, because the unlabelled box did one and looked like the other: it
            only ever finds places, and a note typed there ("busy Thursday") was thrown away. */}
        <Question title="Places you've saved" caption="Links, a list or screenshots. We'll find the places in them.">
          <ImportSection
            destination={destination}
            anchors={draft.anchors}
            onAnchorsChange={(update) => patch((prev) => ({ anchors: update(prev.anchors) }))}
            onDestinationGuess={(guess) =>
              patch((prev) => (prev.destination.trim() ? {} : { destination: guess }))
            }
          />
        </Question>

        {/* The note the planner reads word for word. It lives here rather than on the preferences
            page because "Skip the questions and generate" skips that page. */}
        <Question title="Anything we should plan around?" caption="Optional. Booked tickets, times you're busy, places to skip.">
          <FieldTrough>
            <TextField
              label="Note"
              value={draft.constraintsNote}
              onChangeText={(constraintsNote) => patch({ constraintsNote })}
              placeholder="Busy Thursday afternoon; dinner booked Friday; no rental car"
            />
          </FieldTrough>
        </Question>

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

        {/* The gap, said once the reader has asked for something and not before.
            **Muted, not alert** — a field you have not reached yet is not an error, and DESIGN.md
            keeps coral for the impossible. The loud half of this feedback is the cursor moving
            and the keyboard arriving; the sentence only names it. */}
        {asked && gapSentence(gap, problem) ? (
          <ThemedText
            type="detail"
            themeColor="muted"
            accessibilityLiveRegion="polite"
            style={styles.note}>
            {gapSentence(gap, problem)}
          </ThemedText>
        ) : null}

        {/* Two ways on. The optional steps sharpen the plan; they never gate it, so the fast
            path stays one tap from here. */}
        <View style={styles.action}>
          <PrimaryButton
            title="Next"
            onPress={() => goOn(() => router.push('/plan/group'))}
            accessibilityHint={gap?.reason}
          />
          {/* **Jade text on a 44pt target — and that is the third version of this control, so
              the record is worth keeping straight.** It shipped as muted `detail` body copy,
              which was reported as not reading as pressable at all; the fix for that was a slate
              capsule, on the argument that it differs from the button above it by fill rather
              than by shape. Two capsules stacked on the screen's bottom edge is what that cost,
              and the first one is the thing you are meant to press.

              `quiet` is the distinction the capsule was standing in for: jade ink says action
              under the One Meaning Rule, and `block` keeps the full-width 44pt target. What
              failed the first time was the *ink and the target*, not the absence of a fill. No
              `compact`, so the label keeps `headingSmall` — the chooser's escape is the same
              treatment at the same length and holds one line through AX3. */}
          <PillButton
            block
            tone="quiet"
            title="Skip the questions and generate"
            accessibilityHint={gap?.reason}
            onPress={() => goOn(() => router.replace('/plan/generating'))}
          />
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
      {/* **Only when there is a "here" to be elsewhere from.** Before a destination is typed
          nothing can match, so every group falls into `elsewhere` and the heading ends up over
          the whole library — labelling it elsewhere than nowhere. The trips wall already makes
          this call the same way: a section heading that distinguishes nothing is worse than
          none. */}
      {here.length > 0 && elsewhere.length > 0 ? (
        <ThemedText type="label" themeColor="muted">
          Saved elsewhere
        </ThemedText>
      ) : null}
      {elsewhere.map((g) => (
        <Group key={g.city} g={g} />
      ))}
      {/* **Shaped only where there is somewhere to go.** `SavedPlace.url` is nullable, so this
          was a control that sometimes did nothing — and a capsule promising a press that no-ops
          is worse than a sentence. With a URL it is a link and looks like one. */}
      {reminders.map((r) =>
        r.url ? (
          <PillButton
            key={r.id}
            compact
            role="link"
            title="Instagram post: screenshot it to add places"
            onPress={() => Linking.openURL(r.url!)}
          />
        ) : (
          <ThemedText key={r.id} type="detail" themeColor="muted">
            Instagram post: screenshot it to add places
          </ThemedText>
        ),
      )}
    </View>
  );
}

/** The import box's placeholder on this screen — the box itself is `ImportComposer`. */
const PASTE_PLACEHOLDER = 'Paste links or a list of places';

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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [unread, setUnread] = useState<string[]>([]);

  async function findPlaces(items: ImportItem[]): Promise<boolean> {
    setBusy(true);
    setUnread([]);
    const result = await importPlaces(items, destination.trim() || undefined);
    setBusy(false);

    if (result === undefined) {
      setUnread(["Couldn't read these right now."]);
      return false;
    }
    if (typeof result === 'string') {
      setUnread([result]);
      return false;
    }
    onAnchorsChange((prev) => mergeAnchors(prev, result.places));
    if (result.destinationGuess) onDestinationGuess(result.destinationGuess);
    setUnread(result.unread.map((u) => u.reason));
    return true;
  }

  const toggleMust = (name: string) =>
    onAnchorsChange((prev) =>
      prev.map((a) => (a.name === name ? { ...a, priority: a.priority === 'must' ? 'want' : 'must' } : a))
    );
  const remove = (name: string) => onAnchorsChange((prev) => prev.filter((a) => a.name !== name));

  return (
    <View style={styles.import}>
      <ImportComposer
        busy={busy}
        unread={unread}
        actionTitle="Find the places"
        placeholder={PASTE_PLACEHOLDER}
        onSubmit={findPlaces}
        below={(text) =>
          looksLikeDayPlan(text) ? (
            <PillButton
              title="This looks like a full plan. Use it as your trip"
              onPress={() => router.push({ pathname: '/plan/own', params: { text } })}
            />
          ) : null
        }
      />

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

/** `YYYY-MM-DD`, n days from today, read with local accessors to match the date picker. */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
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
  // The clip the accordion needs: the measured child keeps its own height while the wrapper's
  // animates to nothing, so what is hidden is hidden rather than drawn outside the trough.
  basis: { overflow: 'hidden' },
  // The measuring pass: natural height, no layout space, nothing to see. Full width because an
  // absolute box has none of its own, and a narrower measurement would under-report the height
  // at the type sizes where the rows wrap.
  measuring: { position: 'absolute', left: 0, right: 0, opacity: 0 },
});
