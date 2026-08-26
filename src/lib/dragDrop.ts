"use client";

import { useCallback, useEffect, useRef } from "react";
import { closestCenter, pointerWithin, type CollisionDetection } from "@dnd-kit/core";

/**
 * Shared plumbing for the two drag surfaces (the itinerary card's stop list and Focus Mode's day
 * preview). Both have the same shape of problem: a sortable list of stops plus a handful of small
 * per-day drop targets beside it.
 */

/** Ids carry the day, not just the position within the visible list.
 *
 *  They used to be `stop:<index>`, which quietly ruled out changing the displayed day mid-drag:
 *  after the switch, `stop:3` names a completely different stop. Encoding the day means the id a
 *  drag started with still identifies the same stop however the view moves under it. */
export const stopDragId = (dayIndex: number, stopIndex: number) =>
  `stop:${dayIndex}:${stopIndex}`;

export const dayDropId = (dayIndex: number) => `day:${dayIndex}`;

export type DragId =
  | { kind: "stop"; dayIndex: number; stopIndex: number }
  | { kind: "day"; dayIndex: number }
  | null;

export function parseDragId(raw: string | number | null | undefined): DragId {
  if (raw === null || raw === undefined) return null;
  const parts = String(raw).split(":");
  const nums = parts.slice(1).map(Number);
  if (nums.some((n) => !Number.isInteger(n))) return null;
  if (parts[0] === "stop" && nums.length === 2) {
    return { kind: "stop", dayIndex: nums[0], stopIndex: nums[1] };
  }
  if (parts[0] === "day" && nums.length === 1) return { kind: "day", dayIndex: nums[0] };
  return null;
}

/**
 * Pointer-first collision detection.
 *
 * `closestCenter` alone made the day tabs and stepper arrows nearly impossible to hit: they are
 * small, they sit outside the list, and the centre of a tall stop row is almost always nearer to
 * the dragged row's centre than the centre of a 32px arrow. Whatever the pointer is actually over
 * wins now, and `closestCenter` only arbitrates when the pointer is over nothing (which is what
 * keyboard dragging needs, since it has no pointer at all).
 */
export const dropCollision: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCenter(args);
};

/** What to do with a dwell request. Pure, because the rule is what keeps breaking, not the timer. */
export type DwellVerdict = "clear" | "ignore" | "start";

/**
 * Whether a "pointer is over day N" report should start a dwell countdown.
 *
 * Split out from the hook so the rule that stops the view oscillating is checkable directly. Both
 * failures this encodes were found by hand in the UI, twice: a countdown restarted on every
 * pointer event never fires at all, and a switch permitted immediately after a switch flips the
 * day back and forth under a stationary pointer.
 */
export function dwellVerdict({
  requested,
  pending,
  msSinceLastSwitch,
  cooldownMs,
}: {
  /** Day under the pointer, or null when the pointer is over no day target. */
  requested: number | null;
  /** Day a countdown is already running for, if any. */
  pending: number | null;
  msSinceLastSwitch: number;
  cooldownMs: number;
}): DwellVerdict {
  if (requested === null) return "clear";
  // Already counting down on this day: leave it alone, or it never elapses.
  if (requested === pending) return "ignore";
  // Too soon after the last switch — the caller retries, so this defers rather than discards.
  if (msSinceLastSwitch < cooldownMs) return "ignore";
  return "start";
}

/**
 * "Hold a stop over another day and that day opens."
 *
 * Dropping straight onto a day tab can only ever append by clock time. Switching the view first
 * means the target day's stops are on screen, so the stop can be dropped into an exact position
 * in it — the same gesture people expect from dragging a file onto a folder that then opens.
 *
 * The dwell exists so that merely dragging *past* day 3 on the way to day 4 doesn't yank the view
 * out from under the gesture.
 */
export function useDayDwellSwitch(
  switchTo: (dayIndex: number) => void,
  delayMs = 420,
  /** Dead time after a switch, during which no further switch can fire.
   *
   *  Without it the view can flip repeatedly under a stationary pointer: the switch re-renders the
   *  strip, the next `onDragOver` resolves to a day again, and the dwell restarts — so the day
   *  oscillates instead of settling. It also buys the thing a person actually needs next, which is
   *  a moment to drag *downward* into the day that just opened without it changing again. */
  cooldownMs = 900
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  const lastSwitchAt = useRef(0);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);

  /** Call with the day currently under the pointer, or null for "not over a day". */
  const noteOver = useCallback(
    (dayIndex: number | null) => {
      // Narrowed here rather than off the verdict, which the compiler can't see through.
      if (dayIndex === null) {
        clear();
        return;
      }
      const verdict = dwellVerdict({
        requested: dayIndex,
        pending: pending.current,
        msSinceLastSwitch: Date.now() - lastSwitchAt.current,
        cooldownMs,
      });
      if (verdict !== "start") return;

      clear();
      pending.current = dayIndex;
      timer.current = setTimeout(() => {
        lastSwitchAt.current = Date.now();
        switchTo(dayIndex);
        clear();
      }, delayMs);
    },
    [switchTo, delayMs, cooldownMs, clear]
  );

  // A drag abandoned by unmounting must not leave a timer that switches days afterwards.
  useEffect(() => clear, [clear]);

  return { noteOver, clear };
}
