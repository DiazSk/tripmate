import type { PlanDraft } from '@/api/types';
import { ENERGY, PACES, labelOf } from '@/lib/planDraft';
import { accessibilityValue, dietaryValue } from '@/lib/profileRows';

/**
 * The planner's "Make it yours" tiles: everything past where, when, budget and who, as six
 * questions that each open a half sheet.
 *
 * Each tile carries its answer as one line and whether it has been answered. **Answered is a fact
 * about the draft, not about a tap**: a tile reads answered when the draft holds something for it
 * that the planner will act on, so opening a sheet and closing it changes nothing, and a deep
 * link's prefill ticks a tile without anybody touching it. Pace always reads answered — it has a
 * default the planner uses, and saying "not yet" over a value it will act on would be a lie.
 *
 * `id` is also the sheet's path under `/plan`, so a tile cannot point at a sheet that is not there.
 */
export type PlanTileId = 'into' | 'pace' | 'needs' | 'booked' | 'saved' | 'must';

export type PlanTile = {
  id: PlanTileId;
  title: string;
  value: string;
  done: boolean;
  optional: boolean;
};

export function planTiles(draft: PlanDraft): PlanTile[] {
  const { logistics } = draft;
  const booked = [logistics.stayBooked, logistics.arrivalTime || logistics.arrivalPoint, logistics.departureTime || logistics.departurePoint].filter(
    (part) => !!part?.trim()
  ).length;
  const musts = draft.selectedPois.length + draft.customPois.length + splitList(draft.mustInclude).length;
  const needsNoted =
    draft.dietary.tags.length > 0 ||
    !!draft.dietary.note.trim() ||
    draft.accessibility.stepFreeRequired ||
    draft.accessibility.limitStairs ||
    !!draft.accessibility.note.trim();

  return [
    {
      id: 'into',
      title: 'Into',
      value: draft.starredInterests.length
        ? draft.starredInterests.join(', ')
        : draft.interests.length
          ? draft.interests.join(', ')
          : 'Pick what you like',
      done: draft.interests.length > 0,
      optional: false,
    },
    {
      id: 'pace',
      title: 'Pace',
      value: `${labelOf(PACES, draft.pace)} · ${labelOf(ENERGY, draft.energy).toLowerCase()}`,
      done: true,
      optional: false,
    },
    {
      id: 'needs',
      title: 'Diet and access',
      value: needsNoted ? `${dietaryValue(draft)} · ${accessibilityValue(draft.accessibility).toLowerCase()}` : 'Nothing to avoid',
      done: needsNoted,
      optional: false,
    },
    {
      id: 'booked',
      title: 'Already booked',
      value: booked ? `${booked} of 3 added` : 'Stay, arrival, departure',
      done: booked > 0,
      optional: true,
    },
    {
      id: 'saved',
      title: 'Saved places and notes',
      value: draft.anchors.length
        ? `${draft.anchors.length} ${draft.anchors.length === 1 ? 'place' : 'places'}${draft.constraintsNote.trim() ? ', a note' : ''}`
        : draft.constraintsNote.trim()
          ? 'A note'
          : 'Links, a list or screenshots',
      done: draft.anchors.length > 0 || !!draft.constraintsNote.trim(),
      optional: true,
    },
    {
      id: 'must',
      title: 'Must-sees',
      value: musts ? `${musts} ${musts === 1 ? 'place' : 'places'}${draft.avoid.trim() ? ', some to skip' : ''}` : draft.avoid.trim() ? 'Some to skip' : 'Anywhere you must go',
      done: musts > 0 || !!draft.avoid.trim(),
      optional: true,
    },
  ];
}

/** `"Louvre, Versailles"` → two places; the must-see field is comma-separated by its caption. */
function splitList(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
