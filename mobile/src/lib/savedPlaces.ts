import type { Anchor, SavedPlace } from '@/api/types';
import { anchorKey } from './anchors';

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
