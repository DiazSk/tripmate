import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatDateRange } from '@shared/format';
import { city } from '@shared/memories';
import { profileSentence } from '@shared/profileSentence';
import { travelStyleOf } from '@shared/userAnswers';

import { usePlacePhoto } from '@/api/placePhotos';
import type { TripSummary } from '@/api/types';
import { Passport } from '@/components/passport';
import { usePolarFonts, usePolarStatusBar } from '@/components/polar-ui';
import { ChoiceRow, DestructiveRow, Footer, Group, Header, NavRow, Separator, SettingsColors } from '@/components/settings-list';
import { APPEARANCE, setAppearance, type Appearance } from '@/constants/appearance';
import { Polar, PolarFonts } from '@/constants/polar';
import { BarHeight } from '@/constants/theme';
import { CROWDS, DISCOVERIES, ENERGY, GROUPS, PACES } from '@/lib/planDraft';
import { dietaryValue, interestsValue } from '@/lib/profileRows';
import { confirmSignOut, useProfileStore, withLegacy, type SaveStatus } from '@/lib/profileStore';
import { Text } from '@/components/themed-text';

/**
 * Your travel profile as a settings screen (canvas design "Phone profile · 4 Settings with a
 * passport"), because that is what it is: eight answers you set once and change rarely.
 *
 * The passport data page leads, where Settings puts your Apple Account: who you are, where you set
 * off from, what you have done. Then the sentence the planner reads, which rewrites itself as you
 * answer; then the answers. **A single answer is a row whose value is a native pull-down**
 * (`ChoiceRow`); a list (interests, dietary needs, home city) pushes a screen of its own, all
 * editing the one profile in `profileStore.tsx`, which saves as you go.
 */

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

