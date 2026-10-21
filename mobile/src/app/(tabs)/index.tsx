import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clearsIn } from '@shared/memories';

import { useAccount } from '@/api/auth';
import { usePlacePhoto } from '@/api/placePhotos';
import { lastRequestReachedServer } from '@/api/session';
import { listTrips } from '@/api/tripMateApi';
import type { Trip, TripSummary } from '@/api/types';
import { TripPhotoWidget, TripWidgets, Widget, WidgetGrid, WidgetIcon, widgetText } from '@/components/home-widgets';
import { OfflineScreen } from '@/components/offline-screen';
import { PlusButton, usePolarFonts, usePolarStatusBar } from '@/components/polar-ui';
import { Polar, PolarFonts } from '@/constants/polar';
import { BarHeight } from '@/constants/theme';
import { formatRange } from '@/lib/dayDisplay';
import { METHOD } from '@/lib/method';
import { loadSavedPlaces, loadTrip, loadTrips, type Cached } from '@/lib/tripCache';
import { todayInZone } from '@/lib/tripClock';
import { pickCurrent } from '@/lib/tripPhase';
import { daysUntil, todayISO, tripShelves } from '@/lib/tripsWall';
import { useFocusedFetch, useFocusedFetchWithRetry } from '@/lib/useFocusedFetch';


/**
 * Home, as a page of widgets (canvas design "Phone home · 4 Widgets with a live next stop").
 *
 * **Two jobs, and the screen tells them apart.** Before a trip it is where you start one: the next
 * trip counting down, the two ways in (plan one, bring your own), the draft you have not kept,
 * what is later, and how TripMate plans. During one it is "what now" (`TripWidgets`): the next stop
 * as a Live Activity, where you are, the weather, a saved place near you, the rest of the day.
 *
 * The greeting carries your name and folds into a glass bar as you scroll, with Plan a trip beside
 * it. Offline is the case this screen most has to survive, since it is the one you open standing
 * in a street: trips come through `loadTrips`, which falls back to what is on disk.
 */
export default function Home() {
  const router = useRouter();
  const fonts = usePolarFonts();
  const insets = useSafeAreaInsets();
  const { account } = useAccount();
  const [folded, setFolded] = useState(false);
  usePolarStatusBar(true);

  /** On focus, not on mount: "Up next" has to notice a trip kept a moment ago in the wizard. */
  const { data: fetched, retry } = useFocusedFetchWithRetry(
    async () => (await loadTrips()) ?? (lastRequestReachedServer() === false ? ('offline' as const) : null)
  );
  const unreachable = fetched === 'offline';
  const listed = unreachable ? null : fetched;
  const trips = listed === undefined ? undefined : (listed?.value ?? null);
  const offline = listed?.cachedAt != null;
  // Drafts are a network nicety: nothing is cached for them, and a miss is simply no widget.
  const drafts = useFocusedFetch(async () => (await listTrips('draft')) ?? []) ?? [];

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

  const tripPage = trip ? (
    <TripWidgets
      trip={trip}
      today={tripToday}
      cachedAt={onTrip?.cachedAt ?? null}
      onOpenTrip={() => router.push(`/trip/${trip.id}`)}
      onAsk={offline ? undefined : (dayIndex) => router.push(`/trip/${trip.id}?ask=${dayIndex}`)}
      saved={saved}
    />
  ) : null;

  const first = account?.name?.trim().split(/\s+/)[0];
  const hello = greeting();
  const title = trip ? 'Today' : first ? `${hello}, ${first}` : hello;
  const dateLine = trip ? tripLine(trip, tripToday) : longDate();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 52 }]}
        scrollEventThrottle={32}
        onScroll={(e) => setFolded(e.nativeEvent.contentOffset.y > 46)}>
        <View style={styles.head}>
          <Text style={styles.date}>{dateLine.toUpperCase()}</Text>
          <Text style={[styles.title, fonts && styles.titleFont]} accessibilityRole="header" numberOfLines={2}>
            {title}
          </Text>
        </View>

        {tripPage ?? (
          <Planning
            trips={trips}
            drafts={drafts}
            onPlan={() => router.push('/plan/basics')}
            onImport={() => router.push('/plan/own')}
            onOpen={(id) => router.push(`/trip/${id}`)}
            onMethod={() => router.push('/how-it-works')}
            onTrips={() => router.push('/(tabs)/trips')}
          />
        )}
      </ScrollView>

      <Bar folded={folded} title={title} top={insets.top} onPlan={() => router.push('/plan/basics')} />
    </View>
  );
}

