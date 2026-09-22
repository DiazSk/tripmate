import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';

import { getTrip } from '@/api/tripMateApi';
import type { DayPlan, Stop, Trip } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // undefined = still loading, null = the fetch failed.
  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);

  useEffect(() => {
    getTrip(id).then((result) => setTrip(result ?? null));
  }, [id]);

  const title = trip ? trip.destination : 'Trip';

  if (trip === undefined) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title }} />
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (trip === null) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title }} />
        <SafeAreaView style={styles.centered}>
          <ThemedText type="default" themeColor="textSecondary" style={styles.centeredText}>
            Couldn&apos;t load this trip. Check your connection.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title }} />
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.list}>
          <ThemedText type="subtitle">{trip.destination}</ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.dates}>
            {trip.startDate} – {trip.endDate}
          </ThemedText>
          {trip.itinerary.days.map((day, i) => (
            <DayCard key={day.date} day={day} index={i} />
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function DayCard({ day, index }: { day: DayPlan; index: number }) {
  return (
    <ThemedView style={styles.day}>
      <ThemedText type="smallBold">
        Day {index + 1} · {day.date}
      </ThemedText>
      {day.title ? <ThemedText type="small">{day.title}</ThemedText> : null}
      {day.stops.map((stop, j) => (
        <StopRow key={`${stop.name}-${j}`} stop={stop} />
      ))}
    </ThemedView>
  );
}

function StopRow({ stop }: { stop: Stop }) {
  return (
    <ThemedView style={styles.stop}>
      <ThemedText type="default">
        {stop.time ? `${stop.time} — ` : ''}
        {stop.name}
      </ThemedText>
      {stop.note ? (
        <ThemedText type="small" themeColor="textSecondary">
          {stop.note}
        </ThemedText>
      ) : null}
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
    padding: Spacing.four,
  },
  centeredText: {
    textAlign: 'center',
  },
  list: {
    padding: Spacing.three,
  },
  dates: {
    marginBottom: Spacing.four,
  },
  day: {
    marginBottom: Spacing.four,
    gap: Spacing.one,
  },
  stop: {
    paddingVertical: Spacing.one,
    gap: Spacing.half,
  },
});
