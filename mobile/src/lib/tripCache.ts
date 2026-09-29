import { Directory, File, Paths } from 'expo-file-system';

import { getTrip, listTrips } from '@/api/tripMateApi';
import type { Trip, TripSummary } from '@/api/types';

/**
 * The trip you are on, readable with no network.
 *
 * An on-trip screen that goes blank in a subway tunnel is worse than no on-trip screen, and
 * every call in `tripMateApi` answers `undefined` when the request fails — correct, and not
 * enough on its own. So a trip read while online is written to disk, and a failed read falls
 * back to that copy.
 *
 * **`Paths.document`, not `Paths.cache`.** Expo documents the cache directory as one the system
 * may delete when storage runs low, which is exactly the wrong property for the one file that
 * has to survive being underground. The obvious-sounding choice is the wrong one here.
 *
 * **Nothing here is keyed off the trips list.** `listTrips()` fails offline too, so a design that
 * looked up "which trip is running" over the network would not know which file to read. The
 * directory is self-describing instead: every cached trip carries its own dates, and
 * `readCachedTrips` hands them back for `pickCurrent` to sort out exactly as it would live rows.
 *
 * **Every filesystem call is wrapped.** A cache that throws would take down the screen it exists
 * to protect, which would be worse than not having it — so a failure to write is silent and a
 * failure to read is a miss. That is the same fail-soft bargain the rest of this app strikes with
 * its own upstreams.
 *
 * The API is synchronous in SDK 57 (`write`, `textSync`, `exists`), so none of this needs to be
 * awaited or held in state.
 */

const FOLDER = 'trips';

/** What a cached read hands back: the trip, and when this copy was taken. */
export interface Cached<T> {
  value: T;
  /** ISO timestamp of the read that wrote this copy. Null when the data came from the network. */
  cachedAt: string | null;
}

interface Envelope {
  trip: Trip;
  cachedAt: string;
}

function dir(): Directory {
  const d = new Directory(Paths.document, FOLDER);
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/** Remember this trip as it was just read. Best effort — a failed write is not worth a screen. */
export function cacheTrip(trip: Trip): void {
  try {
    const envelope: Envelope = { trip, cachedAt: new Date().toISOString() };
    new File(dir(), `${trip.id}.json`).write(JSON.stringify(envelope));
  } catch {
    // Storage full, sandbox refused, disk gone. The trip on screen is unaffected.
  }
}

/** The stored copy of one trip, or null when there is none or it cannot be read. */
export function readCachedTrip(id: string): Cached<Trip> | null {
  try {
    const file = new File(dir(), `${id}.json`);
    if (!file.exists) return null;
    const envelope = JSON.parse(file.textSync()) as Envelope;
    // A file written by an older build, or half-written when the app was killed. A miss, not a
    // crash — the alternative is a screen that throws on data it was meant to rescue.
    if (!envelope?.trip?.id) return null;
    return { value: envelope.trip, cachedAt: envelope.cachedAt ?? null };
  } catch {
    return null;
  }
}

/** Every trip on disk, newest copy first. The offline answer to "which trip am I on". */
export function readCachedTrips(): Cached<Trip>[] {
  try {
    return dir()
      .list()
      .flatMap((entry) => {
        const name = entry.name ?? '';
        if (!name.endsWith('.json')) return [];
        const hit = readCachedTrip(name.slice(0, -'.json'.length));
        return hit ? [hit] : [];
      })
      .sort((a, b) => (b.cachedAt ?? '').localeCompare(a.cachedAt ?? ''));
  } catch {
    return [];
  }
}

/**
 * One trip: live if the network answers, the stored copy if it does not.
 *
 * `cachedAt` is how the caller knows which it got, and it is not optional to show — this product
 * does not present old data as current. `undefined` still means what it always did: nothing to
 * render, online or off.
 */
export async function loadTrip(id: string): Promise<Cached<Trip> | undefined> {
  const live = await getTrip(id);
  if (live) {
    cacheTrip(live);
    return { value: live, cachedAt: null };
  }
  return readCachedTrip(id) ?? undefined;
}

/**
 * The trips wall's data, falling back to whatever has been cached.
 *
 * The cached list is necessarily a subset — only trips actually opened are on disk — so this is
 * a fallback for *finding the current trip*, not a mirror of the wall. `listTrips` returning
 * `undefined` with nothing cached stays `undefined`, which is the state Home already draws a
 * notice for.
 */
export async function loadTrips(): Promise<Cached<TripSummary[]> | undefined> {
  const live = await listTrips();
  if (live) return { value: live, cachedAt: null };

  const cached = readCachedTrips();
  if (cached.length === 0) return undefined;
  return {
    value: cached.map((c) => c.value),
    // The oldest copy in the set, because that is the honest claim about the whole list.
    cachedAt: cached[cached.length - 1].cachedAt,
  };
}
