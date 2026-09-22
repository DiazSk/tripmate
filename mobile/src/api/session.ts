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
  if (setCookie) await setStoredCookie(setCookie);

  return response;
}
