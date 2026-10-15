import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiBaseUrl } from "./config";

const OWNER_KEY = "tripmate.session.owner";
/** Mirrors `OWNER_HEADER` in the backend's `src/lib/owner.ts`. */
const OWNER_HEADER = "X-TripMate-Owner";

/** Written when Clerk reports a session, cleared when it reports none. Read only by the launch gate. */
const SIGNED_IN_KEY = "tripmate.signedIn";

/**
 * Sent on every request. The app's own scheme, so a request is identifiable as coming from the
 * native app whether or not the platform's cookie store attaches cookies the client never set (see
 * `fetchWithSession` below). `tripmate` is the scheme declared in `app.json`.
 */
const ORIGIN = "tripmate://";

// expo-secure-store has no web implementation and throws on every call there. This app never
// ships to web, but `npx expo start --web` is a dev-only preview that should still work — an
// in-memory variable is fine since losing it on reload costs nothing real.
let webOwner: string | null = null;
let webSignedIn = false;
/** Resolved once per process, so concurrent first requests cannot mint two different owners. */
let ownerPromise: Promise<string> | null = null;

type ClerkHandle = { getToken: () => Promise<string | null>; signOut: () => Promise<void> };
let clerk: ClerkHandle | null = null;
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

/** Set by `<ClerkBridge>` inside the provider. This module is not a component, so Clerk is handed in. */
export function registerClerk(handle: ClerkHandle | null): void {
  clerk = handle;
}

export async function clerkSignOut(): Promise<void> {
  await clerk?.signOut();
}

/** How long a request waits on Clerk before going out anonymously. */
const TOKEN_WAIT_MS = 3000;

/**
 * Clerk's 60-second token, asked for per request — Clerk caches and refreshes it. A throw
 * (`ClerkOfflineError` with no connection) sends the request anonymously rather than not at all.
 *
 * **Bounded, and skipped when nobody is signed in.** `getToken()` first awaits Clerk's load, which
 * settles only on `ready` or `degraded`; when clerk-js fails to load (an outage, a bad key, a blocked
 * network) the status is `error` and that promise never settles. Every request awaits this one, so
 * an unbounded wait would freeze the whole app, signed-out planning included. The flag is the
 * cheap answer to "is there anything to send", and the race covers the signed-in case.
 */
async function sessionToken(): Promise<string | null> {
  if (!clerk || !(await readSignedInFlag())) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      clerk.getToken(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TOKEN_WAIT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function readSignedInFlag(): Promise<boolean> {
  if (Platform.OS === "web") return webSignedIn;
  return (await SecureStore.getItemAsync(SIGNED_IN_KEY)) === "1";
}

export async function writeSignedInFlag(on: boolean): Promise<void> {
  if (Platform.OS === "web") {
    webSignedIn = on;
    return;
  }
  if (on) await SecureStore.setItemAsync(SIGNED_IN_KEY, "1");
  else await SecureStore.deleteItemAsync(SIGNED_IN_KEY);
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For a change the server made to the account (a photo, a name): every `useAccount` re-reads it. */
export function announceSessionChange(): void {
  announce();
}

function announce() {
  for (const listener of listeners) listener();
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
/**
 * Whether the last request reached TripMate at all, or null before there has been one.
 *
 * Every call in `tripMateApi` answers `undefined` on any failure, which is right for the callers that
 * only need "is there data", and not enough for the one screen that has to say *why* there is none:
 * the offline screen says "you're out of range", which is a lie when the server answered with an
 * error. A thrown `fetch` is the only failure that means the phone never got through; any response,
 * a 500 included, means it did. Module state rather than a return value so no API signature changes;
 * concurrent requests share a network, so whichever finished last tells the same story.
 */
let reached: boolean | null = null;
export const lastRequestReachedServer = () => reached;

export async function fetchWithSession(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const owner = await ownerId();
  const token = await sessionToken();

  try {
    const response = await sendWithSession(path, init, owner, token);
    reached = true;
    return response;
  } catch (error) {
    reached = false;
    throw error;
  }
}

function sendWithSession(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
  owner: string,
  token: string | null,
): Promise<Response> {
  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      [OWNER_HEADER]: owner,
      Origin: ORIGIN,
      // Clerk's session token as a bearer, for the same reason the owner is a header: the
      // platform has no opinion about this one, and the server verifies it without any cookie.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
