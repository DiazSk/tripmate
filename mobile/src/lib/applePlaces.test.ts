import { appleCategoriesFor, placesFromApple } from './applePlaces';

const at = { lat: 19.0544, lng: 72.8406 };

describe('appleCategoriesFor', () => {
  test('asks Apple for the kinds of place each chip means', () => {
    expect(appleCategoriesFor('cafe')).toEqual(['MKPOICategoryCafe', 'MKPOICategoryBakery']);
    expect(appleCategoriesFor('hotel')).toEqual(['MKPOICategoryHotel']);
    expect(appleCategoriesFor('sights')).toContain('MKPOICategoryMuseum');
  });

  test('no chip, or the catch-all, asks for any kind of place', () => {
    expect(appleCategoriesFor(undefined)).toEqual([]);
    expect(appleCategoriesFor('place')).toEqual([]);
  });
});

describe('placesFromApple', () => {
  test("maps Apple's categories to the app's and keeps the details Apple gave", () => {
    const [cafe] = placesFromApple(
      [{ name: 'Kala Ghoda Café', lat: 19.055, lng: 72.841, category: 'MKPOICategoryCafe', address: '10 Ropewalk Ln', phone: '+91 22', website: 'https://kgc.in' }],
      at,
      1800,
    );
    expect(cafe).toMatchObject({ name: 'Kala Ghoda Café', category: 'cafe', address: '10 Ropewalk Ln', phone: '+91 22', website: 'https://kgc.in' });
    expect(cafe.id).toMatch(/^apple:/);
  });

  test('a kind of place the app has no chip for is a plain place', () => {
    expect(placesFromApple([{ name: 'Gym', lat: 19.0545, lng: 72.8407, category: 'MKPOICategoryFitnessCenter' }], at, 1800)[0].category).toBe('place');
    expect(placesFromApple([{ name: 'Somewhere', lat: 19.0545, lng: 72.8407 }], at, 1800)[0].category).toBe('place');
  });

  test('drops unnamed places and ones well outside the search radius', () => {
    const places = placesFromApple(
      [
        { name: '', lat: 19.0545, lng: 72.8407 },
        { name: 'Near', lat: 19.06, lng: 72.845 },
        { name: 'Pune', lat: 18.52, lng: 73.85 },
      ],
      at,
      1800,
    );
    expect(places.map((p) => p.name)).toEqual(['Near']);
  });

  test('ids are unique even when two places share a name', () => {
    const places = placesFromApple(
      [
        { name: 'Café', lat: 19.055, lng: 72.841 },
        { name: 'Café', lat: 19.056, lng: 72.842 },
      ],
      at,
      1800,
    );
    expect(new Set(places.map((p) => p.id)).size).toBe(2);
  });
});
