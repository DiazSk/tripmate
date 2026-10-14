import type { TripSummary } from '@/api/types';

import { isUpcoming, wallOrder } from './tripsWall';

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

test('upcoming comes first soonest-first, past follows most-recent-first', () => {
  expect(wallOrder([jaipur, kyoto, porto, lisbon], TODAY).map((t) => t.id)).toEqual(['lisbon', 'kyoto', 'porto', 'jaipur']);
  expect(wallOrder([], TODAY)).toEqual([]);
});
