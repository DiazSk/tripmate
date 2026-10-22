import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ReadyTrip } from '@shared/readyTrips';

import { isoDaysFromNow } from '@/components/form';
import { useCardPhoto } from '@/components/home/postcard';
import { Meridian } from '@/components/meridian';
import { Scrim } from '@/components/polar-landing/scrim';
import { monumentFontSize, usePolarFonts } from '@/components/polar-ui';
import { SymbolView } from '@/components/symbol';
import { Polar, PolarFonts } from '@/constants/polar';
import { prefillQuery, readyTripPrefill } from '@/lib/homeIdeas';
import { formatMoney } from '@/lib/spend';
import { useReadyTrips } from '@/lib/useReadyTrips';

/** Make it mine plans from where Basics' own default would: a month out. */
const LEAD_DAYS = 30;

/**
 * A ready-made trip, opened from its card on Home (design D's preview sheet): the photograph with
 * its monument, the days, the price and the pace, every day's stops, then the two ways to take it.
 *
 * **Use this plan** keeps the stops as the trip has them and asks only what a plan with no dates
 * needs (Basics, in its ready-made mode). **Make it mine** hands the trip to the planner as a starting point, its
 * stops as must-sees, for a plan written around the traveller.
 *
 * One root ScrollView, as `how-it-works.tsx` explains: a ScrollView beside anything else paints
 * nothing inside a native form sheet.
 */
export default function ReadyTripSheet() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const trips = useReadyTrips();
  usePolarFonts();
  const trip = trips?.find((t) => t.slug === slug);
  if (trips === undefined) {
    return (
      <ScrollView style={styles.sheet} contentContainerStyle={styles.centre}>
        <ActivityIndicator color={Polar.secondary} accessibilityLabel="Loading the trip" />
      </ScrollView>
    );
  }
  return trip ? <Detail trip={trip} /> : <Missing />;
}

function useClose() {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace('/'));
}

/** A slug the catalogue no longer has (unpublished since the card was drawn, or a stale link). */
function Missing() {
  const close = useClose();
  return (
    <ScrollView style={styles.sheet} contentContainerStyle={styles.centre}>
      <Text maxFontSizeMultiplier={1.3} style={styles.missing} accessibilityRole="header">
        Couldn’t find this trip
      </Text>
      <Pressable onPress={close} accessibilityRole="button" style={({ pressed }) => [styles.secondary, styles.missingClose, pressed && styles.pressed]}>
        <Text maxFontSizeMultiplier={1.6} style={styles.secondaryText}>Close</Text>
      </Pressable>
    </ScrollView>
  );
}

