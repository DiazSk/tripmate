import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { listTrips } from '@/api/tripMateApi';
import type { TripSummary } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';

export default function Memories() {
  const router = useRouter();
  const theme = useTheme();
  // undefined = still loading, null = the fetch failed, [] = fetched fine, no trips yet.
  const [trips, setTrips] = useState<TripSummary[] | null | undefined>(undefined);

  useEffect(() => {
    listTrips().then((result) => setTrips(result ?? null));
  }, []);

  if (trips === undefined) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (trips === null) {
    return (
      <Centered text="Couldn't load your trips. Check your connection." />
    );
  }

  if (trips.length === 0) {
    return <Centered text="No trips yet — plan one from Home." />;
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container}>
        <FlatList
          data={trips}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/trip/${item.id}`)}
              style={[styles.row, { borderColor: theme.backgroundElement }]}>
              <ThemedText type="default">{item.destination}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.startDate} – {item.endDate}
              </ThemedText>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.centered}>
        <ThemedText type="default" themeColor="textSecondary" style={styles.centeredText}>
          {text}
        </ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  centeredText: {
    textAlign: 'center',
  },
  row: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    gap: 4,
  },
});
