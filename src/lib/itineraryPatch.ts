import { insertDay, redateDays, removeDay } from "./tripDays";
import type { DayPlan, Itinerary, Stop } from "./types";

/**
 * Edits arrive as operations, never as a regenerated itinerary.
 *
 * That's a deliberate safety property rather than a stylistic choice: because the model only
 * names what to change, everything it didn't name is carried over by reference — so "preserve
 * everything the user didn't ask to change" is enforced by this file, not by hoping the model
 * echoed the other 40 stops back verbatim.
 */
export type PatchOp =
  | { op: "replace_stop"; dayIndex: number; stopIndex: number; stop: Stop }
  | { op: "add_stop"; dayIndex: number; stopIndex: number; stop: Stop }
  | { op: "remove_stop"; dayIndex: number; stopIndex: number }
  | { op: "replace_lodging"; dayIndex: number; lodging: Itinerary["days"][number]["lodging"] }
  // Whole-day ops change the trip's LENGTH, so they also move its end date. `dayIndex` is the
  // position the new day takes (or the day to drop); every later date re-flows automatically.
  | { op: "add_day"; dayIndex: number }
  | { op: "remove_day"; dayIndex: number };

export interface PatchResult {
  itinerary: Itinerary;
  /** Ops that were rejected, with the reason — surfaced so a bad edit fails loudly. */
  rejected: { op: PatchOp; reason: string }[];
}

function inRange(i: number, len: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < len;
}

/**
 * Where a stop the model wanted at `stopIndex` goes, given the day may have moved underneath.
 *
 * Reads as "before whatever used to be at `stopIndex`", and scans forward when that stop has
 * itself been removed by an earlier op in this patch — which is what makes a swap expressed as
 * remove-then-add land in the slot it vacated rather than at the end of the day. Nothing left to
 * sit in front of means append, which is also the answer for the append the model asks for by
 * naming an index past the end.
 */
function insertionIndex(day: DayPlan, before: Stop[], stopIndex: number): number {
  for (let i = Math.max(stopIndex, 0); i < before.length; i++) {
    const at = day.stops.indexOf(before[i]);
    if (at >= 0) return at;
  }
  return day.stops.length;
}

/**
 * Applies ops to a deep clone. `allowedDayIndex`/`allowedStopIndex`, when given, scope-lock the
 * patch (Mode B): any op touching a different slot is rejected rather than applied, so a
 * single-element edit can never quietly reshuffle the rest of the day.
 *
 * **Every `stopIndex` addresses the day as the model was shown it, not as the patch has left it.**
 * A multi-op turn — "drop the museum and the shrine, and put ramen where the shrine was" — used to
 * resolve each op against an array its predecessors had already spliced, so two removals listed
 * low-index-first deleted the second stop and then whatever slid into the gap. Both indices were
 * in range, so nothing was rejected and nobody was told. The only defence was a paragraph in
 * `editPrompt.ts` asking the model to sort its removals highest-first, which is a rule it had to
 * get right every time on a surface where being wrong is invisible.
 *
 * So each day's stop list is snapshotted the first time an op touches it and every index resolves
 * through that snapshot to a stop *object*, which is then located by identity. Order stops
 * mattering, and a stop an earlier op removed is rejected by name rather than silently standing in
 * for its neighbour.
 *
 * `dayIndex` is deliberately NOT snapshotted and still means "the day at this position right now".
 * Day ops move later days, and a day that did not exist when the model looked still has to be
 * fillable in the same patch — a snapshot cannot express both. `editPrompt.ts` scripts the day-op
 * ordering instead, and day ops are one-per-turn in practice.
 */
export function applyPatch(
  itinerary: Itinerary,
  ops: PatchOp[],
  scope?: { dayIndex: number; stopIndex: number }
): PatchResult {
  const next: Itinerary = structuredClone(itinerary);
  const rejected: PatchResult["rejected"] = [];

  // Keyed by the day object rather than its index, so a day `add_day` created mid-patch gets its
  // own (empty) snapshot instead of inheriting the one belonging to whatever used to sit there.
  const snapshots = new Map<DayPlan, Stop[]>();
  const snapshotOf = (day: DayPlan): Stop[] => {
    let stops = snapshots.get(day);
    if (!stops) {
      stops = [...day.stops];
      snapshots.set(day, stops);
    }
    return stops;
  };

  // Captured before any op runs, because `add_day` at index 0 would otherwise make the new (blank)
  // day the reference point and drag the whole trip's dates with it. The start date never moves.
  const startISO = next.days[0]?.date;

  for (const op of ops) {
    // Scope lock first, before any op-specific handling. A scope-locked (single-element) edit is
    // allowed exactly one shape of change, so it must be able to refuse whole-day ops too — they
    // are the furthest thing from "replace this one stop" the vocabulary can express.
    if (scope) {
      const sameSlot =
        op.op === "replace_stop" &&
        op.dayIndex === scope.dayIndex &&
        op.stopIndex === scope.stopIndex;
      if (!sameSlot) {
        rejected.push({ op, reason: "outside the edited element's scope" });
        continue;
      }
    }

    // A whole-day op is the one case where "one past the last day" is a legal target (appending),
    // and where the day being named is about to stop existing.
    if (op.op === "add_day" || op.op === "remove_day") {
      if (!Number.isInteger(op.dayIndex) || op.dayIndex < 0) {
        rejected.push({ op, reason: `day ${op.dayIndex} is not a valid position` });
        continue;
      }
      if (op.op === "add_day") {
        const grown = insertDay(next, op.dayIndex);
        next.days = grown.days;
        continue;
      }
      if (next.days.length <= 1) {
        rejected.push({ op, reason: "a trip needs at least one day" });
        continue;
      }
      if (!inRange(op.dayIndex, next.days.length)) {
        rejected.push({ op, reason: `day ${op.dayIndex} out of range` });
        continue;
      }
      next.days = removeDay(next, op.dayIndex).days;
      continue;
    }

    if (!inRange(op.dayIndex, next.days.length)) {
      rejected.push({ op, reason: `day ${op.dayIndex} out of range` });
      continue;
    }

    const day = next.days[op.dayIndex];
    const before = snapshotOf(day);
    switch (op.op) {
      case "replace_stop":
      case "remove_stop": {
        const target = inRange(op.stopIndex, before.length) ? before[op.stopIndex] : undefined;
        if (!target) {
          rejected.push({ op, reason: `stop ${op.stopIndex} out of range` });
          break;
        }
        const at = day.stops.indexOf(target);
        if (at < 0) {
          // Only reachable when an earlier op in this same patch removed it. Saying so is the
          // whole point: the alternative is applying the op to whichever stop took its place.
          rejected.push({ op, reason: `stop ${op.stopIndex} was already removed by an earlier op` });
          break;
        }
        if (op.op === "remove_stop") {
          day.stops.splice(at, 1);
          break;
        }
        // Merged in place rather than replaced with a new object: the model only needs to send
        // changed fields, and keeping the identity lets a later op in this patch still find it.
        Object.assign(target, op.stop);
        break;
      }
      case "add_stop":
        day.stops.splice(insertionIndex(day, before, op.stopIndex), 0, op.stop);
        break;
      case "replace_lodging":
        day.lodging = op.lodging;
        break;
    }
  }

  // One restatement of the dates at the end rather than per op: several day ops in one patch would
  // otherwise re-date the trip repeatedly, and only the final shape matters.
  if (startISO) next.days = redateDays(next.days, startISO);

  return { itinerary: next, rejected };
}
