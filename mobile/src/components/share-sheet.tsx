import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SymbolView, type SymbolViewProps } from '@/components/symbol';
import { Group, Separator, SettingsColors } from '@/components/settings-list';
import { Polar } from '@/constants/polar';
import { Text } from '@/components/themed-text';

export type ShareState =
  | { kind: 'reading'; found: string[] }
  | { kind: 'done'; names: string[]; city: string | null; reminders: number; truncated: boolean; unread: string[] }
  | { kind: 'importFailed' }
  | { kind: 'saveFailed'; names: string[] };

/** What came in, said the way a person would: "A TikTok", "3 screenshots". */
export type SharedThing = { label: string; icon: SymbolViewProps['name'] };

const INSTAGRAM_NOTE = "Instagram doesn't let apps read posts. Share a screenshot or the downloaded reel instead. The link is saved as a reminder.";

/**
 * Share to TripMate, as the canvas design "Phone share in · 1 A sheet that saves": a half-height
 * sheet over wherever the share landed, the places appearing as rows while it reads and ticked once
 * they are saved under their city, then Done and, when there is a city, Plan a trip there.
 *
 * Only the drawing lives here; `app/share.tsx` reads the share and saves the places, and
 * `app/preview/share.tsx` plays this from a simulated read.
 *
 * On the grouped light the planner and Profile use, because the places it saves are read back on
 * the planner's Saved places sheet and listed on Profile in those same rows.
 */
export function ShareSheet({
  shared,
  state,
  onRetry,
  onDone,
  onPlan,
}: {
  shared: SharedThing;
  state: ShareState;
  onRetry: () => void;
  onDone: () => void;
  /** Open the planner on this city; the saved places are already waiting there. */
  onPlan: (city: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { title, sub } = headline(shared, state);
  const names = state.kind === 'reading' ? state.found : state.kind === 'done' || state.kind === 'saveFailed' ? state.names : [];
  const city = state.kind === 'done' ? state.city : null;
  const failed = state.kind === 'importFailed' || state.kind === 'saveFailed';

  return (
    <ScrollView style={styles.sheet} contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <View style={styles.head}>
        <View style={styles.source}>
          <SymbolView name={shared.icon} size={20} tintColor="#fff" />
        </View>
        <View style={styles.grow}>
          <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
            {title}
          </Text>
          <Text style={styles.sub}>{sub}</Text>
        </View>
        {state.kind === 'reading' ? <ActivityIndicator color={Polar.ember} /> : null}
      </View>

      {names.length ? (
        <>
          <Text style={styles.section}>{state.kind === 'done' ? (city ? `SAVED TO ${city.toUpperCase()}` : 'SAVED') : state.kind === 'saveFailed' ? 'FOUND' : 'FINDING'}</Text>
          <Group>
            {names.map((name, i) => (
              <Animated.View key={`${name}-${i}`} entering={FadeInDown.duration(260)}>
                {i ? <Separator inset={54} /> : null}
                <View style={styles.row}>
                  <View style={styles.pin}>
                    <SymbolView name={{ ios: 'mappin', android: 'place' }} size={13} tintColor="#fff" />
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.name}>{name}</Text>
                    {city ? <Text style={styles.city}>{city}</Text> : null}
                  </View>
                  {state.kind === 'done' ? (
                    <SymbolView name={{ ios: 'checkmark', android: 'check' }} size={15} tintColor={OK} weight="semibold" />
                  ) : null}
                </View>
              </Animated.View>
            ))}
          </Group>
        </>
      ) : state.kind === 'reading' ? (
        // Before the first place arrives: the section it will land in, with two rows still being
        // read, so the sheet says what it is doing rather than sitting blank under the spinner.
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.section}>FINDING</Text>
          <Group>
            {[0.62, 0.44].map((w, i) => (
              <View key={w}>
                {i ? <Separator inset={54} /> : null}
                <View style={styles.row}>
                  <View style={[styles.pin, styles.skeleton]} />
                  <View style={[styles.skeletonLine, { width: `${w * 100}%` }]} />
                </View>
              </View>
            ))}
          </Group>
        </View>
      ) : null}

      {state.kind === 'done' && state.truncated ? <Text style={styles.note}>That was a lot at once, so TripMate read the first 20.</Text> : null}
      {state.kind === 'done' ? state.unread.map((u, i) => <Text key={i} style={styles.note}>{u}</Text>) : null}

      {state.kind === 'reading' ? null : (
        <View style={styles.actions}>
          <Pressable
            onPress={failed ? onRetry : onDone}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}>
            <Text style={styles.primaryText}>{failed ? 'Try again' : 'Done'}</Text>
          </Pressable>
          {failed ? (
            <Pressable onPress={onDone} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          ) : city && names.length ? (
            <Pressable onPress={() => onPlan(city)} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
              <Text style={styles.secondaryText}>{`Plan a trip to ${city}`}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

/** The one line that says how it went, and the one under it that says what that means. */
function headline(shared: SharedThing, state: ShareState): { title: string; sub: string } {
  switch (state.kind) {
    case 'reading':
      return { title: state.found.length ? `Found ${state.found.length} so far` : 'Reading what you shared', sub: shared.label };
    case 'importFailed':
      return { title: "Couldn't read this right now", sub: 'Nothing was saved. Try again in a moment.' };
    case 'saveFailed':
      return { title: `Found ${count(state.names.length)}, not saved yet`, sub: "Couldn't save them just now. Try again." };
    case 'done': {
      const n = state.names.length;
      if (n) {
        return {
          title: state.city ? `${count(n)} saved to ${state.city}` : `${count(n)} saved`,
          sub: state.city ? 'They are waiting when you plan a trip there.' : 'They are waiting on your Profile.',
        };
      }
      if (state.reminders) return { title: 'Saved the link', sub: INSTAGRAM_NOTE };
      return { title: 'No places in this one', sub: "TripMate couldn't find a place to save. A screenshot of a list or a map works best." };
    }
  }
}

const count = (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`;

const OK = '#2F8F83';

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: SettingsColors.ground },
  content: { paddingTop: 22, gap: 4 },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  source: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.ink },
  title: { fontSize: 19, fontWeight: '600', color: '#000' },
  sub: { marginTop: 2, fontSize: 14, lineHeight: 19, color: SettingsColors.grey },
  section: { marginHorizontal: 32, marginTop: 8, marginBottom: 6, fontSize: 13, color: SettingsColors.grey },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 6 },
  pin: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.signal },
  name: { fontSize: 17, color: '#000' },
  skeleton: { backgroundColor: SettingsColors.pressed },
  skeletonLine: { height: 14, borderRadius: 7, backgroundColor: SettingsColors.pressed },
  city: { fontSize: 13, color: SettingsColors.grey },
  note: { marginHorizontal: 32, marginTop: 8, fontSize: 13, lineHeight: 18, color: SettingsColors.grey },
  actions: { gap: 6, marginTop: 18, paddingHorizontal: 16 },
  primary: { paddingVertical: 6, minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.signal },
  primaryPressed: { backgroundColor: Polar.signalPressed },
  primaryText: { fontSize: 17, fontWeight: '600', color: Polar.ink },
  secondary: { paddingVertical: 6, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 16, fontWeight: '600', color: Polar.ember },
});

