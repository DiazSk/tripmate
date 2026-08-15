import { Itinerary, Stop } from "./types";

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
  | { op: "replace_lodging"; dayIndex: number; lodging: Itinerary["days"][number]["lodging"] };

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

  for (const op of ops) {
    if (!inRange(op.dayIndex, next.days.length)) {
      rejected.push({ op, reason: `day ${op.dayIndex} out of range` });
      continue;
    }
    if (scope) {
      const sameSlot =
        op.dayIndex === scope.dayIndex &&
        op.op === "replace_stop" &&
        op.stopIndex === scope.stopIndex;
      if (!sameSlot) {
        rejected.push({ op, reason: "outside the edited element's scope" });
        continue;
      }
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

  return { itinerary: next, rejected };
}
