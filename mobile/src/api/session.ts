import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiBaseUrl } from "./config";

const COOKIE_KEY = "tripmate.session.cookie";

// expo-secure-store has no web implementation and throws on every call there. This app never
// ships to web, but `npx expo start --web` is a dev-only preview that should still work — an
// in-memory variable is fine since losing it on reload costs nothing real.
let webCookie: string | null = null;

async function getStoredCookie(): Promise<string | null> {
  if (Platform.OS === "web") return webCookie;
  return SecureStore.getItemAsync(COOKIE_KEY);
}

async function setStoredCookie(value: string): Promise<void> {
  if (Platform.OS === "web") {
    webCookie = value;
    return;
  }
  await SecureStore.setItemAsync(COOKIE_KEY, value);
}

// The backend scopes trips to an anonymous `owner` cookie (src/proxy.ts) — there is no login on
// this product, on web or on the existing Swift app. Whether each platform's fetch persists that
// cookie automatically across launches like a browser would is unverified; this wrapper does not
// assume it does. It reads the cookie back manually and echoes it forward itself, which is
// correct whether or not the platform *also* handles it — a double-send of the same cookie value
// is a no-op for the server.
export async function fetchWithSession(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const stored = await getStoredCookie();
  const headers: Record<string, string> = { ...init.headers };
  if (stored) headers["Cookie"] = stored;

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const pair = cookiePair(setCookie);
    if (pair) await setStoredCookie(pair);
  }

  return response;
}

/**
 * Just the `name=value`, dropping every attribute.
 *
 * **Storing the whole `Set-Cookie` and echoing it back breaks identity, and it does so
 * silently.** A `Cookie` header carries pairs only; the response's attributes include
 * `Expires=Wed, 27 Oct 2027 17:47:48 GMT`, whose **comma and spaces** make the header
 * unparseable. The server then finds no valid owner, mints a fresh one on every single request,
 * and each call arrives as a different person. Reads still worked — `GET /api/trips/:id` is not
 * owner-scoped, so a trip was visible to anyone with the id — which is exactly why this hid
 * until the first owner-scoped write: creating a trip stamped one owner and the promote that
 * followed arrived as another, and the route answered 404.
 */
function cookiePair(setCookie: string): string | null {
  const pair = setCookie.split(";")[0]?.trim();
  return pair && pair.includes("=") ? pair : null;
}
