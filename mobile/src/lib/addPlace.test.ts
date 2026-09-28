import type { FoundPlace, Itinerary, Stop } from '@/api/types';

import {
  addPlaceToDay,
  describePlace,
  insertionDetour,
  slotLine,
  slotPreview,
  suggestDay,
  suggestTimeOfDay,
} from './addPlace';

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

// --- describePlace -------------------------------------------------------------------------

const cafe = (extra: Partial<FoundPlace>): FoundPlace => ({
  ...place('Somewhere', 35.0, 135.77, 'cafe'),
  ...extra,
});

test('the line leads with the kind of place', () => {
  expect(describePlace(place('Trattoria', 35.0, 135.77, 'restaurant'))).toBe('Restaurant');
  expect(describePlace(place('Kiyomizu-dera', 35.0, 135.77, 'sights'))).toBe('Sight');
});

// The more specific word wins, and stacking the two produced "Coffee shop cafe".
test('a cuisine replaces the kind rather than joining it', () => {
  expect(describePlace(cafe({ category: 'restaurant', cuisine: 'italian' }))).toBe('Italian');
  expect(describePlace(cafe({ cuisine: 'coffee_shop' }))).toBe('Coffee shop');
  // Semicolons separate the kinds a venue claims; underscores are OSM's spaces.
  expect(describePlace(cafe({ cuisine: 'italian;pizza' }))).toBe('Italian');
  expect(describePlace(cafe({ cuisine: 'fish_and_chips' }))).toBe('Fish and chips');
});

test('the facts join in order, and stop at three', () => {
  expect(
    describePlace(
      cafe({ outdoorSeating: true, openingHours: 'Mo-Sa 07:00-19:00', address: 'Via di Citta 43' })
    )
  ).toBe('Cafe · outdoor seating · Mo-Sa 07:00-19:00');
});

test('the street is carried when there is room for it', () => {
  expect(describePlace(cafe({ address: 'Via di Citta 43' }))).toBe('Cafe · Via di Citta 43');
});

// A week's schedule is not a fact on one line — the card shows it in full instead.
test('a long opening-hours grammar is left out rather than swallowing the line', () => {
  const long = 'Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off';
  expect(describePlace(cafe({ openingHours: long, address: 'Via di Citta 43' }))).toBe(
    'Cafe · Via di Citta 43'
  );
});

// `false` is OSM saying no, which is not worth a line; absent is nobody having said.
test('outdoor seating appears only when it is actually there', () => {
  expect(describePlace(cafe({ outdoorSeating: false }))).toBe('Cafe');
  expect(describePlace(cafe({ outdoorSeating: undefined }))).toBe('Cafe');
});

// Empty is the honest answer, and is exactly what every added stop got before this existed.
test('a place with nothing tagged gets no line at all', () => {
  expect(describePlace(place('Nowhere', 35.0, 135.77, 'place'))).toBe('');
});

test('the added stop carries the description the search already found', () => {
  const found = cafe({ name: 'Slow Jet Coffee', outdoorSeating: true, address: 'Kiyamachi' });
  const next = addPlaceToDay(trip, 0, found, 'Morning');
  const added = next.days[0].stops.find((s) => s.name === 'Slow Jet Coffee')!;
  expect(added.note).toBe('Cafe · outdoor seating · Kiyamachi');
});

test('the slot preview reports the time it would actually get', () => {
  const preview = slotPreview(trip, 0, 'Morning');
  expect(preview.time).toMatch(/AM|PM/);
  expect(typeof preview.tight).toBe('boolean');
});

// The figure this exists to produce: not "how far is it" but "how much further does the day get".
describe('what inserting a place costs in travel', () => {
  // Between Nijo Castle (9 AM) and Gion (6 PM), so both neighbours are real.
  const between = { lat: 35.009, lng: 135.762 };

  test('reports the extra journey, not the journey', () => {
    const detour = insertionDetour(trip, 0, between, 'Afternoon');
    expect(detour).not.toBeNull();
    expect(detour!.minutes).toBeGreaterThanOrEqual(0);
    // Two legs replacing one can never beat it by more than rounding.
    expect(detour!.minutes).toBeLessThan(60);
  });

  test('a place far off the day costs more than one on the way', () => {
    const onTheWay = insertionDetour(trip, 0, between, 'Afternoon')!.minutes;
    // Arashiyama, ~11km west of both of day 0's stops.
    const wayOut = insertionDetour(trip, 0, { lat: 35.017, lng: 135.6716 }, 'Afternoon')!.minutes;
    expect(wayOut).toBeGreaterThan(onTheWay);
  });

  test('a day with one stop still measures against it', () => {
    expect(insertionDetour(trip, 1, between, 'Afternoon')!.minutes).toBeGreaterThan(0);
  });

  // An estimate with no basis is worse than a blank: this is the number somebody decides on.
  test('nothing to measure against is null, not zero', () => {
    const empty: Itinerary = { days: [{ date: '2026-10-22', weather: '', stops: [] }] };
    expect(insertionDetour(empty, 0, between, 'Afternoon')).toBeNull();
    expect(insertionDetour(trip, 9, between, 'Afternoon')).toBeNull();
  });

  // 0,0 is the Gulf of Guinea. One unresolved stop must not make every detour transatlantic.
  test('an unplaced stop is stepped over rather than travelled to', () => {
    const withGhost: Itinerary = {
      days: [
        {
          date: '2026-10-22',
          weather: '',
          stops: [stop('Nijo Castle', '9:00 AM', 35.0142, 135.7481), stop('Unresolved', '1:00 PM', 0, 0)],
        },
      ],
    };
    const detour = insertionDetour(withGhost, 0, between, 'Afternoon');
    expect(detour!.minutes).toBeLessThan(60);
  });

  test('a place with no coordinate of its own cannot be priced', () => {
    expect(insertionDetour(trip, 0, { lat: 0, lng: 0 }, 'Afternoon')).toBeNull();
  });
});

describe('the line under a slot', () => {
  test('says only what there is to say', () => {
    expect(slotLine('2:30 PM', false, null)).toBe('2:30 PM');
    expect(slotLine('2:30 PM', true, null)).toBe('2:30 PM  ·  tight fit');
  });

  test('names the mode when both new legs agree, and stays vague when they do not', () => {
    expect(slotLine('2:30 PM', false, { minutes: 7, mode: 'walk' })).toBe('2:30 PM  ·  +7 min walking');
    expect(slotLine('2:30 PM', false, { minutes: 7, mode: 'transit' })).toBe('2:30 PM  ·  +7 min travel');
    expect(slotLine('2:30 PM', false, { minutes: 7, mode: null })).toBe('2:30 PM  ·  +7 min travel');
  });

  // A place on the way costs nothing, and the absence of a figure is the message.
  test('no detour is silence, not "+0 min"', () => {
    expect(slotLine('2:30 PM', false, { minutes: 0, mode: 'walk' })).toBe('2:30 PM');
  });
});
