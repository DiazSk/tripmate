import { Stack } from 'expo-router';

/**
 * Trips is a stack of its own inside the tab, for one reason: a native navigation bar. That is what
 * gives the screen the system's large title that folds into the bar as you scroll, the search bar
 * under it, and pull to refresh against the right inset. A trip still opens on the root stack
 * (`/trip/[id]`), over the tabs, as it did.
 */
export default function TripsLayout() {
  return <Stack />;
}
