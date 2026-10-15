import { ChipsRow, Section, SheetScreen, TextRow } from '@/components/plan-ui';
import { INTERESTS, MAX_STARRED, cycleInterest, usePlanDraft } from '@/lib/planDraft';

/** What the trip is for, and what you are into — tap to pick, again to star, again to clear. */
export default function IntoSheet() {
  const { draft, patch } = usePlanDraft();
  const picks = { selected: draft.interests, starred: draft.starredInterests };
  const starsLeft = MAX_STARRED - draft.starredInterests.length;
  const caption =
    draft.starredInterests.length === 0
      ? 'Tap to pick, again to star, again to clear.'
      : starsLeft > 0
        ? `Star ${starsLeft} more; those count most. Tap again to clear one.`
        : 'Three stars is the most. Clear a starred one to free it up.';

  return (
    <SheetScreen title="Into">
      <Section header="What's the trip for" footer="Optional.">
        <TextRow label="Why" value={draft.purpose} onChangeText={(purpose) => patch({ purpose })} placeholder="An anniversary" />
      </Section>
      <Section header="What you're into" footer={caption}>
        {/* Both rules live in `planDraft`, because the Profile tab edits the same pair. */}
        <ChipsRow
          tags={INTERESTS}
          selected={draft.interests}
          starred={draft.starredInterests}
          onPress={(tag) => {
            const next = cycleInterest(picks, tag);
            patch({ interests: next.selected, starredInterests: next.starred });
          }}
        />
      </Section>
    </SheetScreen>
  );
}
