import { useAuth } from '@clerk/expo';
import { useEffect } from 'react';

import { announceSessionChange, registerClerk, writeSignedInFlag } from '@/api/session';

/**
 * Hands Clerk to the non-React `session.ts`, and keeps the launch flag in step with Clerk.
 *
 * The flag follows `isSignedIn` rather than being written by each sign-in screen, so a session that
 * ends on its own (revoked in the dashboard, expired) clears it too.
 */
export function ClerkBridge() {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();

  useEffect(() => {
    registerClerk({ getToken: () => getToken(), signOut: () => signOut() });
    return () => registerClerk(null);
  }, [getToken, signOut]);

  useEffect(() => {
    if (!isLoaded) return;
    writeSignedInFlag(Boolean(isSignedIn)).finally(announceSessionChange);
  }, [isLoaded, isSignedIn]);

  return null;
}
