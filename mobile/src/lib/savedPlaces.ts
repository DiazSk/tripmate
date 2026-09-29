import type { Anchor, SavedPlace } from '@/api/types';
import { anchorKey, metresBetween } from './anchors';

const cityPart = (s: string) => s.split(',')[0].trim().toLowerCase();

/** "Kyoto" matches places saved under "Kyoto, Japan". The part before the first comma is the city. */
export function cityMatches(city: string | null, destination: string): boolean {
  if (!city || !destination.trim()) return false;
  return cityPart(city) === cityPart(destination);
}

/** Places by city for the saved-places section. Instagram reminders are listed separately. */
export function groupByCity(places: SavedPlace[]): { city: string; places: SavedPlace[] }[] {
  const groups = new Map<string, SavedPlace[]>();
  for (const p of places) {
    if (p.source === 'instagram') continue;
    const key = p.city ?? 'Somewhere';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'Somewhere' ? 1 : b === 'Somewhere' ? -1 : 0))
    .map(([city, list]) => ({ city, places: list }));
}

export function toAnchor(p: SavedPlace): Anchor {
  return { name: p.name, lat: p.lat, lng: p.lng, priority: 'want', source: 'import' };
}

/**
 * Whether the pre-select effect should run for this destination. `last` is the destination it
 * last ran for (`null` before the first run) — comparing by `anchorKey` rather than the raw string
 * means "Kyoto" and "kyoto " count as the same destination, not two separate pre-selects.
 *
 * This is what stops a refetch (a place shared while the wizard was backgrounded) from re-adding
 * a chip the traveller had just deselected: the effect that calls this also fires whenever
 * `useFocusedFetch` delivers fresh data, with the destination unchanged.
 */
export function shouldPreselect(destination: string, last: string | null): boolean {
  return anchorKey(destination) !== last;
}

/**
 * A saved place the plan never used, and how far it is from where you will be.
 *
 * `metres` is null when the place has no coordinates — an Instagram reminder or a hand-typed
 * name that never geocoded. Those are real saved places and they still belong on the list; what
 * they cannot claim is a distance.
 */
export interface SavedNearby {
  place: SavedPlace;
  metres: number | null;
}

/**
 * The places this traveller saved for this city that did not make it into the plan.
 *
 * **The whole point is the ones that did *not* make it.** Places imported from a share or a
 * screenshot are offered once, at plan time, by the wizard — and then they are gone from the
 * app, whether the planner picked them or not. `AnchorReceipt` covers the named must-sees and
 * says nothing about this pile. So a place somebody deliberately saved for Lisbon, which the
 * planner left out, is invisible on the trip it was saved for.
 *
 * Matched by `anchorKey` rather than raw string, so "Pastéis de Belém" in the plan cancels
 * "Pasteis de Belem" in the pile — the same normalisation `anchorCoverage` uses to decide
 * whether an anchor was placed, and for the same reason.
 *
 * Instagram reminders are dropped by `groupByCity` and are dropped here too: they carry a URL
 * and usually no place at all, so they are something to open later rather than somewhere to go.
 */
export function savedNotInPlan(
  places: SavedPlace[],
  planned: { name: string }[],
  destination: string
): SavedPlace[] {
  const inPlan = new Set(planned.map((s) => anchorKey(s.name)));
  return places.filter(
    (p) =>
      p.source !== 'instagram' &&
      cityMatches(p.city, destination) &&
      !inPlan.has(anchorKey(p.name))
  );
}

/**
 * Those places ordered by how far they are from a point, nearest first.
 *
 * **Placeless ones sort last rather than being dropped.** A saved place with no coordinates is
 * still a thing the traveller chose; it simply cannot be ranked, and putting it at the end says
 * that without throwing it away. `Infinity` rather than a sentinel so the comparison is the
 * ordinary one.
 *
 * `from` is null on a day whose next stop has no coordinates, in which case nothing can be
 * ranked and the saved order stands.
 */
export function savedNearby(
  places: SavedPlace[],
  from: { lat: number; lng: number } | null
): SavedNearby[] {
  const withDistance = places.map((place) => ({
    place,
    metres:
      from && typeof place.lat === 'number' && typeof place.lng === 'number'
        ? Math.round(metresBetween(from, { lat: place.lat, lng: place.lng }))
        : null,
  }));
  return withDistance.sort((a, b) => (a.metres ?? Infinity) - (b.metres ?? Infinity));
}

/** "400 m" / "2.4 km" — near enough to decide whether to walk, and never false precision. */
export function describeDistance(metres: number | null): string | null {
  if (metres === null) return null;
  if (metres < 1000) return `${Math.round(metres / 50) * 50} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}
