import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateRange } from '@shared/format';
import { city } from '@shared/memories';
import { profileSentence } from '@shared/profileSentence';
import { legacyExplorerStyle, travelStyleOf } from '@shared/userAnswers';

import { signOut, useAccount, type Account } from '@/api/auth';
import { usePlacePhoto } from '@/api/placePhotos';
import { subscribeToSession } from '@/api/session';
import { getProfile, getProfileStats, listSavedPlaces, listTrips, saveProfile } from '@/api/tripMateApi';
import type { DiscoveryPreference, PacePreference, ProfileStats, SavedPlace, TravelerProfile, TripSummary } from '@/api/types';
import { Avatar } from '@/components/avatar';
import { HomeCitySearch } from '@/components/home-city-search';
import { Scrim } from '@/components/polar-landing/scrim';
import { PaperError, monumentFontSize, usePolarFonts, usePolarStatusBar } from '@/components/polar-ui';
import { APPEARANCE, setAppearance } from '@/constants/appearance';
import { Polar, PolarFonts, PolarRadius, PolarSpace, PolarType } from '@/constants/polar';
import { BarHeight } from '@/constants/theme';
import { CROWDS, DIETARY_TAGS, DISCOVERIES, ENERGY, GROUPS, INTERESTS, MAX_STARRED, PACES, emptyDraft, toTravelerProfile, toggleTag } from '@/lib/planDraft';
import { formatMoney } from '@/lib/spend';

import graubunden from '@/assets/images/scenes/graubunden-autumn-valley.webp';

/**
 * Your travel profile: the web's field notes (`/profile`, design B), for the phone.
 *
 * The latest kept trip's photograph carries the masthead, with your first name as the monument and
 * the three figures. Below it the profile is said back as one sentence that rewrites itself as you
 * answer, so you read what the planner will read; then the eight answers, each with its controls in
 * place, on paper. The web's sticky index of answers is a desktop thing and stays there, as it does
 * on the web's own phone width.
 *
 * **It saves as you go, as it always has here.** Each edit queues a PUT of the whole profile
 * (`PUT /api/profile` replaces rather than merges), debounced so a burst of chip taps is one
 * request, and flushed when the tab is left. The line under the answers says whether it landed.
 */

/** Long enough that a burst of chip taps is one request, short enough that leaving the tab rarely
 *  races it, and blur flushes what is pending. Matches `ProfileStore.edited()` in the Swift app. */
const SAVE_DEBOUNCE_MS = 600;

/** `undefined` still loading · `null` the fetch failed · a profile otherwise. A traveller with no
 *  profile gets the wizard's defaults, and nothing is written until their first edit. */
type Loaded = TravelerProfile | null | undefined;

/**
 * One half of the pair, plus the legacy field both halves derive to. Written together: `explorerStyle`
 * is still what a stored row and the frozen Swift app read.
 */
function withLegacy(profile: TravelerProfile, change: { pace?: PacePreference; discovery?: DiscoveryPreference }): Partial<TravelerProfile> {
  const next = { ...travelStyleOf(profile), ...change };
  return { ...change, explorerStyle: legacyExplorerStyle(next) };
}

const SECTIONS = [
  { key: 'group', title: 'Who you usually travel with', hint: "A default only. The planner still asks who's coming on each trip, since that changes." },
  { key: 'pace', title: 'How full a day' },
  { key: 'discovery', title: 'What to see' },
  { key: 'energy', title: 'How much walking suits you' },
  { key: 'crowds', title: 'Crowds' },
  { key: 'interests', title: 'What matters most', hint: 'Star up to three. The starred ones drive the plan.' },
  { key: 'dietary', title: 'Dietary needs', hint: 'Applied to every food stop on every trip. Leave it empty if nothing applies.' },
  { key: 'home', title: 'Home city', hint: 'Where you usually set off from. It helps with travel times and the best months to go.' },
] as const;

