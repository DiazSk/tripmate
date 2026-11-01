import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clearsIn } from '@shared/memories';
import type { ReadyTrip } from '@shared/readyTrips';

import { BlurView } from '@/components/blur';
import { useAccount } from '@/api/auth';
import { usePlacePhoto } from '@/api/placePhotos';
import { lastRequestReachedServer } from '@/api/session';
import { listTrips } from '@/api/tripMateApi';
import type { Trip, TripSummary } from '@/api/types';
import { Avatar } from '@/components/avatar';
import { FilterPills } from '@/components/home/filter-pills';
import { MeriSearch } from '@/components/home/meri-search';
import { ReadySections } from '@/components/home/ready-sections';
import { TripPhotoWidget, TripWidgets, Widget, WidgetGrid, widgetText } from '@/components/home-widgets';
import { OfflineScreen } from '@/components/offline-screen';
import { usePolarFonts, usePolarStatusBar } from '@/components/polar-ui';
import { Polar, PolarFonts } from '@/constants/polar';
import { BarHeight } from '@/constants/theme';
import { homeIsUnreachable, pillCounts, type Pill } from '@/lib/readyTrips';
import { loadReadyTrips, loadSavedPlaces, loadTrip, loadTrips, readCachedReadyTrips, type Cached } from '@/lib/tripCache';
import { todayInZone } from '@/lib/tripClock';
import { pickCurrent } from '@/lib/tripPhase';
import { daysUntil, todayISO, tripShelves } from '@/lib/tripsWall';
import { useFocusedFetch, useFocusedFetchWithRetry } from '@/lib/useFocusedFetch';
import { Text } from '@/components/themed-text';

/** The bar the greeting folds into, under the status bar. */
const BAR = 50;
/** The root scroll view's children, in order, when not on a trip: the pills are the fourth. */
const PILLS_INDEX = 3;

/**
 * Home (design D, "Phone Home · D · Combined").
 *
 * **Two jobs, and the screen tells them apart.** Before a trip it is where one starts: your own next
 * trip and draft first, then Ask Meri for a trip, then ready-made trips under pinned filter pills.
 * During one it is "what now" (`TripWidgets`): the next stop as a Live Activity, where you are, the
 * weather, a saved place near you, the rest of the day — and none of the ideas.
 *
 * **The pills pin with `stickyHeaderIndices`, so the scroll view starts under the bar.** A sticky
 * header sticks at the scroll view's own top edge; a full-screen scroll view would pin the pills
 * under the clock. So, not on a trip, the content is clipped at the bar's foot and the bar needs no
 * glass (nothing passes beneath it). On a trip nothing pins, and the page keeps scrolling under the
 * glass bar exactly as it did.
 *
 * Offline is the case this screen most has to survive, since it is the one you open standing in a
 * street: trips come through `loadTrips` and the catalogue through `loadReadyTrips`, both falling
 * back to what is on disk.
 */