export default function Profile() {
  const router = useRouter();
  const fonts = usePolarFonts();
  const { account, profile, edit, status, stats, recent, places } = useProfileStore();
  usePolarStatusBar(true);

  const header = (
    <Stack.Screen
      options={{
        title: 'Profile',
        headerLargeTitle: true,
        // iOS only: a transparent bar is how the large title floats over the page, and only iOS insets
        // the scroll content under it (`contentInsetAdjustmentBehavior`). Android ignores that prop,
        // so a transparent bar there let the page start under the status bar and the title (measured
        // on a OnePlus 9R: the passport card under the clock, "Profile" drawn over it). Android gets
        // an ordinary opaque bar in the page's own ground.
        headerTransparent: Platform.OS === 'ios',
        headerLargeTitleShadowVisible: false,
        headerStyle: { backgroundColor: Platform.OS === 'ios' ? 'transparent' : SettingsColors.ground },
        headerLargeTitleStyle: fonts ? { fontFamily: PolarFonts.display, fontSize: 40, color: Polar.ink } : { color: Polar.ink },
        // Android has no large title, so the bar's own title carries the serif: the face iOS shows
        // at 40 above the page, at the size a 56dp bar holds.
        ...(Platform.OS === 'android' && fonts ? { headerTitleStyle: { fontFamily: PolarFonts.display, fontSize: 30, color: Polar.ink } } : null),
        // Only while there is something to say: iOS 26 draws a glass bubble for any bar item, empty or not.
        headerRight: status === 'idle' ? undefined : () => <SaveLine status={status} />,
      }}
    />
  );

  if (!fonts) return <View style={styles.screen}>{header}</View>;
  const style = profile ? travelStyleOf(profile) : null;

  return (
    <ScrollView style={styles.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {header}

      <Passport account={account} homeCity={profile?.homeCity?.name ?? null} stats={stats} onPress={() => router.push(account ? '/profile/account' : '/signin')} />
      {account ? null : (
        <Group>
          <Pressable onPress={() => router.push('/signin')} accessibilityRole="button" style={({ pressed }) => [styles.signIn, pressed && styles.pressed]}>
            <View style={styles.signInText}>
              <Text style={styles.signInTitle}>Sign in to TripMate</Text>
              <Text style={styles.signInBody}>Keep this profile and your trips on every device.</Text>
            </View>
          </Pressable>
        </Group>
      )}

      <Header>What the planner reads</Header>
      <Group>
        <View style={styles.sentence}>
          {profile ? (
            <Text style={styles.sentenceText} accessibilityLiveRegion="polite">
              {profileSentence(profile)}
            </Text>
          ) : profile === null ? (
            <Text style={styles.error}>Couldn’t reach TripMate. Check your connection, then come back to this tab.</Text>
          ) : (
            <ActivityIndicator color={Polar.ink} style={styles.left} />
          )}
        </View>
      </Group>
      <Footer>Every new plan starts from these answers. Change one and the sentence changes with it.</Footer>

      {profile && style ? (
        <>
          <Header>Travel style</Header>
          <Group>
            <ChoiceRow icon="person.2.fill" tint={Polar.signal} label="Travels with" value={profile.group} options={GROUPS} onChange={(group) => edit({ group })} />
            <Separator />
            <ChoiceRow icon="sun.max.fill" tint="#E0A100" label="A day" value={style.pace} options={PACES} onChange={(pace) => edit(withLegacy(profile, { pace }))} />
            <Separator />
            <ChoiceRow icon="binoculars.fill" tint="#2F8F83" label="What to see" value={style.discovery} options={DISCOVERIES} onChange={(discovery) => edit(withLegacy(profile, { discovery }))} />
            <Separator />
            <ChoiceRow icon="figure.walk" tint="#3A7BD5" label="Walking" value={profile.energy} options={ENERGY} onChange={(energy) => edit({ energy })} />
            <Separator />
            <ChoiceRow icon="person.3.fill" tint="#7A5AC8" label="Crowds" value={profile.crowds} options={CROWDS} onChange={(crowds) => edit({ crowds })} />
          </Group>
          <Footer>Travels with is a default. The planner still asks who’s coming on each trip.</Footer>

          <Header>What matters</Header>
          <Group>
            <NavRow icon="heart.fill" tint="#E5484D" label="Interests" value={interestsValue(profile)} onPress={() => router.push('/profile/interests')} />
            <Separator />
            <NavRow icon="fork.knife" tint="#3E9B4F" label="Dietary needs" value={dietaryValue(profile)} onPress={() => router.push('/profile/dietary')} />
            <Separator />
            <NavRow icon="house.fill" tint="#8E8E93" label="Home city" value={profile.homeCity?.name ?? 'Not set'} onPress={() => router.push('/profile/home')} />
          </Group>
          {status === 'failed' ? <Footer>Couldn’t save that. It’s still here, and the next change tries again.</Footer> : null}
        </>
      ) : null}

      <Header>Kept</Header>
      <Group>
        <View style={styles.recent}>
          <View style={styles.recentHead}>
            <Text style={styles.recentTitle}>Recent trips</Text>
            {recent.length ? (
              <Pressable onPress={() => router.push('/(tabs)/trips')} accessibilityRole="link" hitSlop={8}>
                <Text style={styles.seeAll}>{stats && stats.trips > recent.length ? `See All ${stats.trips}` : 'See All'}</Text>
              </Pressable>
            ) : null}
          </View>
          {recent.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {recent.map((t) => (
                <StripTrip key={t.id} trip={t} />
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.recentEmpty}>Plan and keep a trip and it shows up here.</Text>
          )}
        </View>
        {/* Absent with none: an empty list would explain a feature rather than record anything. */}
        {places.length ? (
          <>
            <Separator inset={16} />
            <NavRow icon="mappin" tint={Polar.signal} label="Saved places" value={String(places.length)} onPress={() => router.push('/profile/places')} />
          </>
        ) : null}
      </Group>

      <Header>App</Header>
      <Group>
        {/* The welcome a first launch shows, kept reachable once it has been seen. */}
        <NavRow icon="sparkles" tint={Polar.signal} label="Take the tour" onPress={() => router.push('/landing')} />
        {/* A development switch, not a setting: it reloads the JS and repaints only the screens that
            read `Colors`. A user build neither shows it nor honours a value chosen before it went
            (`constants/appearance.ts`). */}
        {__DEV__ ? (
          <>
            <Separator />
            <ChoiceRow icon="moon.fill" tint={Polar.ink} label="Appearance" value={APPEARANCE} options={APPEARANCES} onChange={(next) => next !== APPEARANCE && setAppearance(next)} />
          </>
        ) : null}
      </Group>
      {__DEV__ ? <Footer>Development only. Switching restarts the app.</Footer> : null}

      {account ? (
        <Group>
          <DestructiveRow title="Sign Out" onPress={() => confirmSignOut()} />
        </Group>
      ) : null}
      <Footer center>Your answers stay on this phone, or on your account when you are signed in.</Footer>
    </ScrollView>
  );
}

/** Saving…, then Saved, in the bar: the one line for the whole form, since one PUT writes it all. */
function SaveLine({ status }: { status: SaveStatus }) {
  const text = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'failed' ? 'Not saved' : '';
  if (!text) return null;
  return (
    <Text style={[styles.save, status === 'failed' && styles.saveFailed]} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

function StripTrip({ trip }: { trip: TripSummary }) {
  const router = useRouter();
  const photo = usePlacePhoto(trip.destination);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  const word = city(trip);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open your ${trip.destination} trip`} onPress={() => router.push(`/trip/${trip.id}`)} style={styles.stripItem}>
      <View style={styles.stripPhoto}>
        <Text style={styles.stripInitial}>{word.slice(0, 1)}</Text>
        {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} recyclingKey={trip.id} /> : null}
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
  screen: { flex: 1, backgroundColor: SettingsColors.ground },
  // Clears the floating tab bar, whose inset does not reach this list.
  content: { paddingTop: 8, paddingBottom: BarHeight + 40 },
  pressed: { backgroundColor: SettingsColors.pressed },
  left: { alignSelf: 'flex-start' },

  signIn: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 },
  signInText: { flex: 1, gap: 2 },
  signInTitle: { fontSize: 18, fontWeight: '600', color: Polar.ember },
  signInBody: { fontSize: 14, color: SettingsColors.grey },

  sentence: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  sentenceText: { fontFamily: PolarFonts.displayItalic, fontSize: 21, lineHeight: 27, color: Polar.ink },
  error: { fontSize: 15, lineHeight: 21, color: Polar.alertText },

  save: { fontSize: 15, color: SettingsColors.grey },
  saveFailed: { color: SettingsColors.destructive },

  recent: { paddingVertical: 12 },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 16, paddingBottom: 10 },
  recentTitle: { fontSize: 17, color: '#000' },
  seeAll: { fontSize: 17, color: Polar.ember },
  recentEmpty: { paddingHorizontal: 16, fontSize: 15, color: SettingsColors.grey },
  strip: { gap: 10, paddingHorizontal: 16 },
  stripItem: { width: 104, gap: 2 },
  stripPhoto: { width: 104, height: 104, marginBottom: 4, overflow: 'hidden', borderRadius: 12, backgroundColor: Polar.deep, alignItems: 'center', justifyContent: 'center' },
  stripInitial: { fontFamily: PolarFonts.display, fontSize: 40, color: 'rgba(255,255,255,0.16)' },
  stripCity: { fontSize: 14, fontWeight: '600', color: '#000' },
  stripDates: { fontSize: 12, color: SettingsColors.grey },
});
