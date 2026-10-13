import { router, useNavigation } from 'expo-router';

import { claimAccount } from '@/api/auth';
import { announceSessionChange } from '@/api/session';

/**
 * The end of every sign-in on the phone — email, code, reset, Apple, Google.
 *
 * Claims this device's anonymous work, then routes on the server's answer: a new account replaces
 * the modal with the welcome; a returning one closes it via the root stack.
 *
 * **Out of the whole flow, not back to the chooser.** `router.dismissAll()` is wrong here and reads
 * as though it were right. It queues a bare `POP_TO_TOP`, and `BaseNavigationContainer` routes a
 * target-less action through the focus chain to the *deepest* focused navigator — which, now that
 * the sign-in screens are a group, is the `Stack` in `signin/_layout.tsx` rather than the one
 * holding the modal. That stack pops back to the chooser instead, so you end up signed in, looking
 * at a chooser offering to sign you in. `canDismiss()` does not catch it either: it walks *down*
 * from the root and returns `true` at the first stack with more than one route, which the root's
 * `[(tabs), signin]` always is. So dispatch on the navigator that owns the modal:
 * `useNavigation('/')` resolves the root `Stack`, and its own `goBack()` pops `signin` and leaves
 * the tab you came from where it was. The guard is the house idiom and the `replace` keeps a target
 * if the root anchor ever goes away.
 */
export function useFinishAuth(): () => Promise<void> {
  const rootNavigation = useNavigation('/');
  return async () => {
    const { needsOnboarding } = await claimAccount();
    announceSessionChange();
    if (needsOnboarding) {
      router.replace('/welcome');
      return;
    }
    if (rootNavigation.canGoBack()) rootNavigation.goBack();
    else router.replace('/(tabs)/trips');
  };
}
