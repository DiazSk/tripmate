import { useRouter } from 'expo-router';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/api/auth';
import { listTrips } from '@/api/tripMateApi';
import type { TripSummary } from '@/api/types';
import { PlacePhoto } from '@/components/place-photo';
import { Invitation, Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { BarHeight, Colors, Radius, Spacing } from '@/constants/theme';
import { formatRange } from '@/lib/dayDisplay';
import { type WallItem, todayISO, wallItems } from '@/lib/tripsWall';
import { useFocusedFetch } from '@/lib/useFocusedFetch';

export default function Trips() {
  const router = useRouter();
  const { account } = useAccount();
  // undefined = still loading, null = the fetch failed, [] = fetched fine, no trips yet.
  // Re-read on focus rather than on mount: a trip kept in the wizard has to show up here.
  const trips = useFocusedFetch<TripSummary[] | null>(async () => (await listTrips()) ?? null);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={wall(trips)}
        keyExtractor={(item) => item.key}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.masthead}>
            <ThemedText type="display">Trips</ThemedText>
            <ThemedText type="detail" themeColor="muted">
              {countLine(trips)}
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          trips === undefined ? (
            <Loading />
          ) : trips === null ? (
            <Notice>Couldn&rsquo;t reach TripMate. Check your connection.</Notice>
          ) : (
            <View>
              <Invitation
                title="No trips kept yet"
                body="Plans you keep are collected here, with the places you chose."
                note="Start one from Home"
              />
              {/* Only when signed out, and only when there is nothing here. Somebody who already
                  has trips on the web opens this app to a blank wall and no reason for it; this
                  is the reason. Offered to a signed-in traveller it would be nonsense, and
                  offered above a full grid it would be an advert. */}
              {!account ? (
                <Pressable onPress={() => router.push('/signin')} style={styles.signIn}>
                  <ThemedText type="detail" themeColor="muted">
                    Already have trips? <ThemedText type="detail">Sign in</ThemedText>
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          )
        }
        renderItem={({ item }) =>
          item.kind === 'spacer' ? (
            <View style={styles.spacer} />
          ) : item.kind === 'header' ? (
            <ThemedText type="label" themeColor="muted" style={styles.sectionLabel}>
              {item.label}
            </ThemedText>
          ) : (
            <TripTile trip={item.trip} onPress={() => router.push(`/trip/${item.trip.id}`)} />
          )
        }
      />
    </SafeAreaView>
  );
}

/** The clock is read here rather than inside the rule, so the arrangement stays testable. */
function wall(trips: TripSummary[] | null | undefined): WallItem[] {
  return trips ? wallItems(trips, todayISO()) : [];
}

function countLine(trips: TripSummary[] | null | undefined): string {
  if (trips === undefined) return 'Gathering your plans';
  if (trips === null) return 'Not loaded';
  if (trips.length === 0) return 'Nothing kept yet';
  // **Distinct destinations, not distinct countries.** This counted the last comma-separated
  // segment — the country — while calling the result "places", so a Lisbon trip and a Porto trip
  // read as "1 place". Two cities is two places to anybody who went to both, and the word on
  // screen should be the thing being counted.
  const places = new Set(trips.map((t) => t.destination.trim()).filter(Boolean));
  const trip = trips.length === 1 ? 'trip' : 'trips';
  const place = places.size === 1 ? 'place' : 'places';
  return `${trips.length} ${trip} · ${places.size} ${place}`;
}

/**
 * A trip tile. Radius 8 rather than the Swift app's 16: DESIGN.md records those 16px panels as
 * a "Radius Drift" — incumbents the web retokenization deliberately left alone — and says new
 * surfaces take 5–8px or tighter. This app is all new surface.
 */
function TripTile({ trip, onPress }: { trip: TripSummary; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && Platform.OS === 'ios' && styles.tilePressed]}
      android_ripple={{ color: Colors.pressed }}>
      <View style={styles.photoWrap}>
        <PlacePhoto name={trip.destination} aspectRatio={4 / 5} radius={Radius.read} />
        {/* A second border inside the photo's own edge. The tile's hairline is white at 12%,
            which disappears against a bright photograph; this one sits on the image itself. */}
        <View pointerEvents="none" style={styles.photoEdge} />
      </View>

      <ThemedText type="heading" numberOfLines={1} style={styles.tileName}>
        {trip.destination}
      </ThemedText>
      {/* Two lines, not one: at a half-width tile these do not fit together. */}
      <ThemedText type="money" themeColor="muted">
        {formatRange(trip.startDate, trip.endDate)}
      </ThemedText>
      <ThemedText type="money" themeColor="money">
        {formatBudget(trip.budget)}
      </ThemedText>
    </Pressable>
  );
}

/**
 * Gold says money and only money — which is exactly why the figure needs a noun.
 *
 * `trip.budget` is the ceiling the traveler set, not what the plan came to and not what they
 * paid; a bare gold `$1,800` beside a photograph reads as any of the three. The word costs four
 * characters and removes the guess.
 */
const formatBudget = (budget: number) =>
  budget > 0 ? `Budget · $${Math.round(budget).toLocaleString('en-US')}` : '—';

const styles = StyleSheet.create({
  // 44pt is the platform's minimum touch target; a line of text is otherwise ~18pt tall.
  signIn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.read },
  screen: { flex: 1, backgroundColor: Colors.canvas },
  /** The tab bar floats over the wall and its safe-area inset does not reach this list, so the
   *  last row's budget line ended up underneath it — the same correction Home and Profile carry. */
  content: { padding: Spacing.read, gap: Spacing.rows, paddingBottom: BarHeight + Spacing.regular },
  row: { gap: Spacing.rows },
  masthead: { gap: Spacing.hair, marginBottom: Spacing.tight },
  // Sits in the leading half of its own row (see `wallItems`), aligned with the tile beneath it.
  sectionLabel: { flex: 1, alignSelf: 'flex-end', paddingBottom: Spacing.hair },
  tile: {
    flex: 1,
    backgroundColor: Colors.panel,
    borderRadius: Radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    padding: 10,
    gap: 2,
    overflow: 'hidden',
  },
  tilePressed: { opacity: 0.7 },
  spacer: { flex: 1 },
  photoWrap: { marginBottom: Spacing.tight },
  photoEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.read,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.photoBorder,
  },
  tileName: { marginBottom: 1 },
});
