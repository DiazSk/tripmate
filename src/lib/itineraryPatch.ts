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

/** 1-based number for a reason, or null when the model sent something that isn't an index (a
 *  missing or fractional `dayIndex` would otherwise print as "day NaN"). */
const nth = (i: unknown): number | null => (Number.isInteger(i) && (i as number) >= 0 ? (i as number) + 1 : null);
// T-56, or T-56a when the model sent no usable day number.
const noDay = (i: unknown) => (nth(i) === null ? "it didn’t name a day in this trip" : `there’s no day ${nth(i)} in this trip`);

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
 * Why a booked stop refuses this op, already phrased for the traveler — or null when it doesn't.
 *
 * §0 rank 1: a `FIXED` stop is something the traveler actually booked, and the plan is built
 * around it. The prompt tells the model the same thing, and this is the half that does not depend
 * on the model having listened — the reason reaches the chat sheet through the existing
 * `rejected[]` channel, so a refused edit is stated rather than silently half-applied.
 *
 * **Only the *when* and the *what* are protected, not the whole object.** Re-costing a booked
 * dinner or rewriting its note is ordinary editing; moving it, dropping it or swapping it for
 * somewhere else is not. Unlocking is the traveler's alone — a model that could clear the flag
 * could clear it and then move the stop in the same turn, which is the lock not existing.
 */
function refusesLock(op: PatchOp, target: Stop): string | null {
  if (target.timeFlexibility !== "FIXED") return null;
  if (op.op === "remove_stop") return `${target.name} is booked, so it stays`;
  if (op.op !== "replace_stop") return null;
  // Declared `Stop`, but the merge below exists precisely because the model sends only the fields
  // it changed, so every one of these is absent more often than not.
  const patch = op.stop as Partial<Stop>;
  if (patch.time !== undefined && patch.time !== target.time) {
    return `${target.name} is booked for ${target.time}, so its time stays`;
  }
  if (patch.name !== undefined && patch.name !== target.name) {
    return `${target.name} is booked, so it can’t be swapped for ${patch.name}`;
  }
  if (patch.timeFlexibility !== undefined && patch.timeFlexibility !== "FIXED") {
    return `${target.name} is booked; unlock it on the stop if you want it changed`;
  }
  return null;
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
  /**
   * What this edit is allowed to touch.
   *
   * With `stopIndex`, one element: exactly one `replace_stop` in that slot (Mode B).
   * Without it, one day: any op naming that day, and no whole-day op, because `add_day` and
   * `remove_day` change the trip's length and re-flow every later date — the furthest thing
   * from "only this day changes" the vocabulary can express.
   *
   * Absent, the whole trip is fair game. **A scope the model is only asked to respect is not a
   * scope**: the chat prompt has always stated one and marked other days read-only, and a model
   * that ignored it was not contradicted anywhere. This is where the promise is kept.
   */
  scope?: { dayIndex: number; stopIndex?: number }
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
      if (scope.stopIndex === undefined) {
        // Day scope. Phrased for a traveler, because this reason reaches them as "Not applied:
        // …" under the reply — the same rule `refusesLock` follows.
        const wholeDay = op.op === "add_day" || op.op === "remove_day";
        if (wholeDay || op.dayIndex !== scope.dayIndex) {
          rejected.push({
            op,
            // Copy row T-52, for both: either way it reached past the one day being edited.
            reason: `it would have changed another day, and this edit is only for day ${scope.dayIndex + 1}`,
          });
          continue;
        }
      } else {
        const sameSlot =
          op.op === "replace_stop" &&
          op.dayIndex === scope.dayIndex &&
          op.stopIndex === scope.stopIndex;
        if (!sameSlot) {
          rejected.push({ op, reason: "it reached beyond the stop you’re editing" });
          continue;
        }
      }
    }

    // A whole-day op is the one case where "one past the last day" is a legal target (appending),
    // and where the day being named is about to stop existing.
    if (op.op === "add_day" || op.op === "remove_day") {
      if (!Number.isInteger(op.dayIndex) || op.dayIndex < 0) {
        // T-54, or T-54a when the model sent no usable day number.
        rejected.push({ op, reason: nth(op.dayIndex) === null ? "it didn’t name a day in this trip" : `there’s no day ${nth(op.dayIndex)} to put it on` });
        continue;
      }
      if (op.op === "add_day") {
        const grown = insertDay(next, op.dayIndex);
        next.days = grown.days;
        continue;
      }
      if (next.days.length <= 1) {
        rejected.push({ op, reason: "it would have removed the trip’s last day" });
        continue;
      }
      if (!inRange(op.dayIndex, next.days.length)) {
        rejected.push({ op, reason: noDay(op.dayIndex) });
        continue;
      }
      next.days = removeDay(next, op.dayIndex).days;
      continue;
    }

    if (!inRange(op.dayIndex, next.days.length)) {
      rejected.push({ op, reason: noDay(op.dayIndex) });
      continue;
    }

    const day = next.days[op.dayIndex];
    const before = snapshotOf(day);
    switch (op.op) {
      case "replace_stop":
      case "remove_stop": {
        const target = inRange(op.stopIndex, before.length) ? before[op.stopIndex] : undefined;
        if (!target) {
          // T-57, or T-57a when the stop number isn't one.
          rejected.push({ op, reason: nth(op.stopIndex) === null ? `it didn’t name a stop on day ${nth(op.dayIndex)}` : `day ${nth(op.dayIndex)} has no stop ${nth(op.stopIndex)}` });
          break;
        }
        const at = day.stops.indexOf(target);
        if (at < 0) {
          // Only reachable when an earlier op in this same patch removed it. Saying so is the
          // whole point: the alternative is applying the op to whichever stop took its place.
          rejected.push({ op, reason: `${target.name} had already been removed by an earlier change` });
          break;
        }
        const locked = refusesLock(op, target);
        if (locked) {
          rejected.push({ op, reason: locked });
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
