import type { Stop } from '@/api/types';
import { timelineRows } from './sharedTimeline';

const stop = (over: Partial<Stop>): Stop => ({
  name: 'Stop',
  lat: 26.9855,
  lng: 75.8513,
  cost: 0,
  note: '',
  time: '09:00',
  durationLabel: '1 hr',
  category: 'entry',
  ...over,
});

test('ends a stop on its own clock style', () => {
  const [a, b] = timelineRows([stop({ time: '09:00', durationLabel: '2 hr 50 min' }), stop({ time: '9:30 PM', durationLabel: '45 min' })]);
  expect(a.end).toBe('11:50');
  expect(b.end).toBe('10:15 PM');
});

test('a leg that does not fit the gap is short; one that does is not', () => {
  // Amber Fort to the old city, about 11 km: far more than ten minutes either way.
  const fort = stop({ name: 'Amber Fort', lat: 26.9855, lng: 75.8513, time: '09:00', durationLabel: '2 hr 50 min' });
  const lunch = stop({ name: 'Lunch', lat: 26.9239, lng: 75.8267, time: '12:00', durationLabel: '1 hr' });
  const later = stop({ name: 'Later', lat: 26.9239, lng: 75.8267, time: '18:00' });
  const rows = timelineRows([fort, lunch, later]);
  expect(rows[0].leg).toBeNull();
  expect(rows[1].leg?.gap).toBe(10);
  expect(rows[1].leg?.short).toBe(true);
  expect(rows[2].leg?.short).toBe(false);
});

test('says nothing about fit when a clock does not parse, and nothing at all for an unplaced stop', () => {
  const rows = timelineRows([stop({ time: 'Morning' }), stop({ time: '12:00' }), stop({ lat: 0, lng: 0, time: '15:00' })]);
  expect(rows[0].end).toBeNull();
  expect(rows[1].leg?.gap).toBeNull();
  expect(rows[1].leg?.short).toBe(false);
  expect(rows[2].leg).toBeNull();
});
