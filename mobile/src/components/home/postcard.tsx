import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ReadyTrip } from '@shared/readyTrips';

import { usePlacePhoto } from '@/api/placePhotos';
import petra from '@/assets/images/scenes/petra-treasury.webp';
import wadiRum from '@/assets/images/scenes/wadi-rum-desert.webp';
import tuscany from '@/assets/images/scenes/tuscany-cypress-road.webp';
import vernazza from '@/assets/images/scenes/vernazza-blue-hour.webp';
import jaipur from '@/assets/images/scenes/jaipur-amber-fort-elephant.webp';
import graubunden from '@/assets/images/scenes/graubunden-autumn-valley.webp';
import peles from '@/assets/images/scenes/peles-castle-romania-snow.webp';
import { Scrim } from '@/components/polar-landing/scrim';
import { SymbolView } from '@/components/symbol';
import { monumentFontSize } from '@/components/polar-ui';
import { Polar, PolarFonts } from '@/constants/polar';
import { formatMoney } from '@/lib/spend';

/**
 * The ready-made trip as a postcard: the carousel's paging card and the rails' portrait card.
 *
 * **A bundled scene first, then the place lookup.** The catalogue stores no photos (spec, Data), and
 * the seven trips the app already carries a photograph of draw that one — no request, and a better
 * picture than Wikipedia's lead image. Every other trip asks `usePlacePhoto` by its destination. A
 * trip with neither is the night ground with its monument, which is drawn on every card anyway, so
 * a missing photo is a finished card rather than an empty box.
 */
/** A bundled asset (Metro's module number) or a fetched photo. */
type Photo = number | { uri: string };

const SCENES: Record<string, number> = {
  'petra-at-first-light': petra,
  'wadi-rum-slowly': wadiRum,
  'val-dorcia-in-no-hurry': tuscany,
  'five-villages-three-days': vernazza,
  'jaipur-in-pink-and-gold': jaipur,
  'engadin-five-unhurried-days': graubunden,
  'sinaia-and-the-carpathians': peles,
};

function useCardPhoto(trip: ReadyTrip): Photo | null {
  const scene = SCENES[trip.slug];
  // No lookup for a trip with a scene: `usePlacePhoto(undefined)` subscribes to nothing.
  const photo = usePlacePhoto(scene ? undefined : trip.destination);
  const uri = photo?.imageUrl ?? photo?.thumbnailUrl ?? null;
  return scene ?? (uri ? { uri } : null);
}

/** "3 days · From $1,450": the card's line. The sheet carries the full "per person, estimate". */
export const tripMeta = (trip: ReadyTrip) => `${trip.days} ${trip.days === 1 ? 'day' : 'days'} · From ${formatMoney(trip.priceFrom)}`;

/** One sentence for VoiceOver and TalkBack: the card is a single button, its parts are not. */
const spoken = (trip: ReadyTrip) => `${trip.title}, ${trip.days} ${trip.days === 1 ? 'day' : 'days'}, from ${formatMoney(trip.priceFrom)} per person`;

/** The carousel's card: full width less the gutters, the monument across the photo's foot. */
export function FeaturedPostcard({
  trip,
  width,
  height,
  badge,
  position,
  onPress,
}: {
  trip: ReadyTrip;
  width: number;
  height: number;
  /** "This week's pick", "Also this week", "Desert · ready-made". */
  badge: string;
  /** "1 / 5", or null for a carousel of one. */
  position: string | null;
  onPress: () => void;
}) {
  const photo = useCardPhoto(trip);
  const measure = width - 40;
  const size = monumentFontSize(trip.monument, measure, 72);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken(trip)}
      style={({ pressed }) => [styles.featured, { width, height }, pressed && styles.pressed]}>
      {photo ? <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} recyclingKey={trip.slug} accessibilityIgnoresInvertColors /> : null}
      <Scrim stops={[[0, Polar.night, 0.45], [0.24, Polar.night, 0], [0.42, Polar.night, 0], [1, Polar.night, 0.88]]} />
      <View style={styles.featuredTop}>
        <Text maxFontSizeMultiplier={1.3} style={styles.badge}>{badge}</Text>
        {position ? <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.position]}>{position}</Text> : null}
      </View>
      <View style={styles.featuredFoot}>
        <Text maxFontSizeMultiplier={1.3} style={styles.eyebrow} numberOfLines={1}>
          {`${trip.country} · Ready-made plan`.toUpperCase()}
        </Text>
        {/* A picture of a word, fitted to the measure from Oswald's widths; the label says the title. No
            lineHeight: Oswald's ascent is taller than its size, and a tight line box clips the caps flat on iOS. */}
        <Text allowFontScaling={false} style={[styles.monument, { fontSize: size }]} numberOfLines={1} adjustsFontSizeToFit>
          {trip.monument}
        </Text>
        <View style={styles.featuredRow}>
          <View style={styles.featuredText}>
            <Text maxFontSizeMultiplier={1.3} style={styles.featuredTitle} numberOfLines={2}>{trip.title}</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.featuredMeta} numberOfLines={1}>{tripMeta(trip)}</Text>
          </View>
          <View style={styles.go}>
            <SymbolView name={{ ios: 'arrow.up.right', android: 'north_east' }} size={16} tintColor={Polar.ink} weight="semibold" />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export const RAIL_CARD_WIDTH = 150;

