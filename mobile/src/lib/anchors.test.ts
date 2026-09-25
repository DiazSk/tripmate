import type { Anchor, Itinerary } from '@/api/types';

import { anchorCoverage, anchorKey, fitMessage, mergeAnchors } from './anchors';

function itinerary(overrides: Partial<Itinerary> = {}): Itinerary {
  return {
    days: [
      {
        date: '2026-10-22',
        weather: '',
        stops: [
          { name: 'Louvre Museum', lat: 48.8606, lng: 2.3376, cost: 0, note: '', time: '', durationLabel: '', category: 'entry' },
        ],
      },
    ],
    ...overrides,
  };
}

const anchor = (overrides: Partial<Anchor> = {}): Anchor => ({
  name: 'Louvre',
  lat: null,
  lng: null,
  priority: 'must',
  ...overrides,
});

test('anchorKey is case-, accent- and punctuation-blind, and Unicode-aware', () => {
  // Ł has no combining-diacritic decomposition (it is its own codepoint) — NFD leaves it alone,
  // and only lowercasing applies. Letters this app plans trips in (浅草寺) must survive too,
  // rather than collapsing to "" the way a [a-z0-9]-only filter would.
  expect(anchorKey('Łazienki Park')).toBe('łazienki park');
  expect(anchorKey('浅草寺')).toBe('浅草寺');
  expect(anchorKey('Café  Central!')).toBe('cafe central');
});

test('a must is placed when a stop name wraps its key', () => {
  const cov = anchorCoverage(itinerary({ anchors: [anchor({ name: 'Louvre' })] }));
  expect(cov).not.toBeNull();
  expect(cov!.placed).toEqual([{ name: 'Louvre', dayIndex: 0 }]);
  expect(cov!.missing).toEqual([]);
});

test('a must is placed when a stop lies within 150m, whatever it is called', () => {
  const cov = anchorCoverage(
    itinerary({ anchors: [anchor({ name: 'Sensō-ji', lat: 48.8605, lng: 2.3377 })] })
  );
  expect(cov!.placed).toEqual([{ name: 'Sensō-ji', dayIndex: 0 }]);
});

test('a missing must past 150m with no name match is not placed', () => {
  const cov = anchorCoverage(itinerary({ anchors: [anchor({ name: 'Eiffel Tower', lat: 48.8584, lng: 2.2945 })] }));
  expect(cov!.placed).toEqual([]);
  expect(cov!.missing).toEqual(['Eiffel Tower']);
});

test('an unplaced must with a model-given reason is explained, not missing', () => {
  const cov = anchorCoverage(
    itinerary({
      anchors: [anchor({ name: 'Eiffel Tower' })],
      unplaced: [{ name: 'Eiffel Tower', reason: 'Closed on the day the trip is there.' }],
    })
  );
  expect(cov!.unplaced).toEqual([{ name: 'Eiffel Tower', reason: 'Closed on the day the trip is there.' }]);
  expect(cov!.missing).toEqual([]);
});

test('a genuinely dropped must is missing, not explained', () => {
  const cov = anchorCoverage(itinerary({ anchors: [anchor({ name: 'Eiffel Tower' })] }));
  expect(cov!.missing).toEqual(['Eiffel Tower']);
  expect(cov!.unplaced).toEqual([]);
});

test('coverage is null when there are no musts', () => {
  expect(anchorCoverage(itinerary({ anchors: [anchor({ priority: 'want' })] }))).toBeNull();
  expect(anchorCoverage(itinerary())).toBeNull();
});

test('fitMessage matches the web copy exactly', () => {
  expect(fitMessage('Eiffel Tower')).toBe(
    'Please fit Eiffel Tower into the plan. It matters to us; drop or move something else to make room, and tell me what you changed.'
  );
});

test('mergeAnchors dedupes by key, keeps must over want', () => {
  const merged = mergeAnchors([anchor({ name: 'Louvre', priority: 'want' })], [anchor({ name: 'louvre', priority: 'must' })]);
  expect(merged).toHaveLength(1);
  expect(merged[0].priority).toBe('must');
});

test('mergeAnchors prefers a geocoded entry over a null-coordinate one, from either side', () => {
  const geocodedFirst = mergeAnchors(
    [anchor({ name: 'Louvre', lat: 48.86, lng: 2.33 })],
    [anchor({ name: 'Louvre', lat: null, lng: null })]
  );
  expect(geocodedFirst[0]).toMatchObject({ lat: 48.86, lng: 2.33 });

  const geocodedSecond = mergeAnchors(
    [anchor({ name: 'Louvre', lat: null, lng: null })],
    [anchor({ name: 'Louvre', lat: 48.86, lng: 2.33 })]
  );
  expect(geocodedSecond[0]).toMatchObject({ lat: 48.86, lng: 2.33 });
});

test('mergeAnchors keeps an unrelated place untouched', () => {
  const merged = mergeAnchors([anchor({ name: 'Louvre' })], [anchor({ name: 'Eiffel Tower' })]);
  expect(merged.map((a) => a.name).sort()).toEqual(['Eiffel Tower', 'Louvre']);
});
