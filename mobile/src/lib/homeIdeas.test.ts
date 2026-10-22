import type { IdeaRead } from '@shared/ideaRead';
import type { ReadyTrip } from '@shared/readyTrips';

import {
  ideaHeadline,
  ideaPrefill,
  keywordTrips,
  matchTrips,
  prefillQuery,
  readyTripPrefill,
  suggestedBudget,
  typewriterTick,
} from './homeIdeas';

const none: IdeaRead = { destination: null, kind: null, days: null, budget: null, budgetBasis: null, adults: null, children: null, pace: null, interests: [], tags: [] };

const trip = (o: Partial<ReadyTrip> & { slug: string }): ReadyTrip => ({
  title: o.slug,
  destination: o.slug,
  country: '',
  region: '',
  monument: '',
  days: 3,
  priceFrom: 1000,
  priceNote: '',
  pace: 'Balanced',
  tags: [],
  weekend: false,
  bestMonths: [],
  summary: '',
  featured: false,
  order: 1,
  itinerary: [],
  ...o,
});

const petra = trip({
  slug: 'petra',
  title: 'Petra at first light',
  destination: 'Petra, Jordan',
  country: 'Jordan',
  region: 'Middle East',
  monument: 'PETRA',
  tags: ['Desert', 'History'],
  days: 3,
  priceFrom: 1450,
  pace: 'Easy pace',
  order: 1,
  itinerary: [
    { day: 1, theme: 'The Siq', stops: [{ name: 'The Siq', kind: 'walk', note: '' }, { name: 'Treasury', kind: 'sight', note: '' }] },
    { day: 2, theme: 'Up', stops: [{ name: 'Monastery', kind: 'sight', note: '' }] },
  ],
});
const trips = [
  petra,
  trip({ slug: 'lisbon', title: 'Lisbon weekend', destination: 'Lisbon, Portugal', country: 'Portugal', region: 'Europe', monument: 'LISBON', tags: ['Food', 'City', 'Coast'], days: 4, priceFrom: 1200, order: 2 }),
  trip({ slug: 'engadin', title: 'Engadin snow', destination: 'St. Moritz, Switzerland', country: 'Switzerland', region: 'Alps', monument: 'ENGADIN', tags: ['Mountains', 'Winter'], days: 5, priceFrom: 2600, order: 3 }),
  trip({ slug: 'kyoto', title: 'Kyoto in autumn', destination: 'Kyoto, Japan', country: 'Japan', region: 'Asia', monument: 'KYOTO', tags: ['History', 'City', 'Food'], days: 6, priceFrom: 3100, order: 4 }),
];

describe('typewriterTick', () => {
  test('typing adds a char every 45ms', () => {
    expect(typewriterTick({ line: 0, chars: 3, phase: 'typing' }, ['abcd'])).toEqual({ next: { line: 0, chars: 4, phase: 'typing' }, delayMs: 45 });
  });
  test('a full line holds for 1,800ms', () => {
    expect(typewriterTick({ line: 0, chars: 4, phase: 'typing' }, ['abcd'])).toEqual({ next: { line: 0, chars: 4, phase: 'holding' }, delayMs: 1800 });
  });
  test('holding then deletes at 20ms a char', () => {
    expect(typewriterTick({ line: 0, chars: 4, phase: 'holding' }, ['abcd'])).toEqual({ next: { line: 0, chars: 3, phase: 'deleting' }, delayMs: 20 });
    expect(typewriterTick({ line: 0, chars: 3, phase: 'deleting' }, ['abcd'])).toEqual({ next: { line: 0, chars: 2, phase: 'deleting' }, delayMs: 20 });
  });
  test('empty moves to the next line, wrapping', () => {
    expect(typewriterTick({ line: 1, chars: 0, phase: 'deleting' }, ['ab', 'cd'])).toEqual({ next: { line: 0, chars: 0, phase: 'typing' }, delayMs: 45 });
    expect(typewriterTick({ line: 0, chars: 0, phase: 'deleting' }, ['ab', 'cd'])).toEqual({ next: { line: 1, chars: 0, phase: 'typing' }, delayMs: 45 });
  });
});

describe('matchTrips', () => {
  test('a place match, dropped when over the per-person budget', () => {
    const read = { ...none, destination: 'Lisbon', budget: 3000, budgetBasis: 'whole_party' as const, adults: 2 };
    expect(matchTrips(trips, read).map((t) => t.slug)).toEqual(['lisbon']);
    expect(matchTrips(trips, { ...read, budget: 2000 }).map((t) => t.slug)).toEqual([]);
  });
  test('per_person budget is not divided', () => {
    expect(matchTrips(trips, { ...none, destination: 'Kyoto', budget: 3100, budgetBasis: 'per_person', adults: 2 }).map((t) => t.slug)).toEqual(['kyoto']);
  });
  test('folds accents and matches the reverse containment', () => {
    expect(matchTrips(trips, { ...none, destination: 'Kyōto, Japan' }).map((t) => t.slug)).toEqual(['kyoto']);
  });
  test('a shared tag is a candidate; days more than 2 apart drops it', () => {
    expect(matchTrips(trips, { ...none, tags: ['History'] }).map((t) => t.slug)).toEqual(['petra', 'kyoto']);
    expect(matchTrips(trips, { ...none, tags: ['History'], days: 6 }).map((t) => t.slug)).toEqual(['kyoto']);
  });
  test('place outscores a tag, and at most 3 return', () => {
    expect(matchTrips(trips, { ...none, destination: 'Kyoto', tags: ['Food', 'City'] }).map((t) => t.slug)[0]).toBe('kyoto');
    expect(matchTrips(trips, { ...none, tags: ['History', 'City', 'Food', 'Desert'] })).toHaveLength(3);
  });
  test('nothing known matches nothing', () => {
    expect(matchTrips(trips, none)).toEqual([]);
  });
});

