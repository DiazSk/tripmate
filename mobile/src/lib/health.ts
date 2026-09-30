import { isBlocking, type Guardrail } from '@shared/guardrails';
import { planHealth, type HealthDimension, type HealthKey, type PlanHealth } from '@shared/planHealth';

import type { Trip, UserAnswers } from '@/api/types';

/**
 * The plan's health, for the trip on screen.
 *
 * **The scoring is imported, not ported.** `@shared/planHealth` and the `@shared/guardrails` it
 * reads are pure TypeScript with no Next and no server imports, and `metro.config.js` already
 * bundles that directory — the same route `@shared/itinerary` and `@shared/daySlotting` already
 * take. Two clients disagreeing about whether a plan is sound would be worse than neither showing
 * it, and a second implementation here is how that starts.
 *
 * All this file owns is the one thing the shared module cannot: unpacking `trip.userAnswers`,
 * which crosses the wire as `unknown` because it is whatever the wizard stored on the day the
 * trip was generated.
 */
export type { Guardrail, HealthDimension, HealthKey, PlanHealth };

/**
 * Which findings mean the day cannot happen, as opposed to being worth reading.
 *
 * Re-exported, not redefined. It decides where coral is spent here and which revisions the
 * generation gate refuses on the server, and those two must be the same list — a second copy is
 * how the phone starts calling something a hard conflict that the planner is happy to ship.
 */
export { isBlocking };

/**
 * `userAnswers` as this app reads it, or an empty object.
 *
 * Nothing is validated beyond "it is an object" and each field's own shape at the point of use.
 * That is not laziness: these rows are written by three different clients across the life of the
 * trip, and a strict parse would throw away a whole trip's budget because one unrelated field
 * drifted. Every reader below already treats absence as "not stated".
 */
function answersOf(trip: Trip): Partial<UserAnswers> {
  const raw = trip.userAnswers;
  return raw && typeof raw === 'object' ? (raw as Partial<UserAnswers>) : {};
}

export function tripHealth(trip: Trip): PlanHealth {
  const answers = answersOf(trip);
  return planHealth(trip.itinerary, {
    // The trip's own budget, not the answers' copy: `PATCH /api/trips` can change it, and the
    // answer tree is a snapshot of what was said at generation time.
    budget: trip.budget,
    logistics: answers.logistics ?? null,
    mustInclude: answers.mustInclude,
    avoid: answers.avoid,
    // `modes` is deliberately omitted. It says what the destination offers, this client was never
    // told, and `legMinutes` already defaults to walk + transit — guessing "drive" for a city
    // would quietly make every leg look reachable.
  });
}

/**
 * What "Fix this" seeds the chat composer with.
 *
 * Never auto-sent — the same bargain `fitMessage` strikes for an unplaced must-see. The finding's
 * own `message` is already written for the traveler, so it is quoted rather than re-worded: the
 * sentence the planner is asked to act on is then exactly the sentence they read on the row.
 */
export const fixMessage = (finding: Guardrail): string => {
  const where = finding.dayIndex === null ? '' : `On day ${finding.dayIndex + 1}: `;
  return `${where}${finding.message} Please fix that, and tell me what you changed.`;
};

/**
 * What the figure beside it does not say: how bad, and over how much — as two clauses, not one
 * string.
 *
 * **The arithmetic is untouched — this is the interpretation.** A flat penalty per finding is the
 * right way to compute the number and the wrong way to read it: a duplicate museum and a train
 * that cannot be caught both cost eight points, and three dimensions nobody could measure are
 * simply absent from the average rather than counted against it. So 84 out of 100 can mean "two
 * connections are impossible and we only checked four things" — a sentence the score alone is
 * incapable of forming.
 *
 * **Two clauses because severity decides the layout.** A blocker outranks the score and leads the
 * card; a clean result lets the figure lead. The caller stacks or joins them, and splitting here
 * rather than at the call site keeps one copy of the wording. It lives in this module rather than
 * in the component so it can be asserted without rendering anything — nothing in this suite
 * renders, and phrasing this careful should not be the part that goes untested.
 *
 * Coverage prints even at full marks. "7 of 7 checks run" is a fact worth stating, and a line
 * that appears only on bad news teaches a reader to skip it on good news.
 */
export function healthSummary(
  findings: number,
  blockers: number,
  ran: number,
  of: number
): { verdict: string; coverage: string } {
  const coverage = `${ran} of ${of} checks run`;
  // **"found", not a bare count.** "2 blockers" reads as *there are two blockers in this plan*.
  // What is actually known is what the checks that ran turned up — and with three dimensions
  // unmeasured those are different statements. One word is the whole difference.
  if (blockers > 0) {
    return { verdict: `${blockers} blocker${blockers === 1 ? '' : 's'} found`, coverage };
  }
  if (findings > 0) {
    return { verdict: `${findings} thing${findings === 1 ? '' : 's'} to look at`, coverage };
  }
  // Not "nothing wrong": nothing was *flagged*, by the checks that could run.
  return { verdict: 'Nothing flagged', coverage };
}
