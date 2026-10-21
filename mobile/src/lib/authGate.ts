/**
 * Which screen a launch opens on.
 *
 * **Pure, and outside `src/app` so it can be tested.** This repo has no renderer in its test setup
 * — no `react-test-renderer`, no `@testing-library/react-native` — so logic that has to be rendered
 * to be exercised cannot be checked at all here. The decision therefore lives in a function that
 * takes the launch URL and two booleans and returns a route, which `authGate.test.ts` calls directly.
 * Inlining this into `+native-intent.tsx`'s body would make the app's single most load-bearing
 * branch the one thing in `src/` with no test.
 *
 * **The gate is soft, and it is a welcome, shown once.** The landing is what the app opens on the
 * first time somebody signed out opens it, the way a phone app greets you once and then opens on
 * itself; from then on every launch opens Home. Signing in is never required: planning,
 * generating and saving all work signed out under the anonymous owner, and the server's
 * `claimAnonymousOwner` exists to move that work onto an account at sign-up. A hard wall would make
 * that mechanism dead code on this platform.
 */

/**
 * A launch with no path — the app being opened rather than linked into.
 *
 * Two real shapes reach here. A home-screen icon tap has no URL at all, so expo-router substitutes
 * `Linking.createURL('/')` (`expo-router/build/link/linking.js`, `getRootURL`) — `tripmate:///` in a
 * standalone build, `exp://<host>:<port>/--/` under Expo Go, where `/--/` is the path separator
 * Expo Go inserts between its own host and the app's route.
 *
 * Everything else is a deep link and is never gated: `/trip/[id]` is readable by anyone holding the
 * id, and a share arrives before any account could be involved. **Every shape this does not
 * recognise fails open** — an unrecognised URL means no gate, never a wall. A dev build launched
 * from the Expo launcher (`tripmate://expo-development-client/?url=…`) is one such shape, which is
 * why the gate has to be tested from the home-screen icon rather than from the launcher.
 */
const BARE_LAUNCH = /^[a-z][a-z0-9+.-]*:\/\/(\/?|[^/]+\/(--\/?)?)$/i;

export interface LaunchEvent {
  /** The URL the app was opened with, already substituted to the root URL on a bare launch. */
  path: string;
  /** True only for the URL the process started with. A link arriving mid-session is not a launch. */
  initial: boolean;
  /**
   * Whether the keychain holds a session token — **not** whether the server agrees it is still
   * valid. Deliberately: validating would mean a network round trip in front of the first frame,
   * and a revoked token costs nothing here. You land on Home, the first request 401s, and
   * `fetchWithSession` clears the token at its own chokepoint.
   */
  signedIn: boolean;
  /**
   * Whether this phone has shown the welcome (`readWelcomeSeen`), which the landing writes the
   * first time it mounts, so somebody who closes the app on it is not shown it again.
   */
  seenWelcome: boolean;
}

/** The route to open, or `null` to leave the launch URL alone. */
export function launchTarget({ path, initial, signedIn, seenWelcome }: LaunchEvent): string | null {
  // First, and the order matters: expo-share-intent opens the app with `tripmate://dataUrl=<key>`,
  // which carries its key in the *authority* rather than the path. Tested after `BARE_LAUNCH` it
  // would still fail that regex and fall through correctly, but only by accident — a share is a
  // deep link and deserves to be recognised as one rather than to survive on a regex's shape.
  if (path.includes('dataUrl=')) return '/share';

  // The landing, not the sign-in chooser: it offers sign-in and leads into planning without it,
  // which is the soft gate described above, with the product shown before the choice. Once only:
  // `welcome=1` tells it to offer Skip into Home, since nothing is under it yet but the anchor.
  if (initial && !signedIn && !seenWelcome && BARE_LAUNCH.test(path)) return '/landing?welcome=1';

  return null;
}
