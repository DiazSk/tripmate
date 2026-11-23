import { useCallback, useSyncExternalStore } from 'react';

import { placePhoto } from './tripMateApi';
import type { PlacePhoto } from './types';

/**
 * One photo lookup per place name, for the whole process.
 *
 * Ported from the earlier SwiftUI client's photo store, with its two load-bearing
 * rules intact:
 *
 * 1. **One request per name.** A grid of memory tiles, the Home card and a trip's day mastheads
 *    all ask for the same destination, often in the same frame. The in-flight map collapses those
 *    into a single fetch.
 * 2. **A failure is never cached.** `placePhoto` returns `undefined` only for a *retryable*
 *    failure (a 503, a dropped connection); "this place has no photograph" comes back as a real
 *    object with null fields and a 200. Caching the former would leave a trip photo-less for the
 *    rest of the session.
 */
const resolved = new Map<string, PlacePhoto>();
const inFlight = new Map<string, Promise<PlacePhoto | undefined>>();
const listeners = new Map<string, Set<() => void>>();

function load(name: string): Promise<PlacePhoto | undefined> {
  const cached = inFlight.get(name);
  if (cached) return cached;

  const request = placePhoto(name).then((photo) => {
    if (photo) resolved.set(name, photo);
    // Cleared either way: a resolved photo now lives in `resolved`, and a failed lookup must be
    // allowed to try again rather than resolving to `undefined` forever.
    inFlight.delete(name);
    listeners.get(name)?.forEach((notify) => notify());
    return photo;
  });

  inFlight.set(name, request);
  return request;
}

/** The same lookup outside React: the film's Now Playing artwork, asked for once per beat. */
export function placePhotoFor(name: string): Promise<PlacePhoto | undefined> {
  const known = resolved.get(name);
  return known ? Promise.resolve(known) : load(name);
}

/**
 * The photograph for a place, or `undefined` while it is being fetched — and also `undefined` if
 * the lookup failed. Callers draw the same thing in both cases, which is why they are not
 * distinguished here: a tile with no picture is a finished state, not an error.
 */
/**
 * **`useSyncExternalStore`, not `useState` + an effect, and the reason is not style.**
 *
 * The cache above is mutable module state living outside React. Reading it during render and
 * poking a counter to force a re-read looks like it works and does not: this app builds with the
 * React Compiler enabled (`app.json` → `experiments.reactCompiler`), which is free to memoize a
 * component whose inputs it believes are unchanged, so the re-render reuses the cached output and
 * the photograph never appears. Observed exactly that way — the lookups returned 200 and not one
 * image was ever requested.
 *
 * This is the hook React provides for precisely this shape: the store says when it changed, and
 * the snapshot is read through an API the compiler understands. The load is kicked off from
 * `subscribe` rather than an effect, which also keeps `setState`-in-an-effect out of the file.
 */
export function usePlacePhoto(name: string | undefined): PlacePhoto | undefined {
  const key = name?.trim() ?? '';

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!key) return () => {};
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(onChange);
      if (!resolved.has(key)) load(key);
      return () => {
        set.delete(onChange);
        if (set.size === 0) listeners.delete(key);
      };
    },
    [key]
  );

  // Stable by construction: once a name resolves, the Map hands back the same object every call,
  // which is what stops `useSyncExternalStore` from looping.
  const getSnapshot = useCallback(() => (key ? resolved.get(key) : undefined), [key]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
