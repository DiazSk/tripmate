import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiBaseUrl } from "./config";

const OWNER_KEY = "tripmate.session.owner";
const OWNER_COOKIE = "tripmate_owner";

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
 * **The client mints the identity rather than capturing the server's, and that is the fix for a
 * bug that made the app unusable.** There is no login on this product: the backend scopes trips
 * to an anonymous `owner` cookie it sets itself (`src/proxy.ts`). The obvious client is to read
 * that `Set-Cookie` and echo it back — but React Native's networking consumes `Set-Cookie` into
 * its own native jar and does not expose it to JS, so the read always came back empty, nothing
 * was ever stored, no `Cookie` header was ever sent, and `proxy.ts` minted a **fresh owner on
 * every single request**.
 *
 * It hid for a long time because reads mostly still worked: fetching a trip by id is not
 * owner-scoped, and an empty trip list looks like a new user rather than a bug. What exposed it
 * was writes — a trip and the profile saved milliseconds apart in one flow landed under two
 * different owners, and promoting a draft answered 404 because the caller was no longer the
 * person who created it.
 *
 * The server accepts any UUID-shaped value as an owner (`isValidOwnerId`), so generating one
 * here and sending it on every request removes the dependency on reading a response header
 * entirely. `ownerPromise` resolves once per process so two concurrent first requests cannot
 * race into two different identities.
 */
export async function fetchWithSession(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const owner = await ownerId();
  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, Cookie: `${OWNER_COOKIE}=${owner}` },
  });
}
