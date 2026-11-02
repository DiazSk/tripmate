import { parseClock } from '@shared/itinerary';

import type { Stop } from '@/api/types';

import { clock, clockAP, dayActivityProps, dayFace, nextChange } from './dayActivity';
import { leaveBy } from './dayTravel';

const at = (h: number, m = 0) => h * 60 + m;
const stop = (name: string, time: string, lat: number, lng: number, fixed = false): Stop =>
  ({ name, time, lat, lng, cost: 0, note: '', durationLabel: '1 hour', category: 'other', timeFlexibility: fixed ? 'FIXED' : undefined }) as Stop;
// Located a few km apart, so every stop after the first has a leg and a time to leave by.
const stops = [stop('Fort', '9:00 AM', 26.9855, 75.8513), stop('Lunch', '12:30 PM', 26.9239, 75.8267, true), stop('Sunset', '5:15 PM', 26.9855, 75.8513)];
const day = { city: 'Jaipur', dayNumber: 3, stops, tomorrow: 'Amber' };
const leaveLunch = () => parseClock(leaveBy(stops, 1)!)!;
const epoch = (m: number) => m * 60_000;

test('clocks are never zero-padded and carry the half of the day where asked', () => {
  expect(clock(at(9, 5))).toBe('9:05');
  expect(clock(at(12, 10))).toBe('12:10');
  expect(clockAP(at(19, 30))).toBe('7:30 PM');
  expect(clockAP(at(0, 15))).toBe('12:15 AM');
});

test('free: a long gap is the figure, in hours', () => {
  const f = dayFace(day, at(9, 30), epoch);
  expect([f.kind, f.title, f.unit]).toEqual(['free', 'Lunch', 'hr free']);
  expect(f.figure).toMatch(/^\d:\d\d$/);
  expect(f.compact).toBe(`${f.figure}h`);
  expect(f.eyebrow).toBe('Next · 12:30 PM · booked');
});

test('upcoming: the figure is the clock to leave by', () => {
  const leave = leaveLunch();
  const f = dayFace(day, leave - 60, epoch);
  expect([f.kind, f.figure, f.unit]).toEqual(['upcoming', clock(leave), 'leave by']);
  expect(f.sub).toMatch(new RegExp(`^Leave by ${clockAP(leave)} · \\d+ min (walking|driving|cycling|by transit)$`));
});

test('imminent: inside 30 minutes iOS counts down to the departure itself', () => {
  const leave = leaveLunch();
  const f = dayFace(day, leave - 12, epoch);
  expect([f.kind, f.countdown, f.unit]).toEqual(['imminent', true, 'to leave']);
  expect(f.leaveAt).toBe(epoch(leave));
  expect(f.barFrom).toBe(epoch(leave - 30));
  expect(f.sub).toMatch(/^Leave in 12 min · /);
});

test('late: past the departure for a booked stop says Now, booked', () => {
  const f = dayFace(day, leaveLunch() + 5, epoch);
  expect([f.kind, f.figure, f.unit, f.compact]).toEqual(['late', 'Now', 'booked', 'Now']);
  expect(f.sub).toBe('5 min past the departure');
});

test("done: after the last stop it is the day's end, with tomorrow", () => {
  const f = dayFace(day, at(18), epoch);
  expect([f.kind, f.eyebrow, f.title, f.sub, f.unit]).toEqual(['done', 'Jaipur · day 3 done', "That's the day", '3 stops · tomorrow, Amber', 'ended']);
  expect(f.directions).toBeNull();
});

test('the first stop has no leg, so it counts to its start and gives no departure', () => {
  const f = dayFace(day, at(8, 30), epoch);
  expect([f.kind, f.figure, f.unit, f.mode]).toEqual(['upcoming', '9:00', 'starts', null]);
});

test('each change of face is found ahead of time, and the activity carries the one after it', () => {
  const leave = leaveLunch();
  expect(nextChange(day, at(9, 30))).toBe(leave - 89);
  expect(nextChange(day, leave - 60)).toBe(leave - 30);
  // Booked: straight to the late alert. A stop that can slip says "Leave now" at the departure.
  expect(nextChange(day, leave - 12)).toBe(leave + 1);
  const loose = { ...day, stops: stops.map((s) => ({ ...s, timeFlexibility: undefined })) };
  expect(nextChange(loose, leave - 12)).toBe(leave);
  expect(dayFace(loose, leave, epoch).sub).toMatch(/^Leave now · /);
  expect(nextChange(day, at(18))).toBeNull();

  const now = Date.UTC(2026, 10, 2, 3, 0, 0);
  const { props, staleAt } = dayActivityProps({ ...day, dayCount: 5, now, nowMinutes: leave - 60 });
  expect(props.day).toBe('Jaipur · Day 3 of 5');
  expect(props.face.kind).toBe('upcoming');
  expect(props.next?.kind).toBe('imminent');
  expect(staleAt?.getTime()).toBe(now + 30 * 60_000);
  expect(props.next?.leaveAt).toBe(now + 60 * 60_000);
});
