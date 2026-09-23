import { suggestDayForPlace, type DayShape } from '@shared/dayFit';
import { planSlot, suggestTimeOfDay } from '@shared/daySlotting';
import type { TimeOfDay } from '@shared/timeOfDay';

import type { FoundPlace, Itinerary, Stop, StopCategory } from '@/api/types';

export type { TimeOfDay };
export { suggestTimeOfDay };

/**
 * Putting a found place into a day.
 *
 * **The judgement here is imported, not rewritten.** Which day a place belongs to
 * (`suggestDayForPlace`) and what time it should get (`planSlot`) already exist in this
 * repository as pure TypeScript with their own tests, and the Swift app already had to make a
 * second copy of both. A third copy — in the same language, in the same repo, a directory away
 * from the original — is where two clients quietly start giving different answers to the same
 * question. `metro.config.js` and the `@shared/*` path are what let this file import them
 * instead.
 *
 * What is *not* imported is `addPlaceToDay` from `activeItinerary.tsx`: it lives behind the web
 * app's own `@/` alias and inside a React context module. The insert itself is six lines.
 */

/** The shapes `suggestDayForPlace` ranks. Derived here so callers pass an itinerary, not geometry. */
export function dayShapesOf(itinerary: Itinerary): DayShape[] {
  return itinerary.days.map((day, index) => ({
    day: index,
    stops: (day.stops ?? []).map((stop) => ({ lat: stop.lat, lng: stop.lng })),
  }));
}

/**
 * The day this place most likely belongs to, or null when no day can be justified.
 *
 * Null is a real answer, not a failure: a place 80km from every stop, or a trip whose days have
 * no stops yet, has no honest recommendation. The caller shows the day list unmarked rather than
 * pointing somewhere it cannot defend.
 */
export function suggestDay(itinerary: Itinerary, place: { lat: number; lng: number }): number | null {
  return suggestDayForPlace({ lat: place.lat, lng: place.lng }, dayShapesOf(itinerary))?.day ?? null;
}

/** What the day slot would actually do — the clock time, and whether it had to squeeze. */
export function slotPreview(itinerary: Itinerary, dayIndex: number, slot: TimeOfDay) {
  return planSlot(itinerary.days[dayIndex]?.stops ?? [], slot);
}

/**
 * The search's category vocabulary, mapped onto a stop's much smaller one.
 *
 * Seven kinds of place collapse into four kinds of stop, and most of them into `other`. That is
 * not lossy by accident: `category` on a stop drives the particulars line and nothing else, so
 * "park" and "shop" genuinely are the same kind of entry in a day.
 */
function stopCategoryFor(category: string | undefined): StopCategory {
  if (category === 'cafe' || category === 'restaurant' || category === 'bar') return 'food';
  if (category === 'sights') return 'entry';
  return 'other';
}

/**
 * The itinerary with the place inserted, or the original if the day does not exist.
 *
 * Returns a new object rather than mutating, so a failed save can put the previous one back —
 * the write is a whole-itinerary PATCH and there is nothing to roll back server-side.
 *
 * `durationLabel` is deliberately left empty. `planSlot` assumes a default visit length purely to
 * space the insert, and writing that guess onto the stop would state it as a fact the traveller
 * never gave.
 */
export function addPlaceToDay(
  itinerary: Itinerary,
  dayIndex: number,
  place: FoundPlace,
  slot: TimeOfDay
): Itinerary {
  const day = itinerary.days[dayIndex];
  if (!day) return itinerary;

  const plan = planSlot(day.stops ?? [], slot);
  const stop: Stop = {
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    cost: 0,
    note: '',
    time: plan.time,
    durationLabel: '',
    category: stopCategoryFor(place.category),
  };

  const stops = [...(day.stops ?? [])];
  stops.splice(plan.index, 0, stop);

  return {
    ...itinerary,
    days: itinerary.days.map((existing, index) =>
      index === dayIndex ? { ...existing, stops } : existing
    ),
  };
}
