import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { searchPlaces } from '@/api/tripMateApi';
import { PLACE_CATEGORIES, type FoundPlace, type Itinerary, type PlaceCategory, type PlaceSearchResult } from '@/api/types';
import { SignalButton, usePolarFonts } from '@/components/polar-ui';
import { SheetDone } from '@/components/sheet-done';
import { SymbolView } from '@/components/symbol';
import { Polar, PolarFonts, PolarRadius, PolarSpace, PolarType } from '@/constants/polar';
import {
  KINDS,
  addPlaceToDay,
  describePlace,
  detourShort,
  foundLine,
  insertionDetour,
  slotLine,
  slotPreview,
  suggestDay,
  suggestTimeOfDay,
  type Detour,
  type TimeOfDay,
} from '@/lib/addPlace';
import { metresBetween } from '@/lib/anchors';
import { formatDayChip } from '@/lib/dayDisplay';
import { describeDistance } from '@/lib/savedPlaces';
import { Text, TextInput } from '@/components/themed-text';

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

const GUTTER = PolarSpace.s3;
/** Both side lanes of the header, so the title between them stays centred. Wide enough for Cancel. */
const LANE = 92;

/** Night's own card fill and rule, a step under `Polar.frost10`. Not tokens because nothing else
 *  draws on the night at these alphas yet. */
const FROST_06 = 'rgba(255,255,255,0.06)';
const LINE = 'rgba(255,255,255,0.12)';
/** "Fits" on a chosen (ice) slot: the route's cyan does not read on white, so its dark green. */
const FITS_ON_ICE = '#1D6B3A';

/** The loading rows' bones, title then line, narrowing down the list so four rows read as a list
 *  rather than one row stamped four times. Literals because a percentage width is a typed string. */
const BONES = [
  ['62%', '70%'],
  ['55%', '66%'],
  ['48%', '62%'],
  ['41%', '58%'],
] as const;

type Answer = {
  asked: string;
  places: FoundPlace[];
  available: boolean;
  provider: PlaceSearchResult['provider'] | null;
};

/**
 * Find a place and put it in a day — the canvas design "Phone · Add a place — combo": Variant C's
 * header (the stop being asked about as a ticket, then the search and the chips), Variant A's ruled
 * list of what was found, and Variant B's place card without its map.
 *
 * **No map, on purpose.** B drew the answer as numbered pins over a map and the place card opened on
 * a strip of one. The list answers "which of these, and what does it cost my day" in a column a
 * thumb can scan, and the stop card already says whose neighbourhood it is; the map was a second
 * answer to the same question, two MapViews' worth of tiles and markers behind a form sheet.
 *
 * **Two questions, and the app answers both before asking.** Which day a place belongs to is
 * geometry — distance to each day's centroid, normalised by that day's own radius — and what
 * time it should get is arithmetic over the times already in that day. Neither is a judgement
 * call worth a model round trip, and both already exist in this repo as tested TypeScript, which
 * is what `@/lib/addPlace` imports.
 *
 * The day you were reading wins over the geometry. Geometry only decides when nobody has an
 * opinion — the recommendation is a starting point on a picker, never a decision taken for you.
 *
 * The body of the `trip/[id]/add` form-sheet route (see `lib/tripSheets.ts`), which runs with the
 * stack's header off: the bar here is the only one. Mounting with the route is the whole reset —
 * the query, the results and the chosen place start empty every time.
 */
