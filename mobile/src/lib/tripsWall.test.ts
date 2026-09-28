import type { TripSummary } from '@/api/types';

import { isUpcoming, wallItems } from './tripsWall';

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
  const items = wallItems([jaipur, kyoto, porto, lisbon], TODAY);
  expect(items.filter((i) => i.kind === 'trip').map((i) => i.key)).toEqual([
    'lisbon',
    'kyoto',
    'porto',
    'jaipur',
  ]);
});

test('each section starts on a fresh row', () => {
  // One upcoming trip, so its section is odd and needs a phantom cell before "Past" begins.
  const items = wallItems([lisbon, porto, jaipur], TODAY);
  const kinds = items.map((i) => i.kind);
  expect(kinds).toEqual([
    'header', 'spacer', // Upcoming
    'trip', 'spacer', // lisbon, padded to a full row
    'header', 'spacer', // Past
    'trip', 'trip', // porto, jaipur
  ]);
});

// A label that distinguishes nothing is noise.
test('headers appear only when both sections have something in them', () => {
  expect(wallItems([jaipur, porto], TODAY).some((i) => i.kind === 'header')).toBe(false);
  expect(wallItems([lisbon, kyoto], TODAY).some((i) => i.kind === 'header')).toBe(false);
  expect(wallItems([lisbon, jaipur], TODAY).filter((i) => i.kind === 'header')).toHaveLength(2);
});

test('an empty wall is empty, not a pair of headers', () => {
  expect(wallItems([], TODAY)).toEqual([]);
});
