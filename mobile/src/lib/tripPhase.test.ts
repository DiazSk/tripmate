import type { TripSummary } from '@/api/types';

import { dayIndexFor, pickCurrent, tripPhase } from './tripPhase';
import { isUpcoming } from './tripsWall';

const trip = (id: string, startDate: string, endDate: string): TripSummary => ({
  id,
  destination: `${id}, Somewhere`,
  startDate,
  endDate,
  budget: 1000,
});

// The real rows in the developer's tripmate.db, which is where the overlaps come from.
const lisbon = trip('lisbon', '2026-10-22', '2026-10-28');
const kyoto = trip('kyoto', '2026-10-22', '2026-10-24');
const jaipur = trip('jaipur', '2026-10-25', '2026-10-29');
const zurich = trip('zurich', '2026-08-20', '2026-08-26');

test('every boundary of the four phases', () => {
  expect(tripPhase(lisbon, '2026-10-20')).toBe('upcoming');
  expect(tripPhase(lisbon, '2026-10-21')).toBe('eve');
  expect(tripPhase(lisbon, '2026-10-22')).toBe('today'); // first morning
  expect(tripPhase(lisbon, '2026-10-25')).toBe('today');
  expect(tripPhase(lisbon, '2026-10-28')).toBe('today'); // final afternoon
  expect(tripPhase(lisbon, '2026-10-29')).toBe('past');
});

test('the eve is one day, not a window', () => {
  expect(tripPhase(lisbon, '2026-10-21')).toBe('eve');
  expect(tripPhase(lisbon, '2026-10-20')).toBe('upcoming');
});

// Month and year ends are where a naive date-1 goes wrong.
test('the eve crosses a month and a year boundary', () => {
  expect(tripPhase(trip('a', '2026-11-01', '2026-11-04'), '2026-10-31')).toBe('eve');
  expect(tripPhase(trip('b', '2027-01-01', '2027-01-04'), '2026-12-31')).toBe('eve');
  expect(tripPhase(trip('c', '2028-03-01', '2028-03-04'), '2028-02-29')).toBe('eve'); // leap
});

test("a trip you are standing in is still 'upcoming' to the wall, and that is not a contradiction", () => {
  expect(tripPhase(lisbon, '2026-10-28')).toBe('today');
  expect(isUpcoming(lisbon, '2026-10-28')).toBe(true);
});

test('dayIndexFor addresses itinerary.days directly, and is null off-trip', () => {
  expect(dayIndexFor(lisbon, '2026-10-22')).toBe(0);
  expect(dayIndexFor(lisbon, '2026-10-25')).toBe(3);
  expect(dayIndexFor(lisbon, '2026-10-28')).toBe(6);
  // Not 0 — a caller that skipped the phase check must not be handed day one.
  expect(dayIndexFor(lisbon, '2026-10-21')).toBeNull();
  expect(dayIndexFor(lisbon, '2026-10-29')).toBeNull();
});

test('the most recently started trip wins an overlap', () => {
  // Oct 26: Lisbon (from the 22nd) and Jaipur (from the 25th) both running.
  expect(pickCurrent([lisbon, jaipur], '2026-10-26')?.id).toBe('jaipur');
});

test('a shared start date is broken by the trip ending soonest', () => {
  // Oct 23: Lisbon and Kyoto both started on the 22nd — the real tie in tripmate.db.
  expect(pickCurrent([lisbon, kyoto], '2026-10-23')?.id).toBe('kyoto');
});

test('the order does not depend on the order the server returned', () => {
  const today = '2026-10-23';
  const first = pickCurrent([lisbon, kyoto], today)?.id;
  expect(pickCurrent([kyoto, lisbon], today)?.id).toBe(first);
});

test('two trips alike in every date are still resolved the same way twice', () => {
  const a = trip('aaa', '2026-10-22', '2026-10-28');
  const b = trip('bbb', '2026-10-22', '2026-10-28');
  expect(pickCurrent([a, b], '2026-10-23')?.id).toBe('aaa');
  expect(pickCurrent([b, a], '2026-10-23')?.id).toBe('aaa');
});

test('a running trip outranks another trip whose eve is today', () => {
  // Oct 24: Kyoto's last day, and Jaipur leaves tomorrow.
  expect(tripPhase(kyoto, '2026-10-24')).toBe('today');
  expect(tripPhase(jaipur, '2026-10-24')).toBe('eve');
  expect(pickCurrent([jaipur, kyoto], '2026-10-24')?.id).toBe('kyoto');
});

test('an eve is picked when nothing is running', () => {
  expect(pickCurrent([lisbon, zurich], '2026-10-21')?.id).toBe('lisbon');
});

test('nothing running and nothing tomorrow is null, not a guess', () => {
  expect(pickCurrent([lisbon, jaipur, zurich], '2026-09-28')).toBeNull();
  expect(pickCurrent([], '2026-10-23')).toBeNull();
});
