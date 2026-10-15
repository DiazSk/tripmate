import type { Stop } from '@/api/types';

import { countdownOf, glanceFor } from './todayGlance';

// No coordinates, so no leg and no leave-by: the arms below are the clock's alone.
const stop = (name: string, time: string, fixed = false): Stop =>
  ({ name, time, lat: 0, lng: 0, cost: 0, note: '', durationLabel: '1 hour', category: 'other', timeFlexibility: fixed ? 'FIXED' : undefined }) as Stop;

const day = [stop('Fort', '9:00 AM'), stop('Lunch', '12:30 PM'), stop('Sunset', '5:15 PM')];
const at = (h: number, m = 0) => h * 60 + m;

test('the countdown is one figure and its unit', () => {
  expect(countdownOf(23)).toEqual({ value: '23', unit: 'min' });
  expect(countdownOf(120)).toEqual({ value: '2', unit: 'hr' });
  expect(countdownOf(125)).toEqual({ value: '2:05', unit: 'hr' });
});

test('mid-morning, the next stop is lunch and the place you are at is the fort', () => {
  const g = glanceFor(day, at(11, 42));
  expect(g.kind).toBe('live');
  if (g.kind !== 'live') return;
  expect(g.next.stop.name).toBe('Lunch');
  expect(g.at?.name).toBe('Fort');
  expect(g.after.map((s) => s.name)).toEqual(['Sunset']);
  expect(g.next.countdown).toEqual({ value: '48', unit: 'min' });
  expect(g.next.late).toBeNull();
});

test('a long gap says how much time is free', () => {
  const g = glanceFor(day, at(13, 0));
  expect(g.kind === 'live' && g.next.leave).toBe('Free for about 4 hr 15 min');
});

test('after the last stop there is nothing left, and an empty day says so', () => {
  expect(glanceFor(day, at(18, 0)).kind).toBe('done');
  expect(glanceFor([], at(9)).kind).toBe('empty');
});

// Located stops a few km apart, so there is a leg and a departure to miss.
const located = (name: string, time: string, lat: number, lng: number, fixed = false): Stop =>
  ({ ...stop(name, time, fixed), lat, lng }) as Stop;
const city = [located('Fort', '9:00 AM', 26.9855, 75.8513), located('Lunch', '12:30 PM', 26.9239, 75.8267, true)];

test('near the departure it counts down to leaving, and past it on a booking it says so', () => {
  const soon = glanceFor(city, at(12, 0));
  expect(soon.kind === 'live' && soon.next.leave).toMatch(/^Leave (in|now)/);
  expect(soon.kind === 'live' && soon.next.leg).toMatch(/^about \d+ min by /);

  const late = glanceFor(city, at(12, 28));
  expect(late.kind === 'live' && late.next.leave).toBe('Leave now');
  expect(late.kind === 'live' && late.next.countdown).toBeNull();
  expect(late.kind === 'live' && late.next.late).toMatch(/^Booked for 12:30 PM, \d+ min past the departure$/);
});
