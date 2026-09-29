import type { Trip } from '@/api/types';

/**
 * An in-memory stand-in for `expo-file-system`'s synchronous class API.
 *
 * The real module is native and cannot run here, but the logic worth testing is this file's own:
 * what it writes, what it does with a file it cannot parse, and whether a failed fetch reaches
 * the mockDisk copy. `mockThrowOn` lets a test make the filesystem fail, which is the case the wrapping
 * exists for and the one most likely to be quietly removed later.
 */
const mockDisk = new Map<string, string>();
let mockThrowOn: 'none' | 'read' | 'write' = 'none';

jest.mock('expo-file-system', () => ({
  Paths: { document: 'doc://' },
  Directory: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() {
      return true;
    }
    create() {}
    list() {
      return [...mockDisk.keys()].map((name) => ({ name }));
    }
  },
  File: class {
    name: string;
    constructor(_dir: unknown, name: string) {
      this.name = name;
    }
    get exists() {
      return mockDisk.has(this.name);
    }
    write(content: string) {
      if (mockThrowOn === 'write') throw new Error('mockDisk full');
      mockDisk.set(this.name, content);
    }
    textSync() {
      if (mockThrowOn === 'read') throw new Error('unreadable');
      return mockDisk.get(this.name) ?? '';
    }
    delete() {
      mockDisk.delete(this.name);
    }
  },
}));

const mockGetTrip = jest.fn();
const mockListTrips = jest.fn();
jest.mock('@/api/tripMateApi', () => ({
  getTrip: (...a: unknown[]) => mockGetTrip(...a),
  listTrips: (...a: unknown[]) => mockListTrips(...a),
}));

// Must follow the mocks. `jest.mock` is hoisted, but its factory runs on *this* import, and it
// closes over `mockDisk` — which is in its temporal dead zone until the declaration above has run.
// eslint-disable-next-line import/first
import { cacheTrip, loadTrip, loadTrips, readCachedTrip, readCachedTrips } from './tripCache';

const trip = (id: string, startDate = '2026-09-27', endDate = '2026-09-29'): Trip => ({
  id,
  destination: `${id}, Somewhere`,
  startDate,
  endDate,
  budget: 900,
  itinerary: { tier: 'midrange', days: [] },
  userAnswers: null,
  chatSessionId: null,
});

beforeEach(() => {
  mockDisk.clear();
  mockThrowOn = 'none';
  mockGetTrip.mockReset();
  mockListTrips.mockReset();
});

test('a trip written is a trip read back', () => {
  cacheTrip(trip('lisbon'));
  const hit = readCachedTrip('lisbon');
  expect(hit?.value.destination).toBe('lisbon, Somewhere');
  expect(hit?.cachedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
});

test('a trip never cached is a miss, not a throw', () => {
  expect(readCachedTrip('kyoto')).toBeNull();
});

test('a live read is served live and cached on the way past', async () => {
  mockGetTrip.mockResolvedValue(trip('lisbon'));
  const hit = await loadTrip('lisbon');
  // cachedAt null is the signal the caller uses to decide whether to say "saved copy".
  expect(hit?.cachedAt).toBeNull();
  expect(readCachedTrip('lisbon')).not.toBeNull();
});

test('a failed read falls back to disk and says when the copy was taken', async () => {
  mockGetTrip.mockResolvedValue(trip('lisbon'));
  await loadTrip('lisbon');

  mockGetTrip.mockResolvedValue(undefined); // offline
  const hit = await loadTrip('lisbon');
  expect(hit?.value.id).toBe('lisbon');
  expect(hit?.cachedAt).not.toBeNull();
});

test('offline with nothing cached stays undefined rather than inventing a trip', async () => {
  mockGetTrip.mockResolvedValue(undefined);
  expect(await loadTrip('lisbon')).toBeUndefined();
});

test('the trips list falls back to the cache, so Home can still find the current trip', async () => {
  mockGetTrip.mockResolvedValue(trip('lisbon'));
  await loadTrip('lisbon');

  mockListTrips.mockResolvedValue(undefined);
  const hit = await loadTrips();
  expect(hit?.value.map((t) => t.id)).toEqual(['lisbon']);
  expect(hit?.cachedAt).not.toBeNull();
});

test('a live list is not replaced by the cache', async () => {
  cacheTrip(trip('stale'));
  mockListTrips.mockResolvedValue([trip('fresh')]);
  const hit = await loadTrips();
  expect(hit?.value.map((t) => t.id)).toEqual(['fresh']);
  expect(hit?.cachedAt).toBeNull();
});

// A trip deleted on the server used to live on in the cache and reappear on Home the next time
// the network dropped — offered as the trip in progress, which it no longer was.
test('a live list forgets cached trips that no longer exist', async () => {
  mockGetTrip.mockResolvedValue(trip('gone'));
  await loadTrip('gone');
  mockGetTrip.mockResolvedValue(trip('kept'));
  await loadTrip('kept');
  expect(readCachedTrips().map((c) => c.value.id).sort()).toEqual(['gone', 'kept']);

  mockListTrips.mockResolvedValue([trip('kept')]);
  await loadTrips();
  expect(readCachedTrips().map((c) => c.value.id)).toEqual(['kept']);

  // And the pruned one no longer comes back when the network next drops.
  mockListTrips.mockResolvedValue(undefined);
  expect((await loadTrips())?.value.map((t) => t.id)).toEqual(['kept']);
});

test('an empty cache and a failed list is undefined, which Home already draws', async () => {
  mockListTrips.mockResolvedValue(undefined);
  expect(await loadTrips()).toBeUndefined();
});

// The cache exists to protect a screen; it must never be the thing that breaks one.
test('a half-written file is a miss, not a crash', () => {
  mockDisk.set('lisbon.json', '{"trip":{"id"');
  expect(readCachedTrip('lisbon')).toBeNull();
});

test('a file written by an older build with no trip in it is a miss', () => {
  mockDisk.set('lisbon.json', '{"cachedAt":"2026-09-01T00:00:00.000Z"}');
  expect(readCachedTrip('lisbon')).toBeNull();
});

test('a filesystem that throws on read is a miss', () => {
  cacheTrip(trip('lisbon'));
  mockThrowOn = 'read';
  expect(readCachedTrip('lisbon')).toBeNull();
  expect(readCachedTrips()).toEqual([]);
});

test('a filesystem that throws on write loses the copy and nothing else', () => {
  mockThrowOn = 'write';
  expect(() => cacheTrip(trip('lisbon'))).not.toThrow();
  mockThrowOn = 'none';
  expect(readCachedTrip('lisbon')).toBeNull();
});

test('non-json files in the folder are ignored', () => {
  cacheTrip(trip('lisbon'));
  mockDisk.set('.DS_Store', 'junk');
  expect(readCachedTrips().map((c) => c.value.id)).toEqual(['lisbon']);
});
