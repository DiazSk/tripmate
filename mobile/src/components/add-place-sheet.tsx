import Constants from 'expo-constants';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Marker, Polyline } from 'react-native-maps';
import Animated, { FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { searchPlaces } from '@/api/tripMateApi';
import { PLACE_CATEGORIES, type FoundPlace, type Itinerary, type PlaceCategory, type PlaceSearchResult } from '@/api/types';
import { BlurView } from '@/components/blur';
import { MARKER_SKEW_PT } from '@/components/day-map';
import MapView, { type MapViewRef } from '@/components/map-view';
import { SignalButton, usePolarFonts } from '@/components/polar-ui';
import { SheetDone } from '@/components/sheet-done';
import { SymbolView } from '@/components/symbol';
import { Polar, PolarFonts, PolarRadius, PolarSpace, PolarType } from '@/constants/polar';
import { MapObjectShadow } from '@/constants/theme';
import {
  KINDS,
  addPlaceToDay,
  describePlace,
  detourShort,
  foundLine,
  insertionDetour,
  insertionPath,
  slotLine,
  slotPreview,
  suggestDay,
  suggestTimeOfDay,
  type Detour,
  type TimeOfDay,
} from '@/lib/addPlace';
import { metresBetween } from '@/lib/anchors';
import { activeCard } from '@/lib/cardRail';
import { formatDayChip } from '@/lib/dayDisplay';
import { drawableStops, regionForStops } from '@/lib/mapRegion';
import { describeDistance } from '@/lib/savedPlaces';

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
const CARD_GAP = 10;
/** The search field and the chips float over the top of the map; pins are framed below them. */
const FLOAT_H = 104;
/** The place card's map, a strip across the top of it. */
const STRIP_H = 190;

/**
 * ponytail: the form sheet's height never reaches JS — react-native-screens sizes only the
 * ScrollView, natively — so the results map is sized from the window, and these are the header's
 * and the card tray's heights as drawn at the default text size. Off by a little, the ScrollView
 * absorbs it: a few points of scroll, or of ground under the tray. Measure them if a device shows
 * either.
 */
const HEADER_H = 64;
const TRAY_H = 200;
/** What iOS leaves above a large-detent sheet, below the status bar. */
const SHEET_TOP_GAP = 10;
const MAP_MIN = 240;

/** Night's own card fill and rule, a step under `Polar.frost10`. Not tokens because nothing else
 *  draws on the night at these alphas yet. */
const FROST_06 = 'rgba(255,255,255,0.06)';
const LINE = 'rgba(255,255,255,0.12)';
/** "Fits" on a chosen (ice) slot: the route's cyan does not read on white, so its dark green. */
const FITS_ON_ICE = '#1D6B3A';

type Answer = {
  asked: string;
  places: FoundPlace[];
  available: boolean;
  provider: PlaceSearchResult['provider'] | null;
};

/**
 * Find a place and put it in a day — Variant B, "Map", of the canvas design: the search drawn over
 * a map of what it found, the results as a rail of cards under it, one pin per card.
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
  const { width, height } = useWindowDimensions();

  // No category when asking about a stop's surroundings: "what else is here" is a question about
  // every kind of place at once, and the route reads an absent category as the union of all of
  // them. The chips stay on the map either way — they are how you narrow a busy corner to cafes.
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
  // Which card the rail rests on, stored with the answer it indexes so a new answer starts at 1.
  const [focus, setFocus] = useState({ asked: '', index: 0 });

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
  const focusIndex = focus.asked === asked ? focus.index : 0;
  const rail = useRef<FlatList<FoundPlace>>(null);
  // Set while a pin's press scrolls the rail: the animation passes over every card between, and
  // each would otherwise take the focus on its way past and flick the pin back.
  const pinning = useRef(false);
  const failKey = `${asked}#${chosen?.id ?? ''}`;
  const failed = failedAt === failKey;

  // VoiceOver hears nothing from `accessibilityLiveRegion`, which is Android's alone, so the answer
  // is announced here on both: how many were found, nothing, or that search could not be reached.
  // Only an answer to the question on screen; a stale one landing late says nothing.
  useEffect(() => {
    if (!answer || answer.asked !== asked) return;
    AccessibilityInfo.announceForAccessibility(foundLine(answer.available, answer.places.length));
  }, [answer, asked]);

  const cardWidth = Math.round(width * 0.82);
  const step = cardWidth + CARD_GAP;
  const mapHeight = Math.max(
    MAP_MIN,
    Math.round(height - Constants.statusBarHeight - SHEET_TOP_GAP - HEADER_H - TRAY_H - insets.bottom),
  );
  const near = probe?.name ?? `Day ${dayIndex + 1}`;
  const title = wide ? `Around Day ${dayIndex + 1}` : at ? `Near ${at.name}` : 'Add a stop';

  function open(place: FoundPlace) {
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

  function pin(index: number) {
    setFocus({ asked, index });
    // Cleared by the scroll's end, or by a finger taking the rail over. An unanimated jump fires
    // no end event, so it never sets the flag.
    pinning.current = !reduced;
    rail.current?.scrollToOffset({ offset: index * step, animated: !reduced });
  }

  let body: ReactNode;
  if (!origin) {
    body = (
      <ScrollView key="nowhere" contentContainerStyle={styles.nowhere}>
        <Text maxFontSizeMultiplier={1.6} style={styles.muted}>
          This day has nowhere to search around yet.
        </Text>
      </ScrollView>
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
        bottom={insets.bottom}
      />
    );
  } else {
    body = (
      <ScrollView
        key="results"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingBottom: insets.bottom }}>
        <View style={{ height: mapHeight }}>
          <ResultsMap
            originLat={origin.lat}
            originLng={origin.lng}
            probe={probe}
            stops={itinerary.days[dayIndex]?.stops ?? []}
            // The last answer's pins stay up while the next is asked, untouchable and unfocused, so
            // the camera moves once per answer rather than to the middle and back each keystroke.
            places={answer?.places ?? NO_PLACES}
            focusIndex={searching ? -1 : focusIndex}
            onPin={searching ? undefined : pin}
            reduced={reduced}
          />
          <View style={styles.float} pointerEvents="box-none">
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
        </View>

        <View style={styles.tray}>
          {searching ? (
            <Searching line={searchingLine(category, query, near)} width={cardWidth} reduced={reduced} />
          ) : !answer?.available ? (
            <Nothing
              title="Couldn\u2019t reach search"
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
            <>
              <Animated.View entering={reduced ? undefined : FadeIn.duration(220)}>
                <FlatList
                  ref={rail}
                  // A new answer is a new rail, starting at its first card like the focus does.
                  key={asked}
                  data={places}
                  horizontal
                  keyExtractor={(place) => place.id}
                  showsHorizontalScrollIndicator={false}
                  snapToInterval={step}
                  decelerationRate="fast"
                  disableIntervalMomentum
                  contentContainerStyle={styles.rail}
                  getItemLayout={(_, index) => ({ length: step, offset: step * index, index })}
                  // Back from a place's card, the rail opens on the card that was opened.
                  initialScrollIndex={Math.min(focusIndex, places.length - 1)}
                  scrollEventThrottle={32}
                  onScroll={(event) => {
                    if (pinning.current) return;
                    const index = activeCard(event.nativeEvent.contentOffset.x, step, places.length);
                    if (index !== focusIndex) setFocus({ asked, index });
                  }}
                  onScrollBeginDrag={() => {
                    pinning.current = false;
                  }}
                  onMomentumScrollEnd={() => {
                    pinning.current = false;
                  }}
                  renderItem={({ item, index }) => (
                    <Card
                      place={item}
                      index={index}
                      on={index === focusIndex}
                      width={cardWidth}
                      itinerary={itinerary}
                      dayIndex={dayIndex}
                      distanceFrom={probe}
                      busy={adding === item.id}
                      disabled={adding !== null}
                      onOpen={() => {
                        setFocus({ asked, index });
                        open(item);
                      }}
                      onAdd={() => add(item, dayIndex, suggestTimeOfDay(item))}
                    />
                  )}
                />
              </Animated.View>
              {failed ? <Failure /> : null}
              <View style={styles.under}>
                <Text maxFontSizeMultiplier={1.6} style={styles.count}>
                  {`${focusIndex + 1} of ${places.length}`}
                </Text>
                {answer?.provider === 'apple' ? <SourceNote /> : null}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <>
      {/* Two children, header then the ScrollView, and the header not flattened: that is the
          shape react-native-screens' form sheet sizes to the detent (`RNSScreenContentWrapper`
          coerces a ScrollView at index 0 or 1 and gives up past two siblings). A wrapping View,
          or a header flattened into its Text and Pressable, left the ScrollView at the sheet's
          top, over the title and over Done. So every view the body has — the map, the cards, a
          place's card — lives inside that one ScrollView. */}
      <Header
        title={title}
        sub={chosen ? `Adding to ${dayLabel(itinerary, day)}` : `Adding to ${dayLabel(itinerary, dayIndex)}`}
        onBack={
          chosen
            ? () => {
                setChosen(null);
              }
            : null
        }
        onCancel={onClose}
      />
      {body}
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
  onBack,
  onCancel,
}: {
  title: string;
  sub: string;
  onBack: (() => void) | null;
  onCancel: () => void;
}) {
  // Capped as well as floored: at the largest text sizes Cancel and Results grow, and uncapped they
  // would take the whole row and leave the title no lane at all.
  const lane = { maxWidth: useWindowDimensions().width * 0.4 };
  return (
    <View collapsable={false} style={styles.bar}>
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
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.sub}>
          {sub}
        </Text>
      </View>
      <View style={[styles.lane, styles.laneEnd, lane]}>
        <SheetDone onPress={onCancel} label="Cancel" />
      </View>
    </View>
  );
}

