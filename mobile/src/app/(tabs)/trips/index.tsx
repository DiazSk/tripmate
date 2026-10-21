import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Link, Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { formatDateRange, formatMoney } from '@shared/format';
import { city, clearsIn, country, phaseLine } from '@shared/memories';

import { useAccount } from '@/api/auth';
import { usePlacePhoto } from '@/api/placePhotos';
import { lastRequestReachedServer } from '@/api/session';
import { discardTrip, listTrips, shareTrip } from '@/api/tripMateApi';
import type { TripSummary } from '@/api/types';
import { OfflineScreen } from '@/components/offline-screen';
import { Scrim } from '@/components/polar-landing/scrim';
import { usePolarFonts, usePolarStatusBar } from '@/components/polar-ui';
import { Polar, PolarFonts } from '@/constants/polar';
import { BarHeight } from '@/constants/theme';
import { confirmDelete } from '@/lib/confirmDelete';
import { tripDays } from '@/lib/tiers';
import { matchesQuery, todayISO, tripShelves } from '@/lib/tripsWall';
import { useFocusedFetchWithRetry } from '@/lib/useFocusedFetch';

type Loaded = { saved: TripSummary[]; drafts: TripSummary[] };

const PAD = 20;
const GAP = 12;
const GRID_PREVIEW = 4;
const GREY = Polar.secondary;

/**
 * Trips, as the canvas design "Phone trips · 2 Albums, like Photos": trips are photographs before
 * they are rows, so the tab is laid out the way Photos lays out a life. What is coming up is a
 * carousel of tall cards that snap as you swipe; a draft not yet kept is one quiet line under it;
 * what is remembered is a grid of squares, newest first, behind See All.
 *
 * **The chrome is the system's.** The large title, the search bar and pull to refresh come from the
 * native navigation bar (`trips/_layout.tsx`); the title alone is set in Cormorant.
 *
 * **Every trip opens on a tap and offers its menu on a press and hold**, with the card as its own
 * preview (`Link.Preview` / `Link.Menu`, UIKit's context menu). Delete is in that menu and asks
 * first with the platform's destructive action sheet; there is no delete control on the cards.
 */
