import { useEffect, useState } from "react";

import { resolveImage } from "@/lib/avatarImage";

import { apiBaseUrl } from "./config";
import { adoptToken, announceSessionChange, clearToken, currentToken, fetchWithSession, subscribeToSession } from "./session";

/**
 * Accounts, over the same `fetchWithSession` everything else here uses.
 *
 * **No auth library on this side, deliberately.** Better Auth's own client exists, and its Expo
 * plugin attaches sessions by hand-setting a `Cookie` header — which is the precise mechanism
 * `session.ts` documents this platform breaking. What is left once that is off the table is three
 * JSON POSTs, and a dependency that shipped a bundle to avoid writing them would also be a second
 * place that decides how a request leaves this app. The server's `bearer` plugin is the contract;
 * this is the whole client for it.
 */

export interface Account {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/** What `set-auth-token` is called on the way back. Better Auth's `bearer` plugin sets it. */
const TOKEN_HEADER = "set-auth-token";

interface AuthResult {
  account: Account | null;
  /** `null` on success. The server's own wording — it already separates a wrong password from an
   *  email that is taken, and those have different next steps. */
  error: string | null;
}

async function exchange(path: string, body: Record<string, unknown>): Promise<AuthResult> {
  let response: Response;
  try {
    response = await fetchWithSession(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // The house idiom: a transport failure is not the same as a rejection, and saying "wrong
    // password" to someone on a train with no signal is the worst version of this screen.
    return { account: null, error: "Couldn't reach TripMate. Check your connection." };
  }

  const payload = (await response.json().catch(() => null)) as
    | { user?: Account; message?: string }
    | null;

  if (!response.ok) {
    return { account: null, error: payload?.message ?? "That didn't work. Try again." };
  }

  // Adopt before returning, so the caller's very next request is already authenticated. The token
  // arrives in a header rather than the body — see `TOKEN_HEADER`.
  const token = response.headers.get(TOKEN_HEADER);
  if (token) await adoptToken(token);

  return { account: payload?.user ?? null, error: null };
}

export function signUp(email: string, password: string, name: string): Promise<AuthResult> {
  return exchange("/api/auth/sign-up/email", { email, password, name });
}

export function signIn(email: string, password: string): Promise<AuthResult> {
  return exchange("/api/auth/sign-in/email", { email, password });
}

/**
 * Tell the server first, then drop the token. **This order is the fix for a real bug.**
 *
 * Dropping the token locally does not sign this app out, because the bearer is not the only thing
 * authenticating it. `session.ts` records the platform keeping cookies JS cannot see; signing in
 * seeds Better Auth's session cookie into that store, and it keeps going out on every request
 * afterwards. Clearing the token first therefore announced a sign-out while the very next request
 * was still the account — observed as Profile's trip count and spend still reading the account's
 * figures after signing out, until the revoke happened to land.
 *
 * Revoking first closes both: the session is dead before anything re-reads, and Better Auth's
 * response carries an expiring `Set-Cookie` that clears the copy the platform was holding.
 *
 * ponytail: offline, the POST fails and the token is dropped anyway — the traveller asked to be
 * signed out and must be. The cookie then outlives it until the session expires server-side. The
 * upgrade, if that matters, is a locally-recorded revocation the next successful request replays.
 */
export async function signOut(): Promise<void> {
  const token = await currentToken();
  if (token) {
    try {
      await fetchWithSession("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      });
    } catch {
      // Offline. Fall through: the local token goes regardless — see the note above.
    }
  }
  await clearToken();
}

/** The signed-in account, or `null`. `undefined` while the first read is still in flight. */
export async function fetchAccount(): Promise<Account | null> {
  if (!(await currentToken())) return null;
  try {
    const response = await fetchWithSession("/api/auth/get-session");
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as { user?: Account } | null;
    const user = payload?.user;
    return user ? { ...user, image: resolveImage((user as { image?: string | null }).image ?? null, apiBaseUrl) } : null;
  } catch {
    return null;
  }
}

/**
 * The account, kept in step with the token.
 *
 * Re-reads whenever the token changes — which includes the case nothing in the UI initiated: a
 * 401 on any request clears the token at the `fetchWithSession` chokepoint, and this is what turns
 * that into the screens showing a signed-out state rather than an unexplained empty list.
 */
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

/** Errors come back as the sentence to show; null means it worked and every `useAccount` refreshed. */
async function accountWrite(path: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const response = await fetchWithSession(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
      return payload?.error ?? payload?.message ?? "Couldn't save that. Try again.";
    }
    announceSessionChange();
    return null;
  } catch {
    return "Couldn't reach TripMate. Check your connection.";
  }
}

export const uploadAvatar = (base64: string) => accountWrite("/api/avatar", "PUT", { mediaType: "image/jpeg", data: base64 });
export const removeAvatar = () => accountWrite("/api/avatar", "DELETE");
export const updateName = (name: string) => accountWrite("/api/auth/update-user", "POST", { name: name.trim().slice(0, 40) });
