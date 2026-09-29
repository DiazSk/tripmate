import {
  cityMatches,
  describeDistance,
  groupByCity,
  savedNearby,
  savedNotInPlan,
  shouldPreselect,
  toAnchor,
} from './savedPlaces';

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

describe('shouldPreselect', () => {
  it('runs on the first call, when last is null', () => {
    expect(shouldPreselect('Kyoto', null)).toBe(true);
  });
  it('does not run again for the same destination, however it is styled', () => {
    expect(shouldPreselect('Kyoto', 'kyoto')).toBe(false);
    expect(shouldPreselect('Kyoto, Japan', 'kyoto japan')).toBe(false);
  });
  it('runs again once the destination actually changes', () => {
    expect(shouldPreselect('Tokyo', 'kyoto')).toBe(true);
  });
});

/* --- the places the plan did not use --- */

const at = (name: string, city: string | null, lat: number | null, lng: number | null, source = 'screenshot') =>
  ({ id: name, name, lat, lng, city, source, url: null, createdAt: '2026-09-25T00:00:00.000Z' }) as never;

// Belém, roughly. The tower and the pastelaria are ~700m apart.
const TOWER = { lat: 38.6916, lng: -9.216 };

describe('savedNotInPlan', () => {
  const saved = [
    at('Pastéis de Belém', 'Lisbon', 38.6975, -9.2035),
    at('Time Out Market', 'Lisbon', 38.7067, -9.1459),
    at('Kinkaku-ji', 'Kyoto', 35.0394, 135.7292),
    at('some reel', 'Lisbon', null, null, 'instagram'),
  ];

  it('keeps only this city, and only what the plan left out', () => {
    const kept = savedNotInPlan(saved, [{ name: 'Time Out Market' }], 'Lisbon, Portugal');
    expect(kept.map((p) => p.name)).toEqual(['Pastéis de Belém']);
  });

  // The point of matching on `anchorKey` rather than the raw string: a plan that spells it
  // without accents must still cancel the saved place, or the list recommends what you are
  // already doing.
  it('matches a planned stop through accents and punctuation', () => {
    const kept = savedNotInPlan(saved, [{ name: 'Pasteis de Belem' }], 'Lisbon');
    expect(kept.map((p) => p.name)).toEqual(['Time Out Market']);
  });

  it('drops Instagram reminders — they are something to open, not somewhere to go', () => {
    const kept = savedNotInPlan(saved, [], 'Lisbon');
    expect(kept.some((p) => p.source === 'instagram')).toBe(false);
  });

  it('is empty when the whole pile is already planned', () => {
    expect(
      savedNotInPlan(saved, [{ name: 'Pastéis de Belém' }, { name: 'Time Out Market' }], 'Lisbon')
    ).toEqual([]);
  });
});

describe('savedNearby', () => {
  it('orders by distance from where you will be', () => {
    const near = savedNearby(
      [at('Time Out Market', 'Lisbon', 38.7067, -9.1459), at('Pastéis de Belém', 'Lisbon', 38.6975, -9.2035)],
      TOWER
    );
    expect(near.map((n) => n.place.name)).toEqual(['Pastéis de Belém', 'Time Out Market']);
    expect(near[0].metres).toBeLessThan(2000);
  });

  // A saved place with no coordinates is still one the traveller chose. It cannot be ranked, so
  // it goes last rather than being thrown away.
  it('sorts a placeless save last instead of dropping it', () => {
    const near = savedNearby(
      [at('Somewhere a friend mentioned', 'Lisbon', null, null), at('Pastéis de Belém', 'Lisbon', 38.6975, -9.2035)],
      TOWER
    );
    expect(near.map((n) => n.place.name)).toEqual(['Pastéis de Belém', 'Somewhere a friend mentioned']);
    expect(near[1].metres).toBeNull();
  });

  it('claims no distance at all when there is nowhere to measure from', () => {
    const near = savedNearby([at('Pastéis de Belém', 'Lisbon', 38.6975, -9.2035)], null);
    expect(near[0].metres).toBeNull();
  });
});

describe('describeDistance', () => {
  it('rounds to something a walker can act on, and never invents precision', () => {
    expect(describeDistance(412)).toBe('400 m');
    expect(describeDistance(2430)).toBe('2.4 km');
    expect(describeDistance(null)).toBeNull();
  });
});