/** The glass bar the greeting folds into, with Plan a trip beside it, always. */
function Bar({ folded, title, top, onPlan }: { folded: boolean; title: string; top: number; onPlan: () => void }) {
  return (
    <View style={[styles.bar, { paddingTop: top, height: top + 50 }]} pointerEvents="box-none">
      {folded ? <BlurView intensity={60} tint="systemChromeMaterialLight" style={StyleSheet.absoluteFill} /> : null}
      {folded ? <View style={styles.barRule} /> : null}
      <Text style={[styles.barTitle, !folded && styles.hidden]} numberOfLines={1} accessibilityElementsHidden={!folded}>
        {title}
      </Text>
      <View style={styles.barEnd}>
        <PlusButton onPress={onPlan} />
      </View>
    </View>
  );
}

function Planning({
  trips,
  drafts,
  onPlan,
  onImport,
  onOpen,
  onMethod,
  onTrips,
}: {
  trips: TripSummary[] | null | undefined;
  drafts: TripSummary[];
  onPlan: () => void;
  onImport: () => void;
  onOpen: (id: string) => void;
  onMethod: () => void;
  onTrips: () => void;
}) {
  const today = todayISO();
  const { upcoming, past } = tripShelves(trips ?? [], today);
  const lead = upcoming[0] ?? past[0];
  // Later: what is still to come after the lead, then the latest memory once something is ahead.
  const later = [...upcoming.slice(1, 4), ...(upcoming.length ? past.slice(0, 1) : [])];
  const draft = drafts[0];

  return (
    <>
      <WidgetGrid>
        {trips === undefined ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Polar.ink} />
          </View>
        ) : trips === null ? (
          <Widget size="medium" tone="warn" label="Not loaded">
            <Text style={widgetText.dim}>Couldn’t reach TripMate. Your trips show up here once it answers.</Text>
          </Widget>
        ) : lead ? (
          <LeadWidget trip={lead} upcoming={upcoming[0] === lead} today={today} onPress={() => onOpen(lead.id)} />
        ) : (
          <Widget size="large" tone="paper" label="Your first trip" onPress={onPlan}>
            <Text style={styles.first}>Days worth keeping, written for where you are going.</Text>
            <Text style={widgetText.dim}>Tell TripMate where, when and how much. It writes the days and checks every place.</Text>
            <View style={styles.firstCta}>
              <SymbolView name="sparkles" size={15} tintColor={Polar.ink} />
              <Text style={styles.firstCtaText}>Plan a trip</Text>
            </View>
          </Widget>
        )}

        <Widget size="small" tone="signal" label="New" onPress={onPlan} accessibilityLabel="Plan a trip">
          <WidgetIcon name="sparkles" />
          <Text style={widgetText.title}>Plan a trip</Text>
          <Text style={[widgetText.dim, styles.onSignal]}>Where, when, how much.</Text>
        </Widget>
        <Widget size="small" label="Import" onPress={onImport} accessibilityLabel="Bring your own plan">
          <WidgetIcon name="doc.text" color={Polar.ember} />
          <Text style={widgetText.title}>Bring your plan</Text>
          <Text style={widgetText.dim}>Paste it, or a photo.</Text>
        </Widget>

        {draft ? <DraftWidget draft={draft} more={drafts.length - 1} onPress={() => onOpen(draft.id)} onTrips={onTrips} /> : null}
      </WidgetGrid>

      {later.length ? (
        <View style={styles.later}>
          <Text style={styles.h} accessibilityRole="header">
            Later
          </Text>
          <View style={styles.list}>
            {later.map((t, i) => (
              <LaterRow key={t.id} trip={t} today={today} memory={upcoming.length > 0 && t === past[0]} first={i === 0} onPress={() => onOpen(t.id)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.method}>
        <WidgetGrid>
          <Widget size="medium" label="How TripMate plans" onPress={onMethod}>
            <View style={styles.steps}>
              {METHOD.map((m) => (
                <View key={m.number} style={styles.stepCell}>
                  <Text style={styles.stepNum}>{m.number}</Text>
                  <Text style={styles.stepTitle} numberOfLines={2}>
                    {m.title}
                  </Text>
                </View>
              ))}
            </View>
          </Widget>
        </WidgetGrid>
      </View>
    </>
  );
}

function LeadWidget({ trip, upcoming, today, onPress }: { trip: TripSummary; upcoming: boolean; today: string; onPress: () => void }) {
  const photo = usePlacePhoto(trip.destination);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  return <TripPhotoWidget label={upcoming ? 'Up next' : 'Latest memory'} trip={trip} photo={url} days={upcoming ? daysUntil(trip.startDate, today) : null} onPress={onPress} />;
}

function DraftWidget({ draft, more, onPress, onTrips }: { draft: TripSummary; more: number; onPress: () => void; onTrips: () => void }) {
  const photo = usePlacePhoto(draft.destination);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  const clears = clearsIn(draft);
  return (
    <Widget size="medium" label={more > 0 ? `Drafts · ${more + 1}` : 'Draft'} onPress={more > 0 ? onTrips : onPress} accessibilityLabel={`Your ${draft.destination} draft`}>
      <View style={styles.draft}>
        <View style={styles.draftThumb}>{url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
        <View style={styles.draftText}>
          <Text style={widgetText.big} numberOfLines={1}>
            {draft.destination.split(',')[0].trim()}
          </Text>
          {clears ? <Text style={widgetText.ember}>{clears}</Text> : null}
          {more > 0 ? <Text style={widgetText.dim}>{`and ${more} more under Trips`}</Text> : null}
        </View>
      </View>
    </Widget>
  );
}

function LaterRow({ trip, today, memory, first, onPress }: { trip: TripSummary; today: string; memory: boolean; first: boolean; onPress: () => void }) {
  const photo = usePlacePhoto(trip.destination);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  const days = daysUntil(trip.startDate, today);
  const when = memory ? 'your latest memory' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, !first && styles.rowRuled, pressed && styles.rowPressed]}>
      <View style={styles.rowThumb}>{url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={trip.id} /> : null}</View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {trip.destination.split(',')[0].trim()}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{`${formatRange(trip.startDate, trip.endDate)} · ${when}`}</Text>
      </View>
      <SymbolView name="chevron.right" size={13} tintColor="rgba(60,60,67,0.3)" weight="semibold" />
    </Pressable>
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
  head: { paddingHorizontal: 20, marginBottom: 16 },
  date: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, color: Polar.secondary },
  title: { marginTop: 2, fontSize: 36, lineHeight: 42, color: Polar.ink },
  titleFont: { fontFamily: PolarFonts.display, fontSize: 40, lineHeight: 44 },

  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  barRule: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(60,60,67,0.22)' },
  barTitle: { maxWidth: '70%', fontSize: 17, fontWeight: '600', color: '#000' },
  barEnd: { position: 'absolute', right: 12, bottom: 3 },

  loading: { width: '100%', height: 200, alignItems: 'center', justifyContent: 'center' },
  first: { fontFamily: PolarFonts.display, fontSize: 32, lineHeight: 34, color: Polar.ink, marginBottom: 6 },
  firstCta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 14, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, backgroundColor: Polar.signal },
  firstCtaText: { fontSize: 16, fontWeight: '600', color: Polar.ink },
  onSignal: { color: 'rgba(31,42,68,0.75)' },

  draft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  draftThumb: { width: 72, height: 72, overflow: 'hidden', borderRadius: 14, backgroundColor: Polar.deep },
  draftText: { flex: 1, gap: 3 },

  later: { marginTop: 26, paddingHorizontal: 16 },
  h: { marginHorizontal: 4, marginBottom: 8, fontSize: 20, fontWeight: '700', letterSpacing: -0.2, color: '#000' },
  list: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 10, paddingRight: 14 },
  rowRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(60,60,67,0.22)' },
  rowPressed: { backgroundColor: '#E5E5EA' },
  rowThumb: { width: 52, height: 52, overflow: 'hidden', borderRadius: 10, backgroundColor: Polar.deep },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#000' },
  rowMeta: { fontSize: 13, color: Polar.secondary },

  method: { marginTop: 14 },
  steps: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  stepCell: { width: '50%', flexDirection: 'row', gap: 6, paddingRight: 8 },
  stepNum: { fontFamily: PolarFonts.condensed, fontSize: 13, lineHeight: 17, color: Polar.ember },
  stepTitle: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 17, color: '#000' },
});
