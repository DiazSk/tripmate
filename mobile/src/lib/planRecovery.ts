/**
 * What to do with a plan whose stream was lost.
 *
 * iOS suspends an app that is left, so a plan's stream drops while the server carries on writing it
 * — and since the server now saves the plan as a draft itself, a lost stream is no longer a lost plan.
 * The run's id arrives in the stream's first frame; coming back, the writing screen asks the server
 * what became of that run (`GET /api/itinerary/runs/:id`) and does what this says, instead of
 * failing and leaving the traveller to start (and pay an allowance for) another.
 */

/** The server's answer; null when the check itself could not be made (offline, a dropped request). */
export type RunStatus = { status: 'ready'; tripId: string } | { status: 'writing' | 'failed' | 'unknown' } | null;

export type RecoveryStep = { action: 'open'; tripId: string } | { action: 'fail'; message: string } | { action: 'wait' };

/** Longer than any plan takes: writing runs 60-300s and the review ~30s more. Past this, stop. */
export const RECOVERY_GIVE_UP_MS = 8 * 60_000;

const FAILED = "The planner didn't finish this plan. Try generating again.";
const TOO_LONG = 'This plan is taking far longer than any plan should. Try generating again.';

export function recoveryStep(status: RunStatus, startedAt: number, now: number): RecoveryStep {
  if (status?.status === 'ready') return { action: 'open', tripId: status.tripId };
  // `unknown`: the server has no record of the run, so there is nothing to wait for.
  if (status?.status === 'failed' || status?.status === 'unknown') return { action: 'fail', message: FAILED };
  return now - startedAt > RECOVERY_GIVE_UP_MS ? { action: 'fail', message: TOO_LONG } : { action: 'wait' };
}
