import * as SecureStore from "expo-secure-store";
import { apiBaseUrl } from "./config";

const COOKIE_KEY = "tripmate.session.cookie";

// The backend scopes trips to an anonymous `owner` cookie (src/proxy.ts) — there is no login on
// this product, on web or on the existing Swift app. Whether each platform's fetch persists that
// cookie automatically across launches like a browser would is unverified; this wrapper does not
// assume it does. It reads the cookie back manually and echoes it forward itself, which is
// correct whether or not the platform *also* handles it — a double-send of the same cookie value
// is a no-op for the server.
export async function fetchWithSession(path: string, init: RequestInit = {}): Promise<Response> {
  const stored = await SecureStore.getItemAsync(COOKIE_KEY);
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (stored) headers["Cookie"] = stored;

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) await SecureStore.setItemAsync(COOKIE_KEY, setCookie);

  return response;
}