describe('keywordTrips', () => {
  test('whole words of 3+ letters match the trip fields', () => {
    expect(keywordTrips(trips, 'petra and wadi rum')).toHaveLength(1);
    expect(keywordTrips(trips, 'petra and wadi rum')[0].slug).toBe('petra');
  });
  test('filler words match nothing: "and" does not find "Jaipur in pink and gold"', () => {
    const jaipur = trip({ slug: 'jaipur', title: 'Jaipur in pink and gold', destination: 'Jaipur, India', country: 'India' });
    expect(keywordTrips([...trips, jaipur], 'petra and wadi rum').map((t) => t.slug)).toEqual(['petra']);
    expect(keywordTrips([trip({ slug: 'x', title: 'Days with the family for under a week' })], 'four days with the kids for under 2000')).toEqual([]);
  });
  test('"and" never matches "Islands"', () => {
    const islands = [trip({ slug: 'x', tags: ['Islands'], title: 'Islands' })];
    expect(keywordTrips(islands, 'and')).toEqual([]);
  });
  test('matches tags, scores by hits, none gives []', () => {
    expect(keywordTrips(trips, 'food city').map((t) => t.slug)).toEqual(['lisbon', 'kyoto']);
    expect(keywordTrips(trips, 'zz qq')).toEqual([]);
  });
});

describe('ideaHeadline', () => {
  test('place, days and budget', () => {
    expect(ideaHeadline({ ...none, destination: 'Lisbon, Portugal', days: 4, budget: 1900 })).toBe("Here's a start: 4 days in Lisbon · about $1,900");
    expect(ideaHeadline({ ...none, destination: 'Lisbon', budget: 12000 })).toBe("Here's a start: Lisbon · about $12,000");
  });
  test('a kind takes no "in"', () => {
    expect(ideaHeadline({ ...none, kind: 'somewhere warm', days: 5 })).toBe("Here's a start: 5 days somewhere warm");
  });
  test('days omitted when null', () => {
    expect(ideaHeadline({ ...none, destination: 'Lisbon, Portugal' })).toBe("Here's a start: Lisbon");
  });
  test('"day" for one', () => {
    expect(ideaHeadline({ ...none, destination: 'Lisbon', days: 1 })).toBe("Here's a start: 1 day in Lisbon");
  });
});

describe('ideaPrefill', () => {
  test('dates only when days is known, today + 30', () => {
    expect(ideaPrefill({ ...none, kind: 'somewhere warm', days: 5 }, '2026-10-21')).toEqual({ start: '2026-11-20', end: '2026-11-24' });
    expect(ideaPrefill(none, '2026-10-21')).toEqual({});
  });
  test('everything the read knows', () => {
    expect(
      ideaPrefill({ ...none, destination: 'Lisbon, Portugal', days: 4, budget: 1900, adults: 2, children: 1, pace: 'relaxed', interests: ['Food', 'Nightlife'] }, '2026-10-21'),
    ).toEqual({ destination: 'Lisbon, Portugal', start: '2026-11-20', end: '2026-11-23', budget: '1900', adults: '2', children: '1', pace: 'relaxed', into: 'Food,Nightlife' });
  });
});

describe('readyTripPrefill', () => {
  test('stops in day order, pace mapped, no dates without a start', () => {
    const p = readyTripPrefill(petra, null);
    expect(p.must).toBe('The Siq, Treasury, Monastery');
    expect(p.destination).toBe('Petra, Jordan');
    expect(p.pace).toBe('relaxed');
    expect(p.start).toBeUndefined();
    expect(p.end).toBeUndefined();
  });
  test('end is start + days - 1', () => {
    expect(readyTripPrefill(petra, '2026-12-30')).toMatchObject({ start: '2026-12-30', end: '2027-01-01' });
  });
  test('a start that is not a calendar day writes no dates rather than throwing', () => {
    expect(readyTripPrefill(petra, '2026-13-40').start).toBeUndefined();
    expect(readyTripPrefill(petra, '').end).toBeUndefined();
  });
});

test('suggestedBudget is priceFrom per person', () => {
  expect(suggestedBudget(petra, 2)).toBe(2900);
  expect(suggestedBudget(petra, 0)).toBe(1450);
});

test('prefillQuery encodes each field for /plan/basics', () => {
  expect(prefillQuery({ destination: 'Lisbon, Portugal', pace: 'relaxed' })).toBe('destination=Lisbon%2C%20Portugal&pace=relaxed');
});
