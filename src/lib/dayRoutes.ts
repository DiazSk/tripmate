"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The focused day's real street routes, fetched once and shared by everything that wants them.
 *
 * Three surfaces read from here and they must not disagree: the travel line between two stop rows,
 * the street path drawn on the map, and the travel beats in a story film. One cache, one key.
 *
 * **Deliberately not importing `osrmRoute.ts`.** That module reaches `fetchCache.ts` and therefore
 * `better-sqlite3`, which is exactly what `serverFetchCached.ts`'s header warns a client-reachable
 * module must never do. Everything here goes through `GET /api/route`, which does the real caching
 * in SQLite; this module's map is only a per-session dedupe in front of it.
 */

export type RouteProfile = "walk" | "bike" | "drive";

export const ROUTE_PROFILES: readonly RouteProfile[] = ["walk", "bike", "drive"];

/** How each profile reads in a sentence: "12 min walk", "6 min ride", "4 min drive". */
export const PROFILE_VERB: Record<RouteProfile, string> = {
  walk: "walk",
  bike: "ride",
  drive: "drive",
};

export interface LatLng {
  lat: number;
  lng: number;
}

/** One leg's answer. `null` in a `DayRoute` means "we could not route this one" — never "these two
 *  places are next to each other" and never "they are unreachable". */
export interface RouteLeg {
  distanceM: number;
  durationS: number;
  /** The street-following line. May be empty if the service answered with numbers only. */
  points: LatLng[];
}

/** Index `i` is the leg from stop `i` to stop `i + 1`, so `length === stops.length - 1`. */
export type DayRoute = (RouteLeg | null)[];

/**
 * Below this, two stops are the same place and there is no journey to describe.
 *
 * Observed, not guessed: a Paris day had a stop and the Vélib' station outside it, and the pair
 * rendered as **"1 min walk · 0 m"** — `formatDuration` floors at a minute and `formatDistance`
 * rounds to ten metres, so a route OSRM snapped to the same bit of pavement comes out as a
 * confident statement about nothing. Both roundings are right on their own; the fix is upstream of
 * them, deciding the leg is not worth a line.
 *
 * 40m is about the depth of a building. `mapRoute.ts`'s `MIN_ARC_LENGTH_M` makes the same call for
 * the same reason on the map side, at a tighter threshold — an arc that short is invisible, where a
 * *sentence* that short is actively wrong.
 */
export const MIN_MEANINGFUL_LEG_M = 40;

/** The leg, if it describes a journey worth mentioning — otherwise `null`. See the constant. */
export function meaningfulLeg(leg: RouteLeg | null | undefined): RouteLeg | null {
  return leg && leg.distanceM >= MIN_MEANINGFUL_LEG_M ? leg : null;
}

// --- The profile store ---
//
// A module-level value plus a subscribe, not a React context. Three unrelated places read it, all
// under `AppShell`, so a context would work — but it would mean a provider, a memoised value and a
// re-render of every consumer for a preference that changes maybe twice in a session.
// `mapEngine.ts` already answers this exact question the same way.

const PROFILE_KEY = "tripmateRouteProfile";
const listeners = new Set<() => void>();
let profile: RouteProfile = "walk";
let profileLoaded = false;

function parseProfile(value: string | null): RouteProfile | null {
  return value === "walk" || value === "bike" || value === "drive" ? value : null;
}

function loadProfile(): RouteProfile {
  if (profileLoaded || typeof window === "undefined") return profile;
  profileLoaded = true;
  try {
    profile = parseProfile(window.localStorage.getItem(PROFILE_KEY)) ?? "walk";
  } catch {
    // Private mode / storage disabled. Walking is the default and the session still works.
  }
  return profile;
}

export function setRouteProfile(next: RouteProfile): void {
  if (next === profile) return;
  profile = next;
  profileLoaded = true;
  try {
    window.localStorage.setItem(PROFILE_KEY, next);
  } catch {
    // Same — the choice just does not survive a reload.
  }
  for (const l of listeners) l();
}

/**
 * The current profile, re-rendering the caller when it changes.
 *
 * The server snapshot is the hardcoded default rather than `loadProfile()`, because localStorage
 * does not exist during SSR and a snapshot that disagreed with the client's first render is a
 * hydration mismatch.
 */
export function useRouteProfile(): RouteProfile {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    loadProfile,
    () => "walk"
  );
}

