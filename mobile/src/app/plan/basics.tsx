import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { suggestDestinations, suggestionLabel, type GeoSuggestion } from '@shared/weather';

import { BlurView } from '@/components/blur';
import { SymbolView } from '@/components/symbol';
import type { ReadyTrip } from '@shared/readyTrips';

import { completePlan, geocode } from '@/api/tripMateApi';
import type { PartyCounts, PlanDraft } from '@/api/types';
import { isoDaysFromNow } from '@/components/form';
import { useCardPhoto } from '@/components/home/postcard';
import { PlacePhoto } from '@/components/place-photo';
import { DateRow, PlanColors, SegmentRow, Section, StepperRow, TextRow } from '@/components/plan-ui';
import { ChoiceRow, ValueRow } from '@/components/settings-list';
import { Polar, PolarFonts } from '@/constants/polar';
import { readyTripPrefill, suggestedBudget } from '@/lib/homeIdeas';
import { GROUPS, groupForParty, partyForGroup, prefillPatch, toUserAnswers, usePlanDraft } from '@/lib/planDraft';
import { paceFor } from '@/lib/readyTrips';
import { formatMoney } from '@/lib/spend';
import { useReadyTrips } from '@/lib/useReadyTrips';
import { planTiles, type PlanTileId } from '@/lib/planTiles';
import { crossFieldProblem, gapSentence, planGap } from '@/lib/formGap';
import { closestTier, perPersonBudget, tierName, tripDays } from '@/lib/tiers';

/**
 * The planner, on one page: the place's photograph with Where on it, the essentials already open
 * — dates, budget, who — and everything else as six tiles that each open a half sheet.
 *
 * **One page because the questions are not a sequence.** It was four pushed steps (where and when,
 * who, what you're after, review), which made a two-minute form feel like a long one and hid how
 * little of it is required: only where and when gate a plan. Here the required half is answered by
 * scrolling and the rest is visibly optional, each tile saying what it holds and ticking when it
 * holds something. There is no review step, because the page *is* the review — every answer is
 * on it, and a tile is one tap from changing.
 *
 * Canvas design "Phone plan · 3C Essentials, then make it yours".
 *
 * **The same page saves a ready-made trip** (`?ready=<slug>`, from its sheet's Use this plan). The
 * trip has no dates, costs or coordinates, so this asks what Basics already asks, with the place and
 * the length fixed by the plan: the photograph and title are the trip's, Where is not editable and
 * Leave follows Arrive. The tiles shape its notes, not its stops, and the button saves it through
 * the bring-your-own-plan route, marked `ready-made`. **Make it mine** turns the page back into the
 * planner, the trip's stops now its must-sees, for a plan written around the traveller.
 */
