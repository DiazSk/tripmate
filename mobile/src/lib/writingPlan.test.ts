import type { Stop, StreamedStop } from '@/api/types';
import { STAGE_ORDER, type StageProgress } from '@shared/generationStages';
import type { RawFetch } from '@shared/types';
import { assembleDays, forecastLine, groupFills, handoffFraction, latestStop, nowLine, waitPhrase } from './writingPlan';

const stop = (name: string, lat = 38.7, lng = -9.14): Stop =>
  ({ name, lat, lng, cost: 0, note: '', time: '10:00', durationLabel: '1h' }) as Stop;
const frame = (dayIndex: number, stopIndex: number, name: string): StreamedStop => ({ dayIndex, stopIndex, date: `2026-11-1${3 + dayIndex}`, stop: stop(name) });
const stages = (over: Partial<Record<string, StageProgress['status']>>): StageProgress[] =>
  STAGE_ORDER.map((stage) => ({ stage, status: over[stage] ?? 'pending' }));

test('a chip stands for every day before the sketch or any stop lands', () => {
  const days = assembleDays([], [], {}, 6);
  expect(days).toHaveLength(6);
  expect(days.every((d) => d.theme === null && d.stops.length === 0)).toBe(true);
});

test('stops land in order whatever order the frames came in, under the sketch themes', () => {
  const days = assembleDays(
    [{ date: '2026-11-13', theme: 'First bites', area: 'Baixa', anchors: [] }],
    [frame(0, 1, 'B'), frame(0, 0, 'A'), frame(1, 0, 'C')],
    {},
    1
  );
  expect(days).toHaveLength(2);
  expect(days[0].theme).toBe('First bites');
  expect(days[0].stops.map((s) => s.name)).toEqual(['A', 'B']);
  expect(days[1].date).toBe('2026-11-14');
});

test("a day-coords correction moves the stop it names, by trimmed name, and only on its own day", () => {
  const days = assembleDays([], [frame(0, 0, 'Belém Tower '), frame(1, 0, 'Belém Tower ')], { 0: { 'Belém Tower': { lat: 38.6916, lon: -9.216 } } }, 2);
  expect(days[0].stops[0]).toMatchObject({ lat: 38.6916, lng: -9.216 });
  expect(days[1].stops[0]).toMatchObject({ lat: 38.7, lng: -9.14 });
});

test('the latest stop is the last of the last day with any, and says whether it opens its day', () => {
  const days = assembleDays([], [frame(0, 0, 'A'), frame(0, 1, 'B'), frame(1, 0, 'C')], {}, 3);
  expect(latestStop(days)).toMatchObject({ dayIndex: 1, first: true, stop: { name: 'C' } });
  expect(latestStop(assembleDays([], [], {}, 3))).toBeNull();
});

test('the line under the instruments follows the stream', () => {
  expect(nowLine(assembleDays([], [], {}, 2), 'Reading the place')).toBe('Reading the place');
  expect(nowLine(assembleDays([{ date: '', theme: 'Hills', area: '', anchors: [] }], [], {}, 2), null)).toBe('The days are sketched');
  expect(nowLine(assembleDays([{ date: '', theme: 'Hills', area: '', anchors: [] }], [frame(0, 0, 'A')], {}, 2), null)).toBe('Day 1 of 2 · Hills');
});

test('the ticks fill by weight: finished groups whole, the running one part-way, the rest empty', () => {
  const s = stages({ geocode: 'done', context: 'done', generate: 'start' });
  const fills = groupFills(s, 0.2);
  expect(fills.map((f) => f.state)).toEqual(['done', 'active', 'waiting', 'waiting']);
  expect(fills[0].fill).toBe(1);
  expect(fills[1].fill).toBeGreaterThan(0);
  expect(fills[1].fill).toBeLessThan(1);
  expect(fills[2].fill).toBe(0);
});

test('a failed review is a whole tick, not one that never fills', () => {
  const fills = groupFills(stages({ geocode: 'done', context: 'done', generate: 'done', critique: 'failed', placing: 'start' }), 0.97);
  expect(fills[2]).toEqual({ state: 'failed', fill: 1 });
});

test('the forecast reads the trip calendar in UTC and says when it is last year', () => {
  const raw = {
    dateContext: { tripDays: 2, leadTimeDays: 30, season: 'fall', days: [{ date: '2026-11-03', dayOfWeek: 'Tuesday' }] },
    weather: { available: true, historical: true, days: [{ date: '2025-11-03', tempMinC: 13.6, tempMaxC: 19.2 }] },
  } as unknown as RawFetch;
  expect(forecastLine(raw)).toBe('Tue 3, 14 to 19° · same dates last year');
  expect(forecastLine(null)).toBeNull();
});

test('the bar reaches the end when the wait does: the review after the hand-off does not count', () => {
  const all = stages({ geocode: 'done', context: 'done', generate: 'done', critique: 'pending', placing: 'pending' });
  expect(handoffFraction(all, 0.5)).toBe(1);
  expect(handoffFraction(stages({}), 0)).toBe(0);
});

test('the estimate is said in words, coarsely', () => {
  expect(waitPhrase(160)).toBe('About 3 min');
  expect(waitPhrase(120)).toBe('About 2 min');
  expect(waitPhrase(60)).toBe('About a minute');
  expect(waitPhrase(10)).toBe('Almost there');
});
