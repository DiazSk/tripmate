/**
 * Which screen a launch opens on.
 *
 * **Pure, and outside `src/app` so it can be tested.** This repo has no renderer in its test setup
 * — no `react-test-renderer`, no `@testing-library/react-native` — so logic that has to be rendered
 * to be exercised cannot be checked at all here. The decision therefore lives in a function that
 * takes the launch URL and returns a route, which `authGate.test.ts` calls directly.
 *
 * **There is no sign-in wall on launch.** Every bare launch opens Home, signed in or out: planning,
 * generating and saving all work signed out under the anonymous owner, and the server's
 * `claimAnonymousOwner` moves that work onto an account at sign-up. A launch that opened on a
 * sign-in or welcome screen first would make that mechanism the thing the first screen fights. The
 * landing is the product tour, reached from Profile → Take the tour, not a launch target.
 */

export interface LaunchEvent {
  /** The URL the app was opened with, already substituted to the root URL on a bare launch. */
  path: string;
}

/** The route to open, or `null` to leave the launch URL alone. */
export function launchTarget({ path }: LaunchEvent): string | null {
  // expo-share-intent opens the app with `tripmate://dataUrl=<key>`, which carries its key in the
  // *authority* rather than the path, so it is matched by substring and not by route shape. A share
  // arrives before any account could be involved, so it is routed the same whether it is the launch
  // or lands mid-session.
  if (path.includes('dataUrl=')) return '/share';

  return null;
}
