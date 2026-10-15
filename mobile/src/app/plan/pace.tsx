import { Section, SheetScreen } from '@/components/plan-ui';
import { ChoiceRow } from '@/components/settings-list';
import { CROWDS, DISCOVERIES, ENERGY, PACES, usePlanDraft } from '@/lib/planDraft';

/**
 * Four questions about tempo and taste, as four menu rows.
 *
 * Kept as four rather than merged: a packed off-the-beaten-path trip could not be asked for while
 * pace and discovery shared one picker. Menus rather than lists because each answer is one of three
 * and the question is the row's own label, so four questions take four lines.
 */
export default function PaceSheet() {
  const { draft, patch } = usePlanDraft();
  return (
    <SheetScreen title="Pace">
      <Section footer="Walking is how much you are happy to walk, not an access need. Those have their own place.">
        <ChoiceRow label="Each day" value={draft.pace} options={PACES} onChange={(pace) => patch({ pace })} />
        <ChoiceRow label="Seeing" value={draft.discovery} options={DISCOVERIES} onChange={(discovery) => patch({ discovery })} />
        <ChoiceRow label="Walking" value={draft.energy} options={ENERGY} onChange={(energy) => patch({ energy })} />
        <ChoiceRow label="Crowds" value={draft.crowds} options={CROWDS} onChange={(crowds) => patch({ crowds })} />
      </Section>
    </SheetScreen>
  );
}
