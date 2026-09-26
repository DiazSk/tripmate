import { evaluateItinerary } from "../guardrails";
import type { Itinerary, TransportMode } from "../types";
import type { BenchCellScores } from "./types";

export type CriticalCode =
  | "closed_or_hours"
  | "pace"
  | "mobility"
  | "overlap"
  | "commitment"
  | "must_include"
  | "excluded"
  | "missing_anchor"
  | "over_budget"
  | "duplicate"
  | "dietary"
  | "travel_leg"
  | "generation_failed";

/**
 * The run's hard failures — any one of them and the trip failed, whatever its composite says.
 *
 * A weighted composite averages a closed-day visit away; a traveller standing at a locked door
 * does not. So these are pass/fail, read off the scorers that already exist rather than
 * re-derived. Deliberately soft and absent here: crowd timing, daylight, budget under target
 * (§5 is a ceiling), starred-priority coverage, unacknowledged dietary stops.
 *
 * `travel_leg` needs typed stops, so it runs only for the legacy arm's JSON, through the same
 * `evaluateItinerary` rule the UI shows; staged markdown has no typed legs. `generation_failed`
 * is never returned here — the sweep adds it for a run that produced no plan at all.
 */
export function criticalFailures(
  scores: BenchCellScores,
  opts: { itinerary?: Itinerary | null; modes?: TransportMode[] } = {}
): CriticalCode[] {
  const s = scores;
  const codes: CriticalCode[] = [];
  const by = s.constraints.byType;
  if (by.opening_hours + by.closed_day > 0) codes.push("closed_or_hours");
  if (by.pace > 0) codes.push("pace");
  if (by.mobility > 0) codes.push("mobility");
  if (s.feasibility.overlaps > 0) codes.push("overlap");
  if (s.commitments.breaches.length > 0) codes.push("commitment");
  if (s.mustInclude.missing.length > 0) codes.push("must_include");
  if (s.mustInclude.violated.length > 0) codes.push("excluded");
  if (s.coverage.missingAnchors.length > 0) codes.push("missing_anchor");
  if (s.budget.budgetUsedFraction !== null && s.budget.budgetUsedFraction > 1) codes.push("over_budget");
  if (s.duplicates.repeats > 0) codes.push("duplicate");
  if (s.dietary.contradictions > 0) codes.push("dietary");
  if (opts.itinerary) {
    const travel = evaluateItinerary(opts.itinerary, { modes: opts.modes }).some((g) => g.rule === "travel");
    if (travel) codes.push("travel_leg");
  }
  return codes;
}
