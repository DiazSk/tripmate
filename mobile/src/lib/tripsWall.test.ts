import type { TripSummary } from '@/api/types';

import { daysUntil, isUpcoming, matchesQuery, tripShelves } from './tripsWall';

const trip = (id: string, startDate: string, endDate: string): TripSummary => ({
  id,
  destination: `${id}, Somewhere`,
  startDate,
  endDate,
  budget: 1000,
});

const TODAY = '2026-10-24';

const lisbon = trip('lisbon', '2026-10-22', '2026-10-28'); // running right now
const kyoto = trip('kyoto', '2026-12-01', '2026-12-07'); // later
const jaipur = trip('jaipur', '2026-03-02', '2026-03-09'); // over
const porto = trip('porto', '2026-08-01', '2026-08-06'); // over, more recently

// A trip you are standing in the middle of is not a memory yet.
test('a trip counts as upcoming until the day after it ends', () => {
  expect(isUpcoming(lisbon, TODAY)).toBe(true);
  expect(isUpcoming(lisbon, '2026-10-28')).toBe(true);
  expect(isUpcoming(lisbon, '2026-10-29')).toBe(false);
});

test('upcoming is soonest-first, past is most-recent-first', () => {
  const { upcoming, past } = tripShelves([jaipur, kyoto, porto, lisbon], TODAY);
  expect(upcoming.map((t) => t.id)).toEqual(['lisbon', 'kyoto']);
  expect(past.map((t) => t.id)).toEqual(['porto', 'jaipur']);
  expect(tripShelves([], TODAY)).toEqual({ upcoming: [], past: [] });
});

test('search matches the destination, or the month and year it starts', () => {
  expect(matchesQuery(kyoto, 'KYO')).toBe(true);
  expect(matchesQuery(kyoto, 'somewhere')).toBe(true);
  expect(matchesQuery(kyoto, 'december 2026')).toBe(true);
  expect(matchesQuery(kyoto, 'dec 2026')).toBe(true);
  expect(matchesQuery(kyoto, 'november')).toBe(false);
  expect(matchesQuery(kyoto, '  ')).toBe(true);
});

test('days until counts calendar days, whatever the hour', () => {
  expect(daysUntil('2026-11-06', '2026-10-14')).toBe(23);
  expect(daysUntil('2026-10-15', '2026-10-14')).toBe(1);
  expect(daysUntil('2026-10-14', '2026-10-14')).toBe(0);
});