// --- The route cache ---

/**
 * A day's identity for routing purposes.
 *
 * 5dp is ~1m — finer than any edit that could change a route, and coarse enough that floating-point
 * noise in a coordinate round-trip does not miss the cache. The profile is part of the key, which
 * is what makes switching profiles need no invalidation at all: walk→drive is a miss on a different
 * key and drive→walk is a hit on a warm one.
 */
export function routeKey(profileFor: RouteProfile, stops: readonly LatLng[]): string {
  return `${profileFor}|${stops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|")}`;
}

/** Promises, cached before they settle, so two components asking in the same tick share one
 *  request. Evicted on rejection so a failure is retried rather than remembered. */
const inflight = new Map<string, Promise<DayRoute>>();
/** The settled answers, readable synchronously. See `peekDayRoute` for why that matters. */
const resolved = new Map<string, DayRoute>();

async function fetchDayRoute(profileFor: RouteProfile, stops: readonly LatLng[]): Promise<DayRoute> {
  const query = stops.map((s) => `${s.lat},${s.lng}`).join("|");
  const res = await fetch(`/api/route?profile=${profileFor}&stops=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`route lookup failed: ${res.status}`);
  const body = (await res.json()) as { legs?: DayRoute };
  return Array.isArray(body.legs) ? body.legs : [];
}

export function loadDayRoute(profileFor: RouteProfile, stops: readonly LatLng[]): Promise<DayRoute> {
  const key = routeKey(profileFor, stops);
  const settled = resolved.get(key);
  if (settled) return Promise.resolve(settled);

  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchDayRoute(profileFor, stops)
      .then((legs) => {
        resolved.set(key, legs);
        return legs;
      })
      .catch((err) => {
        inflight.delete(key);
        throw err;
      });
    inflight.set(key, pending);
  }
  return pending;
}

/**
 * What we already know about this day, without waiting — `null` for "not resolved, yet or ever".
 *
 * This is what keeps a slow or dead routing service off the critical path of anything that must
 * not block. Story mode builds its script from whatever is here at the moment Play is pressed: if
 * the legs have landed the film gets travel beats, and if they have not it gets the film it would
 * have had anyway. Nothing waits.
 */
export function peekDayRoute(profileFor: RouteProfile, stops: readonly LatLng[]): DayRoute | null {
  return resolved.get(routeKey(profileFor, stops)) ?? null;
}

/**
 * The focused day's legs, or `null` while they are unknown.
 *
 * Fail-soft: a failed lookup resolves to `null` and every consumer renders as it did before routing
 * existed. `stops` being `null` means "no day is focused" and clears.
 */
export function useDayRoute(stops: readonly LatLng[] | null): DayRoute | null {
  const activeProfile = useRouteProfile();
  const key = stops && stops.length >= 2 ? routeKey(activeProfile, stops) : null;

  /**
   * The answer and the question it answers, held together.
   *
   * Adjusted **during render** when the key changes rather than in an effect, which is React's own
   * pattern for resetting state on a prop change — an effect that calls `setRoute` in its body
   * renders once with the previous day's legs before correcting itself, so switching days would
   * flash the old day's numbers against the new day's stops. Pairing the route with its key makes
   * that structurally impossible: the two can never be out of step, because they are one value.
   *
   * `peekDayRoute` seeds it synchronously, so returning to a day already fetched shows its numbers
   * immediately instead of blinking through an empty state on the way to the same answer.
   */
  const [state, setState] = useState<{ key: string | null; route: DayRoute | null }>(() => ({
    key,
    route: key && stops ? peekDayRoute(activeProfile, stops) : null,
  }));
  if (state.key !== key) {
    setState({ key, route: key && stops ? peekDayRoute(activeProfile, stops) : null });
  }

  useEffect(() => {
    if (!stops || !key) return;
    let live = true;
    loadDayRoute(activeProfile, stops)
      .then((legs) => {
        if (live) setState({ key, route: legs });
      })
      .catch(() => {
        // Fail-soft: no legs, and every consumer renders as it did before routing existed.
        if (live) setState({ key, route: null });
      });
    return () => {
      live = false;
    };
    // `key` is the identity of (profile, coordinates). `stops` is a fresh array on every render
    // and depending on it would restart the fetch on every one of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state.key === key ? state.route : null;
}
