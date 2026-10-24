import type { ReadyTrip } from '@shared/readyTrips';

/** The Home filter pills, in the order they are drawn. */
export type Pill = 'All' | 'Desert' | 'Coast' | 'Food' | 'Mountains' | 'History' | 'City' | 'Nature' | 'Winter' | 'Islands' | 'Wine' | 'Weekend';
export const PILL_ORDER: Pill[] = ['All', 'Desert', 'Coast', 'Food', 'Mountains', 'History', 'City', 'Nature', 'Winter', 'Islands', 'Wine', 'Weekend'];

export function filterTrips(trips: ReadyTrip[], pill: Pill): ReadyTrip[] {
  if (pill === 'All') return trips;
  return trips.filter((t) => (pill === 'Weekend' ? t.weekend : t.tags.includes(pill)));
}

/** A pill with nothing under it is not offered, so a tap never lands on an empty screen. */
export function pillCounts(trips: ReadyTrip[]): { pill: Pill; count: number }[] {
  return PILL_ORDER.map((pill) => ({ pill, count: filterTrips(trips, pill).length })).filter((p) => p.pill === 'All' || p.count > 0);
}

const byOrder = (a: ReadyTrip, b: ReadyTrip) => a.order - b.order;

/** The carousel: what the catalogue flags as featured, or, if nothing in this view is, its first five. */
export function featuredFor(trips: ReadyTrip[]): ReadyTrip[] {
  const featured = trips.filter((t) => t.featured).sort(byOrder);
  return (featured.length ? featured : [...trips].sort(byOrder)).slice(0, 5);
}

export type Rail = { id: 'weekend' | 'food' | 'mountains' | 'coast' | 'history'; title: string; trips: ReadyTrip[] };

const RAILS: { id: Rail['id']; title: string; has: (t: ReadyTrip) => boolean }[] = [
  { id: 'weekend', title: 'Weekends away', has: (t) => t.weekend },
  { id: 'food', title: 'Food trips', has: (t) => t.tags.includes('Food') },
  { id: 'mountains', title: 'Mountains and nature', has: (t) => t.tags.includes('Mountains') || t.tags.includes('Nature') },
  { id: 'coast', title: 'Coast and islands', has: (t) => t.tags.includes('Coast') || t.tags.includes('Islands') },
  { id: 'history', title: 'History and cities', has: (t) => t.tags.includes('History') || t.tags.includes('City') },
];

export function railsFor(trips: ReadyTrip[]): Rail[] {
  const sorted = [...trips].sort(byOrder);
  return RAILS.map(({ id, title, has }) => ({ id, title, trips: sorted.filter(has) })).filter((r) => r.trips.length > 0);
}

export { paceFor } from '@shared/homeIdeas';

/**
 * Whether Home gives way to the full-screen offline page. Only when the trip list could not be
 * reached *and* there is no catalogue copy on disk either: with a copy, Home still has the search
 * card and the saved catalogue to offer, and "Your trips" says it could not reach TripMate. A thunk,
 * so the disk is read only on the offline path rather than on every render.
 */
export const homeIsUnreachable = (fetched: unknown, hasCatalogueCopy: () => boolean): boolean => fetched === 'offline' && !hasCatalogueCopy();
