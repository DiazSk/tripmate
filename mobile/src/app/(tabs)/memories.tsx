import { useRouter } from 'expo-router';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/api/auth';
import { listTrips } from '@/api/tripMateApi';
import type { TripSummary } from '@/api/types';
import { PlacePhoto } from '@/components/place-photo';
import { Invitation, Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatRange } from '@/lib/dayDisplay';
import { useFocusedFetch } from '@/lib/useFocusedFetch';

export default function Memories() {
  const router = useRouter();
  const { account } = useAccount();
  // undefined = still loading, null = the fetch failed, [] = fetched fine, no trips yet.
  // Re-read on focus rather than on mount: a trip kept in the wizard has to show up here.
  const trips = useFocusedFetch<TripSummary[] | null>(async () => (await listTrips()) ?? null);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={gridData(trips)}
        keyExtractor={(trip) => trip.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.masthead}>
            <ThemedText type="display">Memories</ThemedText>
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
          item.id === SPACER_ID ? (
            <View style={styles.spacer} />
          ) : (
            <MemoryTile trip={item} onPress={() => router.push(`/trip/${item.id}`)} />
          )
        }
      />
    </SafeAreaView>
  );
}

/**
 * A two-column grid whose last row holds one tile would stretch it across the full width —
 * `flex: 1` has nothing to share the row with — and an `aspectRatio` photo then becomes enormous.
 * A phantom cell keeps every tile exactly the width it has in a full row, which `maxWidth: '50%'`
 * would only approximate once the column gap is counted.
 */
const SPACER_ID = '__spacer__';

function gridData(trips: TripSummary[] | null | undefined): TripSummary[] {
  if (!trips || trips.length === 0) return [];
  if (trips.length % 2 === 0) return trips;
  return [...trips, { id: SPACER_ID } as TripSummary];
}

function countLine(trips: TripSummary[] | null | undefined): string {
  if (trips === undefined) return 'Gathering your plans';
  if (trips === null) return 'Not loaded';
  if (trips.length === 0) return 'Nothing kept yet';
  const countries = new Set(trips.map((t) => t.destination.split(',').pop()?.trim()).filter(Boolean));
  const trip = trips.length === 1 ? 'trip' : 'trips';
  const place = countries.size === 1 ? 'place' : 'places';
  return `${trips.length} ${trip} · ${countries.size} ${place}`;
}

/**
 * A memory tile. Radius 8 rather than the Swift app's 16: DESIGN.md records those 16px panels as
 * a "Radius Drift" — incumbents the web retokenization deliberately left alone — and says new
 * surfaces take 5–8px or tighter. This app is all new surface.
 */
function MemoryTile({ trip, onPress }: { trip: TripSummary; onPress: () => void }) {
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

const formatBudget = (budget: number) =>
  budget > 0 ? `$${Math.round(budget).toLocaleString('en-US')}` : '—';

const styles = StyleSheet.create({
  // 44pt is the platform's minimum touch target; a line of text is otherwise ~18pt tall.
  signIn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.read },
  screen: { flex: 1, backgroundColor: Colors.canvas },
  content: { padding: Spacing.read, gap: Spacing.rows },
  row: { gap: Spacing.rows },
  masthead: { gap: Spacing.hair, marginBottom: Spacing.tight },
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
