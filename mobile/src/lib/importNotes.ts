import type { ImportNote, Itinerary } from '@/api/types';
import type { Guardrail } from '@/lib/health';

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

/**
 * The findings an empty day shows in its own body.
 *
 * "Fix this" lives on the row a finding concerns, and an empty day has no rows — so its `empty`
 * finding was counted in plan health and actionable nowhere. Only `empty` is surfaced here, and
 * only imported plans produce it, so a generated plan's day reads exactly as before.
 */
export function emptyDayFindings(day: { stops: readonly unknown[] }, findings: Guardrail[]): Guardrail[] {
  return day.stops.length === 0 ? findings.filter((f) => f.rule === 'empty') : [];
}
