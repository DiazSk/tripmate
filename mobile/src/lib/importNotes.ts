import type { ImportNote, Itinerary } from '@/api/types';

const LINES: Record<ImportNote, string> = {
  hoursUnchecked: "Opening hours not checked — the map data couldn't be reached.",
  costsUnestimated: "Couldn't estimate costs, so the budget check is off for this trip.",
};

/** What an import could not do, said once on the trip rather than per stop. */
export function importNoteLines(itinerary: Pick<Itinerary, 'importNotes'>): string[] {
  return (itinerary.importNotes ?? []).map((note) => LINES[note]);
}

/**
 * Plan health waits for an edit on a plan TripMate wrote. On a plan it is *checking*, the check is
 * the point, so it shows as soon as the trip opens.
 */
export const showsHealthOnOpen = (itinerary: Pick<Itinerary, 'origin'>) => itinerary.origin === 'imported';
