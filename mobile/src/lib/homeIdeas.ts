import type { IdeaRead } from '@shared/ideaRead';
import { realDate } from '@shared/importedPlan';
import type { ReadyTrip } from '@shared/readyTrips';
import { addDays, LEAD_DAYS, paceFor } from '@shared/homeIdeas';

import type { PlanPrefillParams } from '@/lib/planDraft';

// The pure helpers moved to the web's lib so both clients read one copy.
export { TYPEWRITER_IDEAS, QUICK_PROMPTS, typewriterTick, matchTrips, keywordTrips, ideaHeadline } from '@shared/homeIdeas';
export type { Typewriter } from '@shared/homeIdeas';

/** The planner's fields from a read. Dates only when the length is known, since a start with no end says nothing. */
export function ideaPrefill(read: IdeaRead, today: string): PlanPrefillParams {
  const out: PlanPrefillParams = {};
  if (read.destination) out.destination = read.destination;
  if (read.days !== null) {
    out.start = addDays(today, LEAD_DAYS);
    out.end = addDays(out.start, read.days - 1);
  }
  if (read.budget !== null) out.budget = String(read.budget);
  if (read.budgetBasis) out.basis = read.budgetBasis;
  if (read.adults !== null) out.adults = String(read.adults);
  if (read.children !== null) out.children = String(read.children);
  if (read.pace) out.pace = read.pace;
  if (read.interests.length) out.into = read.interests.join(',');
  return out;
}

/**
 * The planner's fields from a ready-made trip: its stops become the must-include list, in the order
 * they are walked. A start that is not a real calendar day writes no dates, since `addDays` would
 * throw on it and a screen's date state is not something to crash over.
 */
export function readyTripPrefill(trip: ReadyTrip, start: string | null): PlanPrefillParams {
  const out: PlanPrefillParams = { destination: trip.destination };
  const pace = paceFor(trip.pace);
  if (pace) out.pace = pace;
  const must = trip.itinerary.flatMap((d) => d.stops.map((s) => s.name)).join(', ');
  if (must) out.must = must;
  if (start && realDate(start)) {
    out.start = start;
    out.end = addDays(start, trip.days - 1);
  }
  return out;
}

/** `priceFrom` is per person, so the whole party's budget is that times the head count. */
export const suggestedBudget = (trip: ReadyTrip, people: number): number => trip.priceFrom * Math.max(1, people);

/**
 * A prefill as `/plan/basics`'s query string, which `PlanDraftProvider` reads back. Encoded as Home
 * encodes `/idea?text=`, with `encodeURIComponent`, so a space is `%20` and never a `+` left to chance.
 */
export const prefillQuery = (p: PlanPrefillParams): string =>
  Object.entries(p)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
