import { useSyncExternalStore } from "react";

/**
 * Which of `/`'s three screens is up: the landing, the planner, or a plan on the map.
 *
 * The navbar is mounted by `AppShell`, outside `HomeView`, and reads only the route, so on `/` it
 * could not tell the landing from the planner. It offered the landing's section links and its
 * "Plan a trip" on every screen, and on the planner and the plan view those links point at sections
 * that are not mounted and the button has nothing listening (see `planIntent.ts`). `HomeView`
 * publishes its step here and the nav shows what that screen needs. Same reason as `planIntent`
 * for not lifting the step into a context: one value, one reader.
 */
export type HomeScreen = "landing" | "plan" | "result";

let current: HomeScreen = "landing";
const listeners = new Set<() => void>();

export function setHomeScreen(next: HomeScreen) {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHomeScreen(): HomeScreen {
  // The server always renders the landing step, so that is its snapshot too.
  return useSyncExternalStore(subscribe, () => current, () => "landing");
}
