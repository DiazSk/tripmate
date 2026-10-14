import {
  closestTier,
  estimateTotal,
  perPersonBudget,
  isEndBeforeStart,
  isTripTooLong,
  TIERS,
  tripDays,
} from './tiers';

test('an estimate charges every day but one fewer night', () => {
  // 7 days is 6 nights: 150*7 + 150*6.
  expect(estimateTotal(TIERS[1], 7)).toBe(1950);
  // A single day has no nights at all.
  expect(estimateTotal(TIERS[1], 1)).toBe(150);
});

test('the tier is whichever estimate lands nearest the budget', () => {
  // Over 7 days the estimates are 730 / 1950 / 5450.
  expect(closestTier(700, 7)).toBe('budget');
  expect(closestTier(2400, 7)).toBe('midrange');
  expect(closestTier(6000, 7)).toBe('luxury');
});

// The comparison is strictly `<`, so the first tier to claim a distance keeps it. This is the
// web's behaviour at an exact midpoint rather than an accident of it, which is why it has a test.
test('an exact midpoint between two tiers goes to the earlier one', () => {
  const midpoint = (estimateTotal(TIERS[0], 7) + estimateTotal(TIERS[1], 7)) / 2;
  expect(midpoint).toBe(1340);
  expect(closestTier(midpoint, 7)).toBe('budget');
});

// A couple's $4,200 for six days is $350 a day each, Mid-range; matched whole it read as Luxury.
test('a whole-party budget is priced per person, infants included', () => {
  const couple = { adults: 2, children: 0, infants: 0 };
  expect(perPersonBudget(4200, 'whole_party', couple)).toBe(2100);
  expect(perPersonBudget(4200, 'per_person', couple)).toBe(4200);
  expect(perPersonBudget(3000, 'whole_party', { adults: 2, children: 0, infants: 1 })).toBe(1000);
  expect(closestTier(perPersonBudget(4200, 'whole_party', couple), 6)).toBe('midrange');
});

test('a zero budget still yields a tier rather than nothing', () => {
  expect(closestTier(0, 3)).toBe('budget');
});

test('day counts are inclusive and floored at one', () => {
  expect(tripDays('2026-09-12', '2026-09-14')).toBe(3);
  expect(tripDays('2026-09-12', '2026-09-12')).toBe(1);
  // End before start would be zero or negative; the floor holds it at one.
  expect(tripDays('2026-09-14', '2026-09-12')).toBe(1);
});

test('day counts cross a month and a year boundary correctly', () => {
  expect(tripDays('2026-09-28', '2026-10-03')).toBe(6);
  expect(tripDays('2026-12-30', '2027-01-02')).toBe(4);
  // 2028 is a leap year: Feb 28 → Mar 1 is three days, not two.
  expect(tripDays('2028-02-28', '2028-03-01')).toBe(3);
});

// The whole reason dates are split rather than parsed: a Date built from a date-only string is
// UTC midnight, and reading it back locally west of Greenwich lands on the previous day.
describe('in a timezone west of Greenwich', () => {
  const realTZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = realTZ;
  });

  test('a day count does not drift', () => {
    expect(tripDays('2026-09-12', '2026-09-14')).toBe(3);
    expect(tripDays('2026-09-12', '2026-09-12')).toBe(1);
  });
});

test('an unparseable date yields one day rather than NaN', () => {
  expect(tripDays('nonsense', '2026-09-14')).toBe(1);
  expect(tripDays('2026-13-01', '2026-09-14')).toBe(1);
});

test('the 30-day cap is exclusive of 30 itself', () => {
  expect(isTripTooLong('2026-09-01', '2026-09-30')).toBe(false); // exactly 30
  expect(isTripTooLong('2026-09-01', '2026-10-01')).toBe(true); // 31
});

test('end-before-start is only claimed when both dates parse', () => {
  expect(isEndBeforeStart('2026-09-14', '2026-09-12')).toBe(true);
  expect(isEndBeforeStart('2026-09-12', '2026-09-14')).toBe(false);
  expect(isEndBeforeStart('2026-09-12', '2026-09-12')).toBe(false);
  // A half-typed date is not an error to show somebody mid-keystroke.
  expect(isEndBeforeStart('', '2026-09-12')).toBe(false);
  expect(isEndBeforeStart('2026-09-12', '')).toBe(false);
});
