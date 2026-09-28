import { formatDate, formatDateline, formatDayChip, formatRange } from './dayDisplay';

// The whole reason this module exists: `new Date('2026-09-19')` is UTC midnight, so a local
// formatter west of Greenwich prints the 18th. This process runs in UTC-5 to prove the port
// never reaches for one.
describe('in a timezone west of Greenwich', () => {
  const realTZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = realTZ;
  });

  test('a date-only string keeps its own day', () => {
    expect(formatDate('2026-09-19', 2026)).toBe('Sep 19');
    expect(formatDateline('2026-09-19')).toBe('Saturday, 19 September');
  });
});

test('the year is printed only when it is not the current one', () => {
  expect(formatDate('2026-09-19', 2026)).toBe('Sep 19');
  expect(formatDate('2027-09-19', 2026)).toBe("Sep 19, '27");
});

test('weekdays are correct across a century boundary and a leap year', () => {
  expect(formatDateline('2026-09-19')).toBe('Saturday, 19 September');
  expect(formatDateline('2024-02-29')).toBe('Thursday, 29 February');
  expect(formatDateline('2000-01-01')).toBe('Saturday, 1 January');
  // January counts as month 13 of the preceding year in Zeller's congruence — the branch that
  // silently breaks if the year isn't decremented with it.
  expect(formatDateline('2026-01-31')).toBe('Saturday, 31 January');
});

test('a range inside one month names the month once', () => {
  expect(formatRange('2026-09-12', '2026-09-20', 2026)).toBe('Sep 12 – 20');
});

test('a range spanning two months names both', () => {
  expect(formatRange('2026-09-28', '2026-10-03', 2026)).toBe('Sep 28 – Oct 3');
});

// The subtlety the collapse exists to avoid: same month number, a year apart. Collapsing would
// print "Sep 19 – 19" and say a trip lasted a day when it lasted a year.
test('a same-month range a year apart does not collapse', () => {
  expect(formatRange('2026-09-19', '2027-09-19', 2026)).toBe("Sep 19 – Sep 19, '27");
});

test('a non-current-year range carries the year on the end, not the start', () => {
  expect(formatRange('2027-09-19', '2027-09-23', 2026)).toBe("Sep 19 – 23, '27");
});

test('an unparseable date falls through to the raw string rather than inventing one', () => {
  expect(formatDate('not-a-date', 2026)).toBe('not-a-date');
  expect(formatDateline('2026-13-01')).toBe('2026-13-01');
  expect(formatRange('nope', '2026-09-20', 2026)).toBe('nope – 2026-09-20');
});

describe('the day strip chip', () => {
  test('names the weekday and the day of the month, and no month', () => {
    expect(formatDayChip('2026-10-22')).toEqual({ dayOfMonth: '22', weekday: 'Thu' });
    expect(formatDayChip('2026-10-25')).toEqual({ dayOfMonth: '25', weekday: 'Sun' });
  });

  // Zeller again, across the boundary it is easiest to get wrong.
  test('gets January right, where the algorithm counts back a year', () => {
    expect(formatDayChip('2027-01-01')?.weekday).toBe('Fri');
  });

  // A caller falls back to the ordinal rather than printing a wrong date beside real ones.
  test('refuses an unparseable date instead of guessing', () => {
    expect(formatDayChip('not-a-date')).toBeNull();
    expect(formatDayChip('2026-13-01')).toBeNull();
  });
});