/** Night glass over the map: Liquid Glass where the system has it, the chrome blur where not. */
function Glass({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  return isLiquidGlassAvailable() ? (
    <GlassView glassEffectStyle="regular" colorScheme="dark" style={style}>
      {children}
    </GlassView>
  ) : (
    <BlurView intensity={60} tint="systemChromeMaterialDark" style={style}>
      {children}
    </BlurView>
  );
}

/**
 * A search field as iOS draws one — magnifier, placeholder from the left, clear button — on glass
 * over the map. The clear button is drawn here rather than by `clearButtonMode`, which is iOS-only
 * and only while editing; a query left in the field after the keyboard goes is still worth clearing.
 */
function SearchField({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return (
    <Glass style={styles.search}>
      <SymbolView name="magnifyingglass" tintColor={Polar.nightText2} size={16} />
      <TextInput
        value={query}
        onChangeText={onQuery}
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
    </Glass>
  );
}

/**
 * One kind of place. Over the map, so an unchosen chip carries its own night fill rather than a
 * hairline on nothing; the chosen one is ice with ink, the way every chosen thing on the night is.
 */
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
 * The map of what was found: one numbered pin per card, in the cards' order, the chosen card's pin
 * in signal. The stop that was asked about is marked and named; the day's other stops are small
 * rings, enough to say where this is in the day without competing with the answer.
 *
 * Apple's own places are off. The pins *are* the places of interest here, and the basemap's
 * would put a second, unnumbered answer to the same question under the first.
 */
function ResultsMap({
  originLat,
  originLng,
  probe,
  stops,
  places,
  focusIndex,
  onPin,
  reduced,
}: {
  originLat: number;
  originLng: number;
  probe: { lat: number; lng: number; name: string } | null;
  stops: { lat: number; lng: number }[];
  places: FoundPlace[];
  focusIndex: number;
  onPin?: (index: number) => void;
  reduced: boolean;
}) {
  const map = useRef<MapViewRef>(null);
  const [initialRegion] = useState(() => regionForStops([{ lat: originLat, lng: originLng }]) ?? undefined);
  const probeLat = probe?.lat;
  const probeLng = probe?.lng;

  // Reframed once per answer, around the stop asked about and everything found — or back to the
  // search's middle when nothing was. Primitives again: `probe` is rebuilt every render.
  useEffect(() => {
    const around = probeLat !== undefined && probeLng !== undefined ? [{ lat: probeLat, lng: probeLng }] : [];
    const region = regionForStops(places.length ? [...around, ...places] : [{ lat: originLat, lng: originLng }]);
    if (region) map.current?.animateToRegion(region, reduced ? 0 : 420);
  }, [places, probeLat, probeLng, originLat, originLng, reduced]);

  const context = drawableStops(stops).filter(
    ({ stop }) => !probe || stop.lat !== probe.lat || stop.lng !== probe.lng,
  );

  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion}
      // The trip's sheets are drawn on the night whatever the appearance, so the map is too.
      userInterfaceStyle="dark"
      mapType="mutedStandard"
      showsPointsOfInterests={false}
      pitchEnabled={false}
      rotateEnabled={false}
      toolbarEnabled={false}
      // The camera frames below the floating search and chips rather than under them.
      mapPadding={{ top: FLOAT_H, right: 0, bottom: 0, left: 0 }}
      accessibilityLabel="Map of the places found">
      {context.map(({ stop, index }) => (
        <MapMark key={`stop-${index}`} lat={stop.lat} lng={stop.lng} paint="ring" zIndex={1}>
          <View style={styles.ring} />
        </MapMark>
      ))}
      {probe ? (
        <MapMark lat={probe.lat} lng={probe.lng} paint="anchor" zIndex={5} label={probe.name}>
          <Anchor name={probe.name} />
        </MapMark>
      ) : null}
      {drawableStops(places).map(({ stop: place, index }) => {
        const on = index === focusIndex;
        return (
          <MapMark
            key={place.id}
            lat={place.lat}
            lng={place.lng}
            paint={on ? 'on' : 'off'}
            zIndex={on ? 999 : 10 + index}
            label={`${index + 1}, ${place.name}`}
            onPress={onPin ? () => onPin(index) : undefined}>
            <View style={styles.target}>
              <View style={[styles.pin, on && styles.pinOn]}>
                <Text maxFontSizeMultiplier={1} style={[styles.pinText, on && styles.pinTextOn]}>
                  {index + 1}
                </Text>
              </View>
            </View>
          </MapMark>
        );
      })}
    </MapView>
  );
}

