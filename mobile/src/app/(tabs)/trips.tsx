import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DRAFT_TTL_DAYS } from '@shared/drafts';
import { formatDateRange, formatMoney } from '@shared/format';
import { city, clearsIn, country, featured, phase, phaseLine, postmark, rememberedLine } from '@shared/memories';

import { useAccount } from '@/api/auth';
import { usePlacePhoto } from '@/api/placePhotos';
import { lastRequestReachedServer } from '@/api/session';
import { discardTrip, listTrips } from '@/api/tripMateApi';
import type { TripSummary } from '@/api/types';
import { OfflineScreen } from '@/components/offline-screen';
import { Scrim } from '@/components/polar-landing/scrim';
import { PaperError, QuietLink, SignalButton, monumentFontSize, usePolarFonts, usePolarStatusBar } from '@/components/polar-ui';
import { Polar, PolarFonts, PolarRadius, PolarSpace, PolarType } from '@/constants/polar';
import { BarHeight } from '@/constants/theme';
import { tripDays } from '@/lib/tiers';
import { todayISO, wallOrder } from '@/lib/tripsWall';
import { useFocusedFetchWithRetry } from '@/lib/useFocusedFetch';

type Loaded = { saved: TripSummary[]; drafts: TripSummary[] };
type Tab = 'memories' | 'drafts';

/**
 * My memories: the web's postcard wall (`/trips`, design A), for the phone.
 *
 * The next trip still to come, else the one that started last, fills the first screen with its city
 * set across the foot as the monument. Below it, on paper, a postcard per trip in one column: the
 * city stamped in Oswald, the month it starts as a postmark, and a flag for where it stands. Drafts
 * sit behind a toggle that only exists while there are some, and say how long they have.
 *
 * **Delete is in the caption, on paper, level with the destination.** On the photograph it shared
 * a corner with the postmark. It asks first, with the platform's own destructive alert.
 */
