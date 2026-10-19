"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  closestCenter,
  closestCorners,
  pointerWithin,
  type Announcements,
  type CollisionDetection,
} from "@dnd-kit/core";
import type { DayPlan } from "./types";

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
 * wins now, and `closestCenter` only arbitrates when the pointer is over nothing.
 *
 * **A keyboard drag has no pointer, and gets `closestCorners`.** That is the pairing dnd-kit's
 * `sortableKeyboardCoordinates` is written against: it picks the next row by closest corners and
 * moves the dragged rect onto that row's edge, so judging the landing by centres can disagree with
 * the step it just took. In the editor the day's whole list is a drop target too (`day:N`), and
 * when a short row steps onto a tall one the list's centre can sit nearer than the row's, so
 * Space-Arrow-Space dropped on the day it started in and moved nothing. Corners cannot confuse a
 * row-sized rect with a list-sized one.
 */
export const dropCollision: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCorners(args);
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCenter(args);
};

/**
 * What the drag surfaces' live region says, in words rather than ids.
 *
 * dnd-kit's default reads the ids out ("Draggable item stop:0:0 was dropped over droppable area
 * stop:0:1"). Positions are 1-based and counted the way `moveStop` places the stop: the slot it
 * takes in the day it lands in. The drop line names no stop on purpose: it is read after the drop
 * has been committed, when `stop:d:i` already names whichever stop now sits in that slot.
 */
export function stopAnnouncements(days: DayPlan[]): Announcements {
  const nameOf = (id: string | number) => {
    const ref = parseDragId(id);
    return ref?.kind === "stop" ? days[ref.dayIndex]?.stops[ref.stopIndex]?.name ?? "the stop" : "the stop";
  };
  const fromDay = (id: string | number) => {
    const ref = parseDragId(id);
    return ref?.kind === "stop" ? ref.dayIndex : null;
  };
  return {
    onDragStart: ({ active }) => `Picked up “${nameOf(active.id)}”.`,
    onDragOver: ({ active, over }) => {
      const target = parseDragId(over?.id);
      if (!target) return `${nameOf(active.id)} is not over a place it can go.`;
      if (target.kind === "day") return `Over day ${target.dayIndex + 1}. Drop to move it there.`;
      const sameDay = target.dayIndex === fromDay(active.id);
      const count = (days[target.dayIndex]?.stops.length ?? 0) + (sameDay ? 0 : 1);
      return `Moved to position ${target.stopIndex + 1} of ${count}${sameDay ? "" : ` on day ${target.dayIndex + 1}`}.`;
    },
    onDragEnd: ({ active, over }) => {
      const target = parseDragId(over?.id);
      if (target?.kind === "stop") {
        return target.dayIndex === fromDay(active.id)
          ? `Dropped at position ${target.stopIndex + 1}.`
          : `Dropped on day ${target.dayIndex + 1} at position ${target.stopIndex + 1}.`;
      }
      if (target?.kind === "day" && target.dayIndex !== fromDay(active.id)) {
        return `Moved to day ${target.dayIndex + 1}.`;
      }
      return "Dropped. Nothing moved.";
    },
    onDragCancel: ({ active }) => `Cancelled. ${nameOf(active.id)} is back where it was.`,
  };
}

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
