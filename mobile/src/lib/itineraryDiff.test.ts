import type { DayPlan, Itinerary, Stop } from '@/api/types';

import { daysUpdatedLabel, diffItineraries } from './itineraryDiff';

const stop = (name: string, time: string, cost = 10, fixed = false): Stop => ({
  name,
  lat: 38.7,
  lng: -9.1,
  cost,
  note: '',
  time,
  durationLabel: '1 hour',
  category: 'entry',
  ...(fixed ? { timeFlexibility: 'FIXED' as const } : {}),
});

const day = (date: string, stops: Stop[]): DayPlan => ({ date, weather: '', stops });

const plan = (...days: DayPlan[]): Itinerary => ({ days });

test('an answer that changes nothing is empty, and says so', () => {
  const a = plan(day('2026-10-22', [stop('Tram 15E', '09:00')]));
  const b = plan(day('2026-10-22', [stop('Tram 15E', '09:00')]));
  const d = diffItineraries(a, b);
  expect(d.empty).toBe(true);
  expect(d.stops).toEqual([]);
  expect(d.days).toEqual([]);
});

test('a stop that keeps its day but changes its clock is retimed, not moved', () => {
  const a = plan(day('2026-10-22', [stop('Jerónimos', '09:45')]));
  const b = plan(day('2026-10-22', [stop('Jerónimos', '10:15')]));
  expect(diffItineraries(a, b).stops).toEqual([
    { kind: 'retimed', name: 'Jerónimos', dayIndex: 0, time: '09:45', toTime: '10:15' },
  ]);
});

test('a stop that changes day is moved, and both days count as touched', () => {
  const a = plan(day('2026-10-22', [stop('Museum', '14:00')]), day('2026-10-23', []));
  const b = plan(day('2026-10-22', []), day('2026-10-23', [stop('Museum', '11:00')]));
  const d = diffItineraries(a, b);
  expect(d.stops).toEqual([
    { kind: 'moved', name: 'Museum', dayIndex: 0, toDayIndex: 1, time: '14:00', toTime: '11:00' },
  ]);
  expect(d.days).toEqual([0, 1]);
});

test('additions and removals are named with the day they land on or leave', () => {
  const a = plan(day('2026-10-22', [stop('Fado show', '21:00')]));
  const b = plan(day('2026-10-22', [stop('LX Factory', '15:00')]));
  const d = diffItineraries(a, b);
  expect(d.stops).toEqual([
    { kind: 'added', name: 'LX Factory', dayIndex: 0, time: '15:00' },
    { kind: 'removed', name: 'Fado show', dayIndex: 0, time: '21:00' },
  ]);
});

// A `Stop` has no id, so the name is the only identity there is. Absorbing the model's drift is
// the whole reason this shares `normalizeStopName` with the duplicate check.
test('capitalisation and punctuation drift is not a change', () => {
  const a = plan(day('2026-10-22', [stop('Jerónimos Monastery', '09:45')]));
  const b = plan(day('2026-10-22', [stop('jeronimos  monastery', '09:45')]));
  expect(diffItineraries(a, b).empty).toBe(true);
});

test('the same name twice pairs in reading order', () => {
  const a = plan(day('2026-10-22', [stop('Coffee', '08:00'), stop('Coffee', '16:00')]));
  const b = plan(day('2026-10-22', [stop('Coffee', '08:00'), stop('Coffee', '17:00')]));
  expect(diffItineraries(a, b).stops).toEqual([
    { kind: 'retimed', name: 'Coffee', dayIndex: 0, time: '16:00', toTime: '17:00' },
  ]);
});

test('spend is reported either side, and a re-cost alone is still a change', () => {
  const a = plan(day('2026-10-22', [stop('Dinner', '19:30', 45)]));
  const b = plan(day('2026-10-22', [stop('Dinner', '19:30', 80)]));
  const d = diffItineraries(a, b);
  expect([d.spendBefore, d.spendAfter]).toEqual([45, 80]);
  expect(d.stops).toEqual([]);
  // Nothing was rescheduled, but the trip got $35 more expensive — worth approving.
  expect(d.empty).toBe(false);
});

// `refusesLock` should make this unreachable. It is computed so the preview can promise it.
test('a booked stop the edit would disturb is named', () => {
  const a = plan(day('2026-10-22', [stop('Dinner reservation', '19:30', 45, true)]));
  const untouched = diffItineraries(a, plan(day('2026-10-22', [stop('Dinner reservation', '19:30', 45, true)])));
  expect(untouched.lockedTouched).toEqual([]);

  const disturbed = diffItineraries(a, plan(day('2026-10-22', [stop('Dinner reservation', '20:30', 45, true)])));
  expect(disturbed.lockedTouched).toEqual(['Dinner reservation']);
});

test('changes read in the order somebody would walk the trip', () => {
  const a = plan(
    day('2026-10-22', [stop('Late', '18:00'), stop('Early', '09:00')]),
    day('2026-10-23', [stop('Next day', '10:00')])
  );
  const b = plan(day('2026-10-22', []), day('2026-10-23', []));
  expect(diffItineraries(a, b).stops.map((c) => c.name)).toEqual(['Early', 'Late', 'Next day']);
});

describe('the line the undo bar reads', () => {
  test('names days while there are few enough to name', () => {
    expect(daysUpdatedLabel([1])).toBe('Day 2 updated');
    expect(daysUpdatedLabel([1, 3])).toBe('Days 2 and 4 updated');
  });

  test('counts them once naming them would stop being readable', () => {
    expect(daysUpdatedLabel([0, 1, 2])).toBe('3 days updated');
  });

  // A re-cost with nothing rescheduled touches no day, and the bar still has to say something.
  test('falls back when the change belongs to no particular day', () => {
    expect(daysUpdatedLabel([])).toBe('Plan updated');
  });
});

// Stored plans in this app hold "1:00 PM"; the schema and older plans hold "13:00".
describe('clock formats', () => {
  test('the same instant spelled two ways is not a change', () => {
    const a = plan(day('2026-10-22', [stop('Lunch', '13:00')]));
    const b = plan(day('2026-10-22', [stop('Lunch', '1:00 PM')]));
    expect(diffItineraries(a, b).empty).toBe(true);
  });

  test('a day reads in the order it is walked, not in alphabetical time', () => {
    const a = plan(day('2026-10-22', [stop('Late', '10:00 AM'), stop('Early', '9:00 AM')]));
    const b = plan(day('2026-10-22', []));
    expect(diffItineraries(a, b).stops.map((c) => c.name)).toEqual(['Early', 'Late']);
  });
});
