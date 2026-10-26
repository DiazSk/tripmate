import { requireOptionalNativeModule } from 'expo';

/** One place as MapKit returned it; `category` is an `MKPointOfInterestCategory` raw value. */
export type ApplePlace = {
  name: string;
  lat: number;
  lng: number;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
};

type ApplePlacesNative = {
  search(lat: number, lng: number, radius: number, query: string | null, categories: string[]): Promise<ApplePlace[]>;
};

// Absent on Android and the web, where Nearby asks the server as before.
const native = requireOptionalNativeModule<ApplePlacesNative>('ApplePlaces');

/** Apple Maps places around a point, or null where the module does not exist or the search threw. */
export async function searchApplePlaces(params: {
  lat: number;
  lng: number;
  radius: number;
  query?: string;
  categories: string[];
}): Promise<ApplePlace[] | null> {
  if (!native) return null;
  try {
    return await native.search(params.lat, params.lng, params.radius, params.query?.trim() || null, params.categories);
  } catch {
    return null;
  }
}
