import type { ReadyTrip } from '@shared/readyTrips';

import { featuredFor, filterTrips, homeIsUnreachable, paceFor, pillCounts, railsFor } from './readyTrips';

const trip = (o: Partial<ReadyTrip> & { slug: string }): ReadyTrip => ({
  title: o.slug,
  destination: o.slug,
  country: '',
  region: '',
  monument: '',
  days: 3,
  priceFrom: 1000,
  priceNote: '',
  pace: 'Balanced',
  tags: [],
  weekend: false,
  bestMonths: [],
  summary: '',
  featured: false,
  order: 1,
  itinerary: [],
  ...o,
});

const trips: ReadyTrip[] = [
  trip({ slug: 'petra', tags: ['Desert', 'History'], featured: true, order: 1, days: 3, priceFrom: 1450, pace: 'Easy pace' }),
  trip({ slug: 'lisbon', tags: ['Food', 'City', 'Coast'], weekend: true, order: 2, days: 4, priceFrom: 1200 }),
  trip({ slug: 'engadin', tags: ['Mountains', 'Winter'], order: 3, days: 5, priceFrom: 2600, pace: 'Slow' }),
  trip({ slug: 'kyoto', tags: ['History', 'City', 'Food'], featured: true, order: 4, days: 6, priceFrom: 3100, pace: 'Full days' }),
];

test('pillCounts lists All first, in PILL_ORDER, omitting zero counts', () => {
  expect(pillCounts(trips).map((p) => p.pill)).toEqual(['All', 'Desert', 'Coast', 'Food', 'Mountains', 'History', 'City', 'Winter', 'Weekend']);
  expect(pillCounts(trips)[0]).toEqual({ pill: 'All', count: 4 });
  expect(pillCounts(trips).find((p) => p.pill === 'History')?.count).toBe(2);
});

test('filterTrips: All, a tag, and Weekend', () => {
  expect(filterTrips(trips, 'All')).toHaveLength(4);
  expect(filterTrips(trips, 'Food').map((t) => t.slug)).toEqual(['lisbon', 'kyoto']);
  expect(filterTrips(trips, 'Weekend').map((t) => t.slug)).toEqual(['lisbon']);
});

test('featuredFor takes featured by order, first 5, else the first 5 by order', () => {
  expect(featuredFor(trips).map((t) => t.slug)).toEqual(['petra', 'kyoto']);
  expect(featuredFor(filterTrips(trips, 'Mountains')).map((t) => t.slug)).toEqual(['engadin']);
  const many = Array.from({ length: 7 }, (_, i) => trip({ slug: `t${i}`, order: 7 - i }));
  expect(featuredFor(many).map((t) => t.slug)).toEqual(['t6', 't5', 't4', 't3', 't2']);
});

test('railsFor groups by the rail rules, omits empty rails, keeps order', () => {
  expect(railsFor(trips).map((r) => r.title)).toEqual(['Weekends away', 'Food trips', 'Mountains and nature', 'Coast and islands', 'History and cities']);
  expect(railsFor(trips).find((r) => r.id === 'history')?.trips.map((t) => t.slug)).toEqual(['petra', 'lisbon', 'kyoto']);
  expect(railsFor(filterTrips(trips, 'Desert')).map((r) => r.title)).toEqual(['History and cities']);
  expect(railsFor([])).toEqual([]);
});

test('paceFor maps the catalogue wording and nothing else', () => {
  expect(paceFor('Easy pace')).toBe('relaxed');
  expect(paceFor('Slow')).toBe('relaxed');
  expect(paceFor('Balanced')).toBe('balanced');
  expect(paceFor('Full days')).toBe('packed');
  expect(paceFor('Frantic')).toBeNull();
});

test('homeIsUnreachable: the full-screen offline page only when there is neither a trip list nor a catalogue copy', () => {
  expect(homeIsUnreachable('offline', () => false)).toBe(true);
  expect(homeIsUnreachable('offline', () => true)).toBe(false);
  // Anything but "the server could not be reached" is Home, and never reads the disk.
  const never = () => {
    throw new Error('read the disk');
  };
  expect(homeIsUnreachable(undefined, never)).toBe(false);
  expect(homeIsUnreachable(null, never)).toBe(false);
  expect(homeIsUnreachable({ value: [], cachedAt: null }, never)).toBe(false);
});
