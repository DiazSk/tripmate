import { Stack, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import type { CrowdPreference, EnergyLevel, ExplorerStyle } from '@/api/types';
import {
  ChoiceRow,
  FieldTrough,
  PrimaryButton,
  Question,
  TagGrid,
  TextField,
  ToggleRow,
} from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import {
  DIETARY_TAGS,
  INTERESTS,
  MAX_STARRED,
  toggleStar,
  toggleTag,
  usePlanDraft,
} from '@/lib/planDraft';

const STYLES: { value: ExplorerStyle; label: string }[] = [
  { value: 'packed', label: 'See as much as possible' },
  { value: 'relaxed', label: 'A few things, done well' },
  { value: 'offbeat', label: 'Off the beaten path' },
  { value: 'mixed', label: 'A bit of both' },
];

const ENERGY: { value: EnergyLevel; label: string }[] = [
  { value: 'high', label: 'Happy to walk all day' },
  { value: 'moderate', label: 'A comfortable amount' },
  { value: 'low', label: 'Prefer it gentle' },
];

const CROWDS: { value: CrowdPreference; label: string }[] = [
  { value: 'love', label: 'Love the buzz' },
  { value: 'mixed', label: 'Some of each' },
  { value: 'avoid', label: 'Keep it quiet' },
];

export default function PreferencesStep() {
  const router = useRouter();
  const { draft, patch } = usePlanDraft();
  const { dietary, accessibility, starredInterests } = draft;

  const starsLeft = MAX_STARRED - starredInterests.length;
  const interestCaption =
    starredInterests.length === 0
      ? 'Tap to pick. Tap again to star — starred ones count most.'
      : starsLeft > 0
        ? `Star up to ${starsLeft} more — those count most.`
        : 'Those three count most.';

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: "What you're after" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="display" style={styles.headline}>
          What are you after?
        </ThemedText>

        <Question title="What's the trip for" caption="Optional.">
          <FieldTrough>
            <TextField
              label="Why"
              value={draft.purpose}
              onChangeText={(purpose) => patch({ purpose })}
              placeholder="An anniversary"
            />
          </FieldTrough>
        </Question>

        <Question title="What you're into" caption={interestCaption}>
          <TagGrid
            tags={INTERESTS}
            selected={draft.interests}
            starred={starredInterests}
            onToggle={(tag) =>
              patch({
                interests: toggleTag(draft.interests, tag),
                // Unpicking a starred tag must take the star with it, or the weighting keeps a
                // priority the traveller just removed.
                starredInterests: starredInterests.filter((t) => t !== tag),
              })
            }
            onStar={(tag) => patch(toggleStar(draft, tag))}
          />
        </Question>

        <Question title="How you like to explore">
          <ChoiceRow
            options={STYLES}
            value={draft.explorerStyle}
            onChange={(explorerStyle) => patch({ explorerStyle })}
          />
        </Question>

        <Question title="How much walking">
          <ChoiceRow options={ENERGY} value={draft.energy} onChange={(energy) => patch({ energy })} />
        </Question>

        <Question title="Crowds">
          <ChoiceRow options={CROWDS} value={draft.crowds} onChange={(crowds) => patch({ crowds })} />
        </Question>

        <Question title="Anything you can't eat" caption="Optional.">
          <TagGrid
            tags={DIETARY_TAGS}
            selected={dietary.tags}
            onToggle={(tag) => patch({ dietary: { ...dietary, tags: toggleTag(dietary.tags, tag) } })}
          />
          <FieldTrough>
            <TextField
              label="Also"
              value={dietary.note}
              onChangeText={(note) => patch({ dietary: { ...dietary, note } })}
              placeholder="No shellfish"
            />
          </FieldTrough>
        </Question>

        {/* Its own question, not inferred from "how much walking". Those are different things,
            and treating the first as a proxy for the second gave a wheelchair user who describes
            their energy as high no accommodation at all. */}
        <Question title="Getting around" caption="Optional.">
          <FieldTrough>
            <ToggleRow
              label="Step-free routes required"
              value={accessibility.stepFreeRequired}
              onChange={(stepFreeRequired) =>
                patch({ accessibility: { ...accessibility, stepFreeRequired } })
              }
            />
            <ToggleRow
              label="Avoid stairs where possible"
              value={accessibility.limitStairs}
              onChange={(limitStairs) => patch({ accessibility: { ...accessibility, limitStairs } })}
            />
            <TextField
              label="Also"
              value={accessibility.note}
              onChangeText={(note) => patch({ accessibility: { ...accessibility, note } })}
              placeholder="Anything else we should know"
            />
          </FieldTrough>
        </Question>

        <View style={styles.action}>
          <PrimaryButton title="Next" onPress={() => router.push('/plan/review')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  content: { padding: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.regular },
  headline: { marginBottom: Spacing.tight },
  action: { marginTop: Spacing.tight },
});
