import type { Anchor, SavedPlace } from '@/api/types';

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
