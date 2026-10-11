import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Trip, TripSummary } from '@/api/types';
import { Today } from '@/components/today';
import { PillButton, PrimaryButton } from '@/components/form';
import { PlacePhoto } from '@/components/place-photo';
import { Invitation, Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { BarHeight, Colors, PhotoScrim, Radius, Spacing } from '@/constants/theme';
import { formatRange } from '@/lib/dayDisplay';
import { loadSavedPlaces, loadTrip, loadTrips, type Cached } from '@/lib/tripCache';
import { todayInZone } from '@/lib/tripClock';
import { pickCurrent } from '@/lib/tripPhase';
import { todayISO } from '@/lib/tripsWall';
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
  /**
   * On focus, not on mount — "Up next" has to notice a trip kept a moment ago in the wizard.
   *
   * Through `loadTrips`, so a failed request falls back to whatever is cached rather than
   * showing a notice. Offline is the case this screen most has to survive: it is the one you
   * open standing in a street somewhere.
   */
  const listed = useFocusedFetch(async () => (await loadTrips()) ?? null);
  const trips = listed === undefined ? undefined : (listed?.value ?? null);
  const offline = listed?.cachedAt != null;

  /**
   * The trip you are on, if you are on one.
   *
   * Two reads rather than one, and only ever when a trip is actually running: the wall's
   * summaries carry no itinerary, and Today is entirely about the stops inside one day.
   */
  const current = trips ? pickCurrent(trips, todayISO()) : null;
  /**
   * Stamped with the id it was fetched for, and matched at render.
   *
   * The obvious shape — clear the state when there is no current trip — is a synchronous
   * `setState` inside an effect, which cascades a render and which this project's lint rule
   * rejects on sight. Comparing ids instead means a result for a trip you have moved away from
   * is simply not used, and nothing has to be cleared at all.
   */
  const [loaded, setLoaded] = useState<{ id: string; hit: Cached<Trip> | null } | null>(null);
  /**
   * Re-read whenever the list is re-read, not only when the trip changes.
   *
   * Keying on the id alone left a reconnection half-applied: the list refetched and came back
   * live, so the composer re-enabled, while the trip beneath it was still the copy from disk and
   * went on saying "saved copy" indefinitely — the id had not changed, so nothing refetched it.
   * `listed` is a fresh object per focus, so depending on it ties the two reads together and the
   * screen recovers as one thing.
   */
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

  /**
   * Today where the *trip* is, which is not the same day as here.
   *
   * Measured: a device reading 21:07 on Sep 28 is Lisbon 05:07 on Sep 29. `pickCurrent` above
   * has to use the device's date — it runs before any trip is chosen, so there is no zone to ask
   * about yet — but once a trip is in hand its own day is the one that decides what `Today`
   * draws. A trip with no zone on record falls back to the device date, which is also the only
   * thing that let it be picked in the first place.
   */
  const trip = onTrip?.value;
  const tripToday = (trip && todayInZone(trip.timezone)) ?? todayISO();

  /**
   * The saved pile. Read on every focus, unconditionally.
   *
   * **The obvious optimisation here is a bug, and it shipped in the first draft of this line.**
   * Today is the only reader and only draws these in a free gap, so `trip ? load() : null` looks
   * free — but `useFocusedFetch` runs its fetcher *on focus*, and Home is already the focused tab
   * when the app launches, at which point `trip` is still undefined because the trips list has
   * not landed. The guard therefore evaluated false exactly once and never ran again: on a cold
   * launch straight into Home the list was permanently empty, and it only appeared after a tab
   * switch away and back. Which is how it was tested, which is why it looked fine.
   *
   * So the read is unconditional. It costs one small request per focus beside the trips list
   * Home already fetches, and `loadSavedPlaces` falls back to disk so a gap still has an answer
   * underground.
   */
  const savedHit = useFocusedFetch(loadSavedPlaces);
  const saved = savedHit?.value ?? undefined;

  const featured = trips ? pickFeatured(trips) : undefined;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* **The masthead addresses the wrong reader on a running trip, and it is the first
            thing on the screen.** The guard below already makes this argument about the Method
            band and the plan button — "the reader is standing in Lisbon" — and it simply never
            reached the two lines above it. Measured, the reading order on a trip was: TRIPMATE,
            a 28pt serif marketing headline, the destination, "Today" in 28pt serif, the clock,
            and only sixth the thing the app was opened for. Three independent reviews reported
            the symptom; this is where it lives.

            Off a trip it stays exactly as it was, because then it is what the screen is for. */}
        {trip ? null : (
          <>
            <BandOpener label="TripMate" />
            <ThemedText type="display" style={styles.headline}>
              Days worth keeping, written for where you are going.
            </ThemedText>
          </>
        )}

        {/* **While a trip is running, Home is about that trip.** Everything below — the wall's
            one featured card, the Method section — is for somebody who is not travelling. The
            Method in particular is marketing copy, and the reader is standing in Lisbon.

            The same argument reaches this button, which was the last thing on the screen still
            addressing the wrong reader: a full-width jade bar above Today, inviting somebody
            mid-trip to start a *different* trip, drawn louder than the stop they have to leave
            for. On a trip it moves below Today and becomes a line of text; off one it stays
            exactly as it was, because then it is genuinely what the screen is for. */}
        {trip ? (
          <View style={styles.band}>
            <Today
              trip={trip}
              today={tripToday}
              cachedAt={onTrip?.cachedAt ?? null}
              onOpenTrip={() => router.push(`/trip/${trip.id}`)}
              onAsk={
                offline ? undefined : (dayIndex) => router.push(`/trip/${trip.id}?ask=${dayIndex}`)
              }
              saved={saved ?? undefined}
              // Handed to Today rather than drawn under it: stacked beneath, this was a third
              // full-width action in the reading order, and Today owns its own action row now.
              onPlanAnother={() => router.push('/plan/basics')}
            />
          </View>
        ) : (
          <View style={styles.cta}>
            <PrimaryButton title="Plan a trip" onPress={() => router.push('/plan/basics')} />
            {/* The second door: a slate pill under the screen's one jade fill (Primary Action Surface),
                at the same width and height so the two read as peers sharing an edge. */}
            <PillButton
              block
              title="I already have a plan"
              onPress={() => router.push('/plan/own')}
              style={styles.secondDoor}
            />
          </View>
        )}

        {/* The only place Home spends a network call, and it reuses the Trips photo cache. */}
        {trip ? null : (
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
                {/* `onDeep`, not `foreground`. They are the same hex in dark and they are not
                    the same token: this ink stands on a photograph, so it does not move when the
                    appearance does. */}
                <View style={styles.featuredCaption}>
                  <ThemedText type="display" themeColor="onDeep" numberOfLines={2}>
                    {featured.trip.destination}
                  </ThemedText>
                  <ThemedText type="money" themeColor="onDeep">
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
        )}

        {trip ? null : (
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
        )}

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
  cta: { marginTop: Spacing.read, gap: Spacing.tight },
  // PrimaryButton's height, so the slate door matches the jade one above it.
  secondDoor: { minHeight: 52 },
  // Same 44pt target as Today's own actions, and no wider than its words.
  quietCta: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
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
