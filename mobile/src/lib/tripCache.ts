import { Directory, File, Paths } from 'expo-file-system';

import { getReadyTrips, getTrip, listSavedPlaces, listTrips } from '@/api/tripMateApi';
import type { SavedPlace, Trip, TripSummary } from '@/api/types';
import type { ReadyTrip } from '@shared/readyTrips';

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

/**
 * Forget every cached trip that is no longer in the live list.
 *
 * Without this the cache only ever grows, and it grows *wrong*: a trip deleted on the server
 * stays on disk, and since `loadTrips` falls back to disk, the next time the network drops it
 * reappears on Home as though it were still a trip. Observed exactly that way — a trip removed
 * from the database was still being offered as the one in progress.
 *
 * A live list is authoritative and is the only moment this is knowable, so the prune rides
 * along with it. Best effort, like every other write here.
 */
function prune(live: TripSummary[]): void {
  const keep = new Set(live.map((trip) => trip.id));
  for (const cached of readCachedTrips()) {
    if (keep.has(cached.value.id)) continue;
    try {
      new File(dir(), `${cached.value.id}.json`).delete();
    } catch {
      // A file that will not delete is a file that will be filtered out next time anyway.
    }
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
  if (live) {
    prune(live);
    return { value: live, cachedAt: null };
  }

  const cached = readCachedTrips();
  if (cached.length === 0) return undefined;
  return {
    value: cached.map((c) => c.value),
    // The oldest copy in the set, because that is the honest claim about the whole list.
    cachedAt: cached[cached.length - 1].cachedAt,
  };
}


/* --- the saved pile, cached for the same reason the trip is --- */

/**
 * One file, not one per place.
 *
 * Trips are cached individually because `readCachedTrips` has to scan them to work out which is
 * running with no network to ask. The saved pile is never searched that way — it is read whole,
 * filtered to a city in memory, and it is small. A directory of hundreds of one-line files would
 * buy nothing and cost a scan.
 */
const SAVED_FILE = 'saved-places.json';

interface SavedEnvelope {
  places: SavedPlace[];
  cachedAt: string;
}

/**
 * The saved pile as it was last read online.
 *
 * This is the piece the Today spec deferred, and the reason it deferred it: Today has to work in
 * a tunnel, and `listSavedPlaces` is a network call. Without a copy on disk the one suggestion
 * the screen can make in a three-hour gap would be the one thing on it that disappears
 * underground.
 */
export function cacheSavedPlaces(places: SavedPlace[]): void {
  try {
    const envelope: SavedEnvelope = { places, cachedAt: new Date().toISOString() };
    new File(dir(), SAVED_FILE).write(JSON.stringify(envelope));
  } catch {
    // Same bargain as `cacheTrip`: a cache that throws is worse than no cache.
  }
}

export function readCachedSavedPlaces(): Cached<SavedPlace[]> | null {
  try {
    const file = new File(dir(), SAVED_FILE);
    if (!file.exists) return null;
    const envelope = JSON.parse(file.textSync()) as SavedEnvelope;
    // An older build, or a write interrupted by the app being killed.
    if (!Array.isArray(envelope?.places)) return null;
    return { value: envelope.places, cachedAt: envelope.cachedAt };
  } catch {
    return null;
  }
}

/**
 * The saved pile: live if the network answers, the copy on disk if it does not.
 *
 * **An empty live answer is cached, and that matters.** Deleting every saved place has to reach
 * disk, or the last non-empty copy would outlive it and Today would go on suggesting somewhere
 * the traveller removed — the same staleness `prune` exists to stop for trips.
 */
export async function loadSavedPlaces(): Promise<Cached<SavedPlace[]> | undefined> {
  const live = await listSavedPlaces();
  if (live) {
    cacheSavedPlaces(live);
    return { value: live, cachedAt: null };
  }
  return readCachedSavedPlaces() ?? undefined;
}


/* --- the ready-made catalogue, for the Home screen's offline rail --- */

/**
 * One file beside `saved-places.json`, for the same reason: it is read whole and never searched.
 * `readCachedTrips` lists this folder, but a file with no `trip` in it is a miss there, so it is
 * never mistaken for a trip and `prune` never reaches it.
 */
const READY_FILE = 'ready-trips.json';

interface ReadyEnvelope {
  trips: ReadyTrip[];
  cachedAt: string;
}

function cacheReadyTrips(trips: ReadyTrip[]): void {
  try {
    const envelope: ReadyEnvelope = { trips, cachedAt: new Date().toISOString() };
    new File(dir(), READY_FILE).write(JSON.stringify(envelope));
  } catch {
    // Same bargain as `cacheTrip`.
  }
}

/** The catalogue as it was last read online — synchronous, for the sheets that open from it. */
export function readCachedReadyTrips(): Cached<ReadyTrip[]> | null {
  try {
    const file = new File(dir(), READY_FILE);
    if (!file.exists) return null;
    const envelope = JSON.parse(file.textSync()) as ReadyEnvelope;
    if (!Array.isArray(envelope?.trips)) return null;
    return { value: envelope.trips, cachedAt: envelope.cachedAt };
  } catch {
    return null;
  }
}

/**
 * The catalogue: live if the server has one, else the copy on disk.
 *
 * `{ unavailable: true }` is the server saying there is no catalogue and we have nothing older —
 * the rail hides. `undefined` is no answer and no copy — the rail can say it could not load. An
 * `available: false` answer does not erase a copy already on disk: an unconfigured server is not
 * a deleted catalogue, and the offline rail should still have something to show.
 */
export async function loadReadyTrips(): Promise<Cached<ReadyTrip[]> | { unavailable: true } | undefined> {
  const live = await getReadyTrips();
  if (live?.available) {
    cacheReadyTrips(live.trips);
    return { value: live.trips, cachedAt: null };
  }
  const cached = readCachedReadyTrips();
  if (cached) return cached;
  return live ? { unavailable: true } : undefined;
}