function Detail({ trip }: { trip: ReadyTrip }) {
  const router = useRouter();
  const close = useClose();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const photo = useCardPhoto(trip);
  const days = `${trip.days} ${trip.days === 1 ? 'day' : 'days'}`;
  const from = formatMoney(trip.priceFrom);

  return (
    <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }} showsVerticalScrollIndicator={false}>
      <View style={styles.photo}>
        {photo ? <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityIgnoresInvertColors /> : null}
        <Scrim stops={[[0, Polar.night, 0.4], [0.3, Polar.night, 0], [1, Polar.night, 0.82]]} />
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
          <SymbolView name={{ ios: 'xmark', android: 'close' }} size={14} weight="semibold" tintColor={Polar.ice} />
        </Pressable>
        <View style={styles.photoFoot}>
          <Text maxFontSizeMultiplier={1.3} style={styles.eyebrow} numberOfLines={1}>
            {`${trip.country} · Ready-made plan`.toUpperCase()}
          </Text>
          {/* A picture of a word, as on the card: the title below says it in words. */}
          <Text
            allowFontScaling={false}
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[styles.monument, { fontSize: monumentFontSize(trip.monument, width - 40, 56) }]}
            numberOfLines={1}
            adjustsFontSizeToFit>
            {trip.monument}
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">
          {trip.title}
        </Text>
        <View style={styles.strip} accessible accessibilityLabel={`${days}, from ${from} per person, ${trip.pace}`}>
          <Cell label="Days" value={String(trip.days)} />
          <View style={styles.stripRule} />
          <Cell label="From" value={from} />
          <View style={styles.stripRule} />
          <Cell label="Pace" value={trip.pace} />
        </View>
        <Text maxFontSizeMultiplier={1.6} style={styles.priceNote}>{trip.priceNote || 'Estimate per person'}</Text>
        {trip.summary ? <Text maxFontSizeMultiplier={1.6} style={styles.summary}>{trip.summary}</Text> : null}

        <View style={styles.days}>
          {trip.itinerary.map((day, i) => (
            <View key={i} style={[styles.day, i > 0 && styles.dayRule]}>
              <Text maxFontSizeMultiplier={1.6} style={styles.dayTitle}>{`Day ${i + 1} · ${day.theme}`}</Text>
              {day.stops.map((stop, s) => (
                <Text key={s} maxFontSizeMultiplier={1.6} style={styles.stop}>
                  {stop.name}
                </Text>
              ))}
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => router.replace(`/plan/basics?ready=${encodeURIComponent(trip.slug)}`)}
            accessibilityRole="button"
            accessibilityHint="Choose dates and who is coming, then save it as a draft"
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}>
            <Text maxFontSizeMultiplier={1.6} style={styles.primaryText}>Use this plan</Text>
          </Pressable>
          <Pressable
            // With a start, so the planner opens at the trip's own length rather than Basics' week.
            onPress={() => router.replace(`/plan/basics?${prefillQuery(readyTripPrefill(trip, isoDaysFromNow(LEAD_DAYS)))}`)}
            accessibilityRole="button"
            accessibilityLabel="Make it mine, tweak it with Meri"
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}>
            <Meridian state="idle" size={20} />
            <Text maxFontSizeMultiplier={1.6} style={styles.secondaryText}>
              Make it mine<Text style={styles.caption}> · tweak it with Meri</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text maxFontSizeMultiplier={1.6} style={styles.cellLabel}>{label}</Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.cellValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const GROUND = '#F2F2F7';

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#fff' },
  centre: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  pressed: { opacity: 0.7 },
  missing: { fontFamily: PolarFonts.display, fontSize: 30, lineHeight: 34, textAlign: 'center', color: Polar.ink },
  missingClose: { alignSelf: 'stretch' },

  photo: { height: 280, overflow: 'hidden', backgroundColor: Polar.deep },
  close: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9,11,16,0.45)',
  },
  photoFoot: { position: 'absolute', left: 20, right: 20, bottom: 16 },
  eyebrow: { fontFamily: PolarFonts.sansSemi, fontSize: 12, letterSpacing: 2, color: Polar.frost88 },
  // No lineHeight: Oswald's ascent is taller than its size, and a tight box clips the caps (postcard.tsx).
  monument: { marginTop: 2, fontFamily: PolarFonts.condensed, textTransform: 'uppercase', letterSpacing: -0.5, color: Polar.ice },

  body: { paddingHorizontal: 20, paddingTop: 18 },
  title: { fontFamily: PolarFonts.display, fontSize: 30, lineHeight: 34, color: Polar.ink },
  strip: { marginTop: 14, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderRadius: 18, backgroundColor: GROUND },
  stripRule: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: Polar.rule },
  cell: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  cellLabel: { fontFamily: PolarFonts.sansRegular, fontSize: 12, color: Polar.secondary },
  cellValue: { marginTop: 2, fontFamily: PolarFonts.sansSemi, fontSize: 16, color: Polar.ink, fontVariant: ['tabular-nums'] },
  priceNote: { marginTop: 8, fontFamily: PolarFonts.sansRegular, fontSize: 13, lineHeight: 18, textAlign: 'center', color: Polar.secondary },
  summary: { marginTop: 16, fontFamily: PolarFonts.sansRegular, fontSize: 16, lineHeight: 23, color: Polar.ink },

  days: { marginTop: 16 },
  day: { paddingVertical: 12, gap: 3 },
  dayRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Polar.rule },
  dayTitle: { fontFamily: PolarFonts.sansSemi, fontSize: 13, letterSpacing: 0.6, color: Polar.ember, marginBottom: 2 },
  stop: { fontFamily: PolarFonts.sansRegular, fontSize: 16, lineHeight: 22, color: Polar.ink },

  actions: { marginTop: 20, gap: 8 },
  primary: { minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.signal },
  primaryPressed: { backgroundColor: Polar.signalPressed },
  primaryText: { fontFamily: PolarFonts.sansSemi, fontSize: 16, color: Polar.ink },
  secondary: { minHeight: 52, flexDirection: 'row', gap: 8, borderRadius: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: GROUND },
  secondaryPressed: { backgroundColor: '#E9E9EF' },
  secondaryText: { flexShrink: 1, fontFamily: PolarFonts.sansSemi, fontSize: 16, color: Polar.ink },
  caption: { fontFamily: PolarFonts.sansRegular, color: Polar.secondary },
});
