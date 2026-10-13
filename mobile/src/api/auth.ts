import { useEffect, useState } from 'react';

import { resolveImage } from '@/lib/avatarImage';

import { apiBaseUrl } from './config';
import { announceSessionChange, clerkSignOut, fetchWithSession, subscribeToSession, writeSignedInFlag } from './session';

/**
 * The account as the app displays it. Clerk holds the identity; `GET /api/account` joins it to the
 * owner id and the avatar this server stores, so every screen keeps one shape.
 */
export interface Account {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/** The signed-in account, or `null`. */
export async function fetchAccount(): Promise<Account | null> {
  try {
    const response = await fetchWithSession('/api/account');
    if (!response.ok) return null;
    const user = (await response.json().catch(() => null)) as Account | null;
    return user ? { ...user, image: resolveImage(user.image ?? null, apiBaseUrl) } : null;
  } catch {
    return null;
  }
}

export function useAccount(): { account: Account | null; loading: boolean } {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      setLoading(true);
      fetchAccount().then((next) => {
        if (!alive) return;
        setAccount(next);
        setLoading(false);
      });
    };
    load();
    const unsubscribe = subscribeToSession(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return { account, loading };
}

/**
 * Ends Clerk's session, then drops the launch flag. The flag goes even when Clerk's call fails: the
 * traveller asked to be signed out, and a dead connection must not refuse them.
 */
export async function signOut(): Promise<void> {
  try {
    await clerkSignOut();
  } catch {
    // See above.
  }
  await writeSignedInFlag(false);
  announceSessionChange();
}

/**
 * Moves this device's anonymous work onto the account and says whether the welcome is due. Called
 * after every successful sign-in. A failure reads as "nothing moved, not new" — the traveller is
 * signed in either way.
 */
export async function claimAccount(): Promise<{ claimed: number; needsOnboarding: boolean }> {
  try {
    const response = await fetchWithSession('/api/account/claim', { method: 'POST' });
    if (!response.ok) return { claimed: 0, needsOnboarding: false };
    return (await response.json()) as { claimed: number; needsOnboarding: boolean };
  } catch {
    return { claimed: 0, needsOnboarding: false };
  }
}

/** Errors come back as the sentence to show; null means it worked and every `useAccount` refreshed. */
async function accountWrite(path: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const response = await fetchWithSession(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      return payload?.error ?? "Couldn't save that. Try again.";
    }
    announceSessionChange();
    return null;
  } catch {
    return "Couldn't reach TripMate. Check your connection.";
  }
}

export const uploadAvatar = (base64: string) => accountWrite('/api/avatar', 'PUT', { mediaType: 'image/jpeg', data: base64 });
export const removeAvatar = () => accountWrite('/api/avatar', 'DELETE');
export const updateName = (name: string) => accountWrite('/api/account', 'PATCH', { name: name.trim().slice(0, 40) });