export default function Home() {
  const router = useRouter();
  const fonts = usePolarFonts();
  const insets = useSafeAreaInsets();
  const { account } = useAccount();
  const [folded, setFolded] = useState(false);
  // Component state only: it holds across tab switches because tab screens stay mounted.
  const [pill, setPill] = useState<Pill>('All');
  usePolarStatusBar(true);

  /**
   * Focusing the Meri field lifts the whole card to just under the bar. iOS's own keyboard inset
   * (`automaticallyAdjustKeyboardInsets`) scrolls only far enough to show the caret's line, which
   * left the chips and the send under the keyboard; so once the keyboard is up, the card is put
   * where all of it shows. Refs, not state: none of this is drawn.
   */
  const scroller = useRef<ScrollView>(null);
  const searchY = useRef(0);
  const searching = useRef(false);
  const liftSearch = () => scroller.current?.scrollTo({ y: Math.max(0, searchY.current - 8), animated: true });
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      if (searching.current) scroller.current?.scrollTo({ y: Math.max(0, searchY.current - 8), animated: true });
    });
    return () => shown.remove();
  }, []);

  /** On focus, not on mount: "Up next" has to notice a trip kept a moment ago in the wizard. */
  const { data: fetched, retry } = useFocusedFetchWithRetry(
    async () => (await loadTrips()) ?? (lastRequestReachedServer() === false ? ('offline' as const) : null)
  );
  // No trip list and no trip on disk: Home still stands on a catalogue copy, with "Your trips" saying
  // it could not reach TripMate. Only with nothing at all is it the full-screen offline page.
  const unreachable = homeIsUnreachable(fetched, () => readCachedReadyTrips() !== null);
  const listed = fetched === 'offline' ? null : fetched;
  const trips = listed === undefined ? undefined : (listed?.value ?? null);
  const offline = fetched === 'offline' || listed?.cachedAt != null;
  // Drafts are a network nicety: nothing is cached for them, and a miss is simply no widget.
  const drafts = useFocusedFetch(async () => (await listTrips('draft')) ?? []) ?? [];
  // "Couldn't ask, nothing on disk" draws the same quiet line as "the catalogue is down": `undefined`
  // is the loading skeleton, and a request that never answers must not leave it there for good.
  const ready = useFocusedFetch(async (): Promise<Cached<ReadyTrip[]> | { unavailable: true }> => (await loadReadyTrips()) ?? { unavailable: true });

  /**
   * The trip you are on, if you are on one: two reads, and only while one is running, because the
   * list's summaries carry no itinerary. Stamped with the id it was fetched for and matched at
   * render, so a result for a trip you have moved off is simply not used.
   */
  const current = trips ? pickCurrent(trips, todayISO()) : null;
  const [loaded, setLoaded] = useState<{ id: string; hit: Cached<Trip> | null } | null>(null);
  // Re-read whenever the list is, so a reconnection refreshes the trip beneath it too.
  useEffect(() => {
    const id = current?.id;
    if (!id) return;
    let alive = true;
    loadTrip(id).then((hit) => alive && setLoaded({ id, hit: hit ?? null }));
    return () => {
      alive = false;
    };
  }, [current?.id, listed]);
  const onTrip = current && loaded?.id === current.id ? loaded.hit : null;
  const trip = onTrip?.value;
  // Today where the trip is, which is not always the same day as here.
  const tripToday = (trip && todayInZone(trip.timezone)) ?? todayISO();
  /** The saved pile, read on every focus unconditionally: a guard on `trip` here never re-ran on a cold launch. */
  const saved = useFocusedFetch(loadSavedPlaces)?.value ?? undefined;

  if (unreachable) {
    return (
      <OfflineScreen
        bottomInset={BarHeight}
        retry={async () => {
          const { result, commit } = await retry();
          return result === 'offline' ? null : commit;
        }}
      />
    );
  }

  const first = account?.name?.trim().split(/\s+/)[0];
  const hello = greeting();
  const title = trip ? 'Today' : first ? `${hello}, ${first}` : hello;
  const dateLine = trip ? tripLine(trip, tripToday) : longDate();

  const pills = ready && 'value' in ready ? pillCounts(ready.value) : [];
  // A pill the catalogue no longer has (its last trip went) falls back to All rather than to nothing.
  const active = pills.some((p) => p.pill === pill) ? pill : 'All';
  const sendIdea = (idea: string) =>
    router.push(`/idea?text=${encodeURIComponent(idea)}${lastRequestReachedServer() === false ? '&offline=1' : ''}`);

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scroller}
        style={trip ? null : { marginTop: insets.top + BAR }}
        contentContainerStyle={[styles.content, { paddingTop: trip ? insets.top + 52 : 2 }]}
        stickyHeaderIndices={trip ? undefined : [PILLS_INDEX]}
        // The Meri field sits mid-page: iOS insets the page by the keyboard and scrolls the focused
        // field above it, as the planner's sheets do (`plan-ui.tsx`). Android resizes the window.
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEventThrottle={32}
        onScroll={(e) => setFolded(e.nativeEvent.contentOffset.y > 46)}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text maxFontSizeMultiplier={1.6} style={styles.date}>{dateLine.toUpperCase()}</Text>
            <Text maxFontSizeMultiplier={1.3} style={[styles.title, fonts && styles.titleFont, fonts && !trip && styles.titleHome]} accessibilityRole="header" numberOfLines={2}>
              {title}
            </Text>
          </View>
          {trip ? null : (
            <Pressable onPress={() => router.push('/(tabs)/profile')} accessibilityRole="button" accessibilityLabel="Your profile" hitSlop={6} style={({ pressed }) => pressed && styles.pressed}>
              <Avatar account={account} size={36} />
            </Pressable>
          )}
        </View>

        {trip ? (
          <TripWidgets
            trip={trip}
            today={tripToday}
            cachedAt={onTrip?.cachedAt ?? null}
            onOpenTrip={() => router.push(`/trip/${trip.id}`)}
            onAsk={offline ? undefined : (dayIndex) => router.push(`/trip/${trip.id}?ask=${dayIndex}`)}
            saved={saved}
          />
        ) : (
          <YourOwn trips={trips} drafts={drafts} onOpen={(id) => router.push(`/trip/${id}`)} onTrips={() => router.push('/(tabs)/trips')} />
        )}
        {trip ? null : (
          <View onLayout={(e) => (searchY.current = e.nativeEvent.layout.y)}>
            <MeriSearch
              offline={offline}
              onSend={sendIdea}
              onPlanStepByStep={() => router.push('/plan/basics')}
              onBringPlan={() => router.push('/plan/own')}
              onFocusChange={(on) => {
                searching.current = on;
                // With the keyboard already up (a chip after the field), there is no show event to wait for.
                if (on) liftSearch();
              }}
            />
          </View>
        )}
        {/* Always rendered off a trip, even empty, so `PILLS_INDEX` keeps pointing at it. */}
        {trip ? null : <View style={styles.pills}>{pills.length ? <FilterPills pills={pills} active={active} onChange={setPill} /> : null}</View>}
        {trip ? null : <ReadySections state={ready} pill={active} onShowAll={() => setPill('All')} onOpen={(slug) => router.push(`/ready/${slug}`)} />}
      </ScrollView>

      <Bar folded={folded} glass={!!trip} title={title} top={insets.top} />
    </View>
  );
}

