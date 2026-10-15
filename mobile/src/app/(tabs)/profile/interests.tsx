import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CheckRow, Footer, Group, Separator, SettingsColors } from '@/components/settings-list';
import { Polar } from '@/constants/polar';
import { INTERESTS, MAX_STARRED, toggleTag } from '@/lib/planDraft';
import { useProfileStore } from '@/lib/profileStore';

/**
 * Tags you choose, and up to three you star. Unstarring follows deselection (a starred tag no longer
 * chosen would keep driving the plan while showing as off), and starring chooses.
 */
export default function Interests() {
  const { profile, edit } = useProfileStore();
  if (!profile) return null;
  const stars = profile.topPriorities;
  const left = MAX_STARRED - stars.length;

  const toggle = (tag: string) => {
    const on = profile.priorities.includes(tag);
    edit({ priorities: toggleTag(profile.priorities, tag), topPriorities: on ? stars.filter((t) => t !== tag) : stars });
  };
  const star = (tag: string) => {
    if (stars.includes(tag)) return edit({ topPriorities: stars.filter((t) => t !== tag) });
    if (!left) return;
    edit({ topPriorities: [...stars, tag], priorities: profile.priorities.includes(tag) ? profile.priorities : [...profile.priorities, tag] });
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Stack.Screen options={{ headerRight: () => <Text style={styles.left}>{left ? `${left} star${left === 1 ? '' : 's'} left` : 'Top three set'}</Text> }} />
      <Footer>Choose what you like. Star up to three: the starred ones drive the plan.</Footer>
      <Group>
        {INTERESTS.map((tag, i) => {
          const starred = stars.includes(tag);
          return (
            <View key={tag}>
              {i ? <Separator inset={48} /> : null}
              <CheckRow
                label={tag}
                on={profile.priorities.includes(tag)}
                onPress={() => toggle(tag)}
                trailing={
                  <Pressable
                    onPress={() => star(tag)}
                    disabled={!starred && !left}
                    accessibilityRole="button"
                    accessibilityLabel={starred ? `Unstar ${tag}` : `Star ${tag}`}
                    accessibilityState={{ selected: starred, disabled: !starred && !left }}
                    hitSlop={8}
                    style={[styles.star, !starred && !left && styles.dim]}>
                    <SymbolView name={starred ? 'star.fill' : 'star'} size={20} tintColor={starred ? Polar.signal : SettingsColors.faint} />
                  </Pressable>
                }
              />
            </View>
          );
        })}
      </Group>
      <Footer>{stars.length ? `In order: ${stars.join(' > ')}.` : 'No stars yet, so everything you choose counts the same.'}</Footer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 30, paddingBottom: 60 },
  left: { fontSize: 15, color: SettingsColors.grey },
  star: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.35 },
});
