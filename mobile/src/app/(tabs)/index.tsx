import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listTrips } from '@/api/tripMateApi';
import type { TripSummary } from '@/api/types';
import { PrimaryButton } from '@/components/form';
import { PlacePhoto } from '@/components/place-photo';
import { Invitation, Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { BarHeight, Colors, PhotoScrim, Radius, Spacing } from '@/constants/theme';
import { formatRange } from '@/lib/dayDisplay';
import { useFocusedFetch } from '@/lib/useFocusedFetch';

/**
 * Transcribed from `ios/TripMate/TripMate/Home/LandingContent.swift`. Static, and true today —
 * this is what the backend actually does when a plan is generated.
 *
 * **Step 02 no longer matches the Swift original, deliberately.** It said "forecast for your
 * actual dates" full stop, which for a trip a month out is a promise the product cannot keep:
 * `fetchWeatherBundle` only reaches the forecast endpoint inside `FORECAST_HORIZON_DAYS` and
 * falls back to the historical archive beyond it. This whole section is an argument about
 * honesty, and the sign-in screen already states the 16 days plainly — a vaguer claim here was
 * the section undercutting itself.
 */
const METHOD = [
  {
    number: '01',
    title: 'You set the constraints',
    prose: 'Where, when, how much, and who is going. The budget is a ceiling — the plan stays inside it rather than spending up to it.',
  },
  {
    number: '02',
    title: 'Real data goes in first',
    prose: 'A real forecast for your dates inside the 16-day window and seasonal norms beyond it, plus public holidays, opening hours and travel times — fetched before a single word is written.',
  },
  {
    number: '03',
    title: 'Written, then critiqued',
    prose: 'A second pass reviews the finished plan against your budget and pace, and rewrites the days it finds fault with.',
  },
  {
    number: '04',
    title: 'Every place is checked',
    prose: 'Coordinates are corrected against OpenStreetMap, so the pins land where the place actually is rather than where the model guessed.',
  },
];

export default function Home() {
  const router = useRouter();
  // On focus, not on mount — "Up next" has to notice a trip kept a moment ago in the wizard.
  const trips = useFocusedFetch<TripSummary[] | null>(async () => (await listTrips()) ?? null);

  const featured = trips ? pickFeatured(trips) : undefined;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <BandOpener label="TripMate" />
        <ThemedText type="display" style={styles.headline}>
          Days worth keeping, written for where you are going.
        </ThemedText>

        <View style={styles.cta}>
          <PrimaryButton title="Plan a trip" onPress={() => router.push('/plan/basics')} />
        </View>

        {/* The only place Home spends a network call, and it reuses the Trips photo cache. */}
        <View style={styles.band}>
          <BandOpener label={featured?.upcoming ? 'Up next' : 'Latest memory'} />
          {trips === undefined ? (
            <Loading />
          ) : trips === null ? (
            <Notice>Couldn&rsquo;t reach TripMate. Check your connection.</Notice>
          ) : featured ? (
            <Pressable
              onPress={() => router.push(`/trip/${featured.trip.id}`)}
              style={({ pressed }) => pressed && styles.pressed}
              android_ripple={{ color: Colors.pressed }}>
              <PlacePhoto
                name={featured.trip.destination}
                aspectRatio={16 / 10}
                radius={Radius.read}
                scrim={PhotoScrim}
                style={styles.featured}>
                <View style={styles.featuredCaption}>
                  <ThemedText type="display" numberOfLines={2}>
                    {featured.trip.destination}
                  </ThemedText>
                  <ThemedText type="money" themeColor="foreground">
                    {formatRange(featured.trip.startDate, featured.trip.endDate)}
                  </ThemedText>
                </View>
              </PlacePhoto>
            </Pressable>
          ) : (
            <Invitation
              title="No trips kept yet"
              body="Once you keep a plan, it opens here."
            />
          )}
        </View>

        <View style={styles.band}>
          <BandOpener label="Method" />
          <ThemedText type="title" style={styles.bandHeading}>
            How it actually works
          </ThemedText>
          {METHOD.map((step, index) => (
            <View key={step.number} style={[styles.step, index > 0 && styles.stepRuled]}>
              {/* Tabular figures, but not gold: gold counts money and only money, and these are
                  ordinals. Colouring a step number with the palette's price colour spends the one
                  piece of vocabulary that teaches a reader "this costs something". */}
              <ThemedText type="money" themeColor="muted" style={styles.stepNumber}>
                {step.number}
              </ThemedText>
              <View style={styles.grow}>
                <ThemedText type="heading">{step.title}</ThemedText>
                <ThemedText type="detail" themeColor="muted" style={styles.stepProse}>
                  {step.prose}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>

        <ThemedText type="detail" themeColor="muted" style={styles.closing}>
          Every plan you keep is collected under Trips.
        </ThemedText>
      </ScrollView>
    </SafeAreaView>
  );
}

/** A label against a bottom rule — how this system opens a section. */
function BandOpener({ label }: { label: string }) {
  return (
    <View style={styles.opener}>
      <ThemedText type="label" themeColor="muted">
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * The soonest trip that has not ended, else the most recent one.
 *
 * Dates are compared as ISO strings rather than parsed: `2026-09-19` sorts correctly as text, and
 * building a `Date` from a date-only string is the UTC-midnight trap this codebase has already
 * shipped once.
 */
function pickFeatured(trips: TripSummary[]): { trip: TripSummary; upcoming: boolean } | undefined {
  if (trips.length === 0) return undefined;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = trips
    .filter((trip) => trip.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (upcoming.length > 0) return { trip: upcoming[0], upcoming: true };
  const past = [...trips].sort((a, b) => b.endDate.localeCompare(a.endDate));
  return { trip: past[0], upcoming: false };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  /** The tab bar floats over the content and its safe-area inset does not reach this scroll
   *  view — the same correction `profile.tsx` already carries. Without it the last Method card
   *  ends underneath the bar. */
  content: { padding: Spacing.read, paddingBottom: BarHeight + Spacing.regular },
  opener: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.cardBorder,
    paddingBottom: Spacing.tight,
    alignItems: 'flex-end',
  },
  headline: { marginTop: Spacing.read },
  cta: { marginTop: Spacing.read },
  band: { marginTop: Spacing.regular * 1.5 },
  bandHeading: { marginTop: Spacing.rows, marginBottom: Spacing.hair },
  featured: { marginTop: Spacing.rows, justifyContent: 'flex-end' },
  featuredCaption: { padding: Spacing.rows, gap: Spacing.hair },
  pressed: { opacity: 0.7 },
  step: {
    flexDirection: 'row',
    gap: Spacing.rows,
    paddingVertical: Spacing.rows,
  },
  stepRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  // A floor, not a fixed width: the figures are tabular so every step is the same width anyway,
  // and a hard 22 made "01" wrap to two lines once the text scaled.
  stepNumber: { minWidth: 22 },
  stepProse: { marginTop: 2 },
  grow: { flex: 1 },
  closing: { marginTop: Spacing.regular * 1.5 },
});