export function AddPlaceSheet({
  onClose,
  itinerary,
  dayIndex,
  centre,
  at,
  onAdd,
}: {
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
   * middle, over every kind of place rather than one. Everything past the results — the card,
   * the day, the slot, the add — is the browse's, unchanged.
   *
   * The `name` is required because it is the whole difference between this and pressing open map:
   * the question has a subject, and the sheet says whose neighbourhood it is showing.
   */
  at?: { lat: number; lng: number; name: string } | null;
  onAdd: (next: Itinerary, placeName: string) => Promise<boolean>;
}) {
  const fonts = usePolarFonts();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();

  // No category when asking about a stop's surroundings: "what else is here" is a question about
  // every kind of place at once, and the route reads an absent category as the union of all of
  // them. The chips stay either way — they are how you narrow a busy corner to cafes.
  const [category, setCategory] = useState<PlaceCategory | null>(at ? null : 'cafe');
  const [query, setQuery] = useState('');
  // An empty stop's way out: its block had nothing, so ask the whole day's neighbourhood instead.
  const [wide, setWide] = useState(false);
  // Try again after a busy search. Part of the question, so pressing it is asking anew.
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<FoundPlace | null>(null);
  const [day, setDay] = useState(dayIndex);
  const [slot, setSlot] = useState<TimeOfDay>('Afternoon');
  const [adding, setAdding] = useState<string | null>(null);
  // Which question, and which place's card, a failed add was raised under. A new search, another
  // chip, or leaving the card is a different question, and the error does not follow it there.
  const [failedAt, setFailedAt] = useState<string | null>(null);

  const probe = wide ? null : (at ?? null);
  /**
   * What is being asked, as one string.
   *
   * The results are stored *with the question they answer*, so "still searching" is derived by
   * comparing the two rather than held as its own state — which is what keeps this effect free
   * of a synchronous `setState`. It also makes a stale response harmless: one that lands after
   * the question moved on simply no longer matches.
   */
  const asked = `${wide ? 'day' : ''}|${category ?? ''}|${query.trim()}|${attempt}`;
  const [answer, setAnswer] = useState<Answer | null>(null);
  // Where the list was scrolled when a place was opened, stored with the answer it measures so Back
  // lands on the row that was opened, and a new answer starts at its top.
  // Raw offsets as the ScrollView reports them; null until the list has been scrolled at all.
  const [back, setBack] = useState<{ asked: string; y: number | null }>({ asked: '', y: null });
  const listY = useRef<number | null>(null);

  // Primitives, never the `centre` object: the parent builds it inline, so a new identity every
  // render would restart the debounce on every render and never actually search.
  // The asked-about stop wins over the day's middle — it is the more specific thing to search
  // around, and it is the only one there is when the day has no stops to have a middle.
  const origin = probe ?? centre;
  const lat = origin?.lat;
  const lng = origin?.lng;
  const radius = probe ? PROBE_RADIUS_M : SEARCH_RADIUS_M;

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
        provider: result?.provider ?? null,
      });
    }, 320);
    return () => clearTimeout(run);
  }, [lat, lng, asked, query, category, radius]);

  const searching = answer?.asked !== asked;
  const places = !searching && answer ? answer.places : NO_PLACES;
  const failKey = `${asked}#${chosen?.id ?? ''}`;
  const failed = failedAt === failKey;

  // VoiceOver hears nothing from `accessibilityLiveRegion`, which is Android's alone, so the answer
  // is announced here on both: how many were found, nothing, or that search could not be reached.
  // Only an answer to the question on screen; a stale one landing late says nothing.
  useEffect(() => {
    if (!answer || answer.asked !== asked) return;
    AccessibilityInfo.announceForAccessibility(foundLine(answer.available, answer.places.length));
  }, [answer, asked]);

  const near = probe?.name ?? `Day ${dayIndex + 1}`;
  const title = wide ? `Around Day ${dayIndex + 1}` : at ? `Near ${at.name}` : 'Add a stop';
  const within = `places within ${describeDistance(radius)}`;
  const chip = formatDayChip(itinerary.days[dayIndex]?.date ?? '');
  // The stop's own clock time, found in the day it came from: the route's params carry only where
  // it is and what it is called. Matched on the exact coordinates, which survive the trip through
  // the URL unchanged (a number's string form round-trips); no match, and the ticket has no time.
  const probeTime = probe
    ? itinerary.days[dayIndex]?.stops.find((stop) => stop.lat === probe.lat && stop.lng === probe.lng)?.time
    : undefined;

  function open(place: FoundPlace) {
    setBack({ asked, y: listY.current });
    // The day being read wins; geometry only answers when there is no day in context. Here there
    // always is one, so the suggestion is a fallback rather than the rule.
    setDay(dayIndex ?? suggestDay(itinerary, place) ?? 0);
    setSlot(suggestTimeOfDay(place));
    setChosen(place);
  }

  async function add(place: FoundPlace, toDay: number, when: TimeOfDay) {
    const key = failKey;
    setAdding(place.id);
    setFailedAt(null);
    const ok = await onAdd(addPlaceToDay(itinerary, toDay, place, when), place.name);
    setAdding(null);
    if (ok) onClose();
    else setFailedAt(key);
  }

  // The one ScrollView's position, kept by hand because it is never remounted (see the return).
  // A place's card opens at its top; Back puts the list where it was left, if it is still the same
  // answer. After the commit, so the list being returned to is laid out before it is scrolled.
  //
  // **Its top is not y 0.** The form sheet insets the content below the header, so resting at the
  // top is `-inset`, and `scrollTo({ y: 0 })` parks the content under "‹ Results" and Cancel,
  // taking their taps. The inset is read off the scroll events; before any, nothing has moved
  // and the view still rests at its own top, so there is nothing to do.
  const scroller = useRef<ScrollView>(null);
  const insetTop = useRef<number | null>(null);
  useEffect(() => {
    const top = insetTop.current;
    if (top === null) return;
    const y = !chosen && back.asked === asked && back.y !== null ? back.y : -top;
    scroller.current?.scrollTo({ y, animated: false });
    // `asked` and `back` are read, not watched: only opening and leaving a card moves the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  let body: ReactNode;
  if (!origin) {
    body = (
      <View style={styles.nowhere}>
        <Text maxFontSizeMultiplier={1.6} style={styles.muted}>
          This day has nowhere to search around yet.
        </Text>
      </View>
    );
  } else if (chosen) {
    body = (
      <PlaceDetail
        key={chosen.id}
        place={chosen}
        itinerary={itinerary}
        day={day}
        slot={slot}
        onDay={setDay}
        onSlot={setSlot}
        distanceFrom={probe}
        busy={adding !== null}
        failed={failed}
        onAdd={() => add(chosen, day, slot)}
        fonts={fonts}
        reduced={reduced}
      />
    );
  } else {
    body = (
      <>
        {/* The header's second half — the stop, the search, the chips — inside the ScrollView,
            because the form sheet allows the body one child (see below). It scrolls away with a
            long list, which is what a long list wants. */}
        <View style={styles.head}>
          <Ticket
            time={probeTime}
            name={probe ? probe.name : wide ? title : `Day ${dayIndex + 1}`}
            sub={
              probe
                ? `${dayLabel(itinerary, dayIndex)} · ${within}`
                : [chip ? `${chip.weekday} ${chip.dayOfMonth}` : '', within].filter(Boolean).join(' · ')
            }
            tag={probe ? 'Nearby' : null}
            fonts={fonts}
          />
          <SearchField query={query} onQuery={setQuery} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.chipRow}
            contentContainerStyle={styles.chips}>
            <Chip label="All nearby" on={category === null} onPress={() => setCategory(null)} />
            {PLACE_CATEGORIES.map((kind) => (
              <Chip
                key={kind}
                label={LABELS[kind]}
                on={category === kind}
                onPress={() => setCategory(category === kind ? null : kind)}
              />
            ))}
          </ScrollView>
        </View>

        <View style={styles.body}>
          {searching ? (
            <Searching line={searchingLine(category, query, near)} reduced={reduced} />
          ) : !answer?.available ? (
            <Nothing
              title="Couldn’t reach search"
              body="Check your connection, or try again in a moment."
              action="Try again"
              onAction={() => setAttempt((n) => n + 1)}
              fonts={fonts}
            />
          ) : places.length === 0 ? (
            <Empty
              query={query.trim()}
              probe={probe}
              day={dayIndex}
              category={category}
              canWiden={!!centre}
              onClear={() => setQuery('')}
              onWiden={() => setWide(true)}
              onAnyKind={() => setCategory(null)}
              fonts={fonts}
            />
          ) : (
            <Animated.View entering={reduced ? undefined : FadeIn.duration(220)}>
              <View style={styles.countRow}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.count, styles.grow]}>
                  {`${places.length} ${places.length === 1 ? 'place' : 'places'} ${probe ? 'within a short walk' : 'nearby'}`}
                </Text>
                {/* "detour", not the canvas's "walk it adds": a hop too far to walk is costed by
                    tram, and each row already says "adds" (see `detourShort`). */}
                <Text maxFontSizeMultiplier={1.4} style={styles.count}>
                  Time · detour
                </Text>
              </View>
              <View style={styles.list}>
                {places.map((place) => (
                  <Row key={place.id} place={place} itinerary={itinerary} dayIndex={dayIndex} onOpen={() => open(place)} />
                ))}
              </View>
              {answer?.provider === 'apple' ? <SourceNote /> : null}
            </Animated.View>
          )}
        </View>
      </>
    );
  }

  return (
    <>
      {/* Two children, header then the ScrollView, and the header not flattened: that is the
          shape react-native-screens' form sheet sizes to the detent (`RNSScreenContentWrapper`
          coerces a ScrollView at index 0 or 1 and gives up past two siblings). A wrapping View,
          or a header flattened into its Text and Pressable, left the ScrollView at the sheet's
          top, over the title and over Done. So every view the body has — the stop card, the
          search, the list, a place's card — lives inside that one ScrollView.

          And it is the *same* ScrollView for all of them, never remounted: the wrapper places the
          one it found when the sheet opened, so a card that brought its own ScrollView started at
          the sheet's top, over the header, and took "‹ Results" and Cancel's taps (hidden while
          the card opened on a map strip; plain once the strip went). Hence the one `ref` and the
          hand-kept scroll position above. */}
      <Header
        // The results' stop card says whose neighbourhood this is, so their bar only names the task.
        title={chosen || !origin ? title : 'Add a place'}
        sub={chosen ? `Adding to ${dayLabel(itinerary, day)}` : origin ? null : `Adding to ${dayLabel(itinerary, dayIndex)}`}
        // The results rule their header under the chips instead, so bar, stop and search read as one.
        ruled={!!chosen || !origin}
        onBack={
          chosen
            ? () => {
                setChosen(null);
              }
            : null
        }
        onCancel={onClose}
      />
      <ScrollView
        ref={scroller}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        scrollEventThrottle={32}
        onScroll={(event) => {
          insetTop.current = event.nativeEvent.contentInset.top;
          // Only the list's position is worth coming back to.
          if (!chosen) listY.current = event.nativeEvent.contentOffset.y;
        }}
        contentContainerStyle={{ paddingBottom: insets.bottom + PolarSpace.s5 }}>
        {body}
      </ScrollView>
    </>
  );
}

