import { Stack, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

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
  CROWDS,
  DIETARY_TAGS,
  ENERGY,
  INTERESTS,
  MAX_STARRED,
  STYLES,
  cycleInterest,
  toggleTag,
  usePlanDraft,
} from '@/lib/planDraft';

export default function PreferencesStep() {
  const router = useRouter();
  const { draft, patch } = usePlanDraft();
  const { dietary, accessibility, starredInterests } = draft;
  /** The wizard's names for the pair the shared rules operate on, and back again. */
  const picks = { selected: draft.interests, starred: starredInterests };
  const fromPicks = (next: { selected: string[]; starred: string[] }) => ({
    interests: next.selected,
    starredInterests: next.starred,
  });

  /**
   * Every state names what the next tap does, because one gesture now has three outcomes.
   *
   * The count is the only thing worth saying out loud: the cycle itself is discoverable by tapping
   * — which is the point of collapsing it onto one gesture — but "why can I not star a fourth"
   * is not, and that was the state where a tap used to do nothing at all.
   */
  const starsLeft = MAX_STARRED - starredInterests.length;
  const interestCaption =
    starredInterests.length === 0
      ? 'Tap to pick, again to star, again to clear.'
      : starsLeft > 0
        ? `Star ${starsLeft} more — those count most. Tap again to clear one.`
        : 'Three stars is the most — clear a starred one to free it up.';

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
            // Both rules live in `planDraft`, because the Profile tab edits the same pair under
            // the names the server uses. The unstar-on-deselect rule used to be written here, in
            // this JSX, where nothing could test it.
            onToggle={(tag) => patch(fromPicks(cycleInterest(picks, tag)))}
            onCycle={(tag) => patch(fromPicks(cycleInterest(picks, tag)))}
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

        {/* A different kind of answer from the interests above: an interest is a weight, these
            are requirements. The first two are their own fields rather than free text because the
            server-side check matches against a list. */}
        <Question title="Anything you must see" caption="Optional. Separate with commas.">
          <FieldTrough>
            <TextField
              label="Must see"
              value={draft.mustInclude}
              onChangeText={(mustInclude) => patch({ mustInclude })}
              // **Names the city, not a landmark in it.** This read "The Louvre, Versailles"
              // whatever the destination was, so a Mumbai trip was shown two places in France —
              // a placeholder that is wrong about the trip is worse than one that is vague, and
              // this one was wrong for every destination but one. Real suggestions would mean
              // `/api/trip-fetch`, which does not run until the step after this; the caption
              // above already carries the comma format, so the example never had to.
              placeholder={
                cityOf(draft.destination)
                  ? `Somewhere in ${cityOf(draft.destination)}`
                  : 'Somewhere you must not miss'
              }
            />
          </FieldTrough>
        </Question>

        <Question title="Anything to leave out" caption="Optional.">
          <FieldTrough>
            <TextField
              label="Skip"
              value={draft.avoid}
              onChangeText={(avoid) => patch({ avoid })}
              placeholder="Nightclubs, seafood"
            />
          </FieldTrough>
        </Question>

        <Question title="Already booked or off-limits" caption="Optional.">
          <FieldTrough>
            <TextField
              label="Also"
              value={draft.constraintsNote}
              onChangeText={(constraintsNote) => patch({ constraintsNote })}
              placeholder="No rental car; dinner booked Thursday"
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

/** "Mumbai, India" → "Mumbai". The suggestion list fills the destination with the disambiguated
 *  form, which is right for the planner and too long for a placeholder sharing a row with a label. */
function cityOf(destination: string): string {
  return destination.split(',')[0].trim();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  content: { padding: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.regular },
  headline: { marginBottom: Spacing.tight },
  action: { marginTop: Spacing.tight },
});