/** The bar the greeting folds into. Glass only on a trip, the one page that scrolls beneath it. */
function Bar({ folded, glass, title, top }: { folded: boolean; glass: boolean; title: string; top: number }) {
  return (
    <View style={[styles.bar, { paddingTop: top, height: top + BAR }]} pointerEvents="box-none">
      {folded && glass ? <BlurView intensity={60} tint="systemChromeMaterialLight" style={StyleSheet.absoluteFill} /> : null}
      {folded && glass ? <View style={styles.barRule} /> : null}
      <Text maxFontSizeMultiplier={1.6} style={[styles.barTitle, !folded && styles.hidden]} numberOfLines={1} accessibilityElementsHidden={!folded}>
        {title}
      </Text>
    </View>
  );
}

/**
 * Your own plans, before anyone else's: the next trip you kept (or, with none, an unkept plan for
 * days still ahead) and the draft line. Nothing while the list loads, so ideas are not pushed down
 * and then back up.
 */
function YourOwn({ trips, drafts, onOpen, onTrips }: { trips: TripSummary[] | null | undefined; drafts: TripSummary[]; onOpen: (id: string) => void; onTrips: () => void }) {
  const today = todayISO();
  const { upcoming } = tripShelves(trips ?? [], today);
  // Marked as a draft on the card, and so not repeated in the Draft widget below (review H3).
  const draftLead = upcoming[0] ? null : (tripShelves(drafts, today).upcoming[0] ?? null);
  const lead = upcoming[0] ?? draftLead;
  const rest = draftLead ? drafts.filter((d) => d.id !== draftLead.id) : drafts;
  const draft = rest[0];
  if (trips === undefined || (trips && !lead && !draft)) return <View />;
  return (
    <View style={styles.own}>
      <WidgetGrid>
        {trips === null ? (
          <Widget size="medium" fit tone="warn" label="Not loaded">
            <Text maxFontSizeMultiplier={1.6} style={widgetText.dim}>Couldn’t reach TripMate. Your trips show up here once it answers.</Text>
          </Widget>
        ) : lead ? (
          <LeadWidget trip={lead} draft={lead === draftLead} today={today} onPress={() => onOpen(lead.id)} />
        ) : null}
        {draft ? <DraftWidget draft={draft} more={rest.length - 1} onPress={() => onOpen(draft.id)} onTrips={onTrips} /> : null}
      </WidgetGrid>
    </View>
  );
}

