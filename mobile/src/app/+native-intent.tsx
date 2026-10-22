import { launchTarget } from '@/lib/authGate';

/**
 * Where a launch actually goes, decided before any navigation state exists.
 *
 * **Synchronous on purpose.** expo-router accepts a promise here, and awaits it while rendering its
 * `fallback`, which would hold the root layout back behind the native splash. Nothing here is async,
 * so the first navigation state the app ever builds already has the right screen on top, and nothing
 * has to be corrected after the fact.
 *
 * The alternatives all decide too late. A `<Redirect>` in `(tabs)/index` mounts Home first and then
 * fires again on every visit to the Home tab; a `router.replace` in a root effect has to work out
 * whether it is racing a cold-start deep link; and `Stack.Protected` controls whether a screen
 * *exists*, which cannot express a gate you are meant to be able to walk past.
 *
 * It runs on a plain icon tap too, not just on links: with no URL to open,
 * `expo-router/build/link/linking.js` substitutes `getRootURL()`, so `path` is always a string.
 */
export function redirectSystemPath({ path }: { path: string }) {
  return launchTarget({ path }) ?? path;
}
