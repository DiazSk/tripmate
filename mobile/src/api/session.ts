import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiBaseUrl } from "./config";

const OWNER_KEY = "tripmate.session.owner";
/** Mirrors `OWNER_HEADER` in the backend's `src/lib/owner.ts`. */
const OWNER_HEADER = "X-TripMate-Owner";

/** The signed-in session token, beside the anonymous owner rather than replacing it. */
const TOKEN_KEY = "tripmate.session.token";

/**
 * Sent on every request, and it is about one specific failure mode.
 *
 * Better Auth validates `Origin` against its `trustedOrigins`, but only on a request that carries
 * a `Cookie` header. A bearer-only request would skip the check — except that *this* platform is
 * the one caught attaching cookies the client never set (see `fetchWithSession` below). Sending
 * the app's own scheme means sign-in behaves the same whether or not the native store decides to
 * put a cookie on the request. `tripmate` is the scheme declared in `app.json`.
 */
const ORIGIN = "tripmate://";

// expo-secure-store has no web implementation and throws on every call there. This app never
// ships to web, but `npx expo start --web` is a dev-only preview that should still work — an
// in-memory variable is fine since losing it on reload costs nothing real.
let webOwner: string | null = null;
let webToken: string | null = null;
/** Resolved once per process, so concurrent first requests cannot mint two different owners. */
let ownerPromise: Promise<string> | null = null;
/**
 * The token, cached after the first read.
 *
 * `undefined` means "not read from the store yet"; `null` means "read, and there isn't one".
 * Collapsing those two into `null` would re-hit the keychain on every single request for a
 * signed-out traveller, which is the common case.
 */
let cachedToken: string | null | undefined = undefined;
const listeners = new Set<() => void>();

async function readStored(): Promise<string | null> {
  if (Platform.OS === "web") return webOwner;
  return SecureStore.getItemAsync(OWNER_KEY);
}

async function writeStored(value: string): Promise<void> {
  if (Platform.OS === "web") {
    webOwner = value;
    return;
  }
  await SecureStore.setItemAsync(OWNER_KEY, value);
}

/**
 * The session token in force, reading through to the store exactly once.
 *
 * A keychain read is a syscall and this is on the path of every request, so it is cached after
 * the first. `adoptToken` and `clearToken` are the only writers and both update the cache, so it
 * cannot go stale behind them.
 */
export async function currentToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = Platform.OS === "web" ? webToken : await SecureStore.getItemAsync(TOKEN_KEY);
  return cachedToken;
}

/** Whether a token is held, without waiting on the store. Drives the signed-in UI. */
export function hasTokenSync(): boolean {
  return Boolean(cachedToken);
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce() {
  for (const listener of listeners) listener();
}

/**
 * Take ownership of a freshly minted session token.
 *
 * Writes the store before the cache: if the keychain write throws, this leaves the session
 * unchanged, which is the honest outcome — a cache-first order would report a sign-in that does
 * not survive the next launch.
 */
export async function adoptToken(token: string): Promise<void> {
  if (Platform.OS === "web") webToken = token;
  else await SecureStore.setItemAsync(TOKEN_KEY, token);
  cachedToken = token;
  announce();
}

/**
 * Drop the session.
 *
 * Clears the cache even when the store throws. A token the app cannot delete is worse held than
 * dropped: the traveller asked to be signed out, and keeping it live in memory so the next
 * request still succeeds is the one outcome nobody wants.
 */
export async function clearToken(): Promise<void> {
  cachedToken = null;
  announce();
  try {
    if (Platform.OS === "web") webToken = null;
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Cache is already cleared — see above.
  }
}

/**
 * A v4-shaped identifier.
 *
 * Not a security token — the backend's own notes are explicit that this cookie is not an
 * authorization boundary, and `GET /api/trips/:id` is readable by anyone holding the id. So this
 * needs to be unique, not unguessable, and `Math.random` is a fine source for that when no
 * crypto is present. Uses `crypto.randomUUID` where the runtime offers it.
 */
function newOwnerId(): string {
  const maybe = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof maybe?.randomUUID === "function") return maybe.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function ownerId(): Promise<string> {
  if (!ownerPromise) {
    ownerPromise = (async () => {
      const stored = await readStored();
      if (stored) return stored;
      const fresh = newOwnerId();
      await writeStored(fresh);
      return fresh;
    })();
  }
  return ownerPromise;
}

/**
 * Every request, carrying this installation's own anonymous owner.
 *
 * **A header, not a cookie, and the client mints the value rather than capturing the server's.**
 * There is no login on this product: the backend scopes trips to an anonymous owner it tracks in
 * a cookie (`src/proxy.ts`). The obvious client reads that `Set-Cookie` and echoes it back, and
 * both halves of that fail here.
 *
 * React Native's networking owns cookies end to end. `Set-Cookie` never reaches JS, so the read
 * always came back empty and nothing was ever stored — the server minted a fresh owner on every
 * request. Minting one here fixed the storage half and not the sending half: the native store
 * also *overwrites* a hand-set `Cookie` header with its own contents. Proven, not inferred — a
 * request left the app carrying `tripmate_owner=<A>,tripmate_owner=<B>`, two ids the store had
 * collected from earlier responses, with the client's own value nowhere in it.
 *
 * It hid for a long time because reads mostly still worked: fetching a trip by id is not
 * owner-scoped, and an empty trip list looks like a new user rather than a bug. What exposed it
 * was writes — a trip and the profile saved milliseconds apart in one flow landed under two
 * different owners, and promoting a draft answered 404.
 *
 * So the identity travels in a header the platform has no opinion about. The proxy folds it into
 * the cookie before anything else reads it, so this is the same identity the web app uses rather
 * than a parallel scheme. `ownerPromise` resolves once per process so two concurrent first
 * requests cannot race into two different owners — which is the exact shape the trip-and-profile
 * pair had.
 */
export async function fetchWithSession(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const owner = await ownerId();
  const token = await currentToken();

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      [OWNER_HEADER]: owner,
      Origin: ORIGIN,
      // A bearer, for the same reason the owner is a header: the platform has no opinion about
      // this one. `auth.ts` on the server runs Better Auth's `bearer` plugin precisely so a
      // client with an untrustworthy cookie jar never has to rely on it.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  /**
   * A rejected token is a sign-out, not a retry.
   *
   * There is nothing the app can do to make an expired or revoked token acceptable, so retrying
   * turns one failure into a loop. Dropping it here — at the one place every request in this app
   * passes through — means the next request goes out anonymously and the UI follows, rather than
   * every screen independently discovering it is unauthorised.
   *
   * Only when a token was actually sent: a 401 on an anonymous request is the server saying
   * something else entirely, and clearing a token we do not have would announce a spurious
   * sign-out.
   */
  if (response.status === 401 && token) await clearToken();

  return response;
}