const NO_PLACES: FoundPlace[] = [];

/**
 * Three lanes that never overlap: back, title, Cancel.
 *
 * The sheet this replaces drew "‹ Results" as a pill in the content and the chips under a title
 * that was free to run under both — the two collided on a device. Here the side lanes are equal and
 * fixed, so the title is centred between them and ellipsizes inside its own lane; nothing can be
 * drawn over anything else at any text size, because a row lays its children side by side.
 *
 * Cancel, not Done: closing here drops the search and any place chosen, and adds nothing.
 */
function Header({
  title,
  sub,
  ruled,
  onBack,
  onCancel,
}: {
  title: string;
  sub: string | null;
  ruled: boolean;
  onBack: (() => void) | null;
  onCancel: () => void;
}) {
  // Capped as well as floored: at the largest text sizes Cancel and Results grow, and uncapped they
  // would take the whole row and leave the title no lane at all.
  const lane = { maxWidth: useWindowDimensions().width * 0.4 };
  return (
    <View collapsable={false} style={[styles.bar, ruled && styles.barRuled]}>
      <View style={[styles.lane, lane]}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to results"
            hitSlop={6}
            style={({ pressed }) => [styles.back, pressed && styles.dim]}>
            <SymbolView name="chevron.left" size={17} weight="semibold" tintColor={Polar.signal} />
            <Text maxFontSizeMultiplier={1.3} style={styles.backText}>
              Results
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.centre}>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {sub ? (
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.sub}>
            {sub}
          </Text>
        ) : null}
      </View>
      <View style={[styles.lane, styles.laneEnd, lane]}>
        <SheetDone onPress={onCancel} label="Cancel" />
      </View>
    </View>
  );
}

