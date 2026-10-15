import { ChipsRow, Section, SheetScreen, SwitchRow, TextRow } from '@/components/plan-ui';
import { DIETARY_TAGS, toggleTag, usePlanDraft } from '@/lib/planDraft';

/**
 * The hard constraints: what you cannot eat, and how you get around.
 *
 * Asked, never inferred — access is its own question and not read from "how much walking", which
 * gave a wheelchair user who describes their energy as high no accommodation at all. Both outrank
 * pace and interests when the plan is written.
 */
export default function NeedsSheet() {
  const { draft, patch } = usePlanDraft();
  const { dietary, accessibility } = draft;
  return (
    <SheetScreen title="Diet and access">
      <Section header="Anything you can't eat" footer="These are rules the plan keeps, not preferences.">
        <ChipsRow
          tags={DIETARY_TAGS}
          selected={dietary.tags}
          onPress={(tag) => patch({ dietary: { ...dietary, tags: toggleTag(dietary.tags, tag) } })}
        />
        <TextRow label="Also" value={dietary.note} onChangeText={(note) => patch({ dietary: { ...dietary, note } })} placeholder="No shellfish" />
      </Section>
      <Section header="Getting around" footer="A step-free need outranks pace and interests.">
        <SwitchRow
          label="Step-free routes required"
          value={accessibility.stepFreeRequired}
          onChange={(stepFreeRequired) => patch({ accessibility: { ...accessibility, stepFreeRequired } })}
        />
        <SwitchRow
          label="Avoid stairs where possible"
          value={accessibility.limitStairs}
          onChange={(limitStairs) => patch({ accessibility: { ...accessibility, limitStairs } })}
        />
        <TextRow
          label="Also"
          value={accessibility.note}
          onChangeText={(note) => patch({ accessibility: { ...accessibility, note } })}
          placeholder="Anything else we should know"
        />
      </Section>
    </SheetScreen>
  );
}