export default function Profile() {
  const fonts = usePolarFonts();
  const { account } = useAccount();
  const { height } = useWindowDimensions();
  const [profile, setProfile] = useState<Loaded>(undefined);
  const [stats, setStats] = useState<ProfileStats | undefined>(undefined);
  const [recent, setRecent] = useState<TripSummary[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [failed, setFailed] = useState(false);
  const [pastMast, setPastMast] = useState(false);
  const mastHeight = Math.round(height * 0.62);
  usePolarStatusBar(pastMast);

  /**
   * True from the first edit until a PUT carrying it succeeds: the screen's one correctness guard.
   * The profile is re-read on every focus, and that read would overwrite an edit that has not
   * reached the server. It clears on success, which hands authority back to the server.
   */
  const unsaved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<TravelerProfile | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    void saveProfile(next).then((ok) => {
      setFailed(!ok);
      // Only a success releases the guard, and only if nothing was queued behind this write.
      if (ok && !timer.current) unsaved.current = false;
    });
  }, []);

  /** Read everything for whoever the caller currently is. Returns its own cancel: a tab change and
   *  a sign-out can each land mid-flight, and a late reply must not win. */
  const load = useCallback(() => {
    let active = true;
    if (!unsaved.current) {
      void getProfile().then((result) => {
        if (!active || unsaved.current) return;
        setProfile(result === undefined ? null : (result ?? toTravelerProfile(emptyDraft())));
      });
    }
    void getProfileStats().then((r) => active && setStats(r));
    void listTrips().then((r) => active && setRecent((r ?? []).slice(0, 6)));
    void listSavedPlaces().then((r) => active && setPlaces(r ?? []));
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const cancel = load();
      // Leaving the tab mid-debounce must not sit on an unsent edit.
      return () => {
        cancel();
        flush();
      };
    }, [flush, load]),
  );

  // Signing in or out changes whose figures these are, and it happens on this very screen.
  useEffect(() => {
    let cancel: (() => void) | undefined;
    const unsubscribe = subscribeToSession(() => {
      cancel?.();
      cancel = load();
    });
    return () => {
      cancel?.();
      unsubscribe();
    };
  }, [load]);

  /** Queue an edit. The whole profile goes every time. */
  const edit = useCallback(
    (changes: Partial<TravelerProfile>) => {
      setProfile((current) => {
        if (!current) return current;
        const next = { ...current, ...changes };
        unsaved.current = true;
        pending.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
        return next;
      });
    },
    [flush],
  );

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPastMast(e.nativeEvent.contentOffset.y > mastHeight - 60);

  if (!fonts) return <View style={[styles.screen, { backgroundColor: Polar.night }]} />;

  return (
    <View style={styles.screen}>
      <ScrollView onScroll={onScroll} scrollEventThrottle={64} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Masthead account={account} lead={recent[0]} stats={stats} height={mastHeight} />

        <View style={styles.sentence}>
          <Text style={[PolarType.eyebrow, styles.ember, styles.small]}>What the planner reads</Text>
          {profile ? (
            <Text style={styles.line} accessibilityLiveRegion="polite">
              {profileSentence(profile)}
            </Text>
          ) : profile === null ? (
            <PaperError>Couldn&apos;t reach TripMate. Check your connection.</PaperError>
          ) : (
            <ActivityIndicator color={Polar.ink} style={styles.left} />
          )}
        </View>

        {profile ? (
          <View style={styles.fields}>
            {SECTIONS.map((s) => (
              <View key={s.key} style={styles.field}>
                <Text style={styles.fieldTitle} accessibilityRole="header">
                  {s.title}
                </Text>
                {'hint' in s ? <Text style={styles.hint}>{s.hint}</Text> : null}
                <View style={styles.control}>
                  <FieldControl k={s.key} profile={profile} edit={edit} />
                </View>
              </View>
            ))}
            {/* One line for the whole form: a single PUT writes every field, so blaming the
                section you last touched would be a guess. */}
            <View style={styles.saveLine}>
              {failed ? (
                <PaperError>Couldn&apos;t save that. It&apos;s still here, and the next change tries again.</PaperError>
              ) : (
                <Text style={styles.hint}>Saved as you go. Every new plan starts from these answers.</Text>
              )}
            </View>
          </View>
        ) : null}

        <Kept trips={recent} tripCount={stats?.trips} places={places} />

        <Pressable accessibilityRole="button" onPress={() => setAppearance(APPEARANCE === 'light' ? 'dark' : 'light')} style={styles.appearance}>
          <Text style={styles.appearanceLabel}>Appearance</Text>
          <Text style={styles.hint}>
            {APPEARANCE === 'light' ? 'Light' : 'Dark'} · a prototype. Switching restarts the app.
          </Text>
        </Pressable>
        <Text style={styles.foot}>Your answers stay on this phone, or on your account when you are signed in.</Text>
      </ScrollView>
    </View>
  );
}

