import type { DayPlan, Itinerary, Stop } from '@/api/types';

import { diffItineraries } from './itineraryDiff';
import { proposalRows } from './proposalRows';

const stop = (name: string, time: string): Stop => ({
  name,
  lat: 26.9,
  lng: 75.8,
  cost: 10,
  note: '',
  time,
  durationLabel: '1 hour',
  category: 'entry',
});
const day = (date: string, stops: Stop[]): DayPlan => ({ date, weather: '', stops });
const plan = (...days: DayPlan[]): Itinerary => ({ days });
const shape = (rows: ReturnType<typeof proposalRows>) => rows.map((r) => `${r.kind} ${r.stop.name} ${r.stop.time}`);

const before = plan(
  day('2026-11-07', [stop('Amber Fort', '9:00 AM'), stop('Hawa Mahal', '2:30 PM'), stop('Nahargarh Fort', '4:45 PM'), stop('Lunch', '12:30 PM')]),
  day('2026-11-08', [stop('Jal Mahal', '10:00 AM'), stop('Sisodia Garden', '1:00 PM')])
);
const after = plan(
  day('2026-11-07', [stop('Amber Fort', '9:00 AM'), stop('Hawa Mahal', '3:00 PM'), stop('Dinner at Baradari', '6:30 PM')]),
  day('2026-11-08', [stop('Jal Mahal', '10:00 AM'), stop('Nahargarh Fort', '11:00 AM'), stop('Sisodia Garden', '1:00 PM')])
);
const diff = diffItineraries(before, after);

test('the day it leaves: retimed in place, the leaver ghosted at its old time, a drop and an add', () => {
  expect(shape(proposalRows(before.days[0], after.days[0], 0, diff))).toEqual([
    'same Amber Fort 9:00 AM',
    'removed Lunch 12:30 PM',
    'retimed Hawa Mahal 3:00 PM',
    'leaving Nahargarh Fort 4:45 PM',
    'added Dinner at Baradari 6:30 PM',
  ]);
});

test('the day it lands on says where it came from and when it was', () => {
  const rows = proposalRows(before.days[1], after.days[1], 1, diff);
  expect(shape(rows)).toEqual(['same Jal Mahal 10:00 AM', 'arriving Nahargarh Fort 11:00 AM', 'same Sisodia Garden 1:00 PM']);
  expect(rows[1]).toMatchObject({ kind: 'arriving', fromDay: 0, was: '4:45 PM' });
});

test('a day the edit does not touch is every stop, unmarked', () => {
  const quiet = plan(day('2026-11-07', [stop('A', '9:00 AM')]), day('2026-11-08', [stop('B', '9:00 AM')]));
  const moved = plan(day('2026-11-07', [stop('A', '10:00 AM')]), day('2026-11-08', [stop('B', '9:00 AM')]));
  expect(shape(proposalRows(quiet.days[1], moved.days[1], 1, diffItineraries(quiet, moved)))).toEqual(['same B 9:00 AM']);
});
