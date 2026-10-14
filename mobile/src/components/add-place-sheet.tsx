import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { searchPlaces } from '@/api/tripMateApi';
import { PLACE_CATEGORIES, type FoundPlace, type Itinerary, type PlaceCategory } from '@/api/types';
import { FieldTrough, PillButton, PrimaryButton, TextField } from '@/components/form';
import { Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  addPlaceToDay,
  describePlace,
  insertionDetour,
  slotLine,
  slotPreview,
  suggestDay,
  suggestTimeOfDay,
  type TimeOfDay,
} from '@/lib/addPlace';
import { formatDayChip } from '@/lib/dayDisplay';

const SLOTS: TimeOfDay[] = ['Morning', 'Afternoon', 'Evening'];

/** Matches the route's own default, and its clamp is 200–8000. */
const SEARCH_RADIUS_M = 1800;

/**
 * How far around a pressed point counts as "here".
 *
 * 200m is the route's own floor, and it is the right end of the clamp for this: a press is aimed
 * at something the reader can see, so the answer has to be things within sight of it. A browse
 * wants a neighbourhood; this wants a block.
 */
const PROBE_RADIUS_M = 200;

/**
 * Find a place and put it in a day.
 *
 * **Two questions, and the app answers both before asking.** Which day a place belongs to is
 * geometry — distance to each day's centroid, normalised by that day's own radius — and what
 * time it should get is arithmetic over the times already in that day. Neither is a judgement
 * call worth a model round trip, and both already exist in this repo as tested TypeScript, which
 * is what `@/lib/addPlace` imports.
 *
 * The day you were reading wins over the geometry. Geometry only decides when nobody has an
 * opinion — the recommendation is a starting point on a picker, never a decision taken for you.
 */
