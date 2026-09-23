import type { FoundPlace, Itinerary, Stop } from '@/api/types';

import { addPlaceToDay, slotPreview, suggestDay, suggestTimeOfDay } from './addPlace';

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

/** Day 0 sits in central Kyoto, day 1 out at Arashiyama — ~11km apart. */
const trip: Itinerary = {
  days: [
    {
      date: '2026-10-22',
      weather: '',
      stops: [stop('Nijo Castle', '9:00 AM', 35.0142, 135.7481), stop('Gion', '6:00 PM', 35.0037, 135.7788)],
    },
    { date: '2026-10-23', weather: '', stops: [stop('Bamboo Grove', '10:00 AM', 35.0170, 135.6716)] },
  ],
};

const place = (name: string, lat: number, lng: number, category: FoundPlace['category']): FoundPlace => ({
  id: name,
  name,
  lat,
  lng,
  category,
});

// The whole point of the shared import: if `@shared/*` ever stops resolving, this fails rather
// than silently falling back to something that agrees by coincidence.
test('the day is chosen by geometry, from the shared ranker', () => {
  expect(suggestDay(trip, place('Kyoto cafe', 35.0045, 135.7695, 'cafe'))).toBe(0);
  expect(suggestDay(trip, place('Arashiyama cafe', 35.0165, 135.6720, 'cafe'))).toBe(1);
});

// Null is an answer, not a failure — the caller must not point at a day it cannot justify.
test('a place nowhere near the trip gets no recommendation', () => {
  expect(suggestDay(trip, place('Sapporo bar', 43.0618, 141.3545, 'bar'))).toBeNull();
});

test('the slot is guessed from the kind of place', () => {
  expect(suggestTimeOfDay({ category: 'cafe', name: 'Slow Jet Coffee' })).toBe('Morning');
  expect(suggestTimeOfDay({ category: 'bar', name: 'Rooftop bar' })).toBe('Evening');
});

test('the insert lands in time order and gives the stop a real clock time', () => {
  const next = addPlaceToDay(trip, 0, place('Slow Jet Coffee', 35.0, 135.77, 'cafe'), 'Morning');
  const names = next.days[0].stops.map((s) => s.name);
  expect(names).toEqual(['Nijo Castle', 'Slow Jet Coffee', 'Gion']);
  expect(next.days[0].stops[1].time).toMatch(/AM|PM/);
  expect(next.days[0].stops[1].category).toBe('food');
});

// `planSlot` assumes a visit length only to space the insert; writing it onto the stop would
// state a guess as something the traveller said.
test('the added stop claims no duration', () => {
  const next = addPlaceToDay(trip, 0, place('Somewhere', 35.0, 135.77, 'park'), 'Afternoon');
  expect(next.days[0].stops.find((s) => s.name === 'Somewhere')!.durationLabel).toBe('');
});

test('the original itinerary is untouched, so a failed save can be rolled back', () => {
  const before = trip.days[0].stops.length;
  addPlaceToDay(trip, 0, place('Somewhere', 35.0, 135.77, 'park'), 'Afternoon');
  expect(trip.days[0].stops).toHaveLength(before);
});

test('a day that does not exist changes nothing', () => {
  expect(addPlaceToDay(trip, 9, place('Somewhere', 35.0, 135.77, 'park'), 'Morning')).toBe(trip);
});

test('the slot preview reports the time it would actually get', () => {
  const preview = slotPreview(trip, 0, 'Morning');
  expect(preview.time).toMatch(/AM|PM/);
  expect(typeof preview.tight).toBe('boolean');
});
