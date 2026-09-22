import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiBaseUrl } from "./config";

const OWNER_KEY = "tripmate.session.owner";
/** Mirrors `OWNER_HEADER` in the backend's `src/lib/owner.ts`. */
const OWNER_HEADER = "X-TripMate-Owner";

// expo-secure-store has no web implementation and throws on every call there. This app never
// ships to web, but `npx expo start --web` is a dev-only preview that should still work — an
// in-memory variable is fine since losing it on reload costs nothing real.
let webOwner: string | null = null;
/** Resolved once per process, so concurrent first requests cannot mint two different owners. */
let ownerPromise: Promise<string> | null = null;

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
  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, [OWNER_HEADER]: owner },
  });
}