/**
 * The stop being asked about, as a ticket: its time, its name, the day, how far "near" reaches.
 * Signal down its left edge, the way a chosen stop is marked on the day. A label, not a control —
 * one accessible element, read as the sentence it is.
 */
function Ticket({
  time,
  name,
  sub,
  tag,
  fonts,
}: {
  time: string | undefined;
  name: string;
  sub: string;
  tag: string | null;
  fonts: boolean;
}) {
  return (
    <View style={styles.ticket} accessible accessibilityLabel={[time, name, sub].filter(Boolean).join(', ')}>
      {time ? (
        <Text maxFontSizeMultiplier={1.4} style={styles.ticketTime}>
          {time}
        </Text>
      ) : null}
      <View style={styles.grow}>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.ticketName, fonts && styles.condFont]}>
          {name}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.ticketSub}>
          {sub}
        </Text>
      </View>
      {tag ? (
        <Text maxFontSizeMultiplier={1.3} style={[styles.ticketTag, fonts && styles.italicFont]}>
          {tag}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A search field as iOS draws one — magnifier, placeholder from the left, clear button. The clear
 * button is drawn here rather than by `clearButtonMode`, which is iOS-only and only while editing;
 * a query left in the field after the keyboard goes is still worth clearing. Its rule turns signal
 * while the field has the keyboard, the one cue that typing goes here.
 */
function SearchField({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.search, focused && styles.searchFocused]}>
      <SymbolView name="magnifyingglass" tintColor={Polar.nightText2} size={16} />
      <TextInput
        value={query}
        onChangeText={onQuery}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search by name"
        placeholderTextColor={Polar.nightText2}
        selectionColor={Polar.signal}
        keyboardAppearance="dark"
        maxFontSizeMultiplier={1.4}
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search by name"
        style={styles.searchInput}
      />
      {query ? (
        <Pressable onPress={() => onQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} style={styles.clear}>
          <SymbolView name="xmark" size={10} weight="bold" tintColor={Polar.deep} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** One kind of place: a hairline on the night, and the chosen one ice with ink, the way every
 *  chosen thing on the night is. */
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.dim]}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.chipText, on && styles.chipTextOn]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One found place, as a ruled row: its name, the clock time it would land at, what it is and where,
 * and on the right what it would cost the day to go there.
 *
 * The time and the detour are worked out at the defaults the place's card opens on — `slotPreview`
 * and `insertionDetour` are the same two it calls — so the row is a preview of the decision, not a
 * different answer to it. A list of cafes is a search engine; the app has already worked out where
 * each one goes, and this is where it says so. The whole row opens the card.
 */
function Row({
  place,
  itinerary,
  dayIndex,
  onOpen,
}: {
  place: FoundPlace;
  itinerary: Itinerary;
  dayIndex: number;
  onOpen: () => void;
}) {
  const slot = suggestTimeOfDay(place);
  const preview = slotPreview(itinerary, dayIndex, slot);
  const detour = insertionDetour(itinerary, dayIndex, place, slot);
  const fit = slotLine(preview.time, preview.tight, detour);
  // The same line the stop will carry once it is added: the kind, then the street when there is one.
  const line = describePlace(place);

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      // Everything the row shows, since a label replaces what is under it rather than adding to it.
      accessibilityLabel={[place.name, line].filter(Boolean).join(', ')}
      accessibilityHint={`Would land at ${fit}. Opens the day and time.`}
      style={({ pressed }) => [styles.row, pressed && styles.pressedFill]}>
      <View style={[styles.rowMain, styles.grow]}>
        <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.rowName}>
          {place.name}
        </Text>
        <View style={styles.fit}>
          <Text maxFontSizeMultiplier={1.4} style={styles.fitTime}>
            {preview.time}
          </Text>
          {preview.tight ? (
            <Text maxFontSizeMultiplier={1.4} style={styles.tight}>
              tight fit
            </Text>
          ) : null}
        </View>
        {line ? (
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.rowLine}>
            {line}
          </Text>
        ) : null}
      </View>
      {/* Capped rather than a fixed column: "on the way" and "adds 12 min" are different widths,
          and at large text a fixed one would clip the minutes, the figure the column exists for. */}
      <View style={styles.rowCost}>
        <DetourNote detour={detour} />
      </View>
      <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={Polar.nightText2} />
    </Pressable>
  );
}

