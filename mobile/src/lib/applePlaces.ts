import type { ApplePlace } from '../../modules/apple-places';

import type { FoundPlace, PlaceCategory } from '@/api/types';
import { metresBetween } from '@/lib/anchors';

/**
 * What each of the Nearby sheet's chips asks Apple Maps for, as `MKPointOfInterestCategory` raw
 * values. The iOS 18 sight kinds (landmark, castle, fortress, monument) are listed too: an older
 * system that does not know them simply finds none of that kind.
 */
const APPLE_CATEGORIES: Record<Exclude<PlaceCategory, 'place'>, string[]> = {
  cafe: ['MKPOICategoryCafe', 'MKPOICategoryBakery'],
  restaurant: ['MKPOICategoryRestaurant'],
  bar: ['MKPOICategoryNightlife', 'MKPOICategoryBrewery', 'MKPOICategoryWinery'],
  sights: [
    'MKPOICategoryMuseum',
    'MKPOICategoryTheater',
    'MKPOICategoryAquarium',
    'MKPOICategoryZoo',
    'MKPOICategoryLandmark',
    'MKPOICategoryCastle',
    'MKPOICategoryFortress',
    'MKPOICategoryNationalMonument',
  ],
  park: ['MKPOICategoryPark', 'MKPOICategoryNationalPark', 'MKPOICategoryBeach'],
  shop: ['MKPOICategoryStore'],
  hotel: ['MKPOICategoryHotel'],
};

/** The chip's Apple categories; none (any kind of place) for no chip or the catch-all. */
export function appleCategoriesFor(category: PlaceCategory | undefined): string[] {
  return category && category !== 'place' ? APPLE_CATEGORIES[category] : [];
}

const CATEGORY_OF = new Map(
  Object.entries(APPLE_CATEGORIES).flatMap(([ours, apple]) => apple.map((a) => [a, ours as PlaceCategory] as const)),
);

/**
 * Apple's places as the sheet's `FoundPlace`s. Unnamed ones go, and so do ones further than half
 * again the search radius: a typed search's region is only a hint to MapKit, and "café" near a
 * Mumbai stop must not list a café in Pune.
 */
export function placesFromApple(items: ApplePlace[], at: { lat: number; lng: number }, radius: number): FoundPlace[] {
  return items
    .filter((p) => p.name.trim() !== '' && metresBetween(at, p) <= radius * 1.5)
    .map((p, i) => ({
      id: `apple:${i}:${p.name}`,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      category: (p.category && CATEGORY_OF.get(p.category)) || 'place',
      ...(p.address ? { address: p.address } : {}),
      ...(p.phone ? { phone: p.phone } : {}),
      ...(p.website ? { website: p.website } : {}),
    }));
}
