import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { searchPlaces } from '@/api/tripMateApi';
import { PLACE_CATEGORIES, type FoundPlace, type Itinerary, type PlaceCategory } from '@/api/types';
import { FieldTrough, PrimaryButton, TextField } from '@/components/form';
import { Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { addPlaceToDay, slotPreview, suggestDay, suggestTimeOfDay, type TimeOfDay } from '@/lib/addPlace';

const SLOTS: TimeOfDay[] = ['Morning', 'Afternoon', 'Evening'];

/** Matches the route's own default, and its clamp is 200–8000. */
const SEARCH_RADIUS_M = 1800;

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
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  itinerary: Itinerary;
  /** The day being read — the default, ahead of whatever the geometry suggests. */
  dayIndex: number;
  /** Where to search. The focused day's own middle. */
  centre: { lat: number; lng: number } | null;
  onAdd: (next: Itinerary, placeName: string) => Promise<boolean>;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.bar}>
          <ThemedText type="title">Add a stop</ThemedText>
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
  onAdd,
  onClose,
}: {
  itinerary: Itinerary;
  dayIndex: number;
  centre: { lat: number; lng: number } | null;
  onAdd: (next: Itinerary, placeName: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<PlaceCategory | null>('cafe');
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
  const lat = centre?.lat;
  const lng = centre?.lng;

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
        radius: SEARCH_RADIUS_M,
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
  }, [lat, lng, asked, query, category]);

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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
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

      {!centre ? (
        <Notice>This day has nowhere to search around yet.</Notice>
      ) : searching ? (
        <Loading />
      ) : !answer?.available ? (
        <Notice>Search is busy. Try again in a moment.</Notice>
      ) : places.length === 0 ? (
        <ThemedText type="detail" themeColor="muted" style={styles.empty}>
          Nothing of that kind nearby. Try another kind, or a name.
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
              <ThemedText type="label" themeColor="muted" style={styles.resultMeta}>
                {[LABELS[place.category] ?? place.category, place.address].filter(Boolean).join('  ·  ')}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
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
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button">
        <ThemedText type="label" themeColor="accent">
          ‹ Results
        </ThemedText>
      </Pressable>

      <View style={styles.cardHead}>
        <ThemedText type="display">{place.name}</ThemedText>
        <ThemedText type="detail" themeColor="muted">
          {[LABELS[place.category] ?? place.category, place.address].filter(Boolean).join('  ·  ')}
        </ThemedText>
      </View>

      <ThemedText type="label" themeColor="muted">
        Which day
      </ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
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
                <ThemedText type="label" themeColor="muted">
                  {preview.tight ? `${preview.time}  ·  tight fit` : preview.time}
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
        <PrimaryButton title={`Add to day ${day + 1}`} onPress={add} busy={busy} disabled={busy} />
      </View>
    </ScrollView>
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
