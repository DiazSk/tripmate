/* The rules behind the toast stack, kept out of toast.tsx so a test can import them (Node strips
 * types from .ts but cannot load JSX). */
import type { Bucket } from "./ipThrottle";

/** How long a success toast stays up. Long enough to read two short lines without hurrying, short
 *  enough that adding three places in a row does not stack a wall of them. */
export const TOAST_MS = 3200;

/** Above this many at once the oldest is dropped rather than growing the stack down the screen.
 *  Three is what fits comfortably above the fold on a laptop. */
export const MAX_VISIBLE = 3;

export interface ToastCopy {
  title: string;
  detail?: string;
}

export interface Toast extends ToastCopy {
  id: number;
  kind: "success" | "error";
  /** Error kind only: at most one action, drawn as text. */
  action?: { label: string; onClick: () => void };
  /** Error kind only: the toast counts down this bucket's hold. `detail` may carry `{mm:ss}`. */
  hold?: Bucket;
  /** Error kind only: the copy a hold toast swaps to when its hold ends. */
  resolved?: ToastCopy;
}

/** Newest last. A hold toast replaces any earlier one for the same bucket (one wait, one message),
 *  and a plain error toast replaces one with the same title. Past MAX_VISIBLE the oldest success goes
 *  first, so a success cannot push out an error that needs reading; with no success, the oldest. */
export const pushToast = (list: Toast[], toast: Toast): Toast[] => {
  const next = [
    ...list.filter(
      (t) => !(toast.hold && t.hold === toast.hold) && !(toast.kind === "error" && !toast.hold && t.kind === "error" && !t.hold && t.title === toast.title)
    ),
    toast,
  ];
  while (next.length > MAX_VISIBLE) {
    const i = next.findIndex((t) => t.kind === "success");
    next.splice(i < 0 || i === next.length - 1 ? 0 : i, 1);
  }
  return next;
};

/** Success toasts fade; an error toast stays until it is dismissed or resolved (null: no timer). */
export const autoDismissMs = (toast: Toast): number | null => (toast.kind === "success" ? TOAST_MS : null);

/**
 * What a toast says now, given its hold's `secondsLeft` (null once the hold has ended). A hold toast
 * whose wait is over says its `resolved` copy; one with no resolved copy has nothing left to say, so
 * this returns null and the toast is dismissed.
 */
export function currentCopy(toast: Toast, secondsLeft: number | null): (ToastCopy & { resolved: boolean }) | null {
  if (!toast.hold || secondsLeft !== null) return { title: toast.title, detail: toast.detail, resolved: false };
  return toast.resolved ? { ...toast.resolved, resolved: true } : null;
}

/** The `{mm:ss}` placeholder a hold toast's detail carries (copy table, "Placeholders"). */
export const WAIT = "{mm:ss}";

/** A hold's end as a local clock time ("3:47 PM"): copy table `{clockTime}`. */
export const formatClockTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The screen-reader form of a hold toast's detail (copy row P-37a): the visible copy's own
 * "in {mm:ss}" becomes "at {clockTime}". It is read once and never goes stale; the ticking wait
 * stays visual only.
 */
export const holdSentence = (detail: string, clockTime: string): string =>
  detail.replaceAll(`in ${WAIT}`, `at ${clockTime}`).replaceAll(WAIT, clockTime);
