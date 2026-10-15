import type { TravelerProfile } from '@/api/types';

import { accessibilityValue, dietaryValue, interestsValue, passportLines } from './profileRows';

const profile = (overrides: Partial<TravelerProfile> = {}): TravelerProfile => ({
  group: 'solo',
  explorerStyle: 'mixed',
  energy: 'moderate',
  crowds: 'mixed',
  priorities: [],
  topPriorities: [],
  dietary: { tags: [], note: '' },
  ...overrides,
});

// "1 noted" makes somebody open the sheet to learn a word that fits in the row.
test('a single dietary tag prints its own name rather than a count', () => {
  expect(dietaryValue(profile({ dietary: { tags: ['Vegetarian'], note: '' } }))).toBe('Vegetarian');
  expect(dietaryValue(profile({ dietary: { tags: ['Vegan', 'Halal'], note: '' } }))).toBe('2 noted');
});

// Dietary is the one field where being wrong means a meal somebody cannot eat, so a note with no
// tags must not read as "Nothing noted".
test('a note with no tags still says something is there', () => {
  expect(dietaryValue(profile())).toBe('Nothing noted');
  expect(dietaryValue(profile({ dietary: { tags: [], note: 'no shellfish' } }))).toBe('A note');
  // Whitespace is not an answer.
  expect(dietaryValue(profile({ dietary: { tags: [], note: '   ' } }))).toBe('Nothing noted');
});

// Tags win the row when both are present — the count is the more specific thing to show.
test('tags are what gets counted, even alongside a note', () => {
  expect(dietaryValue(profile({ dietary: { tags: ['Vegan', 'Kosher'], note: 'low salt' } }))).toBe(
    '2 noted'
  );
});

// Access needs outrank pace and interest when the plan is written, so the Review step has to
// show them even when there are none — an empty row is what lets somebody notice one is missing.
describe('access needs', () => {
  test('names the toggles rather than counting them', () => {
    expect(accessibilityValue({ stepFreeRequired: true, limitStairs: false, note: '' })).toBe(
      'Step-free routes'
    );
    expect(accessibilityValue({ stepFreeRequired: true, limitStairs: true, note: '' })).toBe(
      'Step-free routes, few stairs'
    );
    expect(accessibilityValue({ stepFreeRequired: false, limitStairs: true, note: '' })).toBe(
      'few stairs'
    );
  });

  test('a note with no toggles still says something is there', () => {
    expect(accessibilityValue({ stepFreeRequired: false, limitStairs: false, note: '' })).toBe(
      'Nothing noted'
    );
    expect(
      accessibilityValue({ stepFreeRequired: false, limitStairs: false, note: 'uses a cane' })
    ).toBe('A note');
    expect(accessibilityValue({ stepFreeRequired: false, limitStairs: false, note: '  ' })).toBe(
      'Nothing noted'
    );
  });
});

test('interests say the starred ones, else how many are chosen', () => {
  expect(interestsValue(profile({ priorities: ['Food', 'Nightlife'], topPriorities: ['Food'] }))).toBe('Food');
  expect(interestsValue(profile({ priorities: ['Food', 'Nightlife'] }))).toBe('2 chosen');
  expect(interestsValue(profile())).toBe('None chosen');
});

test('the passport splits a name into given and surname, and pads the line to 44', () => {
  const { surname, given, mrz } = passportLines('Sam de la Rivera');
  expect(given).toBe('Sam');
  expect(surname).toBe('de la Rivera');
  expect(mrz).toBe('P<TPMDE<LA<RIVERA<<SAM'.padEnd(44, '<'));
  expect(mrz).toHaveLength(44);
});

test('a one-word or missing name still makes a page', () => {
  expect(passportLines('Zoë')).toEqual({ surname: null, given: 'Zoë', mrz: 'P<TPMTRIPMATE<<ZOE'.padEnd(44, '<') });
  expect(passportLines(null).given).toBe('Traveller');
  expect(passportLines('   ').surname).toBeNull();
});
