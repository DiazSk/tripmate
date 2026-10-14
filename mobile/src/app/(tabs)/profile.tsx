import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signOut, useAccount, type Account } from '@/api/auth';
import { subscribeToSession } from '@/api/session';
import { getProfile, getProfileStats, saveProfile } from '@/api/tripMateApi';
import { legacyExplorerStyle, travelStyleOf } from '@shared/userAnswers';

import type {
  DiscoveryPreference,
  PacePreference,
  ProfileStats,
  TravelerProfile,
} from '@/api/types';
import { Avatar } from '@/components/avatar';
import { FieldSheet } from '@/components/field-sheet';
import { ChoiceRow, FieldTrough, PrimaryButton, TagGrid, TextField } from '@/components/form';
import { HomeCitySearch } from '@/components/home-city-search';
import { Invitation, Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { APPEARANCE, setAppearance } from '@/constants/appearance';
import { BarHeight, Colors, Radius, Spacing } from '@/constants/theme';
import {
  CROWDS,
  DIETARY_TAGS,
  ENERGY,
  GROUPS,
  INTERESTS,
  MAX_STARRED,
  DISCOVERIES,
  PACES,
  emptyDraft,
  labelOf,
  toTravelerProfile,
  cycleInterest,
  toggleTag,
} from '@/lib/planDraft';
import { dietaryValue, interestsValue } from '@/lib/profileRows';
import { formatMoney } from '@/lib/spend';

/**
 * Your travel profile — and the only place some of it can be set.
 *
 * **A profile reads as a summary, not a questionnaire.** Each row shows the answer it holds and
 * nothing else; choosing happens on a sheet you open. An earlier pass made every field editable
 * inline and the screen became fourteen radio rows followed by seventeen chips — the same
 * information, but something you fill in rather than something you read.
 *
 * **The rows are deliberately not in the Kiln type scale.** `DESIGN.md`'s third boundary: a
 * settings-shaped screen borrows the system's ramp and geometry rather than the product's — row
 * height, separator insets, header styling, and the part no Kiln rule can deliver, **Dynamic
 * Type**. That is why the editors live in sheets: anything using `ThemedText` caps scaling at 1.6x,
 * so keeping the controls off this surface is what lets everything you *read* here scale freely.
 *
 * What does not change is the palette. Kiln needs no adaptation on either platform: the one slate
 * `#1C1A18` sits within 10% of iOS dark's grouped-row `#1C1C1E` and Material 3's dark
 * `surfaceContainerLow` `#1D1B20`. The difference is hue, not value, and the hue is ours to keep.
 *
 * Every field here changes the plans the app writes — `explorerStyle` and `energy` set the pace
 * ceiling, `crowds` shifts timing, `family_with_kids` adds a rules block, the starred priorities
 * are what the prompt calls the thing that "drives which stops are chosen". Dietary has no wizard
 * screen at all, so this is the only route to it.
 */

/** Matches `ProfileStore.edited()` in the Swift app: long enough that a burst of chip taps is one
 *  request, short enough that leaving the tab rarely races it — and blur flushes what is pending. */
const SAVE_DEBOUNCE_MS = 600;

/** `undefined` still loading · `null` the fetch failed · `'none'` asked, and there is no profile. */
type Loaded = TravelerProfile | null | 'none' | undefined;

/** Which field's sheet is open. */
/**
 * One half of the pair, plus the legacy field both halves derive to.
 *
 * Written together rather than left to drift: `explorerStyle` is still what a stored row and
 * the frozen Swift app read, and a profile that changed its pace without updating it would
 * answer two different things to two readers.
 */
function withLegacy(
  profile: TravelerProfile,
  change: { pace?: PacePreference; discovery?: DiscoveryPreference }
): Partial<TravelerProfile> {
  const next = { ...travelStyleOf(profile), ...change };
  return { ...change, explorerStyle: legacyExplorerStyle(next) };
}

type Field = 'group' | 'pace' | 'discovery' | 'energy' | 'crowds' | 'interests' | 'dietary' | 'home';

/**
 * iOS and Android want the same tree — rows, separators, section headers — with different numbers,
 * so this is a metrics object rather than a `.ios.tsx`/`.android.tsx` split. A file split would
 * duplicate the row markup twice and guarantee the two drift.
 */
const M = Platform.select({
  ios: {
    sectionInset: Spacing.read,
    sectionRadius: Radius.surface + 2,
    rowMinHeight: 44,
    rowFontSize: 17,
    headerFontSize: 13,
    headerWeight: '400' as const,
    headerTransform: 'uppercase' as const,
    headerColor: Colors.muted,
    separators: true,
    surface: Colors.surfaceDeep,
  },
  default: {
    sectionInset: 0,
    sectionRadius: 0,
    rowMinHeight: 56,
    rowFontSize: 16,
    headerFontSize: 14,
    headerWeight: '600' as const,
    headerTransform: 'none' as const,
    headerColor: Colors.foreground,
    separators: false,
    surface: Colors.canvas,
  },
})!;

const CAPTIONS = {
  travel: 'Every new trip is planned from these answers.',
  interests: 'Starred interests weigh most when a plan is written.',
  dietary: 'Named up front, so a plan never suggests somewhere you can’t eat.',
  home: 'Where you usually set off from. It helps with travel times and the best months to go.',
};

export default function Profile() {
  // The screen needs the account too, not just the section at its foot — the name belongs at the
  // top. `useAccount` is cached per session read, so the second caller costs nothing.
  const { account } = useAccount();
  const [profile, setProfile] = useState<Loaded>(undefined);
  const [stats, setStats] = useState<ProfileStats | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Field | null>(null);

  /**
   * True from the first edit until a PUT carrying it succeeds.
   *
   * **The screen's one correctness guard.** The profile is re-read whenever the tab is focused —
   * which is how a plan generated in the wizard appears here without a restart — and that read
   * would happily overwrite an edit that has not reached the server. One flag covers all three
   * windows where that matters: debounce armed, PUT in flight, and PUT failed.
   *
   * It clears on **success**, not on the first edit, which is what hands authority back to the
   * server and lets the focus refetch resume doing its job.
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

  /** Read the profile and the stats for whoever the caller currently is. Returns its own cancel:
   *  a tab change and a sign-out can each land mid-flight, and a late reply must not win. */
  const load = useCallback(() => {
    let active = true;
    if (!unsaved.current) {
      void getProfile().then((result) => {
        if (!active || unsaved.current) return;
        setProfile(result === undefined ? null : result === null ? 'none' : result);
      });
    }
    void getProfileStats().then((result) => {
      if (active) setStats(result);
    });
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
    }, [flush, load])
  );

  /**
   * Signing in or out changes *whose* figures these are, and it happens on this very screen —
   * the account rows are at the foot of it, so `useFocusEffect` never fires again and the trip
   * count would keep showing the account's numbers to somebody who just signed out of it.
   */
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

  /**
   * Queue an edit. **The whole profile goes every time**, because `PUT /api/profile` replaces
   * rather than merges — its `parseProfile` refuses anything short of every field.
   */
  const edit = useCallback(
    (changes: Partial<TravelerProfile>) => {
      setProfile((current) => {
        if (!current || typeof current !== 'object') return current;
        const next = { ...current, ...changes };
        unsaved.current = true;
        pending.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
        return next;
      });
    },
    [flush]
  );

  /** A single decision closes its own sheet; the multi-select ones stay open. */
  const pick = useCallback(
    (changes: Partial<TravelerProfile>) => {
      edit(changes);
      setEditing(null);
    },
    [edit]
  );

  const loadedProfile = profile && typeof profile === 'object' ? profile : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ProfileHeader profile={loadedProfile} account={account} />

        {stats ? <Record stats={stats} /> : null}

        {profile === undefined ? (
          <Loading />
        ) : profile === null ? (
          <Notice>Couldn&rsquo;t reach TripMate. Check your connection.</Notice>
        ) : profile === 'none' ? (
          <View style={styles.block}>
            <Invitation
              title="No travel profile yet"
              body="It shapes every plan you get afterwards, and dietary needs can only be set here."
            />
            {/* Seeded from the wizard's own defaults rather than a second set that would drift.
                Nothing is written until the first real edit. */}
            <PrimaryButton
              title="Set one up"
              onPress={() => setProfile(toTravelerProfile(emptyDraft()))}
            />
          </View>
        ) : (
          <>
            <Section title="How you travel" footer={CAPTIONS.travel}>
              <Row
                label="Travels with"
                value={labelOf(GROUPS, profile.group)}
                onPress={() => setEditing('group')}
                first
              />
              {/* Two rows, because "Explores" was two answers. A stored profile has neither
                  field, so `travelStyleOf` reads the legacy one — which is also what stops
                  "off the beaten path" being shown back as a pace. */}
              <Row
                label="Pace"
                value={labelOf(PACES, travelStyleOf(profile).pace)}
                onPress={() => setEditing('pace')}
              />
              <Row
                label="Seeing"
                value={labelOf(DISCOVERIES, travelStyleOf(profile).discovery)}
                onPress={() => setEditing('discovery')}
              />
              <Row
                label="Walking"
                value={labelOf(ENERGY, profile.energy)}
                onPress={() => setEditing('energy')}
              />
              <Row
                label="Crowds"
                value={labelOf(CROWDS, profile.crowds)}
                onPress={() => setEditing('crowds')}
              />
            </Section>

            <Section title="What you're into" footer={CAPTIONS.interests}>
              <Row
                label="Interests"
                value={interestsValue(profile)}
                onPress={() => setEditing('interests')}
                first
              />
            </Section>

            <Section title="Food" footer={CAPTIONS.dietary}>
              <Row
                label="Dietary needs"
                value={dietaryValue(profile)}
                onPress={() => setEditing('dietary')}
                first
              />
            </Section>

            <Section title="Home" footer={CAPTIONS.home}>
              <Row
                label="Home city"
                value={profile.homeCity?.name ?? 'Not set'}
                onPress={() => setEditing('home')}
                first
              />
            </Section>
          </>
        )}

        <AccountSection />

        <AppearanceSection />

        {/* One line, at the foot, rather than Swift's per-section footer: a single PUT writes all
            seven fields, so blaming the section you last touched would be a guess. */}
        {failed ? (
          <View style={styles.block}>
            <ThemedText type="detail" themeColor="alert">
              Couldn&rsquo;t save that. It&rsquo;s still here, and the next change tries again.
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>

      {loadedProfile ? (
        <Sheets
          profile={loadedProfile}
          editing={editing}
          onClose={() => setEditing(null)}
          edit={edit}
          pick={pick}
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The six editors, each behind the one sheet shell.
 *
 * Split from the screen so the branches above stay a readable list of rows. `visible` per sheet
 * rather than one sheet with a switched body: `Modal` keyed on content would animate between
 * fields, and each of these is a separate opening.
 */
function Sheets({
  profile,
  editing,
  onClose,
  edit,
  pick,
}: {
  profile: TravelerProfile;
  editing: Field | null;
  onClose: () => void;
  edit: (changes: Partial<TravelerProfile>) => void;
  pick: (changes: Partial<TravelerProfile>) => void;
}) {
  const picks = { selected: profile.priorities, starred: profile.topPriorities };
  const fromPicks = (next: { selected: string[]; starred: string[] }) => ({
    priorities: next.selected,
    topPriorities: next.starred,
  });
  const starsLeft = MAX_STARRED - profile.topPriorities.length;

  return (
    <>
      <FieldSheet visible={editing === 'group'} title="Travels with" onClose={onClose}>
        <ChoiceRow options={GROUPS} value={profile.group} onChange={(group) => pick({ group })} />
      </FieldSheet>

      {/* Each picker writes its own half AND the legacy field the pair derives to, so a
          profile saved here stays readable by anything that only knows `explorerStyle`. */}
      <FieldSheet visible={editing === 'pace'} title="How full each day" onClose={onClose}>
        <ChoiceRow
          options={PACES}
          value={travelStyleOf(profile).pace}
          onChange={(pace) => pick(withLegacy(profile, { pace }))}
        />
      </FieldSheet>

      <FieldSheet visible={editing === 'discovery'} title="What to see" onClose={onClose}>
        <ChoiceRow
          options={DISCOVERIES}
          value={travelStyleOf(profile).discovery}
          onChange={(discovery) => pick(withLegacy(profile, { discovery }))}
        />
      </FieldSheet>

      <FieldSheet visible={editing === 'energy'} title="Walking" onClose={onClose}>
        <ChoiceRow options={ENERGY} value={profile.energy} onChange={(energy) => pick({ energy })} />
      </FieldSheet>

      <FieldSheet visible={editing === 'crowds'} title="Crowds" onClose={onClose}>
        <ChoiceRow options={CROWDS} value={profile.crowds} onChange={(crowds) => pick({ crowds })} />
      </FieldSheet>

      {/* Stays open: choosing is one pass over the chips and starring is a second. */}
      <FieldSheet
        visible={editing === 'interests'}
        title="Interests"
        caption={
          profile.topPriorities.length === 0
            ? 'Tap to choose. Tap a chosen one again to star it, up to three.'
            : starsLeft > 0
              ? `Star ${starsLeft} more. Tap again to clear one.`
              : 'Those three drive which stops get picked. Clear one to free up a star.'
        }
        onClose={onClose}
      >
        <TagGrid
          tags={INTERESTS}
          selected={profile.priorities}
          starred={profile.topPriorities}
          onToggle={(tag) => edit(fromPicks(cycleInterest(picks, tag)))}
          onCycle={(tag) => edit(fromPicks(cycleInterest(picks, tag)))}
        />
      </FieldSheet>

      <FieldSheet
        visible={editing === 'dietary'}
        title="Dietary needs"
        caption="Applied to every food stop on every trip. Leave it empty if nothing applies."
        onClose={onClose}
      >
        <TagGrid
          tags={DIETARY_TAGS}
          selected={profile.dietary.tags}
          onToggle={(tag) =>
            edit({ dietary: { ...profile.dietary, tags: toggleTag(profile.dietary.tags, tag) } })
          }
        />
        <FieldTrough>
          <TextField
            label="Anything else"
            value={profile.dietary.note}
            onChangeText={(note) => edit({ dietary: { ...profile.dietary, note } })}
            placeholder="No shellfish, low salt…"
          />
        </FieldTrough>
      </FieldSheet>

      {/* Only a real pick saves. The search reports `null` when the text moves off the picked city;
          that must not clear the saved one, or typing in the box would wipe it. */}
      <FieldSheet
        visible={editing === 'home'}
        title="Home city"
        caption="Where you usually set off from. It helps with travel times and the best months to go."
        onClose={onClose}
      >
        <HomeCitySearch value={profile.homeCity ?? null} onPick={(homeCity) => { if (homeCity) pick({ homeCity }); }} />
      </FieldSheet>
    </>
  );
}

/**
 * What the trips you kept add up to.
 *
 * `spend` runs through the same summation the trip screen's budget bar uses, so a cost corrected
 * on a trip shows up here too. **It is labelled "Planned", not "Spent".** `tripSpend` coalesces
 * `actualCost ?? cost`, and nothing in this product collects transactions — so across a lifetime
 * of kept trips the figure is overwhelmingly what those trips were planned to cost. Calling it
 * spend states a fact the app does not have. Rendered only once the figures arrive — a record of three
 * dashes says nothing an absent record does not.
 */
function Record({ stats }: { stats: ProfileStats }) {
  return (
    <View style={styles.record}>
      <Figure label="Trips" value={String(stats.trips)} />
      <Figure label="Places" value={String(stats.places)} />
      <Figure label="Planned" value={formatMoney(stats.spend)} money />
    </View>
  );
}

function Figure({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <View style={styles.figure}>
      <ThemedText type="moneyLarge" themeColor={money ? 'money' : 'foreground'}>
        {value}
      </ThemedText>
      <ThemedText type="label" themeColor="muted">
        {label}
      </ThemedText>
    </View>
  );
}

/** The traveller's face and the one line that says who they are. */
function ProfileHeader({ profile, account }: { profile: TravelerProfile | null; account: Account | null }) {
  const name = account?.name?.trim() || null;
  return (
    <View style={styles.avatarBlock}>
      <Avatar account={account} size={84} editable />
      {/* The name when there is one, with the portrait sentence demoted beneath it. Signed out
          the sentence stands alone exactly as before — this screen still has to work for somebody
          who has never made an account, which is most first-time openers.

          System text styles, no Melodrama: DESIGN.md's third boundary makes this a native settings
          surface, and a display face at the top of a settings list is the landing-page move that
          boundary exists to stop. It was tried twice. */}
      {name ? <Text style={styles.name}>{name}</Text> : null}
      <Text style={styles.portrait}>{portraitSentence(profile)}</Text>
    </View>
  );
}

function portraitSentence(profile: TravelerProfile | null): string {
  if (!profile) return 'Your travel profile shapes every plan you get.';
  const group = labelOf(GROUPS, profile.group).toLowerCase();
  const energy = labelOf(ENERGY, profile.energy).toLowerCase();
  return `Travelling ${group === 'solo' ? 'solo' : `as a ${group}`}, ${energy}.`;
}

/** A grouped section: a header above, rows in a surface, and the explanation underneath — which is
 *  where the native idiom puts it, rather than above the control it describes. */
/**
 * The account, as one more settings section.
 *
 * At the foot rather than the head: the rows above are what this screen is *for*, and they work
 * signed out. This is the answer to "will I still have this on my other phone", which is a
 * question you ask after reading them, not before.
 *
 * Signed out it offers rather than nags, and names what signing in does — the trips already made
 * on this phone follow the account, so there is nothing to weigh up.
 */
function AccountSection() {
  const { account, loading } = useAccount();
  const [busy, setBusy] = useState(false);

  // No row at all while the first read is in flight. A row that says "Not signed in" and then
  // corrects itself a frame later is worse than a section that arrives a frame late.
  if (loading) return null;

  if (!account) {
    return (
      <Section title="Account" footer="Your trips stay on this phone until you do.">
        <Row label="Sign in" value="" onPress={() => router.push('/signin')} first />
      </Section>
    );
  }

  return (
    <Section title="Account" footer="Your trips and this profile follow you.">
      <Row label="Signed in" value={account.email} onPress={() => {}} first />
      <Row
        label="Sign out"
        value={busy ? 'Signing out…' : ''}
        onPress={async () => {
          if (busy) return;
          setBusy(true);
          await signOut();
          setBusy(false);
        }}
      />
    </Section>
  );
}

/**
 * The light appearance, behind its flag.
 *
 * **A reload, not a re-render, and the row says so.** `Colors` is resolved once at module load
 * so that no call site knows an appearance exists (see `constants/appearance.ts`); the price is
 * that switching restarts the JS bundle. Hiding that behind a Switch that appears to do nothing
 * for a second would be worse than a row that states it.
 *
 * Lives under Account rather than at the top because it is a prototype, and because nothing on
 * this screen should outrank the profile the screen is for.
 */
function AppearanceSection() {
  const light = APPEARANCE === 'light';
  return (
    <Section
      title="Appearance"
      footer="Kiln is drawn for the dark ground. The light appearance is a prototype. Switching restarts the app, and the keyboard, date picker and tab bar stay dark until it ships for real.">
      <Row
        label="Appearance"
        value={light ? 'Light' : 'Dark'}
        onPress={() => setAppearance(light ? 'dark' : 'light')}
        first
      />
    </Section>
  );
}

function Section({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
      {footer ? <Text style={styles.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}

/**
 * Where the label and its value stop sharing a line.
 *
 * The same threshold `FieldRow` in `form.tsx` uses, for the same measured reason: these rows carry
 * a label *and* a value on one line, and at the accessibility sizes the label takes the row and
 * the value truncates to nothing — "Travels with C.", "Explores Off…". A value nobody can read is
 * worse than a taller row, and the platform agrees: an iOS Form row stacks rather than letting the
 * two fight.
 */
const STACK_ABOVE_SCALE = 1.2;

/** Label left, current value right, chevron last — and the whole row is the target. */
function Row({
  label,
  value,
  onPress,
  first,
}: {
  label: string;
  value: string;
  onPress: () => void;
  first?: boolean;
}) {
  // `fontScale` from the hook rather than `PixelRatio.getFontScale()`: this one re-renders when the
  // reader changes the setting instead of holding whatever it was at mount.
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > STACK_ABOVE_SCALE;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      style={({ pressed }) => [
        styles.row,
        M.separators && !first && styles.rowSeparated,
        // Darken on press, never lighten.
        pressed && styles.rowPressed,
      ]}
      android_ripple={{ color: Colors.pressed }}
    >
      <View style={[styles.rowText, stacked && styles.rowTextStacked]}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text
          style={[styles.rowValue, stacked && styles.rowValueStacked]}
          // Stacked it has the full width, so let it wrap rather than truncate.
          numberOfLines={stacked ? 2 : 1}
        >
          {value}
        </Text>
      </View>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right' }}
        tintColor={Colors.muted}
        size={13}
        fallback={<Text style={styles.chevron}>›</Text>}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  /**
   * Clears the floating tab bar, and the height is functional rather than generous. The bar floats
   * over the content and its safe-area inset does not reach this scroll view, so without this the
   * last section sits behind it. The Swift app carries the same margin for the same reason
   * (`Token.barHeight + Token.gapRows`).
   */
  scroll: { paddingBottom: BarHeight + Spacing.regular },

  avatarBlock: {
    alignItems: 'center',
    gap: Spacing.rows,
    paddingTop: Spacing.regular,
    paddingBottom: Spacing.compact,
    paddingHorizontal: Spacing.regular,
  },
  name: {
    color: Colors.foreground,
    fontSize: 22,
    // No `fontFamily`: the system face at a system weight is what carries Dynamic Type, and
    // DESIGN.md's third boundary puts every settings row on it. A custom family here would also
    // have to pick its own weight file — `Fonts` gives each weight its own family and warns
    // against pairing one with `fontWeight`.
    fontWeight: '600',
    textAlign: 'center',
  },
  portrait: { color: Colors.muted, fontSize: 15, textAlign: 'center' },

  record: {
    flexDirection: 'row',
    marginHorizontal: Spacing.read,
    marginBottom: Spacing.tight,
    backgroundColor: Colors.panel,
    borderRadius: Radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    paddingVertical: Spacing.rows,
  },
  // Thirds rather than a gap, so the three figures read as one row of columns.
  figure: { flex: 1, alignItems: 'center', gap: Spacing.hair },

  section: { marginTop: Spacing.compact },
  sectionHeader: {
    color: M.headerColor,
    fontSize: M.headerFontSize,
    fontWeight: M.headerWeight,
    textTransform: M.headerTransform,
    marginBottom: Spacing.tight,
    // Aligns the header with the row labels inside the section below it.
    marginHorizontal: M.sectionInset + Spacing.read,
  },
  sectionBody: {
    backgroundColor: M.surface,
    borderRadius: M.sectionRadius,
    marginHorizontal: M.sectionInset,
    overflow: 'hidden',
  },
  sectionFooter: {
    color: Colors.muted,
    fontSize: 13,
    marginTop: Spacing.tight,
    marginHorizontal: M.sectionInset + Spacing.read,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    minHeight: M.rowMinHeight,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
  },
  rowSeparated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  rowPressed: { backgroundColor: Colors.pressed },
  // Label and value share a line until the type outgrows it, then stack — see STACK_ABOVE_SCALE.
  rowText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.read,
  },
  rowTextStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  rowLabel: { color: Colors.foreground, fontSize: M.rowFontSize },
  // Takes the room the label leaves, so a long value truncates rather than pushing the chevron.
  rowValue: { color: Colors.muted, fontSize: M.rowFontSize, flexShrink: 1, textAlign: 'right' },
  rowValueStacked: { textAlign: 'left' },
  chevron: { color: Colors.muted, fontSize: 17 },

  block: { paddingHorizontal: Spacing.read, gap: Spacing.rows },
});
