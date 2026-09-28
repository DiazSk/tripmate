import type { Stop } from '@/api/types';

import { dayLegs, leaveBy, travelSummary } from './dayTravel';

const stop = (name: string, time: string, lat: number, lng: number): Stop => ({
  name,
  lat,
  lng,
  cost: 0,
  note: '',
  time,
  durationLabel: '1 hour',
  category: 'other',
});

// Central Lisbon: a few hundred metres apart, so every hop is a walk.
const near = [
  stop('Lunch', '1:00 PM', 38.7106, -9.1327),
  stop('Castle', '3:00 PM', 38.7139, -9.1335),
  stop('Walk', '5:30 PM', 38.7118, -9.1301),
];

test('every consecutive hop is priced, in order', () => {
  const legs = dayLegs(near);
  expect(legs.map((l) => l.toIndex)).toEqual([1, 2]);
  expect(legs.every((l) => l.minutes > 0)).toBe(true);
  expect(legs.every((l) => l.mode === 'walk')).toBe(true);
});

// The gutter leaves an unplaced segment empty; inventing a hop across it would put a number on
// a journey nobody is taking.
test('a pair with an unplaced end is skipped, not bridged', () => {
  const withGhost = [near[0], stop('Unresolved', '2:00 PM', 0, 0), near[2]];
  expect(dayLegs(withGhost)).toEqual([]);
});

test('one stop has no legs and a day with none still says its count', () => {
  expect(dayLegs([near[0]])).toEqual([]);
  expect(travelSummary([near[0]])).toBe('1 stop');
});

describe('the summary over the map', () => {
  test('leads with the count, then the travel the map cannot draw', () => {
    const line = travelSummary(near);
    expect(line.startsWith('3 stops  ·  ')).toBe(true);
    expect(line).toMatch(/min walking$/);
  });

  test('splits by mode, biggest first', () => {
    // A long hop out of town prices as transit; the short one stays a walk.
    const mixed = [near[0], near[1], stop('Sintra', '6:00 PM', 38.7976, -9.3905)];
    const line = travelSummary(mixed);
    const modes = [...line.matchAll(/(walking|transit|driving|cycling)/g)].map((m) => m[1]);
    expect(modes).toEqual(['transit', 'walking']);
  });

  test('an empty day is zero stops, not a crash', () => {
    expect(travelSummary([])).toBe('0 stops');
  });
});

describe('when to leave', () => {
  test('counts back from the arriving stop’s own stated time', () => {
    const at = leaveBy(near, 1);
    expect(at).toMatch(/^2:\d\d PM$/); // Castle is at 3:00 PM, a few minutes' walk away.
  });

  // A second opinion about arrival would either be noise or duplicate the conflict row.
  test('nothing to count back from is null', () => {
    expect(leaveBy(near, 0)).toBeNull();
    expect(leaveBy(near, 9)).toBeNull();
    expect(leaveBy([near[0], stop('No clock', '', 38.71, -9.13)], 1)).toBeNull();
    expect(leaveBy([near[0], stop('Unplaced', '3:00 PM', 0, 0)], 1)).toBeNull();
  });

  // `formatClock` wraps modulo a day, which would turn "leave at 23:50 yesterday" into a
  // plausible-looking late evening on this one.
  test('a departure before midnight is refused rather than wrapped', () => {
    const justAfterMidnight = [
      stop('Late', '11:00 PM', 38.7106, -9.1327),
      stop('Early', '12:01 AM', 38.7976, -9.3905),
    ];
    expect(leaveBy(justAfterMidnight, 1)).toBeNull();
  });
});
