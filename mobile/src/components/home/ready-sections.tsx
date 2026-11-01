import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import type { ReadyTrip } from '@shared/readyTrips';

import { FeaturedPostcard, RailPostcard, SkeletonPostcard } from '@/components/home/postcard';
import { Polar, PolarFonts } from '@/constants/polar';
import { clockAt } from '@/lib/dayDisplay';
import { featuredFor, filterTrips, railsFor, type Pill } from '@/lib/readyTrips';
import type { Cached } from '@/lib/tripCache';
import { Text } from '@/components/themed-text';

const GAP = 12;
const GUTTER = 20;

/**
 * The ready-made trips under the pills: the featured carousel, then the themed rails, all filtered
 * by the one pill. Every state is a drawn one, never a blank: loading is three still card shapes,
 * a catalogue that cannot load is one quiet line (the search above still works), a copy from disk
 * says when it was saved, and a filter with nothing under it offers the way back to All.
 */
export function ReadySections({
  state,
  pill,
  onShowAll,
  onOpen,
}: {
  state: Cached<ReadyTrip[]> | { unavailable: true } | undefined;
  pill: Pill;
  onShowAll: () => void;
  onOpen: (slug: string) => void;
}) {
  if (state === undefined) {
    return (
      <View style={styles.skeletons} accessibilityLabel="Loading ready-made trips">
        <SkeletonPostcard />
        <SkeletonPostcard />
        <SkeletonPostcard />
      </View>
    );
  }
  if ('unavailable' in state) {
    return <Text maxFontSizeMultiplier={1.6} style={styles.quiet}>Ready-made trips can’t load right now</Text>;
  }

  const trips = filterTrips(state.value, pill);
  const saved = state.cachedAt ? <Text maxFontSizeMultiplier={1.6} style={styles.saved}>{`Saved ${clockAt(state.cachedAt) ?? 'earlier'} · offline`}</Text> : null;
  if (trips.length === 0) {
    return (
      <View style={styles.empty}>
        {saved}
        <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle} accessibilityRole="header">
          {pill === 'All' ? 'Nothing here yet' : `Nothing here yet for ${pill}`}
        </Text>
        {pill === 'All' ? null : (
          <Pressable onPress={onShowAll} accessibilityRole="button" style={({ pressed }) => [styles.showAll, pressed && styles.pressed]}>
            <Text maxFontSizeMultiplier={1.3} style={styles.showAllText}>Show all</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View>
      {saved}
      {/* Keyed by the pill: a new filter starts the carousel at its first card. */}
      <Featured key={pill} trips={featuredFor(trips)} pill={pill} onOpen={onOpen} />
      {railsFor(trips).map((rail) => (
        <View key={rail.id} style={styles.rail}>
          <View style={styles.railHead}>
            <Text maxFontSizeMultiplier={1.3} style={styles.railTitle} accessibilityRole="header">{rail.title}</Text>
            <Text maxFontSizeMultiplier={1.6} style={styles.railCount}>{`${rail.trips.length} ${rail.trips.length === 1 ? 'plan' : 'plans'}`}</Text>
          </View>
          <FlatList
            horizontal
            data={rail.trips}
            keyExtractor={(t) => t.slug}
            renderItem={({ item }) => <RailPostcard trip={item} onPress={() => onOpen(item.slug)} />}
            ItemSeparatorComponent={Gap}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.railList}
          />
        </View>
      ))}
    </View>
  );
}

const Gap = () => <View style={{ width: GAP }} />;

/** The paging postcards, one per screen less the gutters, with dots that follow the swipe. */
function Featured({ trips, pill, onOpen }: { trips: ReadyTrip[]; pill: Pill; onOpen: (slug: string) => void }) {
  const { width: screen, height: tall } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const width = screen - GUTTER * 2;
  // Portrait, as the design's 3:4, but never so tall the rails fall off a short screen.
  const height = Math.round(Math.min(width * (4 / 3), 480, Math.max(340, tall - 360)));
  const step = width + GAP;
  const badge = (i: number) => (pill === 'All' ? (i === 0 ? 'This week’s pick' : 'Also this week') : `${pill} · ready-made`);
  return (
    <View>
      <FlatList
        horizontal
        data={trips}
        keyExtractor={(t) => t.slug}
        renderItem={({ item, index: i }) => (
          <FeaturedPostcard
            trip={item}
            width={width}
            height={height}
            badge={badge(i)}
            position={trips.length > 1 ? `${i + 1} / ${trips.length}` : null}
            onPress={() => onOpen(item.slug)}
          />
        )}
        ItemSeparatorComponent={Gap}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onMomentumScrollEnd={(e) => setIndex(Math.max(0, Math.min(trips.length - 1, Math.round(e.nativeEvent.contentOffset.x / step))))}
        contentContainerStyle={styles.featuredList}
        // The shadow under each card would be clipped flat by the list's own bounds.
        style={styles.featuredClip}
      />
      {trips.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {trips.map((t, i) => (
            <View key={t.slug} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8 },
  skeletons: { flexDirection: 'row', gap: GAP, paddingHorizontal: 16, paddingTop: 4, overflow: 'hidden' },
  quiet: { marginHorizontal: GUTTER, marginTop: 8, fontFamily: PolarFonts.sansRegular, fontSize: 14, lineHeight: 20, color: Polar.secondary },
  saved: { marginHorizontal: GUTTER, marginBottom: 10, fontFamily: PolarFonts.sansRegular, fontSize: 13, lineHeight: 18, color: Polar.secondary },

  empty: { marginHorizontal: 16, marginTop: 4, paddingVertical: 36, paddingHorizontal: 24, borderRadius: 22, alignItems: 'center', backgroundColor: Polar.ice },
  emptyTitle: { fontFamily: PolarFonts.display, fontSize: 26, lineHeight: 30, textAlign: 'center', color: Polar.ink },
  showAll: { marginTop: 18, minHeight: 44, paddingHorizontal: 22, borderRadius: 22, justifyContent: 'center', backgroundColor: Polar.ink },
  showAllText: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ice },

  featuredClip: { overflow: 'visible' },
  featuredList: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 16 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: -2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(31,42,68,0.24)' },
  dotOn: { width: 20, backgroundColor: Polar.ink },

  rail: { marginTop: 28 },
  railHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingHorizontal: GUTTER, marginBottom: 12 },
  railTitle: { flexShrink: 1, fontFamily: PolarFonts.display, fontSize: 26, lineHeight: 30, color: Polar.ink },
  railCount: { fontFamily: PolarFonts.sansRegular, fontSize: 13, color: Polar.secondary },
  railList: { paddingHorizontal: GUTTER },
});
