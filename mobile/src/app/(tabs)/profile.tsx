import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getProfile } from '@/api/tripMateApi';
import type { CrowdPreference, EnergyLevel, ExplorerStyle, GroupType, TravelerProfile } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Labels ported from ios/TripMateKit/Sources/TripMateKit/UserAnswers.swift.
const GROUP_LABELS: Record<GroupType, string> = {
  solo: 'Solo',
  couple: 'Couple',
  family_with_kids: 'Family with kids',
  other: 'Something else',
};

const EXPLORER_STYLE_LABELS: Record<ExplorerStyle, string> = {
  packed: 'See as much as possible',
  relaxed: 'A few things, done well',
  offbeat: 'Off the beaten path',
  mixed: 'A bit of both',
};

const ENERGY_LABELS: Record<EnergyLevel, string> = {
  high: 'Happy to walk all day',
  moderate: 'A comfortable amount',
  low: 'Prefer it gentle',
};

const CROWD_LABELS: Record<CrowdPreference, string> = {
  love: 'Love the buzz',
  mixed: 'Some of each',
  avoid: 'Keep it quiet',
};

export default function Profile() {
  // undefined = still loading, null = the fetch failed, "none" = fetched fine, no profile yet.
  const [profile, setProfile] = useState<TravelerProfile | null | 'none' | undefined>(undefined);

  useEffect(() => {
    getProfile().then((result) => setProfile(result === undefined ? null : result === null ? 'none' : result));
  }, []);

  if (profile === undefined) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (profile === null) {
    return <Centered text="Couldn't load your profile. Check your connection." />;
  }

  if (profile === 'none') {
    return <Centered text="You haven't filled in your travel profile yet." />;
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.list}>
          <Row label="Group" value={GROUP_LABELS[profile.group]} />
          <Row label="Explorer style" value={EXPLORER_STYLE_LABELS[profile.explorerStyle]} />
          <Row label="Energy" value={ENERGY_LABELS[profile.energy]} />
          <Row label="Crowds" value={CROWD_LABELS[profile.crowds]} />
          <Row label="Top priorities" value={profile.topPriorities.join(', ') || '—'} />
          <Row label="Dietary" value={profile.dietary.tags.join(', ') || '—'} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="default">{value}</ThemedText>
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
  list: {
    padding: Spacing.four,
  },
  row: {
    gap: Spacing.half,
    marginBottom: Spacing.four,
  },
});
