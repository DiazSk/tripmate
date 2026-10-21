import { useLocalSearchParams, useRouter } from 'expo-router';

import { AddPlaceSheet } from '@/components/add-place-sheet';
import { useTripSheets } from '@/lib/tripSheets';

/**
 * Add a stop as a form sheet over the trip. `lat`, `lng` and `name` say it was opened as "what
 * else is near this stop?" — params rather than published state, because the sheet's first render
 * decides its category from them, and a value that arrived a render later would be missed.
 */
export default function AddRoute() {
  const { id, lat, lng, name } = useLocalSearchParams<{ id: string; lat?: string; lng?: string; name?: string }>();
  const router = useRouter();
  const sheets = useTripSheets(id);
  if (!sheets) return null;
  const at = name && lat && lng ? { lat: Number(lat), lng: Number(lng), name } : null;
  return (
    <AddPlaceSheet
      onClose={router.back}
      itinerary={sheets.itinerary}
      dayIndex={sheets.dayIndex}
      centre={sheets.centre}
      at={at}
      onAdd={sheets.onAdd}
    />
  );
}