/** "adds 6 min" beside a walker, or a tram for a hop too far to walk; nothing with nothing to say. */
function DetourNote({ detour, light = false }: { detour: Detour | null; light?: boolean }) {
  const words = detourShort(detour);
  if (!words) return null;
  const tint = light ? Polar.charcoal : Polar.nightText2;
  return (
    <View style={styles.detour}>
      {detour?.mode === 'walk' ? (
        <SymbolView name="figure.walk" size={12} tintColor={tint} />
      ) : detour?.mode === 'transit' ? (
        <SymbolView name="tram" size={12} tintColor={tint} />
      ) : null}
      <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[styles.detourText, { color: tint }]}>
        {words}
      </Text>
    </View>
  );
}

/** `CAFE · 150 M` — the distance only when there is a stop to measure from, not a day's middle. */
function eyebrow(place: FoundPlace, from: { lat: number; lng: number } | null): string {
  const kind = KINDS[place.category] ?? 'Place';
  return from ? `${kind} · ${describeDistance(metresBetween(from, place))}` : kind;
}

/** What is being looked for, and where the answer will go: the list's rows in outline, breathing. */
function Searching({ line, reduced }: { line: string; reduced: boolean }) {
  const glow = useSharedValue(0.45);
  useEffect(() => {
    if (reduced) return;
    glow.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [glow, reduced]);
  const pulse = useAnimatedStyle(() => ({ opacity: reduced ? 0.7 : glow.value }));

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={line} style={styles.searching}>
      <View style={styles.searchingLine}>
        <ActivityIndicator size="small" color={Polar.ice} />
        <Text maxFontSizeMultiplier={1.6} style={[styles.muted, styles.grow]}>
          {line}
        </Text>
      </View>
      <Animated.View style={[styles.list, pulse]}>
        {BONES.map(([title, rest], index) => (
          <View key={index} style={styles.skeleton}>
            <View style={[styles.bone, styles.boneLead, { width: title }]} />
            <View style={[styles.bone, { width: '38%' }]} />
            <View style={[styles.bone, { width: rest }]} />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

/**
 * Nothing found, said about the place rather than the search.
 *
 * A stop out on a headland or up a mountain legitimately has nothing mapped within a block of it.
 * That is an answer about the place, not a failure, and it must not read like the category one —
 * there is no category. Each case offers the one thing that would widen the question.
 */
function Empty({
  query,
  probe,
  day,
  category,
  canWiden,
  onClear,
  onWiden,
  onAnyKind,
  fonts,
}: {
  query: string;
  probe: { name: string } | null;
  day: number;
  category: PlaceCategory | null;
  canWiden: boolean;
  onClear: () => void;
  onWiden: () => void;
  onAnyKind: () => void;
  fonts: boolean;
}) {
  if (query) {
    return (
      <Nothing
        title={probe ? `No “${query}” within a short walk` : `No “${query}” near Day ${day + 1}`}
        body="Places are listed by the name they trade under. Try a shorter word."
        action="Clear search"
        onAction={onClear}
        fonts={fonts}
      />
    );
  }
  if (probe) {
    return (
      <Nothing
        title={`Nothing else mapped within a short walk of ${probe.name}`}
        body="A stop on the water or up a hill legitimately has little around it."
        action={canWiden ? `Search around all of Day ${day + 1}` : null}
        onAction={onWiden}
        fonts={fonts}
      />
    );
  }
  return (
    <Nothing
      title="Nothing of that kind nearby"
      body="Try another kind, or a name."
      action={category ? 'Show every kind' : null}
      onAction={onAnyKind}
      fonts={fonts}
    />
  );
}

function Nothing({
  title,
  body,
  action,
  onAction,
  fonts,
}: {
  title: string;
  body: string;
  action: string | null;
  onAction: () => void;
  fonts: boolean;
}) {
  return (
    // No live region: the sheet announces the answer itself, on both platforms (see `foundLine`).
    <View style={styles.nothing}>
      <View style={styles.nothingMark}>
        <SymbolView name="mappin" size={18} tintColor={Polar.nightText2} />
      </View>
      <Text maxFontSizeMultiplier={1.4} style={[styles.nothingTitle, fonts && styles.displayFont]}>
        {title}
      </Text>
      <Text maxFontSizeMultiplier={1.6} style={[styles.muted, styles.centred]}>
        {body}
      </Text>
      {action ? (
        <Pressable onPress={onAction} accessibilityRole="button" style={({ pressed }) => [styles.quiet, pressed && styles.quietPressed]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.quietText}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Where the places came from, said once under the list: Apple Maps answered, not TripMate. */
function SourceNote() {
  return (
    <View style={styles.source}>
      <SymbolView name="map" size={13} tintColor={Polar.nightText2} />
      <Text maxFontSizeMultiplier={1.6} style={styles.sourceText}>
        Places from Apple Maps
      </Text>
    </View>
  );
}

function Failure() {
  return (
    <Text accessibilityRole="alert" maxFontSizeMultiplier={1.6} style={styles.failure}>
      That didn&rsquo;t save. Check your connection and try again.
    </Text>
  );
}

/** "Finding cafes near Day 1…", "Finding “Pastéis” near Belém Tower…". */
function searchingLine(category: PlaceCategory | null, query: string, near: string): string {
  const what = query.trim() ? `“${query.trim()}”` : category ? (LABELS[category] ?? category).toLowerCase() : 'places';
  return `Finding ${what} near ${near}…`;
}

/**
 * One place, and the two decisions about it.
 *
 * Variant B's card, without the strip of map it opened on: the name leads, and the detour the
 * eyebrow names is the line that map used to draw. Each slot shows the clock time it would
 * actually produce, not just its name: "Afternoon" is a
 * guess, "2:30 PM" is the answer. A slot with no clear gap says so rather than quietly
 * shoulder-to-shouldering the day.
 */
function PlaceDetail({
  place,
  itinerary,
  day,
  slot,
  onDay,
  onSlot,
  distanceFrom,
  busy,
  failed,
  onAdd,
  fonts,
  reduced,
}: {
  place: FoundPlace;
  itinerary: Itinerary;
  day: number;
  slot: TimeOfDay;
  onDay: (day: number) => void;
  onSlot: (slot: TimeOfDay) => void;
  distanceFrom: { lat: number; lng: number } | null;
  busy: boolean;
  failed: boolean;
  onAdd: () => void;
  fonts: boolean;
  reduced: boolean;
}) {
  const detour = insertionDetour(itinerary, day, place, slot);
  const time = slotPreview(itinerary, day, slot).time;
  const head = [eyebrow(place, distanceFrom), detourShort(detour)].filter(Boolean).join(' · ');

  // Content only: the sheet's one ScrollView holds it (see `AddPlaceSheet`'s return).
  return (
    <Animated.View entering={reduced ? undefined : FadeIn.duration(220)}>
      <View style={styles.detail}>
        <View style={styles.hero}>
          <Text maxFontSizeMultiplier={1.4} style={styles.eyebrow}>
            {head}
          </Text>
          <Text maxFontSizeMultiplier={1.3} accessibilityRole="header" style={[styles.heroName, fonts && styles.condFont]}>
            {place.name}
          </Text>
          {place.address ? (
            <Text maxFontSizeMultiplier={1.6} style={styles.muted}>
              {place.address}
            </Text>
          ) : null}
        </View>

        <PlaceFacts place={place} fonts={fonts} />

        <Text maxFontSizeMultiplier={1.4} style={[styles.label, fonts && styles.condFont]}>
          Which day
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="radiogroup"
          accessibilityLabel="Which day"
          style={styles.daysRow}
          contentContainerStyle={styles.days}>
          {itinerary.days.map((plan, index) => {
            const chip = formatDayChip(plan.date ?? '');
            const on = index === day;
            return (
              <Pressable
                key={index}
                onPress={() => onDay(index)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={dayLabel(itinerary, index)}
                style={({ pressed }) => [styles.day, on && styles.iceCell, pressed && !on && styles.cellPressed]}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.cellCaps, on && styles.onIceSoft]}>
                  {chip?.weekday ?? 'Day'}
                </Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.dayNumber, on && styles.onIce]}>
                  {chip?.dayOfMonth ?? index + 1}
                </Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.dayOrdinal, on && styles.onIceSoft]}>
                  {chip ? `Day ${index + 1}` : ' '}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text maxFontSizeMultiplier={1.4} style={[styles.label, fonts && styles.condFont]}>
          When
        </Text>
        <View style={styles.slots} accessibilityRole="radiogroup" accessibilityLabel="When">
          {SLOTS.map((option) => {
            const preview = slotPreview(itinerary, day, option);
            // Per slot, not per place: the same café costs a different detour depending on which
            // two stops it would end up between.
            const cost = insertionDetour(itinerary, day, place, option);
            const on = option === slot;
            return (
              <Pressable
                key={option}
                onPress={() => onSlot(option)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${option}, ${slotLine(preview.time, preview.tight, cost)}`}
                style={({ pressed }) => [styles.slot, on && styles.iceCell, on && styles.slotOn, pressed && !on && styles.cellPressed]}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.cellCaps, on && styles.onIceSoft]}>
                  {option}
                </Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.slotTime, on && styles.onIce]}>
                  {preview.time}
                </Text>
                <DetourNote detour={cost} light={on} />
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={[preview.tight ? styles.tight : styles.fits, on && (preview.tight ? styles.tightOnIce : styles.fitsOnIce)]}>
                  {preview.tight ? 'Tight fit' : 'Fits'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {failed ? <Failure /> : null}

        <SignalButton
          large
          title={`Add to ${dayLabel(itinerary, day)} · ${time}`}
          onPress={onAdd}
          busy={busy}
          disabled={busy}
          style={styles.addLarge}
        />
      </View>
    </Animated.View>
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
 * A phone number and a website are the two facts worth pressing, so they are tiles, side by side;
 * a rejected `openURL` is swallowed, because a device with no dialler is not something to report
 * to somebody reading about a cafe. The rest are a ruled list. Hours go in exactly as OSM wrote
 * them, unparsed: this is where the long grammar the stop's own line leaves out finally has room.
 */
function PlaceFacts({ place, fonts }: { place: FoundPlace; fonts: boolean }) {
  const links: { label: string; value: string; href: string; icon: 'phone' | 'globe' }[] = [];
  if (place.phone) links.push({ label: 'Call', value: place.phone, href: `tel:${place.phone}`, icon: 'phone' });
  if (place.website) links.push({ label: 'Website', value: tidyUrl(place.website), href: place.website, icon: 'globe' });

  const rows: { label: string; value: string }[] = [];
  // **"listed", not "Hours".** This is an OSM `opening_hours` tag with no freshness metadata
  // attached — it may have been edited last week or in 2016, and the UI has no way to tell. A
  // bare "Hours" promotes a database row into a guarantee about a door somebody is walking to.
  // One word states the basis instead. The cards stay unqualified: a caveat on every result is
  // noise, and this is where the decision is actually made.
  if (place.openingHours) rows.push({ label: 'Hours listed', value: place.openingHours });
  if (place.outdoorSeating) rows.push({ label: 'Seating', value: 'Tables outside' });
  if (place.wheelchair) rows.push({ label: 'Access', value: ACCESS[place.wheelchair] });
  if (place.rating) rows.push({ label: 'Rating', value: `${place.rating.toFixed(1)} out of 5` });

  if (links.length === 0 && rows.length === 0) return null;

  return (
    <>
      {links.length ? (
        <View style={styles.tiles}>
          {links.map((link) => (
            <Pressable
              key={link.label}
              onPress={() => Linking.openURL(link.href).catch(() => {})}
              accessibilityRole="link"
              accessibilityLabel={`${link.label}, ${link.value}`}
              style={({ pressed }) => [styles.tile, pressed && styles.pressedFill]}>
              <SymbolView
                name={link.icon === 'phone' ? { ios: 'phone.fill', android: 'call' } : { ios: 'globe', android: 'language' }}
                size={18}
                tintColor={Polar.signal}
              />
              <Text maxFontSizeMultiplier={1.4} style={styles.tileLabel}>
                {link.label}
              </Text>
              <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.tileValue}>
                {link.value}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {rows.length ? (
        <View style={styles.facts}>
          {rows.map((row) => (
            <View key={row.label} style={styles.fact} accessible accessibilityLabel={`${row.label}, ${row.value}`}>
              {/* A fixed column so the values line up down the card rather than starting wherever
                  their label happens to end. Wide enough for "Hours listed". */}
              <Text maxFontSizeMultiplier={1.4} style={[styles.factLabel, fonts && styles.condFont]}>
                {row.label}
              </Text>
              <Text maxFontSizeMultiplier={1.6} style={[styles.factValue, styles.grow]}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
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
  grow: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.6 },
  centred: { textAlign: 'center' },
  muted: { fontFamily: PolarFonts.sans, fontSize: 13, lineHeight: 19, color: Polar.nightText2 },
  pressedFill: { backgroundColor: Polar.frost10 },
  // Applied only once `usePolarFonts` says Oswald and the display cut are in: an unloaded family
  // is not an error in RN, it is a silent fallback.
  condFont: { fontFamily: PolarFonts.condensed },
  displayFont: { fontFamily: PolarFonts.display },
  // The italic is its own file, so the style that asked for a synthesised slant comes off with it.
  italicFont: { fontFamily: PolarFonts.displayItalic, fontStyle: 'normal' },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 53,
    paddingHorizontal: GUTTER,
    paddingTop: PolarSpace.s2,
    paddingBottom: 6,
    backgroundColor: Polar.deep,
  },
  barRuled: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  lane: { minWidth: LANE, flexShrink: 0, alignItems: 'flex-start', justifyContent: 'center' },
  laneEnd: { alignItems: 'flex-end' },
  centre: { flex: 1, minWidth: 0, alignItems: 'center' },
  title: { fontFamily: PolarFonts.sansSemi, fontSize: 15, lineHeight: 20, color: Polar.ice },
  sub: { fontFamily: PolarFonts.sans, fontSize: 12, lineHeight: 16, color: Polar.nightText2 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, marginLeft: -6 },
  backText: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.signal },

  nowhere: { padding: GUTTER },

  head: {
    gap: 12,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
  },
  ticket: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: GUTTER,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: PolarRadius.card,
    backgroundColor: FROST_06,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: LINE,
    borderLeftWidth: 3,
    borderLeftColor: Polar.signal,
  },
  ticketTime: { fontFamily: PolarFonts.sans, fontSize: 13, color: Polar.nightText2, fontVariant: ['tabular-nums'] },
  ticketName: {
    fontFamily: PolarFonts.sansSemi,
    fontSize: 20,
    lineHeight: 25,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: Polar.ice,
  },
  ticketSub: { fontFamily: PolarFonts.sans, fontSize: 12, lineHeight: 16, color: Polar.nightText2 },
  ticketTag: { fontFamily: PolarFonts.sans, fontStyle: 'italic', fontSize: 16, color: Polar.signal },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingVertical: 6,
    marginHorizontal: GUTTER,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: PolarRadius.sm,
    backgroundColor: FROST_06,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: LINE,
  },
  searchFocused: { borderColor: Polar.signal },
  // Sized by its own text and centred by the row, not stretched to it: stretched, the field kept the
  // row's height while the 1.4x text inside it grew, and at AX3 the placeholder's descenders were cut.
  searchInput: { flex: 1, paddingVertical: 0, fontFamily: PolarFonts.sans, fontSize: 15, color: Polar.ice },
  clear: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Polar.frost20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { flexGrow: 0 },
  chips: { gap: 6, paddingHorizontal: GUTTER },
  chip: {
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: PolarRadius.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Polar.frost20,
  },
  chipOn: { backgroundColor: Polar.ice, borderColor: Polar.ice },
  chipText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.nightText2 },
  chipTextOn: { color: Polar.ink },

  body: { paddingHorizontal: GUTTER },
  countRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingTop: PolarSpace.s3, paddingBottom: 8 },
  count: {
    fontFamily: PolarFonts.sansSemi,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: Polar.nightText2,
    fontVariant: ['tabular-nums'],
  },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LINE },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
  },
  rowMain: { gap: 2 },
  rowName: { fontFamily: PolarFonts.sansSemi, fontSize: 17, lineHeight: 22, color: Polar.ice },
  rowLine: { fontFamily: PolarFonts.sans, fontSize: 12.5, lineHeight: 17, color: Polar.nightText2 },
  rowCost: { maxWidth: '38%', alignItems: 'flex-end' },
  // Wraps rather than truncating once large text fills the row.
  fit: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, rowGap: 2 },
  fitTime: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ice, fontVariant: ['tabular-nums'] },
  tight: { fontFamily: PolarFonts.sansSemi, fontSize: 11.5, color: Polar.alertNight },
  tightOnIce: { color: Polar.alertText },
  fits: { fontFamily: PolarFonts.sansSemi, fontSize: 11.5, color: Polar.route },
  fitsOnIce: { color: FITS_ON_ICE },
  detour: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  detourText: { fontFamily: PolarFonts.sans, fontSize: 12.5, flexShrink: 1 },
  source: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 18 },
  sourceText: { fontFamily: PolarFonts.sans, fontSize: 12, color: Polar.nightText2 },
  failure: {
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: PolarSpace.s3,
    borderLeftWidth: 2,
    borderLeftColor: Polar.alertNight,
    fontFamily: PolarFonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: Polar.alertNight,
  },

  searching: { gap: 10, paddingTop: PolarSpace.s3 },
  searchingLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  skeleton: { gap: 7, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  bone: { height: 10, borderRadius: 2, backgroundColor: Polar.frost10 },
  boneLead: { height: 14 },

  nothing: { alignItems: 'center', gap: 8, paddingHorizontal: PolarSpace.s2, paddingTop: PolarSpace.s4 },
  nothingMark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Polar.frost20,
    marginBottom: 2,
  },
  nothingTitle: { maxWidth: 300, textAlign: 'center', fontSize: 22, lineHeight: 25, color: Polar.ice },
  quiet: {
    minHeight: 40,
    marginTop: 6,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: PolarRadius.hairline,
    backgroundColor: Polar.frost10,
  },
  quietPressed: { backgroundColor: Polar.frost20 },
  quietText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ice },

  detail: { paddingHorizontal: GUTTER },
  eyebrow: {
    fontFamily: PolarFonts.sansSemi,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    color: Polar.nightText2,
  },
  hero: { gap: 6, paddingTop: GUTTER },
  heroName: { fontFamily: PolarFonts.sansSemi, fontSize: 34, lineHeight: 38, textTransform: 'uppercase', color: Polar.ice },
  tiles: { flexDirection: 'row', gap: 8, marginTop: GUTTER },
  tile: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: PolarRadius.card,
    backgroundColor: FROST_06,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: LINE,
  },
  tileLabel: { marginTop: 4, fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ice },
  tileValue: { fontFamily: PolarFonts.sans, fontSize: 12, color: Polar.nightText2 },
  facts: { marginTop: GUTTER, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LINE },
  fact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 44,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
  },
  factLabel: { ...PolarType.label, fontFamily: PolarFonts.sansSemi, width: 92, paddingTop: 2, color: Polar.nightText2 },
  factValue: { fontFamily: PolarFonts.sans, fontSize: 15, lineHeight: 20, color: Polar.ice },
  label: { ...PolarType.label, fontFamily: PolarFonts.sansSemi, marginTop: PolarSpace.s4, marginBottom: 10, color: Polar.nightText2 },

  daysRow: { marginHorizontal: -GUTTER },
  days: { gap: 6, paddingHorizontal: GUTTER },
  day: {
    width: 62,
    alignItems: 'center',
    gap: 1,
    paddingTop: 8,
    paddingBottom: 7,
    borderRadius: PolarRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: LINE,
  },
  iceCell: { backgroundColor: Polar.ice, borderColor: Polar.ice },
  cellPressed: { backgroundColor: FROST_06 },
  cellCaps: {
    fontFamily: PolarFonts.sansSemi,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: Polar.nightText2,
  },
  dayNumber: { fontFamily: PolarFonts.sans, fontSize: 21, lineHeight: 26, color: Polar.ice, fontVariant: ['tabular-nums'] },
  dayOrdinal: { fontFamily: PolarFonts.sans, fontSize: 10.5, color: Polar.nightText2 },
  onIce: { color: Polar.ink },
  onIceSoft: { color: Polar.charcoal },

  slots: { flexDirection: 'row', gap: 6 },
  slot: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 9,
    borderRadius: PolarRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: LINE,
  },
  // The chosen slot is ice, underlined in signal: chosen, and the one Add will use.
  slotOn: { borderBottomWidth: 3, borderBottomColor: Polar.signal, paddingBottom: 7 },
  slotTime: { fontFamily: PolarFonts.sans, fontSize: 18, lineHeight: 24, color: Polar.ice, fontVariant: ['tabular-nums'] },
  addLarge: { marginTop: PolarSpace.s4 },
});
