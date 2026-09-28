import type { Trip } from '@/api/types';

import { tripHealth } from './health';

/**
 * The point of this file is the import at the top.
 *
 * `health.ts` reaches the web app's `planHealth` and `guardrails` through `@shared/*` rather than
 * copying them, and the whole bargain of that arrangement is that the two clients cannot drift
 * apart. If the alias stops resolving, or the shared module grows a dependency this app cannot
 * bundle, these fail rather than the phone showing a health panel that disagrees with the web's.
 *
 * (`metro.config.js` records the one way this is still not enough: Metro does not read tsconfig
 * paths, so jest and tsc can both be green while the bundler refuses. `extraNodeModules` is what
 * closes that, and only running the app proves it.)
 */
const trip = (overrides: Partial<Trip> = {}): Trip => ({
  id: 't1',
  destination: 'Kyoto',
  startDate: '2026-09-14',
  endDate: '2026-09-15',
  budget: 2000,
  status: 'saved',
  userAnswers: null,
  chatSessionId: null,
  itinerary: {
    days: [
      {
        date: '2026-09-14',
        weather: '',
        stops: [
          { name: 'A museum', lat: 35.0, lng: 135.7, cost: 20, note: '', time: '9:00 AM', durationLabel: '1 hour', category: 'entry' },
          { name: 'A garden', lat: 35.005, lng: 135.705, cost: 10, note: '', time: '11:00 AM', durationLabel: '1 hour', category: 'other' },
        ],
      },
    ],
  },
  ...overrides,
});

test('a sound plan scores what could be checked and nothing else', () => {
  const health = tripHealth(trip());
  expect(health.score).toBe(100);
  expect(health.dimensions).toHaveLength(7);
  // Not 100 — nobody ran them. A panel that scores an unrun check full marks is decoration.
  expect(health.dimensions.find((d) => d.key === 'weather')?.score).toBeNull();
});

test('the trip budget is what is scored, not the answer tree snapshot', () => {
  const health = tripHealth(trip({ budget: 5 }));
  const budget = health.dimensions.find((d) => d.key === 'budget');
  expect(budget?.score).toBe(92);
  expect(budget?.findings[0].message).toMatch(/over your \$5 budget/);
});

// `userAnswers` crosses the wire as `unknown` and is written by three clients over a trip's life.
// Anything unreadable has to degrade to "not stated" rather than throw a health panel away.
test.each([null, undefined, 'not an object', 42, []])('unreadable userAnswers degrades: %p', (answers) => {
  expect(() => tripHealth(trip({ userAnswers: answers }))).not.toThrow();
});

test('stated must-sees are read out of userAnswers and scored', () => {
  const health = tripHealth(trip({ userAnswers: { mustInclude: ['Fushimi Inari'] } }));
  const requests = health.dimensions.find((d) => d.key === 'requests');
  expect(requests?.score).toBe(92);
  expect(requests?.findings[0].message).toMatch(/Fushimi Inari/);
});
