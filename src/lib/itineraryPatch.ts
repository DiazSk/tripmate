import { insertDay, redateDays, removeDay } from "./tripDays";
import type { Itinerary, Stop } from "./types";

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
 * Applies ops to a deep clone. `allowedDayIndex`/`allowedStopIndex`, when given, scope-lock the
 * patch (Mode B): any op touching a different slot is rejected rather than applied, so a
 * single-element edit can never quietly reshuffle the rest of the day.
 */
export function applyPatch(
  itinerary: Itinerary,
  ops: PatchOp[],
  scope?: { dayIndex: number; stopIndex: number }
): PatchResult {
  const next: Itinerary = structuredClone(itinerary);
  const rejected: PatchResult["rejected"] = [];

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
    switch (op.op) {
      case "replace_stop":
        if (!inRange(op.stopIndex, day.stops.length)) {
          rejected.push({ op, reason: `stop ${op.stopIndex} out of range` });
          break;
        }
        // Merge rather than overwrite: the model only needs to send changed fields, and this
        // keeps coordinates/category intact when it omits them.
        day.stops[op.stopIndex] = { ...day.stops[op.stopIndex], ...op.stop };
        break;
      case "add_stop":
        day.stops.splice(Math.min(Math.max(op.stopIndex, 0), day.stops.length), 0, op.stop);
        break;
      case "remove_stop":
        if (!inRange(op.stopIndex, day.stops.length)) {
          rejected.push({ op, reason: `stop ${op.stopIndex} out of range` });
          break;
        }
        day.stops.splice(op.stopIndex, 1);
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
