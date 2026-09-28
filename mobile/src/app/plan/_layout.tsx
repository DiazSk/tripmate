import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Colors } from '@/constants/theme';
import { PlanDraftProvider } from '@/lib/planDraft';

/**
 * The way out of the wizard, on the two screens that would otherwise have none.
 *
 * A stack's *root* screen gets no back button, and this flow has two roots: `basics` always, and
 * `generating` because every step reaches it with `replace` rather than `push` — the wait is not
 * somewhere to come back to. Nothing else covers it either: the tab bar is gone, since the flow
 * is pushed over `(tabs)`, and the parent Stack that would have drawn a header of its own is
 * `headerShown: false` so it does not double up with this one. The result was a screen with no
 * exit at all — on `generating`, for the four to nine minutes a plan takes to write.
 *
 * Steps 2-4 are pushed, so they keep their ordinary back button and are deliberately not listed.
 */
function CloseButton() {
  const router = useRouter();
  return (
    <Pressable
      // `canGoBack` was false when the flow was deep-linked into rather than entered from a tab,
      // which is the same dead end this button exists to remove. The root layout now anchors
      // `(tabs)`, so a cold-start deep link gets Home prepended and the fallback no longer fires —
      // kept because it is what makes this button correct independent of that anchor.
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={12}>
      <SymbolView
        // Object form, never a bare SF string: given one, the Android path renders nothing at
        // all, silently.
        name={{ ios: 'xmark', android: 'close' }}
        tintColor={Colors.foreground}
        size={18}
        fallback={<Text style={styles.fallback}>Close</Text>}
      />
    </Pressable>
  );
}

export default function PlanLayout() {
  return (
    <PlanDraftProvider>
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Screen name="basics" options={{ headerLeft: () => <CloseButton /> }} />
        <Stack.Screen name="generating" options={{ headerLeft: () => <CloseButton /> }} />
      </Stack>
    </PlanDraftProvider>
  );
}

const styles = StyleSheet.create({
  fallback: { color: Colors.foreground, fontSize: 16 },
});