/** The latest trip's photograph, the account, the figures, and the first name across the foot. */
function Masthead({ account, lead, stats, height }: { account: Account | null; lead: TripSummary | undefined; stats: ProfileStats | undefined; height: number }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const photo = usePlacePhoto(lead?.destination);
  const [busy, setBusy] = useState(false);
  // Undefined while the lookup runs, so the night ground holds rather than flashing the fallback.
  const remote = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  const source = !lead || (photo && !remote) ? graubunden : remote ? { uri: remote } : null;
  const name = account?.name?.trim() || null;
  const first = name?.split(/\s+/)[0] || 'Traveller';
  const size = monumentFontSize(first, width - PolarSpace.pad * 2, height * 0.24);

  return (
    <View style={[styles.mast, { height, paddingTop: insets.top }]}>
      {source ? <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" transition={600} accessibilityIgnoresInvertColors /> : null}
      <Scrim stops={[[0, Polar.night, 0.55], [0.24, Polar.night, 0.1], [0.5, Polar.night, 0.5], [1, Polar.night, 0.9]]} />
      <View style={styles.who}>
        <Avatar account={account} size={72} editable />
        <View style={styles.whoText}>
          <Text style={[PolarType.eyebrow, styles.onDark, styles.small]}>Travel profile</Text>
          <Text style={styles.fullname} accessibilityRole="header">
            {name ?? 'Your travel profile'}
          </Text>
          <Text style={styles.caption}>{account ? account.email : 'Not signed in. Sign in to add a photo and keep this profile on every device.'}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            hitSlop={6}
            style={styles.out}
            onPress={async () => {
              if (!account) return router.push('/signin');
              setBusy(true);
              await signOut();
              setBusy(false);
            }}>
            <Text style={styles.outText}>{account ? (busy ? 'Signing out…' : 'Sign out') : 'Sign in'}</Text>
          </Pressable>
        </View>
      </View>
      {/* Rendered once the figures arrive: three dashes say nothing an absent row does not. "Planned",
          not "Spent": `tripSpend` coalesces `actualCost ?? cost` and nothing here collects payments. */}
      {stats ? (
        <View style={styles.figures}>
          <Figure k="Trips kept" v={String(stats.trips)} />
          <Figure k="Places seen" v={String(stats.places)} />
          <Figure k="Planned" v={formatMoney(stats.spend)} />
        </View>
      ) : null}
      <Text style={[PolarType.monument, styles.monument, { fontSize: size, lineHeight: Math.round(size * 1.15) }]} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {first}
      </Text>
    </View>
  );
}

function Figure({ k, v }: { k: string; v: string }) {
  return (
    <View>
      <Text style={styles.dt}>{k}</Text>
      <Text style={styles.dd}>{v}</Text>
    </View>
  );
}

/** One answer from a short list, as a radio group. */
function Choices<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={name}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)} style={[styles.choice, on && styles.choiceOn]}>
            <Text style={styles.choiceText}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FieldControl({ k, profile, edit }: { k: (typeof SECTIONS)[number]['key']; profile: TravelerProfile; edit: (c: Partial<TravelerProfile>) => void }) {
  const style = travelStyleOf(profile);
  switch (k) {
    case 'group':
      return <Choices name="Who you usually travel with" value={profile.group} options={GROUPS} onChange={(group) => edit({ group })} />;
    case 'pace':
      return <Choices name="How full a day" value={style.pace} options={PACES} onChange={(pace) => edit(withLegacy(profile, { pace }))} />;
    case 'discovery':
      return <Choices name="What to see" value={style.discovery} options={DISCOVERIES} onChange={(discovery) => edit(withLegacy(profile, { discovery }))} />;
    case 'energy':
      return <Choices name="How much walking suits you" value={profile.energy} options={ENERGY} onChange={(energy) => edit({ energy })} />;
    case 'crowds':
      return <Choices name="Crowds" value={profile.crowds} options={CROWDS} onChange={(crowds) => edit({ crowds })} />;
    case 'interests':
      return <Interests profile={profile} edit={edit} />;
    case 'dietary':
      return (
        <View style={styles.stack}>
          <View style={styles.chips}>
            {DIETARY_TAGS.map((tag) => {
              const on = profile.dietary.tags.includes(tag);
              return (
                <Pressable
                  key={tag}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => edit({ dietary: { ...profile.dietary, tags: toggleTag(profile.dietary.tags, tag) } })}
                  style={[styles.chip, styles.chipPlain, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{tag}</Text>
                </Pressable>
              );
            })}
          </View>
          <NoteField value={profile.dietary.note} onChange={(note) => edit({ dietary: { ...profile.dietary, note } })} />
        </View>
      );
    case 'home':
      return (
        <View style={styles.stack}>
          {profile.homeCity ? (
            <View style={styles.homeNow}>
              <View style={styles.pin} />
              <Text style={styles.homeName}>{profile.homeCity.name}</Text>
            </View>
          ) : null}
          {/* Only a real pick saves. A null is the search saying the text moved off the picked city;
              that must not clear the saved one, or typing in the box would wipe it. */}
          <HomeCitySearch tone="paper" value={profile.homeCity ?? null} onPick={(homeCity) => { if (homeCity) edit({ homeCity }); }} />
        </View>
      );
  }
}

/**
 * Tags you choose, and up to three you star. Unstarring follows deselection (a starred tag no longer
 * chosen would keep driving the plan while showing as off), and starring chooses.
 */
function Interests({ profile, edit }: { profile: TravelerProfile; edit: (c: Partial<TravelerProfile>) => void }) {
  const stars = profile.topPriorities;
  const full = stars.length >= MAX_STARRED;
  const left = MAX_STARRED - stars.length;
  const toggle = (tag: string) => {
    const on = profile.priorities.includes(tag);
    edit({ priorities: toggleTag(profile.priorities, tag), topPriorities: on ? stars.filter((t) => t !== tag) : stars });
  };
  const star = (tag: string) => {
    if (stars.includes(tag)) return edit({ topPriorities: stars.filter((t) => t !== tag) });
    if (full) return;
    edit({ topPriorities: [...stars, tag], priorities: profile.priorities.includes(tag) ? profile.priorities : [...profile.priorities, tag] });
  };
  return (
    <View style={styles.stack}>
      <View style={styles.chips}>
        {INTERESTS.map((tag) => {
          const on = profile.priorities.includes(tag);
          const starred = stars.includes(tag);
          return (
            <View key={tag} style={[styles.chip, on && styles.chipOn, starred && styles.chipStar]}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => toggle(tag)} style={styles.chipMain}>
                <Text style={[styles.chipText, on && !starred && styles.chipTextOn]}>{tag}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={starred ? `Unstar ${tag}` : `Star ${tag}`}
                accessibilityState={{ selected: starred, disabled: !starred && full }}
                disabled={!starred && full}
                onPress={() => star(tag)}
                style={[styles.chipStarButton, !starred && full && styles.dim]}>
                <Text style={[styles.chipText, on && !starred && styles.chipTextOn]}>{starred ? '★' : '☆'}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      <Text style={styles.hint}>{stars.length ? `${stars.join(' > ')} · ${left ? `${left} left` : 'top three set'}` : 'No stars yet, so everything you pick counts the same.'}</Text>
    </View>
  );
}

/** The dietary note, held locally so each keystroke is not a profile edit until the field settles. */
function NoteField({ value, onChange }: { value: string; onChange: (note: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.noteField}>
      <Text style={styles.dtInk}>Anything else</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="An allergy, a dislike, a rule you keep"
        placeholderTextColor={Polar.stone}
        style={[styles.input, focused && styles.inputFocused]}
      />
    </View>
  );
}

/** What the trips you kept left behind: the latest few, and the places you saved for later. */
function Kept({ trips, tripCount, places }: { trips: TripSummary[]; tripCount: number | undefined; places: SavedPlace[] }) {
  return (
    <View style={styles.kept}>
      <View>
        <View style={styles.keptHead}>
          <Text style={[PolarType.eyebrow, styles.ink, styles.small]}>Recent memories</Text>
          {trips.length > 0 ? (
            <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push('/(tabs)/trips')}>
              <Text style={styles.keptLink}>{tripCount && tripCount > trips.length ? `See all ${tripCount}` : 'See all'}</Text>
            </Pressable>
          ) : null}
        </View>
        {trips.length > 0 ? (
          <View style={styles.strip}>
            {trips.map((t) => (
              <StripTrip key={t.id} trip={t} />
            ))}
          </View>
        ) : (
          <Text style={styles.hint}>Plan and keep a trip and it shows up here, with the places you chose.</Text>
        )}
      </View>
      {/* Absent with none: an empty list would explain a feature rather than record anything. */}
      {places.length > 0 ? (
        <View>
          <View style={styles.keptHead}>
            <Text style={[PolarType.eyebrow, styles.ink, styles.small]}>Saved places</Text>
            <Text style={styles.hint}>
              {Math.min(places.length, 4)} of {places.length}
            </Text>
          </View>
          {places.slice(0, 4).map((p) => (
            <View key={p.id} style={styles.place}>
              <Text style={styles.placeName}>{p.name}</Text>
              {p.city ? <Text style={styles.hint}>{p.city}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function StripTrip({ trip }: { trip: TripSummary }) {
  const photo = usePlacePhoto(trip.destination);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  const word = city(trip);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open your ${trip.destination} trip`} onPress={() => router.push(`/trip/${trip.id}`)} style={styles.stripItem}>
      <View style={styles.stripPhoto}>
        <Text style={styles.stripInitial}>{word.slice(0, 1)}</Text>
        {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} recyclingKey={trip.id} /> : null}
      </View>
      <Text style={styles.stripCity} numberOfLines={1}>
        {word}
      </Text>
      <Text style={styles.stripDates} numberOfLines={1}>
        {formatDateRange(trip.startDate, trip.endDate)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Polar.ice },
  // Clears the floating tab bar, whose inset does not reach this scroll view.
  scroll: { paddingBottom: BarHeight + PolarSpace.s5 },
  onDark: { color: Polar.ice },
  ink: { color: Polar.ink },
  ember: { color: Polar.ember },
  small: { fontSize: 11 },
  left: { alignSelf: 'flex-start' },
  dim: { opacity: 0.3 },

  mast: { justifyContent: 'flex-end', gap: PolarSpace.s3, overflow: 'hidden', paddingHorizontal: PolarSpace.pad, backgroundColor: Polar.night },
  who: { flexDirection: 'row', alignItems: 'flex-end', gap: PolarSpace.s3 },
  whoText: { flex: 1, gap: 3 },
  fullname: { fontFamily: PolarFonts.display, fontSize: 28, lineHeight: 30, color: Polar.ice },
  caption: { fontFamily: PolarFonts.sans, fontSize: 12, lineHeight: 17, color: Polar.nightText2 },
  out: { minHeight: 32, justifyContent: 'center', alignSelf: 'flex-start' },
  outText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ice, textDecorationLine: 'underline' },
  figures: { flexDirection: 'row', gap: PolarSpace.s5 },
  dt: { fontFamily: PolarFonts.sansSemi, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: Polar.nightText2 },
  dd: { fontFamily: PolarFonts.condensed, fontSize: 28, lineHeight: 32, color: Polar.ice, fontVariant: ['tabular-nums'] },
  monument: { color: Polar.ice, opacity: 0.94 },

  sentence: { gap: 10, paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s6, paddingBottom: PolarSpace.s5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Polar.rule },
  line: { fontFamily: PolarFonts.displayItalic, fontSize: 25, lineHeight: 31, color: Polar.ink },

  fields: { paddingHorizontal: PolarSpace.pad },
  field: { gap: 6, paddingVertical: PolarSpace.s5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Polar.rule },
  fieldTitle: { fontFamily: PolarFonts.display, fontSize: 27, lineHeight: 30, color: Polar.ink },
  hint: { fontFamily: PolarFonts.sans, fontSize: 13, lineHeight: 19, color: Polar.charcoal },
  control: { marginTop: 8 },
  saveLine: { paddingVertical: PolarSpace.s4 },
  stack: { gap: 12 },

  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { minHeight: 44, paddingHorizontal: 15, justifyContent: 'center', borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: 'rgba(31,42,68,0.15)', backgroundColor: Polar.ice },
  choiceOn: { borderColor: Polar.ink, borderWidth: 2, paddingHorizontal: 14 },
  choiceText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { minHeight: 44, flexDirection: 'row', alignItems: 'stretch', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(31,42,68,0.15)', backgroundColor: Polar.ice, overflow: 'hidden' },
  chipPlain: { paddingHorizontal: 16, alignItems: 'center' },
  chipOn: { backgroundColor: Polar.ink, borderColor: Polar.ink },
  chipStar: { backgroundColor: Polar.signal, borderColor: Polar.signal },
  chipMain: { justifyContent: 'center', paddingLeft: 16, paddingRight: 6 },
  chipStarButton: { justifyContent: 'center', paddingLeft: 6, paddingRight: 14 },
  chipText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },
  chipTextOn: { color: Polar.ice },

  noteField: { gap: 7 },
  dtInk: { fontFamily: PolarFonts.sansSemi, fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', color: Polar.charcoal },
  input: { minHeight: 46, paddingHorizontal: 13, borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: 'rgba(31,42,68,0.15)', backgroundColor: Polar.snow, fontFamily: PolarFonts.sans, fontSize: 16, color: Polar.ink },
  inputFocused: { borderColor: Polar.signal, backgroundColor: Polar.ice },

  homeNow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pin: { width: 9, height: 9, borderRadius: 5, backgroundColor: Polar.signal },
  homeName: { fontFamily: PolarFonts.display, fontSize: 22, color: Polar.ink },

  kept: { gap: PolarSpace.s5, paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s6 },
  keptHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 8, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: Polar.ink },
  keptLink: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ink, textDecorationLine: 'underline' },
  strip: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, rowGap: 14 },
  stripItem: { width: '33.333%', paddingHorizontal: 5, gap: 3 },
  stripPhoto: { aspectRatio: 1, overflow: 'hidden', borderRadius: PolarRadius.sm, backgroundColor: Polar.deep, alignItems: 'center', justifyContent: 'center' },
  stripInitial: { fontFamily: PolarFonts.display, fontSize: 40, color: 'rgba(255,255,255,0.16)' },
  stripCity: { marginTop: 4, fontFamily: PolarFonts.display, fontSize: 17, color: Polar.ink },
  stripDates: { fontFamily: PolarFonts.sans, fontSize: 11, color: Polar.charcoal },
  place: { gap: 1, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Polar.rule },
  placeName: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },

  appearance: { minHeight: 44, gap: 2, marginTop: PolarSpace.s6, paddingHorizontal: PolarSpace.pad, paddingVertical: PolarSpace.s3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Polar.rule },
  appearanceLabel: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },
  foot: { paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s3, fontFamily: PolarFonts.sans, fontSize: 12, color: Polar.charcoal },
});