/** A rail's portrait card: the photo with its monument, then the line and the country under it. */
export function RailPostcard({ trip, onPress }: { trip: ReadyTrip; onPress: () => void }) {
  const photo = useCardPhoto(trip);
  const size = monumentFontSize(trip.monument, RAIL_CARD_WIDTH - 24, 26);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={spoken(trip)} style={({ pressed }) => [styles.rail, pressed && styles.pressed]}>
      <View style={styles.railPhoto}>
        {photo ? <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} recyclingKey={trip.slug} accessibilityIgnoresInvertColors /> : null}
        <Scrim stops={[[0, Polar.night, 0], [0.45, Polar.night, 0], [1, Polar.night, 0.82]]} />
        <Text allowFontScaling={false} style={[styles.railMonument, { fontSize: size, lineHeight: size * 1.2 }]} numberOfLines={2}>
          {trip.monument}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={1.6} style={styles.railMeta} numberOfLines={2}>{tripMeta(trip)}</Text>
      <Text maxFontSizeMultiplier={1.6} style={styles.railSub} numberOfLines={2}>{`${trip.country} · ${trip.pace}`}</Text>
    </Pressable>
  );
}

/** The loading stand-in: a rail card's shape and nothing else. Still, so Reduce Motion has nothing to stop. */
export function SkeletonPostcard() {
  return (
    <View style={styles.rail}>
      <View style={[styles.railPhoto, styles.skeleton]} />
      <View style={[styles.skeletonLine, { width: '80%' }]} />
      <View style={[styles.skeletonLine, { width: '55%' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },

  featured: {
    overflow: 'hidden',
    borderRadius: 28,
    backgroundColor: Polar.deep,
    // A shadow needs the card itself to draw it on iOS; overflow:hidden clips only the children.
    shadowColor: Polar.night,
    shadowOpacity: 0.16,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
  },
  featuredTop: { position: 'absolute', top: 16, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  badge: {
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(9,11,16,0.48)',
    fontFamily: PolarFonts.sansSemi,
    fontSize: 12,
    letterSpacing: 0.4,
    color: Polar.ice,
  },
  position: { paddingHorizontal: 10, fontFamily: PolarFonts.sans, fontVariant: ['tabular-nums'] },
  featuredFoot: { position: 'absolute', left: 20, right: 20, bottom: 20 },
  eyebrow: { fontFamily: PolarFonts.sansSemi, fontSize: 12, letterSpacing: 2, color: Polar.frost88 },
  monument: { marginTop: 2, fontFamily: PolarFonts.condensed, textTransform: 'uppercase', letterSpacing: -0.5, color: Polar.ice },
  featuredRow: { marginTop: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  featuredText: { flex: 1, gap: 2 },
  featuredTitle: { fontFamily: PolarFonts.sansSemi, fontSize: 16, lineHeight: 21, color: Polar.ice },
  featuredMeta: { fontFamily: PolarFonts.sans, fontSize: 14, lineHeight: 19, color: Polar.frost88, fontVariant: ['tabular-nums'] },
  go: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.ice },

  rail: { width: RAIL_CARD_WIDTH },
  railPhoto: { width: RAIL_CARD_WIDTH, height: RAIL_CARD_WIDTH * (4 / 3), overflow: 'hidden', borderRadius: 22, backgroundColor: Polar.deep },
  railMonument: { position: 'absolute', left: 12, right: 12, bottom: 12, fontFamily: PolarFonts.condensed, textTransform: 'uppercase', color: Polar.ice },
  railMeta: { marginTop: 8, fontFamily: PolarFonts.sansSemi, fontSize: 14, lineHeight: 19, color: Polar.ink, fontVariant: ['tabular-nums'] },
  railSub: { fontFamily: PolarFonts.sansRegular, fontSize: 13, lineHeight: 18, color: Polar.secondary },

  skeleton: { backgroundColor: 'rgba(31,42,68,0.07)' },
  skeletonLine: { height: 12, marginTop: 10, borderRadius: 6, backgroundColor: 'rgba(31,42,68,0.07)' },
});