/**
 * The stop that was asked about: a white-ringed dot with its name beside it.
 *
 * Laid out symmetrically — an empty box the label's width on the left — because a custom marker is
 * centred on its coordinate, and the dot, not the middle of "dot plus name", is where the stop is.
 */
function Anchor({ name }: { name: string }) {
  return (
    <View style={styles.anchor}>
      <View style={styles.anchorSide} />
      <View style={styles.anchorDot} />
      <Text maxFontSizeMultiplier={1} numberOfLines={1} style={[styles.anchorSide, styles.anchorText]}>
        {name}
      </Text>
    </View>
  );
}

/**
 * A mark on the map, drawn by us.
 *
 * `tracksViewChanges` for the reason `StopMarker` in `day-map.tsx` records: on Android a marker
 * with children is re-snapshotted every frame while it is true, and never painted at all if it
 * starts false. So it starts true, settles after a beat, and re-arms when `paint` — what the mark
 * looks like — changes, which is what lets the chosen pin actually turn orange there.
 */
function MapMark({
  lat,
  lng,
  paint,
  zIndex,
  label,
  onPress,
  children,
}: {
  lat: number;
  lng: number;
  paint: string;
  zIndex: number;
  label?: string;
  onPress?: () => void;
  children: ReactNode;
}) {
  const [tracking, setTracking] = useState(true);
  const [painted, setPainted] = useState(paint);
  if (paint !== painted) {
    setPainted(paint);
    setTracking(true);
  }
  useEffect(() => {
    if (!tracking) return;
    const settle = setTimeout(() => setTracking(false), 300);
    return () => clearTimeout(settle);
  }, [tracking]);

  return (
    <Marker
      coordinate={{ latitude: lat, longitude: lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      // `anchor` is Google-only; Apple Maps needs this, measured — see `MARKER_SKEW_PT`.
      centerOffset={{ x: -MARKER_SKEW_PT, y: 0 }}
      zIndex={zIndex}
      tracksViewChanges={tracking}
      onPress={onPress}
      tappable={!!onPress}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'auto' : 'no-hide-descendants'}>
      {children}
    </Marker>
  );
}

/**
 * One found place, as a card on the rail.
 *
 * The top opens the place; the foot answers "where would this go and what does it cost me" at the
 * defaults the place's card opens on — `slotPreview` and `insertionDetour` are the same two it
 * calls — and Add takes those defaults without opening anything. A list of cafes is a search
 * engine; the app has already worked out where each one goes, and this is where it says so.
 */
function Card({
  place,
  index,
  on,
  width,
  itinerary,
  dayIndex,
  distanceFrom,
  busy,
  disabled,
  onOpen,
  onAdd,
}: {
  place: FoundPlace;
  index: number;
  on: boolean;
  width: number;
  itinerary: Itinerary;
  dayIndex: number;
  distanceFrom: { lat: number; lng: number } | null;
  busy: boolean;
  disabled: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const slot = suggestTimeOfDay(place);
  const preview = slotPreview(itinerary, dayIndex, slot);
  const detour = insertionDetour(itinerary, dayIndex, place, slot);
  const fit = slotLine(preview.time, preview.tight, detour);
  // The same line the stop will carry once it is added, when there is no street to show instead.
  const line = place.address || describePlace(place);

  return (
    <View style={[styles.card, { width }, on && styles.cardOn]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        // Everything the card shows, since a label replaces what is under it rather than adding to it.
        accessibilityLabel={[`${index + 1}. ${place.name}`, eyebrow(place, distanceFrom), line].filter(Boolean).join(', ')}
        accessibilityState={{ selected: on }}
        accessibilityHint={`Would land at ${fit}. Opens the day and time.`}
        style={({ pressed }) => [styles.cardOpen, pressed && styles.cardPressed]}>
        <View style={styles.cardTop}>
          <View style={[styles.num, on && styles.numOn]}>
            <Text maxFontSizeMultiplier={1} style={[styles.numText, on && styles.numTextOn]}>
              {index + 1}
            </Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[styles.eyebrow, styles.grow]}>
            {eyebrow(place, distanceFrom)}
          </Text>
        </View>
        <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.cardName}>
          {place.name}
        </Text>
        {line ? (
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.cardLine}>
            {line}
          </Text>
        ) : null}
      </Pressable>
      <View style={styles.cardFoot}>
        <View style={[styles.fit, styles.grow]} accessible accessibilityLabel={fit}>
          <Text maxFontSizeMultiplier={1.4} style={styles.fitTime}>
            {preview.time}
          </Text>
          {preview.tight ? (
            <Text maxFontSizeMultiplier={1.4} style={styles.tight}>
              tight
            </Text>
          ) : null}
          <DetourNote detour={detour} />
        </View>
        <Pressable
          onPress={onAdd}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Add ${place.name} to ${dayLabel(itinerary, dayIndex)} at ${preview.time}`}
          accessibilityState={{ busy, disabled }}
          style={({ pressed }) => [styles.addSmall, pressed && styles.addPressed, disabled && !busy && styles.off]}>
          {busy ? (
            <ActivityIndicator size="small" color={Polar.ink} />
          ) : (
            <Text maxFontSizeMultiplier={1.3} style={styles.addSmallText}>
              Add
            </Text>
          )}
        </Pressable>
      </View>
    </View>
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

/** Where the place goes, and the sign it is waiting: one card's outline, breathing. */
function Searching({ line, width, reduced }: { line: string; width: number; reduced: boolean }) {
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
      <Animated.View style={[styles.card, styles.skeleton, { width }, pulse]}>
        <View style={[styles.bone, { width: '34%' }]} />
        <View style={[styles.bone, styles.boneLead, { width: '62%' }]} />
        <View style={[styles.bone, { width: '48%' }]} />
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

/** Where the places came from, said once under the rail: Apple Maps answered, not TripMate. */
function SourceNote() {
  return (
    <View style={styles.source}>
      <SymbolView name="map" size={13} tintColor={Polar.nightText2} />
      <Text maxFontSizeMultiplier={1.6} style={styles.count}>
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
 * A strip of map first, with the line the place would be walked on — the stop before it, the
 * place, the stop after, for the day and time chosen below, so the line moves as they do. Then
 * each slot shows the clock time it would actually produce, not just its name: "Afternoon" is a
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
  bottom,
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
  bottom: number;
}) {
  const detour = insertionDetour(itinerary, day, place, slot);
  const time = slotPreview(itinerary, day, slot).time;
  const head = [eyebrow(place, distanceFrom), detourShort(detour)].filter(Boolean).join(' · ');

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: bottom + PolarSpace.s5 }}>
      <Animated.View entering={reduced ? undefined : FadeIn.duration(220)}>
        <PlaceMap itinerary={itinerary} day={day} slot={slot} place={place} reduced={reduced} />
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
    </ScrollView>
  );
}

/**
 * The place card's strip of map: the place in signal, its neighbours in the day as rings, and the
 * dashed line between them. A picture, not a control — it does not take touches, so a drag on it
 * scrolls the card instead of panning a map nobody asked to pan.
 */
function PlaceMap({
  itinerary,
  day,
  slot,
  place,
  reduced,
}: {
  itinerary: Itinerary;
  day: number;
  slot: TimeOfDay;
  place: FoundPlace;
  reduced: boolean;
}) {
  const map = useRef<MapViewRef>(null);
  const path = useMemo(() => insertionPath(itinerary, day, place, slot), [itinerary, day, place, slot]);
  const region = useMemo(() => regionForStops(path), [path]);
  const [initialRegion] = useState(region ?? undefined);

  useEffect(() => {
    if (region) map.current?.animateToRegion(region, reduced ? 0 : 420);
  }, [region, reduced]);

  return (
    <View
      style={styles.strip}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        userInterfaceStyle="dark"
        mapType="mutedStandard"
        showsPointsOfInterests={false}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        toolbarEnabled={false}
        mapPadding={{ top: 24, right: 24, bottom: 24, left: 24 }}>
        {path.length > 1 ? (
          <Polyline
            coordinates={path.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={Polar.route}
            strokeWidth={2.5}
            lineDashPattern={[6, 5]}
            lineCap="round"
          />
        ) : null}
        {path.map((p, index) =>
          p.lat === place.lat && p.lng === place.lng ? (
            <MapMark key={`p-${index}`} lat={p.lat} lng={p.lng} paint="place" zIndex={999}>
              <View style={styles.target}>
                <View style={[styles.pin, styles.pinOn]}>
                  <SymbolView name="mappin" size={12} tintColor={Polar.ink} />
                </View>
              </View>
            </MapMark>
          ) : (
            <MapMark key={`p-${index}`} lat={p.lat} lng={p.lng} paint="ring" zIndex={1}>
              <View style={styles.ring} />
            </MapMark>
          ),
        )}
      </MapView>
    </View>
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
              style={({ pressed }) => [styles.tile, pressed && styles.cardPressed]}>
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

const PIN = 22;

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.6 },
  off: { opacity: 0.45 },
  centred: { textAlign: 'center' },
  muted: { fontFamily: PolarFonts.sans, fontSize: 13, lineHeight: 19, color: Polar.nightText2 },
  // Applied only once `usePolarFonts` says Oswald and the display cut are in: an unloaded family
  // is not an error in RN, it is a silent fallback.
  condFont: { fontFamily: PolarFonts.condensed },
  displayFont: { fontFamily: PolarFonts.display },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HEADER_H - PolarSpace.s2,
    paddingHorizontal: GUTTER,
    paddingTop: PolarSpace.s2,
    paddingBottom: 6,
    backgroundColor: Polar.deep,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
  },
  lane: { minWidth: LANE, flexShrink: 0, alignItems: 'flex-start', justifyContent: 'center' },
  laneEnd: { alignItems: 'flex-end' },
  centre: { flex: 1, minWidth: 0, alignItems: 'center' },
  title: { fontFamily: PolarFonts.sansSemi, fontSize: 15, lineHeight: 20, color: Polar.ice },
  sub: { fontFamily: PolarFonts.sans, fontSize: 12, lineHeight: 16, color: Polar.nightText2 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, marginLeft: -6 },
  backText: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.signal },

  nowhere: { padding: GUTTER },

  float: { position: 'absolute', top: 12, left: 0, right: 0, gap: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    marginHorizontal: GUTTER,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: PolarRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Polar.frost20,
    overflow: 'hidden',
  },
  searchInput: { flex: 1, height: '100%', fontFamily: PolarFonts.sans, fontSize: 15, color: Polar.ice },
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
    height: 32,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: PolarRadius.hairline,
    backgroundColor: 'rgba(14,17,24,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Polar.frost20,
  },
  chipOn: { backgroundColor: Polar.ice, borderColor: Polar.ice },
  chipText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ice },
  chipTextOn: { color: Polar.ink },

  target: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pin: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,17,24,0.92)',
    borderWidth: 1.5,
    borderColor: Polar.frost20,
    ...MapObjectShadow,
  },
  // Larger as well as orange, so the chosen pin is found by its size before its colour.
  pinOn: { backgroundColor: Polar.signal, borderColor: 'rgba(255,126,21,0.35)', borderWidth: 3, transform: [{ scale: 1.3 }] },
  pinText: { fontFamily: PolarFonts.sansSemi, fontSize: 11, color: Polar.ice },
  pinTextOn: { color: Polar.ink },
  ring: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: Polar.ice, backgroundColor: Polar.deep },
  anchor: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  anchorSide: { width: 104 },
  anchorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: Polar.ice,
    backgroundColor: Polar.deep,
    ...MapObjectShadow,
  },
  anchorText: {
    fontFamily: PolarFonts.sansSemi,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Polar.ice,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  tray: {
    paddingTop: 12,
    paddingBottom: PolarSpace.s4,
    backgroundColor: Polar.deep,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LINE,
  },
  rail: { paddingLeft: GUTTER, paddingRight: GUTTER - CARD_GAP },
  card: {
    marginRight: CARD_GAP,
    borderRadius: PolarRadius.card,
    backgroundColor: FROST_06,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: LINE,
    overflow: 'hidden',
  },
  cardOn: { borderColor: Polar.frost20 },
  cardOpen: { gap: 4, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  cardPressed: { backgroundColor: Polar.frost10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  num: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Polar.frost20,
  },
  numOn: { backgroundColor: Polar.signal, borderColor: Polar.signal },
  numText: { fontFamily: PolarFonts.sansSemi, fontSize: 10.5, color: Polar.ice },
  numTextOn: { color: Polar.ink },
  eyebrow: {
    fontFamily: PolarFonts.sansSemi,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    color: Polar.nightText2,
  },
  cardName: { fontFamily: PolarFonts.sansSemi, fontSize: 17, lineHeight: 22, color: Polar.ice },
  cardLine: { fontFamily: PolarFonts.sans, fontSize: 13, lineHeight: 18, color: Polar.nightText2 },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LINE,
  },
  fit: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fitTime: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ice, fontVariant: ['tabular-nums'] },
  tight: { fontFamily: PolarFonts.sansSemi, fontSize: 11.5, color: Polar.alertNight },
  tightOnIce: { color: Polar.alertText },
  fits: { fontFamily: PolarFonts.sansSemi, fontSize: 11.5, color: Polar.route },
  fitsOnIce: { color: FITS_ON_ICE },
  detour: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  detourText: { fontFamily: PolarFonts.sans, fontSize: 12.5, flexShrink: 1 },
  addSmall: {
    minHeight: 34,
    minWidth: 58,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PolarRadius.hairline,
    backgroundColor: Polar.signal,
  },
  addPressed: { backgroundColor: Polar.signalPressed },
  addSmallText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },
  under: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 10,
    paddingHorizontal: GUTTER,
  },
  count: { fontFamily: PolarFonts.sans, fontSize: 12, color: Polar.nightText2, fontVariant: ['tabular-nums'] },
  source: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  failure: {
    marginTop: 10,
    marginHorizontal: GUTTER,
    paddingVertical: 9,
    paddingHorizontal: PolarSpace.s3,
    borderLeftWidth: 2,
    borderLeftColor: Polar.alertNight,
    fontFamily: PolarFonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: Polar.alertNight,
  },

  searching: { gap: 10, paddingHorizontal: GUTTER },
  searchingLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  skeleton: { gap: 8, padding: 14, height: 118 },
  bone: { height: 10, borderRadius: 2, backgroundColor: Polar.frost10 },
  boneLead: { height: 15 },

  nothing: { alignItems: 'center', gap: 8, paddingHorizontal: PolarSpace.s4, paddingTop: 4, paddingBottom: 4 },
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

  strip: { height: STRIP_H, backgroundColor: Polar.night },
  detail: { paddingHorizontal: GUTTER },
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
