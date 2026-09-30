import { EVIDENCE_LABEL, stopEvidence } from '@shared/evidence';

import type { Stop } from '@/api/types';

/**
 * What to print beside a stop's facts about where they came from.
 *
 * **The classifying stays in `@shared/evidence`; this only looks up.** That module exists so two
 * surfaces cannot quietly disagree about what kind of fact something is — re-deriving
 * `stop.located === 'search' ? 'sourced' : 'planner'` at a call site is exactly the second
 * opinion it was written to prevent, and it would be wrong the first time the rule changes.
 *
 * **Two of the seven facts, and the third is already said in other words.** `stopEvidence`
 * returns everything a stop is carrying; tagging all of it puts seven grey qualifiers on one
 * expanded row, which is the failure the last cycle fixed — a qualifier on everything stops
 * being read. What survives is where knowing the source changes what a traveller *does*:
 * whether to trust a sentence about a place, and whether a figure is a receipt or a guess.
 *
 * Location is the third of those and is **not** here, because `locationNote` already renders it
 * as a whole sentence ("Location is the planner's estimate") and "from a listing" beside that
 * sentence says it twice. Travel and `Leave by` are omitted because the screen already hedges
 * them in words ("about 14 min"), and `Booked` because the tag would read "you entered" under a
 * line whose entire content is that the traveller entered it.
 *
 * ponytail: matched on `stopEvidence`'s `label` strings, which root does not export as
 * constants. `provenance.test.ts` pins both, so a rename there fails a test rather than silently
 * emptying every tag on the day page.
 */
export function evidenceTags(stop: Stop): { detail?: string; cost?: string } {
  const by = new Map(stopEvidence(stop).map((f) => [f.label, EVIDENCE_LABEL[f.evidence]]));
  return { detail: by.get('Detail'), cost: by.get('Cost') };
}
