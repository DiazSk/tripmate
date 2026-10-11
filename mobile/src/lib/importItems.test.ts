import { importItemsFrom, looksLikeDayPlan } from './importItems';

describe('importItemsFrom', () => {
  it('splits links on their own line from the rest of the text', () => {
    expect(importItemsFrom('Pastéis de Belém\nhttps://maps.app.goo.gl/abc\nLX Factory', [])).toEqual([
      { kind: 'url', url: 'https://maps.app.goo.gl/abc' },
      { kind: 'text', text: 'Pastéis de Belém\nLX Factory' },
    ]);
  });

  it('puts screenshots first', () => {
    const items = importItemsFrom('note', [{ mediaType: 'image/jpeg', data: 'AAA' }]);
    expect(items[0]).toEqual({ kind: 'image', mediaType: 'image/jpeg', data: 'AAA' });
  });

  it('is empty for whitespace only', () => {
    expect(importItemsFrom('  \n ', [])).toEqual([]);
  });
});

describe('looksLikeDayPlan', () => {
  it('reads two day headings as a plan', () => {
    expect(looksLikeDayPlan('Day 1: Alfama\nTram 28\nDay 2: Sintra')).toBe(true);
  });

  it('reads weekday headings as a plan', () => {
    expect(looksLikeDayPlan('Saturday\nBelém\nSunday\nSintra')).toBe(true);
  });

  it('does not read one heading, or a list of places, as a plan', () => {
    expect(looksLikeDayPlan('Day 1: Alfama, Belém, LX Factory')).toBe(false);
    expect(looksLikeDayPlan('Time Out Market\nLX Factory')).toBe(false);
  });
});