export default function Basics() {
  const router = useRouter();
  const { draft, patch } = usePlanDraft();
  const { ready: readySlug } = useLocalSearchParams<{ ready?: string }>();
  const catalogue = useReadyTrips(!!readySlug);
  const [mine, setMine] = useState(false);
  /** The ready-made trip this page is saving, while it is; `undefined` for the planner. */
  const ready = mine ? undefined : catalogue?.find((t) => t.slug === readySlug);
  const readyPhoto = useCardPhoto(ready);
  /** Set once the traveller types a budget: until then a ready-made trip's follows the party and the basis. */
  const budgetTyped = useRef(false);
  const followBudget = (party: PartyCounts, basis: PlanDraft['budgetBasis']) =>
    ready && !budgetTyped.current ? { budget: readyBudget(ready, basis, party) } : {};
  // A counter changed by hand carries the preset with it, so "Who" never contradicts the counts.
  const setParty = (change: Partial<typeof draft.party>) =>
    patch((prev) => {
      const party = { ...prev.party, ...change };
      return { party, group: groupForParty(party, prev.group), ...followBudget(party, prev.budgetBasis) };
    });
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

  /** Once, when the ready-made trip is known: its place, its length from the arrival, its pace, and the party's budget. */
  const readySeeded = useRef(false);
  useEffect(() => {
    if (!ready || readySeeded.current) return;
    readySeeded.current = true;
    const pace = paceFor(ready.pace);
    patch((prev) => {
      const start = prev.startDate || isoDaysFromNow(30);
      return {
        destination: ready.destination,
        startDate: start,
        endDate: leaveFor(ready, start),
        budget: readyBudget(ready, prev.budgetBasis, prev.party),
        ...(pace ? { pace } : {}),
      };
    });
  }, [ready, patch]);

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
    patch(ready ? { startDate: value, endDate: leaveFor(ready, value) } : { startDate: value });
  };
  const setEndDate = (value: string) => {
    closeSuggestions();
    patch({ endDate: value });
  };
  const setBudget = (text: string) => {
    closeSuggestions();
    budgetTyped.current = true;
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


  /** Held while the save is in flight; a ref beside the state, since two taps in one frame both see `saving` false. */
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);

  /** Use this plan: the trip's stops, in order, saved as a draft with the answers beside them. */
  async function saveReadyPlan(trip: ReadyTrip) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveProblem(null);
    const result = await completePlan({
      destination: trip.destination,
      startDate,
      // The route reads one traveller's budget (own.tsx's "Budget per person"), whatever the toggle says here.
      ...(budget > 0 ? { budget: Math.round(perPersonBudget(budget, budgetBasis, draft.party)) } : {}),
      plan: {
        destinationGuess: trip.destination,
        isPlan: true,
        days: trip.itinerary.map((d) => ({ stops: d.stops.map((s) => ({ name: s.name, ...(s.note ? { note: s.note } : {}) })) })),
        loose: [],
        notes: [],
        unread: [],
      },
      origin: 'ready-made',
      readyTrip: trip.slug,
      userAnswers: toUserAnswers(draft),
    }, { 422: UNPLACED });
    if (result !== undefined && typeof result !== 'string') {
      // Still held: the plan modal closes onto the trip, as `own.tsx`'s build does.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/trip/${result.id}`);
      return;
    }
    savingRef.current = false;
    setSaving(false);
    setSaveProblem(result ?? 'Couldn’t reach TripMate. Your answers are kept.');
  }

  /** Back to the planner, the trip as a starting point. No dates in the patch, so the arrival, party and budget stay. */
  function makeItMine(trip: ReadyTrip) {
    patch(prefillPatch(readyTripPrefill(trip, null)));
    setSaveProblem(null);
    setMine(true);
  }

  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  // 402:262, never shorter than what the band holds (see the note on `PlacePhoto` below).
  // A trip's title can take two lines where "Plan a trip" takes one.
  const heroRatio = screenWidth / Math.max((screenWidth * 262) / 402, insets.top + HERO_BODY + (ready ? TITLE_LINE : 0));
  const tiles = planTiles(draft);
  const open = (id: PlanTileId) => {
    closeSuggestions();
    router.push(`/plan/${id}`);
  };
  const city = destination.split(',')[0].trim();
  const notes = [
    missed ? 'We couldn’t find that place, but the plan will still work.' : null,
    problem,
    asked ? gapSentence(gap, problem) : null,
    ready ? saveProblem : null,
  ].filter((n): n is string => !!n);
  const leave = endDate ? new Date(`${endDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* No navigation bar: the photograph is the top of the page, and its own close sits on it. */}
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* The place itself, once there is one. Until then the ink the photograph would sit on. */}
        {/* Never shorter than what it holds. At 402:262 alone, the close, the title and the field
            came to more than the photograph under the status bar, the bottom padding gave way, and
            the field sat 2pt above the sheet where plan-3C leaves 14pt. The floor goes into the
            ratio, not into a `minHeight`: with a ratio, Yoga widens the box to keep it when the
            height is clamped, and the band (and the field in it) ran past the screen's right edge. */}
        <PlacePhoto name={city || 'Travel'} source={ready ? readyPhoto : undefined} aspectRatio={heroRatio} radius={0} scrim={0.42} style={styles.hero}>
          <View style={[styles.heroInner, { paddingTop: insets.top + 4 }]}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}>
              <SymbolView name={{ ios: 'xmark', android: 'close' }} size={15} weight="semibold" tintColor="#fff" />
            </Pressable>
            <View style={styles.grow} />
            <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
              {ready ? ready.title : 'Plan a trip'}
            </Text>
            <View style={styles.where}>
              <SymbolView name={{ ios: 'mappin.and.ellipse', android: 'place' }} size={17} tintColor={PlanColors.grey} />
              <TextInput
                ref={destinationField}
                value={destination}
                onChangeText={setDestination}
                onBlur={checkDestination}
                placeholder="Where to?"
                placeholderTextColor={PlanColors.faint}
                selectionColor={Polar.ember}
                keyboardAppearance="light"
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                accessibilityLabel="Where"
                // The plan is of this place; a different one is Make it mine.
                editable={!ready}
                maxFontSizeMultiplier={1.6}
                style={styles.whereInput}
              />
              {destination && !ready ? (
                <Pressable onPress={() => setDestination('')} accessibilityRole="button" accessibilityLabel="Clear where" hitSlop={10}>
                  <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel' }} size={17} tintColor={PlanColors.faint} />
                </Pressable>
              ) : null}
            </View>
          </View>
        </PlacePhoto>

        <View style={styles.sheet}>
          {/* In the page rather than over it, so a suggestion never hides the question below. */}
          {suggestions.length > 0 ? (
            <Section>
              {suggestions.map((suggestion) => (
                <Pressable
                  key={`${suggestion.lat},${suggestion.lon}`}
                  onPress={() => pickDestination(suggestion)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
                  <SymbolView name={{ ios: 'mappin', android: 'place' }} size={14} tintColor={PlanColors.grey} />
                  <Text style={styles.suggestionText} numberOfLines={1}>
                    {suggestionLabel(suggestion)}
                    {suggestion.admin1 && suggestion.admin1 !== suggestion.name ? (
                      <Text style={styles.suggestionArea}>{`  ${suggestion.admin1}`}</Text>
                    ) : null}
                  </Text>
                </Pressable>
              ))}
            </Section>
          ) : null}

          <Section header="The essentials" footer={ready ? `Estimate from ${formatMoney(ready.priceFrom)} per person, excluding flights` : readout}>
            <DateRow label="Arrive" value={startDate} onChange={setStartDate} />
            {ready ? (
              <ValueRow label="Leave" value={leave} />
            ) : (
              <DateRow label="Leave" value={endDate} minimumDate={startDate || undefined} onChange={setEndDate} />
            )}
            <TextRow
              ref={budgetField}
              label="Budget"
              // An example, said as one: a bare "2,600" in the value's place, at the value's size,
              // read as a budget already set. The "$" joins once there is a figure to sit beside.
              prefix={budgetText ? '$' : undefined}
              value={budgetText}
              onChangeText={setBudget}
              onFocus={closeSuggestions}
              placeholder="e.g. $2,600"
              keyboardType="number-pad"
            />
            {/* The number means nothing without this: everything downstream reads a party total,
                and the server converts a per-person figure once, so nothing here multiplies. */}
            <SegmentRow
              options={[
                { value: 'whole_party', label: 'Total' },
                { value: 'per_person', label: 'Per person' },
              ]}
              value={budgetBasis}
              onChange={(next) => patch({ budgetBasis: next, ...followBudget(draft.party, next) })}
            />
            {/* A shortcut into the counters, not a second question about the same thing — see
                `partyForGroup`. The counters stay editable, so a preset is a starting point. */}
            <ChoiceRow
              label="Who"
              value={draft.group}
              options={GROUPS}
              onChange={(group) => {
                const seeded = partyForGroup(group);
                patch(seeded ? { group, party: seeded, ...followBudget(seeded, draft.budgetBasis) } : { group });
              }}
            />
            {draft.group === 'other' ? (
              <TextRow
                label="Who"
                value={draft.groupOther}
                onChangeText={(groupOther) => patch({ groupOther })}
                placeholder="Five college friends"
                autoCapitalize="none"
              />
            ) : null}
            <StepperRow label="Adults" value={draft.party.adults} min={1} max={12} onChange={(adults) => setParty({ adults })} />
            <StepperRow label="Children" caption="2 to 11" value={draft.party.children} max={12} onChange={(children) => setParty({ children })} />
            <StepperRow label="Infants" caption="Under 2" value={draft.party.infants} max={6} onChange={(infants) => setParty({ infants })} />
          </Section>

          <Text style={styles.heading}>MAKE IT YOURS</Text>
          <View style={styles.tiles}>
            {tiles.map((tile) => (
              <Pressable
                key={tile.id}
                onPress={() => open(tile.id)}
                accessibilityRole="button"
                accessibilityLabel={`${tile.title}, ${tile.value}${tile.done ? ', answered' : tile.optional ? ', optional' : ''}`}
                style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}>
                <View style={styles.tileTop}>
                  <View style={styles.tileIcon}>
                    <SymbolView name={TILE_ICON[tile.id]} size={16} tintColor={Polar.ember} />
                  </View>
                  {tile.done ? (
                    <View style={styles.tick}>
                      <SymbolView name={{ ios: 'checkmark', android: 'check' }} size={11} weight="bold" tintColor={Polar.ink} />
                    </View>
                  ) : tile.optional ? (
                    <Text style={styles.optional}>Optional</Text>
                  ) : null}
                </View>
                <Text style={styles.tileTitle}>{tile.title}</Text>
                <Text style={styles.tileValue} numberOfLines={2}>
                  {tile.value}
                </Text>
              </Pressable>
            ))}
          </View>
          {ready ? (
            <View style={styles.readyFoot}>
              <Text style={styles.readyNote}>These shape the notes and later changes, not this plan’s stops. To change the stops, make it yours instead.</Text>
              <Pressable onPress={() => makeItMine(ready)} accessibilityRole="button" accessibilityHint="Plan it fresh, with this trip's stops as must-sees" hitSlop={8}>
                <Text style={styles.readyLink}>Make it mine</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* The page's one action, at the thumb. Never disabled: the empty case is handled at the
          press, where the cursor moves to what is missing and the line above says why. */}
      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <BlurView intensity={80} tint="systemChromeMaterialLight" style={StyleSheet.absoluteFill} />
        {notes.map((note) => (
          <Text key={note} style={[styles.note, note === problem && styles.noteAlert]} accessibilityLiveRegion="polite">
            {note}
          </Text>
        ))}
        {ready ? (
          <Pressable
            onPress={() => saveReadyPlan(ready)}
            disabled={saving}
            accessibilityRole="button"
            accessibilityState={{ busy: saving, disabled: saving }}
            style={({ pressed }) => [styles.plan, pressed && styles.planPressed]}>
            {saving ? <ActivityIndicator color={Polar.ink} /> : <Text style={styles.planText}>Use this plan</Text>}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => goOn(() => router.replace('/plan/generating'))}
            accessibilityRole="button"
            accessibilityHint={gap?.reason}
            style={({ pressed }) => [styles.plan, pressed && styles.planPressed]}>
            <Text style={styles.planText}>Plan my trip</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const TILE_ICON: Record<PlanTileId, React.ComponentProps<typeof SymbolView>['name']> = {
  into: { ios: 'sparkles', android: 'auto_awesome' },
  pace: { ios: 'figure.walk', android: 'directions_walk' },
  needs: { ios: 'fork.knife', android: 'restaurant' },
  booked: { ios: 'bed.double', android: 'hotel' },
  saved: { ios: 'photo.on.rectangle', android: 'image' },
  must: { ios: 'mappin.circle', android: 'place' },
};

/** Below the inset: 4 + close 38 + 12 + title 44 + 12 + field 52 + 38 padding, and 14 to spare. */
const HERO_BODY = 214;
/** One more line of the title, for a ready-made trip's name. */
const TITLE_LINE = 44;

/**
 * A ready-made trip's suggested budget, in the unit the toggle says: `priceFrom` is one traveller's,
 * so per person it is that, and in total it is that times the party.
 */
const readyBudget = (trip: ReadyTrip, basis: PlanDraft['budgetBasis'], party: PartyCounts) =>
  basis === 'per_person' ? trip.priceFrom : suggestedBudget(trip, party.adults + party.children);

/** Where is locked in ready mode, so the route's "check where it is" would point at nothing to change. */
const UNPLACED = 'Couldn’t place this trip on the map right now. Try again, or make it yours below.';

/** The last day of a ready-made trip from its arrival: the plan fixes the length. */
const leaveFor = (trip: ReadyTrip, start: string) => readyTripPrefill(trip, start).end ?? start;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PlanColors.ground },
  grow: { flex: 1 },
  hero: { justifyContent: 'flex-end', backgroundColor: Polar.ink },
  heroInner: { flex: 1, paddingHorizontal: 16, paddingBottom: 38, gap: 12 },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  title: { fontFamily: PolarFonts.display, fontSize: 40, lineHeight: 44, color: '#fff' },
  where: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  whereInput: { flex: 1, fontSize: 19, color: PlanColors.ink, paddingVertical: 10 },
  // Rounded over the photograph, the way a sheet sits on a page; the grouped ground beneath.
  sheet: { marginTop: -24, paddingTop: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: PlanColors.ground },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 16, backgroundColor: '#fff' },
  suggestionText: { flex: 1, fontSize: 16, color: PlanColors.ink },
  suggestionArea: { color: PlanColors.grey },
  pressed: { backgroundColor: PlanColors.pressed },
  heading: { marginHorizontal: 32, marginBottom: 7, fontSize: 13, color: PlanColors.grey },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  // Two across: half the row less half the gap.
  tile: { width: '48.5%', minHeight: 116, padding: 14, gap: 3, borderRadius: 14, backgroundColor: '#fff' },
  tilePressed: { opacity: 0.7 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  tileIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: PlanColors.fill },
  tick: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.signal },
  optional: { fontSize: 12, color: PlanColors.grey },
  tileTitle: { fontSize: 16, fontWeight: '600', color: PlanColors.ink },
  tileValue: { fontSize: 13, lineHeight: 17, color: PlanColors.grey },
  readyFoot: { marginHorizontal: 32, marginTop: 10, gap: 10 },
  readyNote: { fontSize: 13, lineHeight: 18, color: PlanColors.grey },
  readyLink: { fontSize: 15, fontWeight: '600', color: Polar.ember },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 6,
    paddingTop: 12,
    paddingHorizontal: 16,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PlanColors.separator,
  },
  note: { fontSize: 13, lineHeight: 18, textAlign: 'center', color: PlanColors.grey },
  noteAlert: { color: Polar.alertText },
  plan: { minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.signal },
  planPressed: { backgroundColor: Polar.signalPressed },
  planText: { fontSize: 17, fontWeight: '600', color: Polar.ink },
});
