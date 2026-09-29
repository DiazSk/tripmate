import type { Stop } from '@/api/types';

import { clockInZone, minutesUntil, nextStop, nowInZone, todayInZone } from './tripClock';

const stop = (name: string, time: string): Stop =>
  ({ name, time, lat: 38.7, lng: -9.1, cost: 0, note: '', durationLabel: '1 hour', category: 'other' }) as Stop;

// Stored times are "1:00 PM", not "13:00" — the schema says otherwise and the data does not.
const day = [
  stop('Jeronimos', '10:30 AM'),
  stop('Pasteis', '12:30 PM'),
  stop('Belem Tower', '2:00 PM'),
  stop('Dinner', '7:30 PM'),
];

// 2026-09-28T21:07Z. Lisbon is UTC+1 in September, Tokyo UTC+9, Los Angeles UTC-7.
const AT = new Date('2026-09-28T21:07:00Z');

test('the clock is the destination, not the device', () => {
  expect(clockInZone('Europe/Lisbon', AT)).toBe('22:07');
  expect(clockInZone('Asia/Tokyo', AT)).toBe('06:07');
  expect(clockInZone('America/Los_Angeles', AT)).toBe('14:07');
});

// The reason the timezone is stored at all: the day can differ, not just the hour.
test('the date can differ from the device date', () => {
  expect(todayInZone('Asia/Tokyo', AT)).toBe('2026-09-29');
  expect(todayInZone('America/Los_Angeles', AT)).toBe('2026-09-28');
});

test('no zone is silence, not a fallback to the device', () => {
  expect(nowInZone(null, AT)).toBeNull();
  expect(nowInZone(undefined, AT)).toBeNull();
  expect(clockInZone(null, AT)).toBeNull();
  expect(todayInZone(null, AT)).toBeNull();
});

test('a zone the engine does not know is silence too', () => {
  expect(nowInZone('Mars/Olympus_Mons', AT)).toBeNull();
  expect(todayInZone('Mars/Olympus_Mons', AT)).toBeNull();
});

test('midnight is the first minute of the day, not the 1440th', () => {
  // A cycle that reports "24" here would place midnight after every stop in the day.
  expect(nowInZone('Europe/Lisbon', new Date('2026-09-28T23:10:00Z'))).toBe(10);
});

test('the next stop is the next one to start', () => {
  expect(nextStop(day, 9 * 60)).toBe(0); // before the day begins
  expect(nextStop(day, 11 * 60)).toBe(1); // mid-morning
  expect(nextStop(day, 13 * 60)).toBe(2);
});

test('the stop you are standing in is behind you', () => {
  // 12:30 exactly: lunch has started, so the answer is what comes after lunch.
  expect(nextStop(day, 12 * 60 + 30)).toBe(2);
});

test('after the last stop the day is over, and that is not stop zero', () => {
  expect(nextStop(day, 22 * 60)).toBeNull();
  expect(nextStop([], 12 * 60)).toBeNull();
});

test('an unreadable time loses its own row rather than reordering the day', () => {
  const broken = [stop('Jeronimos', '10:30 AM'), stop('Mystery', 'sometime'), stop('Dinner', '7:30 PM')];
  expect(nextStop(broken, 11 * 60)).toBe(2);
  expect(nextStop([stop('Mystery', 'sometime')], 11 * 60)).toBeNull();
});

test('the plan order is the day, even when the clock disagrees with it', () => {
  // A plan where a later row carries an earlier time is a plan with a problem, and that problem
  // belongs to the guardrails. This must not quietly reorder it into something that looks fine.
  const odd = [stop('Late', '6:00 PM'), stop('Early', '9:00 AM')];
  expect(nextStop(odd, 10 * 60)).toBe(0);
});

test('the countdown never runs backwards', () => {
  expect(minutesUntil(day[0], 10 * 60)).toBe(30);
  expect(minutesUntil(day[0], 11 * 60)).toBe(0);
  expect(minutesUntil(undefined, 600)).toBeNull();
  expect(minutesUntil(stop('Mystery', 'sometime'), 600)).toBeNull();
});
