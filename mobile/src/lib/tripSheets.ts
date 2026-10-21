import { useSyncExternalStore } from 'react';

import type { ChatTurn, DayPlan, Itinerary } from '@/api/types';
import type { Sureness } from '@/lib/spend';

/**
 * What the trip screen's sheets read, published by the trip screen.
 *
 * **The sheets are routes now (`trip/[id]/budget|add|chat`), presented by the root Stack as native
 * form sheets, and the trip's state still lives in `trip/[id].tsx`.** A route cannot take props,
 * so the screen publishes the slice each sheet needs after every render and the sheet reads it
 * here. Lifting the whole screen's state into a layout would have done the same thing by moving
 * a 1,500-line component.
 *
 * They were RN `<Modal presentationStyle="pageSheet">`: large only, no grabber, unlike the
 * planner's sheets. A Modal also keeps a screen-sized `ModalHostView` in the trip screen's own
 * hierarchy, above the toolbar, until `onDismiss` (its responder claims every touch); a form-sheet
 * route is its own native screen and leaves nothing behind. The tap still lost straight after a
 * dismissal is UIKit's, not this: measured, it never reaches React Native, it happens after an
 * Alert too and on controls outside the toolbar, and a tap 0.5s later lands.
 *
 * `useSyncExternalStore` for the reason `api/placePhotos.ts` records: the React Compiler memoizes
 * a component whose inputs look unchanged, so module state must be read through this hook.
 */
export type TripSheets = {
  days: DayPlan[];
  budget: number;
  itinerary: Itinerary;
  dayIndex: number;
  offline: boolean;
  /** Where Add a stop searches by default: the day's own middle, or null for a day with no stops. */
  centre: { lat: number; lng: number } | null;
  onDay: (dayIndex: number) => void;
  onSureness: (dayIndex: number, stopIndex: number, sureness: Sureness) => void;
  onAdd: (next: Itinerary, placeName: string) => Promise<boolean>;
  turns: ChatTurn[];
  replying: boolean;
  failure: string | null;
};

const published = new Map<string, TripSheets>();
const listeners = new Set<() => void>();

export function publishTripSheets(id: string, sheets: TripSheets | null): void {
  if (sheets) published.set(id, sheets);
  else published.delete(id);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The slice for this trip, or undefined when no trip screen for it is mounted (a cold deep link). */
export function useTripSheets(id: string): TripSheets | undefined {
  return useSyncExternalStore(subscribe, () => published.get(id));
}
