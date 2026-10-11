import type { Anchor, ImportedPlan } from '@/api/types';

/**
 * The confirm screen of bring-your-own-itinerary, as logic it can be tested without. There is no
 * renderer in this repo's mobile tests — see `authGate.ts` — so what the screen decides lives here.
 */

/** True when the plan didn't say which dates its days are. Dates count only when every day has one — the server's rule. */
export function needsStartDate(plan: ImportedPlan): boolean {
  return !plan.days.every((d) => d.date);
}

/** What the screen still needs before building, in the order it appears on screen. */
export function ownPlanGap(plan: ImportedPlan, destination: string, startDate: string): string | null {
  if (!destination.trim()) return 'Add where this trip is.';
  if (needsStartDate(plan) && !startDate) return 'Pick the day your trip starts.';
  if (plan.days.some((d) => d.stops.some((s) => !s.name.trim()))) return 'Every stop needs a name.';
  return null;
}

/** A renamed stop forgets where it was found, so the build looks the new name up instead of pinning it to the old place. */
export function renameStop(plan: ImportedPlan, dayIndex: number, stopIndex: number, name: string): ImportedPlan {
  return {
    ...plan,
    days: plan.days.map((day, d) =>
      d !== dayIndex
        ? day
        : {
            ...day,
            stops: day.stops.map((stop, s) =>
              s !== stopIndex
                ? stop
                : { name, ...(stop.time ? { time: stop.time } : {}), ...(stop.note ? { note: stop.note } : {}) },
            ),
          },
    ),
  };
}

/** A list of places, not a plan: what the wizard gets instead. */
export function looseAnchors(plan: ImportedPlan): Anchor[] {
  return plan.loose.map((name) => ({ name, lat: null, lng: null, priority: 'want', source: 'import' }));
}

export const isFound = (stop: { lat?: number; lng?: number }) =>
  typeof stop.lat === 'number' && typeof stop.lng === 'number';