export default function Trips() {
  const router = useRouter();
  const fonts = usePolarFonts();
  const { account } = useAccount();
  const { height } = useWindowDimensions();
  // undefined = still loading, null = the server answered with a failure, 'offline' = it could not
  // be reached at all. Re-read on focus: a trip kept in the wizard has to show up here. Both lists
  // at once, so the toggle never appears a beat late.
  const { data: fetched, retry } = useFocusedFetchWithRetry<Loaded | 'offline' | null>(async () => {
    const [saved, drafts] = await Promise.all([listTrips('saved'), listTrips('draft')]);
    if (saved) return { saved, drafts: drafts ?? [] };
    return lastRequestReachedServer() === false ? 'offline' : null;
  });
  const offline = fetched === 'offline';
  const loaded = offline ? null : fetched;
  // Deleted here, spliced locally until the next focus re-reads the server.
  const [gone, setGone] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('memories');
  const [error, setError] = useState<string | null>(null);
  const [pastHero, setPastHero] = useState(false);

  const today = todayISO();
  const saved = loaded ? wallOrder(loaded.saved.filter((t) => !gone.includes(t.id)), today) : [];
  const drafts = loaded ? loaded.drafts.filter((t) => !gone.includes(t.id)) : [];
  // The toggle exists only with a second collection, so the tab in force is derived every render:
  // discarding the last draft must not leave `tab` pointing at a list that is gone.
  const activeTab: Tab = drafts.length > 0 ? tab : 'memories';
  const shown = activeTab === 'drafts' ? drafts : saved;
  const heroHeight = Math.round(height * 0.86);
  const hasHero = saved.length > 0;
  // The offline screen is night all over, so the bar stays white over it.
  usePolarStatusBar(!offline && (!hasHero || pastHero));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPastHero(e.nativeEvent.contentOffset.y > heroHeight - 60);

  function askDelete(trip: TripSummary) {
    const draft = trip.status === 'draft';
    Alert.alert(
      draft ? 'Discard this draft?' : 'Delete this trip?',
      `Your ${trip.destination} itinerary will be permanently deleted. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: draft ? 'Discard draft' : 'Delete trip',
          style: 'destructive',
          onPress: async () => {
            setError(null);
            // The card stays put on a failure, which is the honest reflection of a delete that
            // didn't happen; the line above the wall says so.
            if (await discardTrip(trip.id)) setGone((g) => [...g, trip.id]);
            else setError("We couldn't delete that trip. Try again.");
          },
        },
      ],
    );
  }

  if (offline) {
    return (
      <OfflineScreen
        bottomInset={BarHeight}
        // A server that answers, even with an error, ends the offline screen: its own notice says the rest.
        retry={async () => {
          const { result, commit } = await retry();
          return result === 'offline' ? null : commit;
        }}
      />
    );
  }

  if (!fonts || loaded === undefined) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: Polar.night }]}>
        <ActivityIndicator color={Polar.ice} />
      </View>
    );
  }

  const wallHead = (
    <View style={styles.wallHead}>
      {error ? <PaperError>{error}</PaperError> : null}
      {drafts.length > 0 ? (
        <View style={styles.tabs} accessibilityRole="radiogroup" accessibilityLabel="Which trips to show">
          {(['memories', 'drafts'] as const).map((t) => (
            <Pressable
              key={t}
              accessibilityRole="radio"
              accessibilityState={{ checked: activeTab === t }}
              onPress={() => setTab(t)}
              style={[styles.tab, activeTab === t && styles.tabOn]}>
              <Text style={[styles.tabText, activeTab === t && styles.tabTextOn]}>
                {t === 'memories' ? 'My memories' : 'Drafts'} <Text style={styles.tabCount}>{t === 'memories' ? saved.length : drafts.length}</Text>
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {activeTab === 'drafts' ? (
        <Text style={styles.note}>
          Plans you generated but haven&apos;t kept. Open one to carry on where you left off. Unkept drafts are cleared after {DRAFT_TTL_DAYS} days.
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={loaded === null ? [] : shown}
        keyExtractor={(t) => t.id}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            {loaded === null ? (
              <Empty title="Not loaded" body="Couldn't reach TripMate. Check your connection." />
            ) : hasHero ? (
              <Hero trips={saved} height={heroHeight} />
            ) : (
              <Empty
                title="Your memories start here"
                body="Plan a trip and it shows up here once you keep it: a postcard for every place you have been, and every place you are going."
                action={<SignalButton large title="Plan your first trip" onPress={() => router.push('/plan/basics')} />}
                // Only signed out, and only with nothing here: somebody with trips on the web opens
                // this app to a blank wall, and this is the reason.
                extra={!account ? <QuietLink title="Already have trips? Sign in" onPress={() => router.push('/signin')} style={styles.selfCenter} /> : null}
              />
            )}
            {loaded !== null && (saved.length > 0 || drafts.length > 0) ? wallHead : null}
          </>
        }
        ListEmptyComponent={
          loaded !== null && drafts.length > 0 ? (
            <Text style={[styles.note, styles.gutter]}>Nothing kept yet. Open a draft and press Keep this trip, and it becomes a memory here.</Text>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        renderItem={({ item }) => <Postcard trip={item} today={today} onOpen={() => router.push(`/trip/${item.id}`)} onDelete={() => askDelete(item)} />}
        ListFooterComponent={<Text style={styles.foot}>Every journey here was planned in TripMate. Photographs via Wikipedia.</Text>}
      />
    </View>
  );
}

/** The first screen: the featured trip's photograph, the page's sentence, and the city across the foot. */
function Hero({ trips, height }: { trips: TripSummary[]; height: number }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const hero = featured(trips);
  const photo = usePlacePhoto(hero?.destination);
  if (!hero) return null;
  const word = city(hero);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  const size = monumentFontSize(word, width - PolarSpace.pad * 2, height * 0.24);
  return (
    <View style={[styles.hero, { height, paddingTop: insets.top }]}>
      {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={600} accessibilityIgnoresInvertColors /> : null}
      <Scrim stops={[[0, Polar.night, 0.5], [0.22, Polar.night, 0], [0.38, Polar.night, 0], [0.62, Polar.night, 0.55], [1, Polar.night, 0.88]]} />
      <View style={styles.heroCopy}>
        <View style={styles.next}>
          <View style={styles.dot} />
          <Text style={[PolarType.eyebrow, styles.onDark, styles.small]}>
            {phase(hero) === 'past' ? 'Most recent' : 'Next'}: {word} · {phaseLine(hero)}
          </Text>
        </View>
        <Text style={[PolarType.display, styles.onDark]} accessibilityRole="header">
          My memories
        </Text>
        <Text style={[PolarType.lead, styles.onDark]}>{rememberedLine(trips)}</Text>
        <Text style={[PolarType.coord, styles.onDark2]}>
          {hero.destination} · {formatDateRange(hero.startDate, hero.endDate)}
        </Text>
      </View>
      <Text style={[PolarType.monument, styles.monument, { fontSize: size, lineHeight: Math.round(size * 1.15) }]} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {word}
      </Text>
    </View>
  );
}

function Empty({ title, body, action, extra }: { title: string; body: string; action?: React.ReactNode; extra?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.empty, { paddingTop: insets.top + PolarSpace.s10 }]}>
      <Text style={PolarType.kicker}>Nothing kept yet.</Text>
      <Text style={[PolarType.display, styles.ink, styles.centerText]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[PolarType.body, styles.muted, styles.centerText]}>{body}</Text>
      {action}
      {extra}
    </View>
  );
}

function Postcard({ trip, today, onOpen, onDelete }: { trip: TripSummary; today: string; onOpen: () => void; onDelete: () => void }) {
  const { width } = useWindowDimensions();
  const photo = usePlacePhoto(trip.destination);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  const draft = trip.status === 'draft';
  const pm = postmark(trip);
  const days = tripDays(trip.startDate, trip.endDate);
  const word = city(trip);
  const place = country(trip);
  const clears = draft ? clearsIn(trip, new Date(`${today}T12:00:00Z`)) : null;
  const cardW = width - PolarSpace.pad * 2;
  const stamp = Math.min(cardW * 0.18, monumentFontSize(word, cardW - 20, 66));
  return (
    // Delete is a sibling of the card's press target, never inside it: one press, one meaning.
    <View style={styles.card}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open your ${trip.destination} ${draft ? 'draft' : 'trip'}`} style={({ pressed }) => [styles.cardPress, pressed && styles.pressed]}>
        <View style={styles.photo}>
          {/* The typographic card is the base and never unmounts: a photo miss reads as the
              place's initial on the night ground, and a hit fades in over it. */}
          <Text style={[styles.initial, { fontSize: cardW * 0.42, lineHeight: cardW * 0.5 }]}>{word.slice(0, 1)}</Text>
          {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} recyclingKey={trip.id} accessibilityIgnoresInvertColors /> : null}
          <Scrim stops={[[0, Polar.night, 0.25], [0.3, Polar.night, 0], [0.55, Polar.night, 0], [1, Polar.night, 0.6]]} />
          <Text style={[styles.stamp, { fontSize: stamp, lineHeight: Math.round(stamp * 1.15) }]} numberOfLines={1}>
            {word}
          </Text>
          <View style={styles.postmark}>
            <Text style={styles.pmMonth}>{pm.month}</Text>
            <Text style={styles.pmYear}>{pm.year}</Text>
          </View>
          {draft ? (
            <Text style={[styles.flag, styles.flagDraft]}>Draft</Text>
          ) : phase(trip) !== 'past' ? (
            <Text style={styles.flag}>{phaseLine(trip)}</Text>
          ) : null}
        </View>
        <View style={styles.caption}>
          <Text style={styles.dest}>
            {word}
            {place ? <Text style={styles.country}>{`  ${place.toUpperCase()}`}</Text> : null}
          </Text>
          <Text style={styles.meta}>
            {formatDateRange(trip.startDate, trip.endDate)} · {days} {days === 1 ? 'day' : 'days'} · {formatMoney(trip.budget)}
          </Text>
          {clears ? <Text style={styles.clears}>{clears}</Text> : null}
        </View>
      </Pressable>
      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel={draft ? `Discard your ${trip.destination} draft` : `Delete your ${trip.destination} trip`}
        style={({ pressed }) => [styles.delete, { top: cardW * 0.75 + 8 }, pressed && styles.deletePressed]}>
        {({ pressed }) => (
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5" fill="none" stroke={pressed ? Polar.ice : Polar.charcoal} strokeWidth={1.3} />
          </Svg>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Polar.paper },
  center: { alignItems: 'center', justifyContent: 'center' },
  // Clears the floating tab bar, whose inset does not reach this list.
  content: { paddingBottom: BarHeight + PolarSpace.s5 },
  gutter: { paddingHorizontal: PolarSpace.pad },
  gap: { height: PolarSpace.s5 },
  onDark: { color: Polar.ice },
  onDark2: { color: Polar.nightText2 },
  ink: { color: Polar.ink },
  muted: { color: Polar.charcoal },
  small: { fontSize: 11 },
  centerText: { textAlign: 'center' },
  selfCenter: { alignSelf: 'center' },

  hero: { justifyContent: 'flex-end', overflow: 'hidden', backgroundColor: Polar.night, paddingHorizontal: PolarSpace.pad, marginBottom: PolarSpace.s6 },
  heroCopy: { gap: 8, paddingBottom: PolarSpace.s3 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Polar.signal },
  monument: { color: Polar.ice, opacity: 0.94 },

  empty: { alignItems: 'center', gap: PolarSpace.s3, paddingHorizontal: PolarSpace.pad, paddingBottom: PolarSpace.s6 },

  wallHead: { gap: PolarSpace.s3, paddingHorizontal: PolarSpace.pad, marginBottom: PolarSpace.s4 },
  tabs: { flexDirection: 'row', alignSelf: 'flex-start', padding: 3, gap: 3, borderRadius: PolarRadius.sm, backgroundColor: Polar.veil05 },
  tab: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: PolarRadius.hairline },
  tabOn: { backgroundColor: Polar.ice, shadowColor: Polar.ink, shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  tabText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.charcoal },
  tabTextOn: { color: Polar.ink },
  tabCount: { fontFamily: PolarFonts.sans, fontVariant: ['tabular-nums'] },
  note: { fontFamily: PolarFonts.sans, fontSize: 14, lineHeight: 21, color: Polar.charcoal },

  card: { marginHorizontal: PolarSpace.pad },
  cardPress: { gap: 12 },
  pressed: { opacity: 0.85 },
  photo: { aspectRatio: 4 / 3, overflow: 'hidden', borderRadius: PolarRadius.card, backgroundColor: Polar.deep, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: PolarFonts.display, color: 'rgba(255,255,255,0.14)' },
  stamp: { ...PolarType.monument, position: 'absolute', left: 10, bottom: 2, right: 10, color: Polar.ice, opacity: 0.95 },
  postmark: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-12deg' }],
  },
  pmMonth: { fontFamily: PolarFonts.condensed, fontSize: 16, lineHeight: 18, letterSpacing: 1, color: Polar.ice },
  pmYear: { fontFamily: PolarFonts.sansSemi, fontSize: 9, letterSpacing: 1.3, color: Polar.ice },
  flag: {
    position: 'absolute',
    top: 14,
    left: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
    borderRadius: PolarRadius.hairline,
    backgroundColor: 'rgba(255,255,255,0.88)',
    fontFamily: PolarFonts.sansSemi,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Polar.ink,
  },
  flagDraft: { backgroundColor: Polar.signal },
  // Room on the right for the delete control beside the first line.
  caption: { gap: 3, paddingRight: 52 },
  dest: { fontFamily: PolarFonts.display, fontSize: 25, lineHeight: 28, color: Polar.ink },
  country: { fontFamily: PolarFonts.sansSemi, fontSize: 11, letterSpacing: 1.3, color: Polar.charcoal },
  meta: { fontFamily: PolarFonts.sans, fontSize: 13, lineHeight: 18, color: Polar.charcoal, fontVariant: ['tabular-nums'] },
  clears: { fontFamily: PolarFonts.sans, fontSize: 12, color: Polar.ember },
  delete: {
    position: 'absolute',
    right: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Polar.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deletePressed: { backgroundColor: Polar.alertText, borderColor: Polar.alertText },
  foot: { marginTop: PolarSpace.s6, paddingTop: PolarSpace.s4, paddingHorizontal: PolarSpace.pad, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Polar.rule, fontFamily: PolarFonts.sans, fontSize: 12, color: Polar.charcoal },
});
