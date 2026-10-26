import { activeCard } from './cardRail';

describe('activeCard', () => {
  test('a rail at rest is on the card it snapped to', () => {
    expect(activeCard(0, 330, 5)).toBe(0);
    expect(activeCard(660, 330, 5)).toBe(2);
  });

  test('mid-drag, the card more than half on screen wins', () => {
    expect(activeCard(160, 330, 5)).toBe(0);
    expect(activeCard(170, 330, 5)).toBe(1);
  });

  test('an overscroll bounce never focuses a card that is not there', () => {
    expect(activeCard(-40, 330, 5)).toBe(0);
    expect(activeCard(330 * 9, 330, 5)).toBe(4);
  });

  test('an empty or unmeasured rail is on its first card', () => {
    expect(activeCard(500, 330, 0)).toBe(0);
    expect(activeCard(500, 0, 5)).toBe(0);
  });
});
