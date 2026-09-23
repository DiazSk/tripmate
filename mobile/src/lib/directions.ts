import { Platform } from 'react-native';

/**
 * A route to a stop, in whichever maps app the phone already has.
 *
 * Universal `https://` links rather than the `maps://` and `google.navigation:` schemes: both
 * open the native app when it is installed and fall back to the web map when it is not, and
 * neither needs an entry in `LSApplicationQueriesSchemes` or a `canOpenURL` check.
 *
 * **Coordinates, never the name.** "Lunch in Higashiyama district" is not a geocodable place, and
 * half the stops in a generated plan read like that. The lat/lng is the one thing that always
 * points at the right spot.
 *
 * **No travel mode.** Setting `walking` would be wrong for "Taxi to Kiyomizu-dera" and setting
 * `driving` wrong for everything else; both apps remember what the traveller last chose, which is
 * a better guess than either of ours.
 */
export function directionsUrl(stop: { lat: number; lng: number }): string {
  const destination = `${stop.lat},${stop.lng}`;
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?daddr=${destination}`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}
