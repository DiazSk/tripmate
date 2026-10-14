/**
 * "Start planning", asked for from outside the page that can do it.
 *
 * `startPlanning` is local state in `HomeView`, and the navbar is mounted by `AppShell` as a sibling
 * of the content overlay — so a nav "Plan a trip" has nothing to call. Rather than lift the
 * wizard's state into a context for one button, the nav fires this event and the landing, which
 * holds `onPlan`, answers it. When nothing is listening (any route but `/`), nothing happens; the
 * nav only offers the button on `/`.
 */
export const PLAN_EVENT = "tripmate:plan";

export function requestPlan() {
  window.dispatchEvent(new Event(PLAN_EVENT));
}
