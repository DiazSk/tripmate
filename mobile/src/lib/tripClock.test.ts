import type { Stop } from '@/api/types';

import { clockInZone, dayEnd, describeGap, minutesUntil, nextStop, nowInZone, todayInZone, todayState, tripClockNow } from './tripClock';
import { dayIndexFor } from './tripPhase';

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
  expect(clockInZone('Europe/Lisbon', AT)).toBe('10:07 PM');
  expect(clockInZone('Asia/Tokyo', AT)).toBe('6:07 AM');
  expect(clockInZone('America/Los_Angeles', AT)).toBe('2:07 PM');
});

// Written like every other time in the app, and never zero-padded — the display face slashes its
// zero, so "05:22" renders as "Ø5:22".
test('the clock reads the way the stop times below it do', () => {
  expect(clockInZone('Europe/Lisbon', new Date('2026-09-29T04:22:00Z'))).toBe('5:22 AM');
  expect(clockInZone('Europe/Lisbon', new Date('2026-09-28T23:10:00Z'))).toBe('12:10 AM');
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

/* --- what Today should be saying, at each boundary --- */

// The real shape of the Belém day: a 10:30 first stop with no origin, then stops that have one.
const belem = [
  stop('Jerónimos Monastery', '10:30 AM'),
  stop('Pastéis de Belém', '12:30 PM'),
  stop('Belém Tower', '2:00 PM'),
];
// Stand-in for `leaveBy`: null for the first stop, which is the real constraint — the day's
// first stop has no previous stop to depart from and lodging carries no coordinates.
const leaveByFor = (i: number) => (i === 0 ? null : ['', '12:10 PM', '1:45 PM'][i]);

const at = (h: number, m = 0) => h * 60 + m;

test('an empty day and a finished day are different answers', () => {
  expect(todayState([], at(9), leaveByFor)).toEqual({ kind: 'empty' });
  expect(todayState(belem, at(22), leaveByFor).kind).toBe('done');
});

test('a long wait is the story, not the stop', () => {
  const s = todayState(belem, at(6, 27), leaveByFor);
  expect(s.kind).toBe('free');
  if (s.kind === 'free') {
    expect(s.index).toBe(0);
    expect(describeGap(s.minutes)).toBe('4 hr 3 min');
  }
});

// The reviewer asked for "Leave by 10:03" here. It is not computable: there is no origin.
test('the first stop of a day never reports a departure time', () => {
  const s = todayState(belem, at(10), leaveByFor);
  expect(s.kind).toBe('upcoming');
  if (s.kind === 'upcoming') {
    expect(s.leaveBy).toBeNull();
    expect(s.minutes).toBe(30); // until the stop, since there is no departure to count to
  }
});

test('once there is a previous stop, the departure leads', () => {
  const s = todayState(belem, at(11, 55), leaveByFor);
  expect(s.kind).toBe('imminent');
  if (s.kind === 'imminent') {
    expect(s.leaveBy).toBe('12:10 PM');
    expect(s.minutes).toBe(15);
  }
});

test('imminent is measured to the departure, not to the stop', () => {
  // 11:35 is 55 min from the 12:30 stop but only 35 from the 12:10 departure — still upcoming.
  expect(todayState(belem, at(11, 35), leaveByFor).kind).toBe('upcoming');
  // 11:41 crosses the 30-minute departure boundary.
  expect(todayState(belem, at(11, 41), leaveByFor).kind).toBe('imminent');
});

test('the boundaries themselves', () => {
  expect(todayState(belem, at(11, 40), leaveByFor).kind).toBe('imminent'); // exactly 30
  expect(todayState(belem, at(10, 40), leaveByFor).kind).toBe('free'); // exactly 90 to 12:10
  expect(todayState(belem, at(10, 41), leaveByFor).kind).toBe('upcoming'); // 89
});

// **Late is gated on booked, not on lateness alone.** A flexible stop reached late is a day that
// slipped; a reservation you can no longer reach is the impossibility coral exists for. The window
// is real: `nextStop` keys on `at > now`, so at 12:20 the 12:30 stop is still next while its 12:10
// departure is ten minutes gone.
const booked = (name: string, time: string): Stop =>
  ({ ...stop(name, time), timeFlexibility: 'FIXED' }) as Stop;
const belemBooked = [belem[0], booked('Pastéis de Belém', '12:30 PM'), belem[2]];

test('a booked stop whose departure has passed is late, not imminent', () => {
  const s = todayState(belemBooked, at(12, 20), leaveByFor);
  expect(s.kind).toBe('late');
  if (s.kind === 'late') {
    expect(s.leaveBy).toBe('12:10 PM');
    expect(s.minutes).toBe(10); // minutes *past* the departure
  }
});

// The clamp this arm exists to see past is `Math.max(0, …)`, and everything else still needs it.
test('the same day unbooked, at the same minute, is still imminent at zero', () => {
  const s = todayState(belem, at(12, 20), leaveByFor);
  expect(s.kind).toBe('imminent');
  if (s.kind === 'imminent') expect(s.minutes).toBe(0);
});

test('a booked first stop is not late, because there is no departure to be late for', () => {
  const s = todayState([booked('Jerónimos Monastery', '10:30 AM'), belem[1]], at(10), leaveByFor);
  expect(s.kind).toBe('upcoming');
  if (s.kind === 'upcoming') expect(s.leaveBy).toBeNull();
});

test('exactly at the departure minute is imminent, not late', () => {
  expect(todayState(belemBooked, at(12, 10), leaveByFor).kind).toBe('imminent');
});

test('a stop with an unreadable time does not strand the screen', () => {
  expect(todayState([stop('Mystery', 'sometime')], at(9), leaveByFor).kind).toBe('done');
});

test('the gap reads the way somebody would say it', () => {
  expect(describeGap(45)).toBe('45 min');
  expect(describeGap(60)).toBe('1 hr');
  expect(describeGap(210)).toBe('3 hr 30 min');
  expect(describeGap(0)).toBe('0 min');
});

/* --- a day that runs past midnight stays the day until its last stop has ended --- */

const late = (name: string, time: string, durationLabel: string): Stop => ({ ...stop(name, time), durationLabel });
// Day 3 (index 2) of a five-day Lisbon trip: dinner 10 PM for 2h, then a booked 12:30 AM stop for
// 1.5h, so the night ends at 2:00 AM on the 22nd.
const night = [late('Fado', '10:00 PM', '2 hours'), late('Rooftop', '12:30 AM', '1.5 hours')];
const trip = (lastDayStops: Stop[] = night, timezone: string | null = 'Europe/Lisbon') => ({
  startDate: '2026-09-19',
  endDate: '2026-09-23',
  timezone,
  itinerary: { days: [[], [], night, [stop('Cafe', '9:00 AM')], lastDayStops].map((stops) => ({ stops })) },
});
// Lisbon is UTC+1 here, so 23:15Z on the 21st is 00:15 on the 22nd.
const lisbon = (iso: string) => new Date(`${iso}:00Z`);

test('a day ends when its last stop ends, rolled past midnight', () => {
  expect(dayEnd(night)).toBe(26 * 60);
  expect(dayEnd([late('Lunch', '12:30 PM', '1 hour')])).toBe(13 * 60 + 30);
  expect(dayEnd([stop('Mystery', 'sometime')])).toBeNull();
  expect(dayEnd([])).toBeNull();
});

test('00:15 is still day 3, and the next stop is the one after midnight', () => {
  const now = tripClockNow(trip(), lisbon('2026-09-21T23:15'))!;
  expect(now).toEqual({ today: '2026-09-21', minutes: 24 * 60 + 15 });
  expect(dayIndexFor(trip(), now.today)).toBe(2);
  expect(nextStop(night, now.minutes)).toBe(1);
  const s = todayState(night, now.minutes, () => null);
  expect(s.kind === 'upcoming' && s.index === 1 && s.minutes === 15).toBe(true);
});

test('the stop you are standing in after midnight is behind you, but the day is not over', () => {
  // 01:00: Rooftop (12:30 AM) has started; nothing follows it, so Today says done, on day 3.
  const now = tripClockNow(trip(), lisbon('2026-09-22T00:00'))!;
  expect(now.today).toBe('2026-09-21');
  expect(todayState(night, now.minutes, () => null).kind).toBe('done');
});

test('a stop after midnight keeps its departure on the rolled clock', () => {
  // Leaving for the 12:30 AM stop at 12:20 AM: 10 minutes ahead at 00:10, late at 00:25 when booked.
  const booked = [night[0], { ...night[1], timeFlexibility: 'FIXED' } as Stop];
  const leave = () => '12:20 AM';
  const s = todayState(booked, 24 * 60 + 10, leave);
  expect(s.kind === 'imminent' && s.minutes === 10).toBe(true);
  const l = todayState(booked, 24 * 60 + 25, leave);
  expect(l.kind === 'late' && l.minutes === 5).toBe(true);
});

test('02:30 is day 4: the night has ended', () => {
  const now = tripClockNow(trip(), lisbon('2026-09-22T01:30'))!;
  expect(now).toEqual({ today: '2026-09-22', minutes: 150 });
  expect(dayIndexFor(trip(), now.today)).toBe(3);
});

test('exactly at the end the new day begins', () => {
  expect(tripClockNow(trip(), lisbon('2026-09-22T01:00'))!.today).toBe('2026-09-22'); // 02:00
  expect(tripClockNow(trip(), lisbon('2026-09-22T00:59'))!.today).toBe('2026-09-21'); // 01:59
});

test('a day with no late stops hands over at midnight', () => {
  const t = { ...trip(), itinerary: { days: [[], [], [late('Dinner', '7:00 PM', '2 hours')], [stop('Cafe', '9:00 AM')], []].map((stops) => ({ stops })) } };
  expect(tripClockNow(t, lisbon('2026-09-21T23:01'))).toEqual({ today: '2026-09-22', minutes: 1 });
});

test('the last day of the trip carries past midnight instead of ending', () => {
  const t = trip(night); // day 5 is 2026-09-23
  const now = tripClockNow(t, lisbon('2026-09-23T23:15'))!;
  expect(now).toEqual({ today: '2026-09-23', minutes: 24 * 60 + 15 });
  expect(dayIndexFor(t, now.today)).toBe(4);
  // And once it has ended the trip is over, as before.
  expect(dayIndexFor(t, tripClockNow(t, lisbon('2026-09-24T01:30'))!.today)).toBeNull();
});

test('the zone decides, not the device: Tokyo is already on the 22nd', () => {
  // 23:15Z on the 21st is 08:15 on the 22nd in Tokyo; a late Lisbon night does not follow it there.
  expect(tripClockNow(trip(night, 'Asia/Tokyo'), lisbon('2026-09-21T23:15'))).toEqual({ today: '2026-09-22', minutes: 8 * 60 + 15 });
});

test('a day before the trip begins is not carried', () => {
  expect(tripClockNow(trip(), lisbon('2026-09-18T23:15'))).toEqual({ today: '2026-09-19', minutes: 15 });
});

test('no timezone is silence', () => {
  expect(tripClockNow(trip(night, null), lisbon('2026-09-21T23:15'))).toBeNull();
  expect(tripClockNow({ ...trip(), timezone: undefined }, lisbon('2026-09-21T23:15'))).toBeNull();
});
