import { Itinerary, Stop } from "./types";

/** Matches by name+lat+lng rather than object identity — callers often hold a
 *  Stop reference that's a structural copy of the one inside `itinerary`. */
export function findStopLocation(
  itinerary: Itinerary,
  stop: Stop
): { dayIndex: number; stopIndex: number } | null {
  for (let d = 0; d < itinerary.days.length; d++) {
    const s = itinerary.days[d].stops.findIndex(
      (x) => x.name === stop.name && x.lat === stop.lat && x.lng === stop.lng
    );
    if (s !== -1) return { dayIndex: d, stopIndex: s };
  }
  return null;
}

/** Remaining stops for the same day, after the given stop — used to power the
 *  "Next Up" quick-navigation list in PlaceDetailPanel. */
export function upcomingStopsAfter(itinerary: Itinerary, stop: Stop): Stop[] {
  const loc = findStopLocation(itinerary, stop);
  if (!loc) return [];
  return itinerary.days[loc.dayIndex].stops.slice(loc.stopIndex + 1);
}