export function AddPlaceSheet({
  visible,
  onClose,
  itinerary,
  dayIndex,
  centre,
  at,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  itinerary: Itinerary;
  /** The day being read — the default, ahead of whatever the geometry suggests. */
  dayIndex: number;
  /** Where to search. The focused day's own middle. */
  centre: { lat: number; lng: number } | null;
  /**
   * A stop somebody asked "what else is near this?" about.
   *
   * The same sheet, asked a tighter question: it searches around that stop instead of the day's
   * middle, over every kind of place rather than one. Everything past the result list — the card,
   * the day, the slot, the add — is the browse's, unchanged.
   *
   * The `name` is required because it is the whole difference between this and pressing open map:
   * the question has a subject, and the sheet says whose neighbourhood it is showing.
   */
  at?: { lat: number; lng: number; name: string } | null;
  onAdd: (next: Itinerary, placeName: string) => Promise<boolean>;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.bar}>
          <ThemedText type="title" numberOfLines={1}>
            {at ? `Near ${at.name}` : 'Add a stop'}
          </ThemedText>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <ThemedText type="label" themeColor="muted">
              Close
            </ThemedText>
          </Pressable>
        </View>

        {/* Mounted only while open, which is the whole reset mechanism. Clearing the query, the
            results and the chosen place from an effect on the way out would be the same thing
            written as four `setState` calls React would rather not see in an effect body. */}
        {visible ? (
          <SheetBody
            itinerary={itinerary}
            dayIndex={dayIndex}
            centre={centre}
            at={at ?? null}
            onAdd={onAdd}
            onClose={onClose}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function SheetBody({
  itinerary,
  dayIndex,
  centre,
  at,
  onAdd,
  onClose,
}: {
  itinerary: Itinerary;
  dayIndex: number;
  centre: { lat: number; lng: number } | null;
  at: { lat: number; lng: number; name: string } | null;
  onAdd: (next: Itinerary, placeName: string) => Promise<boolean>;
  onClose: () => void;
}) {
  // No category when asking about a stop's surroundings: "what else is here" is a question about
  // every kind of place at once, and the route reads an absent category as the union of all of
  // them. The chips stay on screen either way — they are how you narrow a busy corner to cafes.
  const [category, setCategory] = useState<PlaceCategory | null>(at ? null : 'cafe');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<FoundPlace | null>(null);

  /**
   * What is being asked, as one string.
   *
   * The results are stored *with the question they answer*, so "still searching" is derived by
   * comparing the two rather than held as its own state — which is what keeps this effect free
   * of a synchronous `setState`. It also makes a stale response harmless: one that lands after
   * the question moved on simply no longer matches.
   */
  const asked = `${category ?? ''}|${query.trim()}`;
  const [answer, setAnswer] = useState<{
    asked: string;
    places: FoundPlace[];
    available: boolean;
  } | null>(null);

  // Primitives, never the `centre` object: the parent builds it inline, so a new identity every
  // render would restart the debounce on every render and never actually search.
  // The asked-about stop wins over the day's middle — it is the more specific thing to search
  // around, and it is the only one there is when the day has no stops to have a middle.
  const origin = at ?? centre;
  const lat = origin?.lat;
  const lng = origin?.lng;
  const radius = at ? PROBE_RADIUS_M : SEARCH_RADIUS_M;

  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    // 320ms, the same debounce the Swift app settled on: long enough not to search every
    // keystroke, short enough that a chip press feels immediate.
    const run = setTimeout(async () => {
      const result = await searchPlaces({
        lat,
        lng,
        q: query,
        category: category ?? undefined,
        radius,
      });
      setAnswer({
        asked,
        places: result?.places ?? [],
        // A transport failure and the route's own `available: false` mean the same thing to a
        // reader — we could not ask — and must not be reported as "there is nothing here".
        available: result?.available ?? false,
      });
    }, 320);
    return () => clearTimeout(run);
  }, [lat, lng, asked, query, category, radius]);

  const searching = answer?.asked !== asked;
  const places = answer?.places ?? [];

  if (chosen) {
    return (
      <PlaceCard
        place={chosen}
        itinerary={itinerary}
        dayIndex={dayIndex}
        onBack={() => setChosen(null)}
        onAdd={onAdd}
        onDone={onClose}
      />
    );
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <ScrollView
        horizontal
        indicatorStyle="white"
        contentContainerStyle={styles.chips}>
        {PLACE_CATEGORIES.map((kind) => {
          const active = category === kind;
          return (
            <Pressable
              key={kind}
              onPress={() => setCategory(active ? null : kind)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.chip, active && styles.chipActive]}>
              <ThemedText type="detail" themeColor={active ? 'foreground' : 'muted'}>
                {LABELS[kind]}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      <FieldTrough>
        <TextField
          label="Find"
          value={query}
          onChangeText={setQuery}
          placeholder="A name, or leave blank"
          autoCorrect={false}
          returnKeyType="search"
        />
      </FieldTrough>

      {/* Which day these results would join. The card that follows can move it, but a list of
          places with no stated destination is the thing that made this screen read as ordinary
          search: the app has already decided where a stop is going, and was not saying. */}
      <ThemedText type="detail" themeColor="muted">
        Adding to {dayLabel(itinerary, dayIndex)}
      </ThemedText>

      {!origin ? (
        <Notice>This day has nowhere to search around yet.</Notice>
      ) : searching ? (
        <Loading />
      ) : !answer?.available ? (
        <Notice>Search is busy. Try again in a moment.</Notice>
      ) : places.length === 0 ? (
        <ThemedText type="detail" themeColor="muted" style={styles.empty}>
          {/* A stop out on a headland or up a mountain legitimately has nothing mapped within a
              block of it. That is an answer about the place, not a failure, and it must not read
              like the category one — there is no category. */}
          {at
            ? `Nothing else mapped within a short walk of ${at.name}.`
            : 'Nothing of that kind nearby. Try another kind, or a name.'}
        </ThemedText>
      ) : (
        <View style={styles.results}>
          {places.map((place, index) => (
            <Pressable
              key={place.id}
              onPress={() => setChosen(place)}
              style={[styles.result, index > 0 && styles.resultRuled]}
              android_ripple={{ color: Colors.pressed }}>
              <ThemedText type="heading">{place.name}</ThemedText>
              {/* Where it would land and what it would cost, *before* the row is opened. The card
                  behind this row opens on exactly these two defaults, and says the same sentence
                  through the same function — so this is a preview of the answer rather than a
                  second estimate of it. Paper rather than jade: it outranks the muted line below
                  it because it is the only one about *this trip*, but it is a fact and not a
                  control, and jade in this product means press me.

                  **It goes directly under the name, above the map's own facts about the place.**
                  A review read these rows as one texture: category, opening-hours grammar and
                  street came first and were the least decidable thing on them, while the two
                  figures that answer "where would this go and what does it cost me" sat beneath.
                  The weights were already right — paper over muted — and the order was not, which
                  is a cheaper fix than any change of type. */}
              <ThemedText type="detail" themeColor="foreground" style={styles.resultMeta}>
                {landingLine(itinerary, dayIndex, place)}
              </ThemedText>
              {/* The same line the stop will carry once it is added, rather than a second summary
                  written to a different rule — so what you read here is what lands in the day. */}
              <ThemedText type="detail" themeColor="muted" style={styles.resultMeta}>
                {describePlace(place)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/**
 * What this place would do to the day, at the defaults the card will open on.
 *
 * The complaint this answers is that a list of cafes is a search engine, and the app had already
 * worked out where each one goes and what it costs to put it there. `slotPreview` and
 * `insertionDetour` are the same two the card calls; `suggestTimeOfDay` is the slot it opens on.
 * Reading a different pair here would make the row a claim the next screen contradicts.
 */
function landingLine(itinerary: Itinerary, dayIndex: number, place: FoundPlace): string {
  const slot = suggestTimeOfDay(place);
  const preview = slotPreview(itinerary, dayIndex, slot);
  return slotLine(preview.time, preview.tight, insertionDetour(itinerary, dayIndex, place, slot));
}

/**
 * One place, and the two decisions about it.
 *
 * Each slot row shows the clock time it would actually produce, not just its name: "Afternoon" is
 * a guess, "2:30 PM" is the answer. A slot with no clear gap says so rather than quietly
 * shoulder-to-shouldering the day.
 */
function PlaceCard({
  place,
  itinerary,
  dayIndex,
  onBack,
  onAdd,
  onDone,
}: {
  place: FoundPlace;
  itinerary: Itinerary;
  dayIndex: number;
  onBack: () => void;
  onAdd: (next: Itinerary, placeName: string) => Promise<boolean>;
  onDone: () => void;
}) {
  // The day being read wins; geometry only answers when there is no day in context. Here there
  // always is one, so the suggestion is a fallback rather than the rule.
  const suggested = suggestDay(itinerary, place);
  const [day, setDay] = useState(dayIndex ?? suggested ?? 0);
  const [slot, setSlot] = useState<TimeOfDay>(suggestTimeOfDay(place));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function add() {
    setBusy(true);
    setFailed(false);
    const ok = await onAdd(addPlaceToDay(itinerary, day, place, slot), place.name);
    setBusy(false);
    if (ok) onDone();
    else setFailed(true);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* Moving this into the sheet's own title bar — where the positional exemption would
          licence bare text — is the better structure and is a sheet-navigation refactor. Until
          then it is a control standing in content, so it takes a shape and a 44pt target. */}
      <PillButton compact title="‹ Results" accessibilityLabel="Back to results" onPress={onBack} />

      <View style={styles.cardHead}>
        <ThemedText type="display">{place.name}</ThemedText>
        <ThemedText type="detail" themeColor="muted">
          {[LABELS[place.category] ?? place.category, place.address].filter(Boolean).join('  ·  ')}
        </ThemedText>
      </View>

      <PlaceFacts place={place} />

      <ThemedText type="label" themeColor="muted">
        Which day
      </ThemedText>
      <ScrollView
        horizontal
        indicatorStyle="white"
        contentContainerStyle={styles.chips}>
        {itinerary.days.map((_, index) => {
          const active = index === day;
          return (
            <Pressable
              key={index}
              onPress={() => setDay(index)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Day ${index + 1}`}
              style={[styles.chip, active && styles.chipActive]}>
              <ThemedText type="money" themeColor={active ? 'foreground' : 'muted'}>
                {index + 1}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      <ThemedText type="label" themeColor="muted" style={styles.slotsLabel}>
        When
      </ThemedText>
      <FieldTrough>
        {SLOTS.map((option) => {
          const preview = slotPreview(itinerary, day, option);
          // Per slot, not per place: the same café costs a different detour depending on which
          // two stops it would end up between.
          const detour = insertionDetour(itinerary, day, place, option);
          const active = option === slot;
          return (
            <Pressable
              key={option}
              onPress={() => setSlot(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={styles.slot}
              android_ripple={{ color: Colors.pressed }}>
              <View style={styles.grow}>
                <ThemedText type="heading">{option}</ThemedText>
                <ThemedText type="detail" themeColor="muted">
                  {slotLine(preview.time, preview.tight, detour)}
                </ThemedText>
              </View>
              {active ? (
                <ThemedText type="heading" themeColor="accent">
                  ✓
                </ThemedText>
              ) : null}
            </Pressable>
          );
        })}
      </FieldTrough>

      {failed ? (
        <ThemedText type="detail" themeColor="alert" style={styles.empty}>
          That didn&rsquo;t save. Check your connection and try again.
        </ThemedText>
      ) : null}

      <View style={styles.action}>
        <PrimaryButton title={`Add to ${dayLabel(itinerary, day)}`} onPress={add} busy={busy} disabled={busy} />
      </View>
    </ScrollView>
  );
}

/**
 * `Day 2 · Fri 23`, or just `Day 2` for a plan whose day carries no readable date.
 *
 * The ordinal alone is what a traveler has to hold in their head; the date is what they are
 * actually thinking in when they decide a café belongs to this afternoon.
 */
function dayLabel(itinerary: Itinerary, dayIndex: number): string {
  const chip = formatDayChip(itinerary.days[dayIndex]?.date ?? '');
  return chip ? `Day ${dayIndex + 1} · ${chip.weekday} ${chip.dayOfMonth}` : `Day ${dayIndex + 1}`;
}

/** How OSM's `wheelchair` tag reads as a sentence. `no` is worth saying — somebody planning
 *  around a wheelchair needs the negative as much as the positive. */
const ACCESS: Record<string, string> = {
  yes: 'Wheelchair access',
  limited: 'Limited wheelchair access',
  no: 'No wheelchair access',
};

/** `https://www.slowjet.coffee/` → `slowjet.coffee`. The scheme and the trailing slash are
 *  plumbing; what a reader wants to recognise is the domain. */
function tidyUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

/**
 * What is known about this place, beyond its name.
 *
 * **The card has to look finished with none of it.** Coverage is partial by nature — see
 * `FoundPlace` for the measured shape of it — so this renders nothing at all rather than a stack
 * of empty rows or "unknown" six times, and the card above stands on its own.
 *
 * Hours go in exactly as OSM wrote them, unparsed: this is where the long grammar the stop's own
 * line leaves out finally has room. A phone number and a website are the two rows worth pressing,
 * so they are the two that are links; a rejected `openURL` is swallowed, because a device with no
 * dialler is not something to report to somebody reading about a cafe.
 */
function PlaceFacts({ place }: { place: FoundPlace }) {
  const rows: { label: string; value: string; href?: string }[] = [];
  // **"listed", not "Hours".** This is an OSM `opening_hours` tag with no freshness metadata
  // attached — it may have been edited last week or in 2016, and the UI has no way to tell. A
  // bare "Hours" promotes a database row into a guarantee about a door somebody is walking to.
  // One word states the basis instead. The search rows stay unqualified: a caveat on every
  // result is noise, and the card is where the decision is actually made.
  if (place.openingHours) rows.push({ label: 'Hours listed', value: place.openingHours });
  if (place.phone) rows.push({ label: 'Phone', value: place.phone, href: `tel:${place.phone}` });
  if (place.website) {
    rows.push({ label: 'Website', value: tidyUrl(place.website), href: place.website });
  }
  if (place.outdoorSeating) rows.push({ label: 'Seating', value: 'Tables outside' });
  if (place.wheelchair) rows.push({ label: 'Access', value: ACCESS[place.wheelchair] });
  if (place.rating) rows.push({ label: 'Rating', value: `${place.rating.toFixed(1)} out of 5` });

  if (rows.length === 0) return null;

  return (
    <FieldTrough>
      {rows.map((row) => (
        <Pressable
          key={row.label}
          disabled={!row.href}
          onPress={() => row.href && Linking.openURL(row.href).catch(() => {})}
          accessibilityRole={row.href ? 'link' : 'text'}
          style={styles.fact}
          android_ripple={row.href ? { color: Colors.pressed } : undefined}>
          <ThemedText type="label" themeColor="muted" style={styles.factLabel}>
            {row.label}
          </ThemedText>
          <ThemedText
            type="detail"
            themeColor={row.href ? 'accentText' : 'foreground'}
            style={styles.grow}>
            {row.value}
          </ThemedText>
        </Pressable>
      ))}
    </FieldTrough>
  );
}

/** The category names as a person would say them, not as the API spells them. */
const LABELS: Record<string, string> = {
  cafe: 'Cafes',
  restaurant: 'Food',
  bar: 'Bars',
  sights: 'Sights',
  park: 'Parks',
  shop: 'Shops',
  hotel: 'Hotels',
  place: 'Places',
};

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.canvas },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.read,
    paddingBottom: Spacing.tight,
  },
  content: { padding: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.rows },
  chips: { gap: Spacing.tight, paddingRight: Spacing.read, alignItems: 'center' },
  chip: {
    minWidth: 36,
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.tight,
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  results: {
    backgroundColor: Colors.panel,
    borderRadius: Radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  result: { paddingHorizontal: Spacing.read, paddingVertical: Spacing.rows },
  resultRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  resultMeta: { marginTop: 3 },
  empty: { paddingVertical: Spacing.rows },

  cardHead: { gap: Spacing.hair, marginBottom: Spacing.tight },
  fact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.rows,
    minHeight: 44,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
  },
  // A fixed column so the values line up down the card rather than starting wherever their label
  // happens to end. Wide enough for "Seating" at the largest text size.
  factLabel: { width: 82, paddingTop: 1 },
  slotsLabel: { marginTop: Spacing.tight },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.rows,
    minHeight: 56,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
  },
  grow: { flex: 1 },
  action: { marginTop: Spacing.tight },
});
