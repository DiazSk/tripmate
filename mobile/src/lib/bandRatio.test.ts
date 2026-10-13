import { ratioToFit } from './bandRatio';

test('a tall phone keeps the photo the stack leaves, under the 0.58 ceiling', () => {
  expect(ratioToFit(874, 470)).toBeCloseTo((874 - 470) / 874, 5);
});

test('a short stack is capped at the ceiling', () => {
  expect(ratioToFit(874, 300)).toBe(0.58);
});

test('a short phone gives up photo, never below the collapsed sliver', () => {
  expect(ratioToFit(667, 470)).toBeCloseTo((667 - 470) / 667, 5);
  expect(ratioToFit(500, 470)).toBeCloseTo(132 / 500, 5);
});
