import { useShareIntentContext } from 'expo-share-intent';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

// SPIKE ONLY — replaced in Task 5.
export default function ShareProbe() {
  const { shareIntent, hasShareIntent, error } = useShareIntentContext();
  return (
    <ThemedView style={{ flex: 1, padding: 24, paddingTop: 80 }}>
      <ThemedText selectable>{JSON.stringify({ hasShareIntent, error, shareIntent }, null, 2)}</ThemedText>
    </ThemedView>
  );
}