function LeadWidget({ trip, draft, today, onPress }: { trip: TripSummary; draft: boolean; today: string; onPress: () => void }) {
  const photo = usePlacePhoto(trip.destination);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  return (
    <TripPhotoWidget
      size="medium"
      label={draft ? 'Draft · Up next' : 'Up next'}
      trip={trip}
      photo={url}
      days={daysUntil(trip.startDate, today)}
      note={draft ? clearsIn(trip) : null}
      onPress={onPress}
    />
  );
}

function DraftWidget({ draft, more, onPress, onTrips }: { draft: TripSummary; more: number; onPress: () => void; onTrips: () => void }) {
  const photo = usePlacePhoto(draft.destination);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  const clears = clearsIn(draft);
  return (
    <Widget size="medium" fit label={more > 0 ? `Drafts · ${more + 1}` : 'Draft'} onPress={more > 0 ? onTrips : onPress} accessibilityLabel={`Your ${draft.destination} draft`}>
      <View style={styles.draft}>
        <View style={styles.draftThumb}>{url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
        <View style={styles.draftText}>
          <Text maxFontSizeMultiplier={1.3} style={widgetText.big} numberOfLines={1}>
            {draft.destination.split(',')[0].trim()}
          </Text>
          {clears ? <Text maxFontSizeMultiplier={1.6} style={widgetText.ember}>{clears}</Text> : null}
          {more > 0 ? <Text maxFontSizeMultiplier={1.6} style={widgetText.dim}>{`and ${more} more under Trips`}</Text> : null}
        </View>
      </View>
    </Widget>
  );
}

/** "Good morning", from the device clock, as Fitness and Health greet you. */
function greeting(hour = new Date().getHours()): string {
  return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function longDate(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "Jaipur · Day 2 of 7", or "Jaipur · Tomorrow" on the eve. */
function tripLine(trip: Trip, today: string): string {
  const city = trip.destination.split(',')[0].trim();
  const n = daysUntil(today, trip.startDate) + 1;
  const total = trip.itinerary.days.length;
  return n >= 1 && n <= total ? `${city} · Day ${n} of ${total}` : `${city} · Tomorrow`;
}

const GROUND = '#F2F2F7';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: GROUND },
  // Clears the floating tab bar, whose inset does not reach this scroll view.
  content: { paddingBottom: BarHeight + 40 },
  pressed: { opacity: 0.8 },
  hidden: { opacity: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, marginBottom: 16 },
  headText: { flex: 1 },
  date: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, color: Polar.secondary },
  title: { marginTop: 2, fontSize: 36, lineHeight: 42, color: Polar.ink },
  titleFont: { fontFamily: PolarFonts.display, fontSize: 40, lineHeight: 44 },
  // A size down beside the avatar, so "Good afternoon, Zaid" holds one line on a 400pt phone.
  titleHome: { fontSize: 34, lineHeight: 38 },

  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  barRule: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(60,60,67,0.22)' },
  barTitle: { maxWidth: '70%', fontSize: 17, fontWeight: '600', color: '#000' },

  own: { marginBottom: 16 },
  // The screen's own ground, so the rails scroll under the pinned row cleanly.
  pills: { marginTop: 8, backgroundColor: GROUND },

  draft: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  draftThumb: { width: 72, height: 72, overflow: 'hidden', borderRadius: 14, backgroundColor: Polar.deep },
  draftText: { flex: 1, gap: 3 },
});
