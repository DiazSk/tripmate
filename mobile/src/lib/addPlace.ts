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

/** The kind of place as a noun somebody would say — singular, unlike the sheet's plural chips. */
const KINDS: Record<string, string> = {
  cafe: 'Cafe',
  restaurant: 'Restaurant',
  bar: 'Bar',
  sights: 'Sight',
  park: 'Park',
  shop: 'Shop',
  hotel: 'Hotel',
};

/**
 * `italian;pizza` → `Italian`, `coffee_shop` → `Coffee shop`.
 *
 * OSM writes cuisine as a tag value: lowercase, underscored, and semicolon-separated where a venue
 * claims several. The first is the one it leads with. Only the first letter is raised — lowercasing
 * the remainder would turn `BBQ` into `Bbq`.
 */
function tidyCuisine(cuisine: string): string {
  const first = cuisine.split(';')[0].replace(/_/g, ' ').trim();
  return first ? first[0].toUpperCase() + first.slice(1) : '';
}

/**
 * Hours longer than this are a week's schedule rather than a fact.
 *
 * `Mo-Sa 07:00-19:00` is 17 characters and belongs on a line; `Mo-Fr 08:00-18:00; Sa 09:00-14:00;
 * Su off` is 41 and would be the only thing anybody read. The long ones are still shown in full on
 * the place card, where there is room for them.
 */
const MAX_HOURS_CHARS = 24;

/** At most this many facts, so the note stays one line under the stop's name. */
const MAX_FACTS = 3;

/**
 * A stop's line, composed from what the search already found.
 *
 * **Facts only, and only facts somebody else recorded.** A generated stop's `note` is written by
 * the model, which has the trip in front of it; a hand-added one has no such context, and inventing
 * a sentence for it would put a claim in the plan nobody made. What this does instead is say what
 * OSM says — the kind of place, whether it has tables outside, when it opens, where it is.
 *
 * Empty is a real answer. Coverage is partial by nature (see `FoundPlace`), and a place with
 * nothing tagged gets `''` — exactly what every added stop got before this existed, so the row
 * simply renders no line rather than an apology for having none.
 *
 * Opening hours go in **as written**. OSM's `opening_hours` is a grammar, not a clock; turning it
 * into "open now" needs the venue's timezone and a real parser, and getting it wrong tells somebody
 * a closed door is open.
 */
export function describePlace(place: FoundPlace): string {
  // The cuisine *replaces* the kind rather than joining it. Stacking the two was the first shape
  // and it produced "Coffee shop cafe": the pair are synonyms far more often than they are
  // complements, and no cheap test tells those apart — `cafe` is not a substring of `coffee shop`.
  // Replacing loses nothing, because where a cuisine exists at all it is the more specific word of
  // the two ("Italian" over "Restaurant"). The kind still leads the other 94% of places, cuisine
  // being the thinnest-covered tag of the set.
  const lead = (place.cuisine ? tidyCuisine(place.cuisine) : '') || KINDS[place.category] || '';

  // Ordered by how much it tells you about the place, not by how often it is present: the street
  // is the best-covered tag of the set and still goes last, because "where" is the one thing the
  // map beside it already answers.
  return [
    lead,
    place.outdoorSeating ? 'outdoor seating' : '',
    place.openingHours && place.openingHours.length <= MAX_HOURS_CHARS ? place.openingHours : '',
    place.address ?? '',
  ]
    .filter(Boolean)
    .slice(0, MAX_FACTS)
    .join(' · ');
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
    // The facts the search already fetched, rather than the blank line this used to leave. They
    // were in hand at this exact moment and were being dropped — see `describePlace`.
    note: describePlace(place),
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
