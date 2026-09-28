import { currentToken } from '@/api/session';
import { launchTarget } from '@/lib/authGate';

/**
 * Where a launch actually goes, decided before any navigation state exists.
 *
 * **This is the gate, and this file is the only place it can live without flashing.**
 * `redirectSystemPath` may return a promise, and expo-router awaits it through
 * `useThenable(getInitialState)` while rendering its `fallback` — `null` by default
 * (`expo-router/build/fork/NavigationContainer.js`). So the root layout does not mount during the
 * await, which means `AnimatedSplashOverlay` has not yet called `SplashScreen.hideAsync()` and the
 * native splash is still up. The keychain read is free, and the *first* navigation state the app
 * ever builds already has the right screen on top. Nothing has to be corrected after the fact.
 *
 * The alternatives all decide too late. A `<Redirect>` in `(tabs)/index` mounts Home first and then
 * fires again on every visit to the Home tab; a `router.replace` in a root effect has to work out
 * whether it is racing a cold-start deep link; and `Stack.Protected` controls whether a screen
 * *exists*, which cannot express a gate you are meant to be able to walk past.
 *
 * It runs on a plain icon tap too, not just on links: with no URL to open,
 * `expo-router/build/link/linking.js` substitutes `getRootURL()`, so `path` is always a string.
 */
export async function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  // Fail open, and this `catch` is the whole reason the read is not inlined into the call below.
  // A keychain that cannot be answered must not put a wall in front of anybody, so the default is
  // "signed in" — the state that gates nothing. Being wrong here shows an account-less traveller
  // Home; being wrong the other way locks an account holder out of their own app.
  let signedIn = true;
  try {
    signedIn = Boolean(await currentToken());
  } catch {
    // Left as `true`.
  }

  return launchTarget({ path, initial, signedIn }) ?? path;
}
