import { cityMatches, groupByCity, toAnchor } from './savedPlaces';

const sp = (name: string, city: string | null, source = 'screenshot') =>
  ({ id: name, name, lat: null, lng: null, city, source, url: null, createdAt: '2026-09-25T00:00:00.000Z' }) as never;

describe('cityMatches', () => {
  it('matches on the part before the first comma, case-insensitively', () => {
    expect(cityMatches('Kyoto, Japan', 'kyoto')).toBe(true);
    expect(cityMatches('Kyoto, Japan', 'Kyoto, Japan')).toBe(true);
    expect(cityMatches('Kyoto', 'Kyoto, Kyoto Prefecture, Japan')).toBe(true);
  });
  it('does not match a different city or a missing one', () => {
    expect(cityMatches('Kyoto, Japan', 'Tokyo')).toBe(false);
    expect(cityMatches(null, 'Kyoto')).toBe(false);
    expect(cityMatches('Kyoto, Japan', '')).toBe(false);
  });
});

describe('groupByCity', () => {
  it('groups by city, puts "Somewhere" last, and leaves instagram reminders out of place groups', () => {
    const groups = groupByCity([sp('A', 'Kyoto, Japan'), sp('B', null), sp('C', 'Kyoto, Japan'), sp('IG', null, 'instagram')]);
    expect(groups.map((g) => [g.city, g.places.map((p) => p.name)])).toEqual([
      ['Kyoto, Japan', ['A', 'C']],
      ['Somewhere', ['B']],
    ]);
  });
});

it('toAnchor makes a want anchor from an import source', () => {
  expect(toAnchor(sp('A', 'Kyoto'))).toEqual({ name: 'A', lat: null, lng: null, priority: 'want', source: 'import' });
});
