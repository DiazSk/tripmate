/**
 * Two small facts the web events need that no single component owns, kept in module state because
 * a client-side navigation keeps this module alive and a reload (correctly) forgets them.
 */

/** A fresh id for one planning attempt, or null where `crypto.randomUUID` is missing (plain http off localhost): the server ignores anything that is not a UUID, so no id is better than a made-up one. */
export function newAttemptId(): string | null {
  try {
    return crypto.randomUUID();
  } catch {
    return null;
  }
}

const attemptByTrip = new Map<string, string>();

/** Pairs a trip with the attempt that wrote it, so the trip page's Keep can say which attempt it ends. A trip opened any other way has none, and Keep sends nothing. */
export function rememberAttempt(tripId: string, attemptId: string | null): void {
  if (attemptId) attemptByTrip.set(tripId, attemptId);
}

export function attemptFor(tripId: string): string | undefined {
  return attemptByTrip.get(tripId);
}

let current: string | null = null;
let previous: string | null = null;

/** Called by anything that knows the route (idempotent, so order between callers does not matter). */
export function notePath(path: string): void {
  if (path === current) return;
  previous = current;
  current = path;
}

/** The route this page was reached from, within this tab's life of client navigations; null on a first load. */
export function previousPath(): string | null {
  return previous;
}

/** Where a trip page was opened from: Home, the memories list, a share link, or (anything else) a link. */
export function tripSource(from: string | null, referrerPath: string | null): "home" | "trips" | "link" | "share" {
  const path = from ?? referrerPath;
  if (path === "/") return "home";
  if (path === "/trips" || path?.startsWith("/trips/")) return "trips";
  if (path?.startsWith("/s/")) return "share";
  return "link";
}