export default function Trips() {
  const router = useRouter();
  const fonts = usePolarFonts();
  const { account } = useAccount();
  // undefined = still loading, null = the server answered with a failure, 'offline' = it could not
  // be reached at all. Re-read on focus: a trip kept in the wizard has to show up here.
  const { data: fetched, retry } = useFocusedFetchWithRetry<Loaded | 'offline' | null>(async () => {
    const [saved, drafts] = await Promise.all([listTrips('saved'), listTrips('draft')]);
    if (saved) return { saved, drafts: drafts ?? [] };
    return lastRequestReachedServer() === false ? 'offline' : null;
  });
  const [gone, setGone] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Dark text on the white page; the offline screen is night all over, so it keeps white.
  usePolarStatusBar(fetched !== 'offline');

  if (fetched === 'offline') {
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

  const header = (
    <Stack.Screen
      options={{
        title: 'Trips',
        headerLargeTitle: true,
        headerTransparent: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerLargeTitleStyle: fonts ? { fontFamily: PolarFonts.display, fontSize: 40, color: Polar.ink } : { color: Polar.ink },
        headerTitleStyle: { color: Polar.ink },
        // The app runs in dark appearance (`userInterfaceStyle`), so the system would draw this bar
        // for a night page; this one is white, so its colours are said outright.
        headerSearchBarOptions: {
          placeholder: 'Search trips',
          textColor: Polar.ink,
          hintTextColor: GREY,
          headerIconColor: GREY,
          tintColor: Polar.ember,
          barTintColor: 'rgba(118,118,128,0.12)',
          hideWhenScrolling: true,
          onChangeText: (e) => setQuery(e.nativeEvent.text),
          onCancelButtonPress: () => setQuery(''),
        },
        // A plain bar item: iOS 26 draws its glass, light now that the tabs' stacks run the light
        // theme (`(tabs)/_layout.tsx`), so it reads as Home's + without a second glass of our own.
        // Drawn by the page over the bar instead, it never got the tap: the bar takes touches.
        headerRight: () => (
          <Pressable onPress={() => router.push('/plan/basics')} accessibilityRole="button" accessibilityLabel="Plan a trip" hitSlop={8} style={styles.plus}>
            <SymbolView name="plus" size={18} tintColor={Polar.ink} weight="semibold" />
          </Pressable>
        ),
      }}
    />
  );

  if (!fonts || fetched === undefined) {
    return (
      <View style={[styles.screen, styles.center]}>
        {header}
        <ActivityIndicator color={Polar.ink} />
      </View>
    );
  }

  const today = todayISO();
  const saved = fetched ? fetched.saved.filter((t) => !gone.includes(t.id)) : [];
  const drafts = fetched ? fetched.drafts.filter((t) => !gone.includes(t.id)) : [];
  const { upcoming, past } = tripShelves(saved, today);
  const searching = query.trim().length > 0;
  const results = searching ? [...upcoming, ...drafts, ...past].filter((t) => matchesQuery(t, query)) : [];

  async function refresh() {
    setRefreshing(true);
    const { commit } = await retry();
    commit?.();
    setRefreshing(false);
  }

  function askDelete(trip: TripSummary) {
    confirmDelete(trip, async () => {
      // Spliced locally once the server agrees; a failure leaves the card where it was.
      if (await discardTrip(trip.id)) setGone((g) => [...g, trip.id]);
      else Alert.alert("We couldn't delete that trip", 'Try again.');
    });
  }

  /** The same share the trip screen makes: a read-only link, then the system sheet. */
  async function share(trip: TripSummary) {
    const result = await shareTrip(trip.id);
    if (!result) return Alert.alert('That didn’t go through', 'Try again.');
    // One field by platform: iOS reads `message` + `url` as two items, Android has no `url`.
    await Share.share(Platform.OS === 'ios' ? { url: result.url } : { message: result.url }).catch(() => {});
  }

  const menu = { onShare: share, onDelete: askDelete };
  const kept = upcoming.length + past.length;

  return (
    <ScrollView
      style={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {header}

      {fetched === null ? (
        <Unavailable title="Not loaded" body="Couldn’t reach TripMate. Pull down to try again." />
      ) : kept + drafts.length === 0 ? (
        <Empty signedOut={!account} onPlan={() => router.push('/plan/basics')} onSignIn={() => router.push('/signin')} />
      ) : searching ? (
        results.length ? (
          <Grid trips={results} {...menu} />
        ) : (
          <Unavailable title="No Results" body={`No trips match “${query.trim()}”.`} />
        )
      ) : (
        <>
          {/* "0 trips" over a draft read as "nothing here" beside the thing that is here. */}
          <Text style={styles.sub}>
            {[
              kept ? `${kept} ${kept === 1 ? 'trip' : 'trips'}` : 'No kept trips yet',
              upcoming.length ? `${upcoming.length} coming up` : null,
              drafts.length ? `${drafts.length} ${drafts.length === 1 ? 'draft' : 'drafts'}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>

          {upcoming.length ? (
            <>
              <Text style={styles.h} accessibilityRole="header">
                Coming Up
              </Text>
              <Carousel trips={upcoming} {...menu} />
            </>
          ) : null}

          {drafts.map((t) => (
            <DraftLine key={t.id} trip={t} {...menu} />
          ))}

          {/* A draft is not a kept trip, so the invitation (and its Sign in) stays until one is. */}
          {kept === 0 ? (
            <Empty under signedOut={!account} onPlan={() => router.push('/plan/basics')} onSignIn={() => router.push('/signin')} />
          ) : null}

          {past.length ? (
            <>
              <View style={styles.hRow}>
                <Text style={styles.h} accessibilityRole="header">
                  Remembered
                </Text>
                {past.length > GRID_PREVIEW ? (
                  <Pressable onPress={() => setAll((v) => !v)} accessibilityRole="button" hitSlop={8}>
                    <Text style={styles.see}>{all ? 'Show Less' : 'See All'}</Text>
                  </Pressable>
                ) : null}
              </View>
              <Grid trips={all ? past : past.slice(0, GRID_PREVIEW)} {...menu} />
            </>
          ) : null}

          <Text style={styles.foot}>Hold a trip for more. Photographs via Wikipedia.</Text>
        </>
      )}
    </ScrollView>
  );
}

type Menu = { onShare: (t: TripSummary) => void; onDelete: (t: TripSummary) => void };

/**
 * A trip as a native link: tap to open, press and hold for the preview and the menu. `children` is
 * the card; `preview` is what lifts out of the page while the menu is open.
 *
 * **The card's `style` must be one flat object.** `asChild` merges the link's props into the child
 * through a `Slot`: a style function does not survive the merge (the card lost every style it had,
 * the draft line stopped being a row), and an array throws, so the cards `StyleSheet.flatten`. The press is
 * shown by the system anyway: a touch-down on a menu target dims it, and the hold lifts it.
 */
function TripLink({ trip, onShare, onDelete, preview, children }: Menu & { trip: TripSummary; preview: ReactNode; children: ReactNode }) {
  const draft = trip.status === 'draft';
  return (
    <Link href={`/trip/${trip.id}`} asChild>
      <Link.Trigger>{children}</Link.Trigger>
      <Link.Preview style={styles.previewSize}>{preview}</Link.Preview>
      <Link.Menu>
        {draft ? null : <Link.MenuAction title="Share Link…" subtitle="Anyone with the link can read it" icon="square.and.arrow.up" onPress={() => onShare(trip)} />}
        <Link.MenuAction title={draft ? 'Discard Draft' : 'Delete Trip'} icon="trash" destructive onPress={() => onDelete(trip)} />
      </Link.Menu>
    </Link>
  );
}

function photoUrl(photo: ReturnType<typeof usePlacePhoto>) {
  return photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
}

/** Coming up: tall cards that snap, the next one peeking in from the right, dots beneath. */
function Carousel({ trips, ...menu }: Menu & { trips: TripSummary[] }) {
  const { width } = useWindowDimensions();
  const cardW = width - 64;
  const [page, setPage] = useState(0);
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardW + GAP}
        decelerationRate="fast"
        // Room after the last card, so it snaps to the same left edge as every other one.
        contentContainerStyle={[styles.carousel, { paddingRight: width - cardW - PAD }]}
        scrollEventThrottle={32}
        onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (cardW + GAP)))}>
        {trips.map((t, i) => (
          <Tall key={t.id} trip={t} width={cardW} lead={i === 0} {...menu} />
        ))}
      </ScrollView>
      {trips.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {trips.map((t, i) => (
            <View key={t.id} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>
      ) : (
        <View style={styles.dotsSpace} />
      )}
    </View>
  );
}

function Tall({ trip, width, lead, ...menu }: Menu & { trip: TripSummary; width: number; lead: boolean }) {
  const url = photoUrl(usePlacePhoto(trip.destination));
  const line = phaseLine(trip);
  return (
    <TripLink trip={trip} {...menu} preview={<Preview trip={trip} url={url} />}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${trip.destination}, ${line}`} style={StyleSheet.flatten([styles.tall, { width }])}>
        <Photo url={url} word={city(trip)} recyclingKey={trip.id} />
        <Scrim stops={[[0, Polar.night, 0.3], [0.3, Polar.night, 0], [0.5, Polar.night, 0], [1, Polar.night, 0.8]]} />
        {lead ? (
          <Text style={[styles.pill, styles.pillLead]}>{line}</Text>
        ) : (
          <BlurView intensity={30} tint="light" style={styles.pillGlass}>
            <Text style={styles.pillGlassText}>{line}</Text>
          </BlurView>
        )}
        <View style={styles.tallCopy}>
          <Text style={styles.tallCity} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>
            {city(trip).toUpperCase()}
          </Text>
          <Text style={styles.tallMeta}>
            {formatDateRange(trip.startDate, trip.endDate)} · {tripDays(trip.startDate, trip.endDate)} days
          </Text>
        </View>
      </Pressable>
    </TripLink>
  );
}

/** A draft: one line between what is coming and what is remembered, with the days it has left. */
function DraftLine({ trip, ...menu }: Menu & { trip: TripSummary }) {
  const url = photoUrl(usePlacePhoto(trip.destination));
  const clears = clearsIn(trip);
  return (
    <TripLink trip={trip} {...menu} preview={<Preview trip={trip} url={url} />}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open your ${trip.destination} draft`} style={styles.draft}>
        <View style={styles.draftThumb}>
          <Photo url={url} word={city(trip)} recyclingKey={trip.id} small />
        </View>
        <View style={styles.draftText}>
          <Text style={styles.draftTitle} numberOfLines={1}>
            Draft · {city(trip)}
          </Text>
          {clears ? <Text style={styles.draftClears}>{clears}</Text> : null}
        </View>
        <SymbolView name="chevron.right" size={13} tintColor="rgba(60,60,67,0.3)" weight="semibold" />
      </Pressable>
    </TripLink>
  );
}

/** Photos' album grid, two across: the city and the year over each square. */
function Grid({ trips, ...menu }: Menu & { trips: TripSummary[] }) {
  const { width } = useWindowDimensions();
  const side = (width - PAD * 2 - 10) / 2;
  return (
    <View style={styles.grid}>
      {/* Sized by a plain view: the link adds a native wrapper of its own, which as a direct flex
          child put every square on a row of its own. */}
      {trips.map((t) => (
        <View key={t.id} style={{ width: side, height: side }}>
          <Square trip={t} side={side} {...menu} />
        </View>
      ))}
    </View>
  );
}

function Square({ trip, side, ...menu }: Menu & { trip: TripSummary; side: number }) {
  const url = photoUrl(usePlacePhoto(trip.destination));
  const draft = trip.status === 'draft';
  return (
    <TripLink trip={trip} {...menu} preview={<Preview trip={trip} url={url} />}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${trip.destination}${draft ? ', draft' : ''}`} style={StyleSheet.flatten([styles.square, { width: side, height: side }])}>
        <Photo url={url} word={city(trip)} recyclingKey={trip.id} />
        <Scrim stops={[[0, Polar.night, 0], [0.5, Polar.night, 0], [1, Polar.night, 0.7]]} />
        <View style={styles.squareCopy}>
          <Text style={styles.squareCity} numberOfLines={1}>
            {city(trip)}
          </Text>
          <Text style={styles.squareYear}>{draft ? 'Draft' : trip.startDate.slice(0, 4)}</Text>
        </View>
      </Pressable>
    </TripLink>
  );
}

/** The photograph, over the place's initial on the night ground, so a miss is never a blank. */
function Photo({ url, word, recyclingKey, small = false }: { url: string | null; word: string; recyclingKey: string; small?: boolean }) {
  return (
    <>
      <Text style={[styles.initial, small && styles.initialSmall]}>{word.slice(0, 1)}</Text>
      {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} recyclingKey={recyclingKey} accessibilityIgnoresInvertColors /> : null}
    </>
  );
}

/** What lifts out of the page under the menu: the photograph, then the facts. */
function Preview({ trip, url }: { trip: TripSummary; url: string | null }) {
  const days = tripDays(trip.startDate, trip.endDate);
  const place = country(trip);
  return (
    <View style={styles.preview}>
      <View style={styles.previewPhoto}>
        <Photo url={url} word={city(trip)} recyclingKey={`p-${trip.id}`} />
      </View>
      <View style={styles.previewText}>
        <Text style={styles.previewCity}>{city(trip)}</Text>
        <Text style={styles.previewMeta} numberOfLines={1}>
          {[place, formatDateRange(trip.startDate, trip.endDate), `${days} ${days === 1 ? 'day' : 'days'}`, formatMoney(trip.budget)].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

function Empty({ signedOut, onPlan, onSignIn, under = false }: { signedOut: boolean; onPlan: () => void; onSignIn: () => void; under?: boolean }) {
  return (
    <View style={[styles.empty, under && styles.emptyUnder]}>
      <View style={styles.emptyStack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.emptyCard, styles.emptyLeft]} />
        <View style={[styles.emptyCard, styles.emptyRight]} />
        <View style={[styles.emptyCard, styles.emptyFront]} />
      </View>
      <Text style={styles.emptyTitle} accessibilityRole="header">
        Your trips land here
      </Text>
      <Text style={styles.emptyBody}>Each one you keep becomes a photograph: coming up at the top, remembered below.</Text>
      <Pressable onPress={onPlan} accessibilityRole="button" style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
        <Text style={styles.ctaText}>Plan a Trip</Text>
      </Pressable>
      {/* Only signed out, and only with nothing kept: somebody with trips on the web opens this app
          to an empty tab, and this is the reason. */}
      {signedOut ? (
        <Pressable onPress={onSignIn} accessibilityRole="button" style={styles.link}>
          <Text style={styles.linkText}>Already have trips? Sign in</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.unavailable}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // White, as Photos is, so the pictures carry the colour.
  screen: { flex: 1, backgroundColor: '#fff' },
  center: { alignItems: 'center', justifyContent: 'center' },
  plus: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  // Clears the floating tab bar, whose inset does not reach this list.
  content: { paddingBottom: BarHeight + 40 },

  sub: { marginHorizontal: PAD, marginTop: 2, marginBottom: 18, fontSize: 15, color: GREY },
  hRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingRight: PAD },
  h: { marginHorizontal: PAD, marginBottom: 10, fontSize: 22, fontWeight: '700', letterSpacing: -0.3, color: '#000' },
  see: { fontSize: 17, color: Polar.ember },

  carousel: { gap: GAP, paddingHorizontal: PAD },
  tall: { aspectRatio: 3 / 4, overflow: 'hidden', borderRadius: 22, backgroundColor: Polar.deep, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', top: 14, left: 14, overflow: 'hidden', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 14, fontSize: 13, fontWeight: '600' },
  pillLead: { color: Polar.ink, backgroundColor: Polar.signal },
  pillGlass: { position: 'absolute', top: 14, left: 14, overflow: 'hidden', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 14 },
  pillGlassText: { fontSize: 13, fontWeight: '600', color: Polar.ice },
  tallCopy: { position: 'absolute', left: 18, right: 18, bottom: 18 },
  tallCity: { fontFamily: PolarFonts.condensed, fontSize: 46, lineHeight: 50, color: Polar.ice },
  tallMeta: { marginTop: 4, fontSize: 15, color: 'rgba(255,255,255,0.85)', fontVariant: ['tabular-nums'] },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginTop: 12, marginBottom: 18 },
  dotsSpace: { height: 18 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(60,60,67,0.22)' },
  dotOn: { backgroundColor: Polar.ink },

  draft: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: PAD, marginBottom: 26, padding: 10, paddingRight: 14, borderRadius: 16, backgroundColor: '#F2F2F7' },
  draftThumb: { width: 48, height: 48, overflow: 'hidden', borderRadius: 10, backgroundColor: Polar.deep, alignItems: 'center', justifyContent: 'center' },
  draftText: { flex: 1, minWidth: 0, gap: 1 },
  draftTitle: { fontSize: 16, fontWeight: '600', color: '#000' },
  draftClears: { fontSize: 13, color: Polar.ember },

  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 12, paddingHorizontal: PAD },
  square: { overflow: 'hidden', borderRadius: 14, backgroundColor: Polar.deep, alignItems: 'center', justifyContent: 'center' },
  squareCopy: { position: 'absolute', left: 12, right: 12, bottom: 10 },
  squareCity: { fontSize: 16, fontWeight: '600', color: Polar.ice },
  squareYear: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },

  initial: { fontFamily: PolarFonts.display, fontSize: 140, lineHeight: 160, color: 'rgba(255,255,255,0.14)' },
  initialSmall: { fontSize: 30, lineHeight: 36 },

  preview: { width: 340, backgroundColor: '#fff' },
  previewSize: { width: 340, height: 330 },
  previewPhoto: { height: 255, overflow: 'hidden', backgroundColor: Polar.deep, alignItems: 'center', justifyContent: 'center' },
  previewText: { gap: 2, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  previewCity: { fontSize: 17, fontWeight: '600', color: '#000' },
  previewMeta: { fontSize: 14, color: GREY, fontVariant: ['tabular-nums'] },

  foot: { marginTop: 22, marginHorizontal: PAD, fontSize: 12, textAlign: 'center', color: GREY },

  empty: { alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingTop: 60 },
  emptyUnder: { paddingTop: 4 },
  emptyStack: { width: 120, height: 120, marginBottom: 14 },
  emptyCard: { position: 'absolute', top: 10, bottom: 10, left: 20, right: 20, borderRadius: 14, backgroundColor: '#E5E5EA' },
  emptyLeft: { transform: [{ translateX: -14 }, { rotate: '-10deg' }] },
  emptyRight: { backgroundColor: '#D9D9DE', transform: [{ translateX: 14 }, { rotate: '8deg' }] },
  emptyFront: { backgroundColor: Polar.signal },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: '#000', textAlign: 'center' },
  emptyBody: { fontSize: 15, lineHeight: 21, color: GREY, textAlign: 'center' },
  cta: { marginTop: 14, height: 50, paddingHorizontal: 28, borderRadius: 25, justifyContent: 'center', backgroundColor: Polar.signal },
  ctaPressed: { backgroundColor: Polar.signalPressed },
  ctaText: { fontSize: 17, fontWeight: '600', color: Polar.ink },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: 15, fontWeight: '600', color: Polar.ember },
  unavailable: { alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingTop: 80 },
});
