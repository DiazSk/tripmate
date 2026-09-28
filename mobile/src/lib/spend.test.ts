import type { DayPlan, Stop, StopCategory } from '@/api/types';

import { anyActualSpend, budgetSegments, daySpend, spendShares, tripSpend } from './spend';

const stop = (name: string, cost: number, category: StopCategory, actualCost?: number): Stop => ({
  name,
  lat: 35.0,
  lng: 135.77,
  cost,
  note: '',
  time: '',
  durationLabel: '',
  category,
  ...(actualCost === undefined ? {} : { actualCost }),
});

const day = (stops: Stop[], lodging?: { cost: number; actualCost?: number }): DayPlan => ({
  date: '2026-10-22',
  weather: '',
  stops,
  ...(lodging ? { lodging: { name: 'Ryokan', note: '', ...lodging } } : {}),
});

// The whole point of routing through `@shared/*`: if the alias stops resolving, or the two type
// trees drift back apart, this fails here rather than red-screening on a device. Same job as the
// equivalent test in addPlace.test.ts.
test('the shared money functions are reachable and agree with each other', () => {
  const d = day([stop('Lunch', 30, 'food'), stop('Temple', 20, 'entry')]);
  expect(daySpend(d)).toBe(50);
  expect(tripSpend([d, d])).toBe(100);
});

test('a day splits into its categories, largest first', () => {
  const d = day(
    [stop('Lunch', 30, 'food'), stop('Temple', 50, 'entry'), stop('Taxi', 10, 'transit')],
    { cost: 100 }
  );
  expect(spendShares(d).map((s) => [s.label, s.amount])).toEqual([
    ['Stay', 100],
    ['Entry', 50],
    ['Food', 30],
    ['Transit', 10],
  ]);
});

// A day with no transit has nothing to say about transit. A 0% row is furniture.
test('categories with no money get no row', () => {
  const d = day([stop('Lunch', 30, 'food')]);
  expect(spendShares(d).map((s) => s.label)).toEqual(['Food']);
});

// Rounding each share on its own puts 33/33/33 on screen and a total of 99 — a total that is
// visibly not a total. Largest remainder is what makes the column add up.
test('the percentages always sum to exactly 100', () => {
  const thirds = day([
    stop('A', 10, 'food'),
    stop('B', 10, 'entry'),
    stop('C', 10, 'transit'),
  ]);
  expect(spendShares(thirds).map((s) => s.percent)).toEqual([34, 33, 33]);

  const sliver = day([stop('Big', 199.5, 'food'), stop('Tiny', 0.5, 'transit')]);
  const percents = spendShares(sliver).map((s) => s.percent);
  expect(percents.reduce((a, b) => a + b, 0)).toBe(100);

  const sevenths = day([
    stop('A', 1, 'food'),
    stop('B', 1, 'entry'),
    stop('C', 1, 'transit'),
    stop('D', 4, 'other'),
  ]);
  expect(spendShares(sevenths).reduce((a, s) => a + s.percent, 0)).toBe(100);
});

// The fractions are the true proportions and drive the band's widths — they are never the
// rounded percentages, or a 34% slice would be drawn wider than it is.
test('the fractions stay exact while the percentages round', () => {
  const d = day([stop('A', 10, 'food'), stop('B', 20, 'entry')]);
  const shares = spendShares(d);
  expect(shares.reduce((a, s) => a + s.fraction, 0)).toBeCloseTo(1);
  expect(shares.find((s) => s.label === 'Food')!.fraction).toBeCloseTo(1 / 3);
});

// This is the defect that motivated the whole module: day-page.tsx summed `cost` and ignored
// `actualCost`, so a real spend entered on the web moved the web's figures and not this app's.
test('a real spend overrides the estimate, in the total and in the shares', () => {
  const d = day([stop('Dinner', 40, 'food', 90), stop('Temple', 20, 'entry')]);
  expect(daySpend(d)).toBe(110);
  expect(spendShares(d).find((s) => s.label === 'Food')!.amount).toBe(90);
});

test('a lodging actual overrides its estimate too', () => {
  const d = day([], { cost: 100, actualCost: 150 });
  expect(daySpend(d)).toBe(150);
  expect(spendShares(d)).toEqual([
    { key: 'stay', label: 'Stay', amount: 150, fraction: 1, percent: 100 },
  ]);
});

// Empty is a real answer — the breakdown draws nothing rather than five zeroes.
test('a day that costs nothing has no shares at all', () => {
  expect(spendShares(day([stop('Free walk', 0, 'other')]))).toEqual([]);
  expect(daySpend(day([]))).toBe(0);
});

test('the budget bar spans one segment per spending day, in order', () => {
  const days = [day([stop('A', 250, 'food')]), day([stop('B', 250, 'entry')])];
  const segments = budgetSegments(days, 1000);
  expect(segments.map((s) => [s.dayIndex, s.width, s.left])).toEqual([
    [0, 25, 0],
    [1, 25, 25],
  ]);
});

// A day nobody spent on would still draw its separator — a hairline on the bar marking nothing.
test('a day with no spend gets no segment', () => {
  const days = [day([stop('A', 100, 'food')]), day([]), day([stop('C', 100, 'entry')])];
  expect(budgetSegments(days, 1000).map((s) => s.dayIndex)).toEqual([0, 2]);
});

// The bar has one denominator, always the budget. Over it, the days fill in order and the day
// that crosses is drawn partial; the rest get nothing. "The budget ran out on day two."
test('the segments stop where the budget runs out, and never exceed the track', () => {
  const days = [day([stop('A', 800, 'food')]), day([stop('B', 800, 'food')]), day([stop('C', 800, 'food')])];
  const segments = budgetSegments(days, 1000);
  expect(segments.map((s) => s.dayIndex)).toEqual([0, 1]);
  expect(segments.reduce((a, s) => a + s.width, 0)).toBe(100);
  // The truncated day still reports what it really cost — the readout is not the geometry.
  expect(segments[1].spend).toBe(800);
});

test('no budget means no bar to draw', () => {
  expect(budgetSegments([day([stop('A', 100, 'food')])], 0)).toEqual([]);
});

// The budget bar's label turns on this: `tripSpend` coalesces `actualCost ?? cost`, so one
// figure means "forecast" or "receipt" and only this can tell them apart.
describe('whether any real spend has been entered', () => {
  test('a plan nobody has spent against is still a projection', () => {
    expect(anyActualSpend([day([stop('Lunch', 30, 'food')], { cost: 100 })])).toBe(false);
  });

  test('one actual figure on one stop is enough', () => {
    expect(anyActualSpend([day([stop('Lunch', 30, 'food', 41)])])).toBe(true);
  });

  // Lodging is the easy one to forget: it is money, and it is not in `stops`.
  test('an actual on the lodging counts too', () => {
    expect(anyActualSpend([day([stop('Lunch', 30, 'food')], { cost: 100, actualCost: 120 })])).toBe(
      true
    );
  });

  // Zero is a real figure somebody entered — "it turned out to be free" is not "unknown".
  test('an actual of zero is an answer, not an absence', () => {
    expect(anyActualSpend([day([stop('Park', 10, 'entry', 0)])])).toBe(true);
  });
});
