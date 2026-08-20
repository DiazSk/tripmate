import { listTrips } from "@/lib/db";
import { toTripSummary } from "@/lib/tripPayload";
import TripsView from "./TripsView";

/**
 * Server half of `/trips`: reads the saved trips and hands the list straight to the view.
 *
 * No `<Suspense>` and no `loading.tsx`, on purpose. `better-sqlite3` is synchronous, so
 * `listTrips()` has already returned by the time this function does — a boundary here would wrap
 * something that never pends and buy a fallback nobody would ever see. The round trip is what
 * this deletes: the view used to mount, fetch `/api/trips`, and only then know how many trips
 * exist, which is also the count its hero needs to choose a variant.
 *
 * What still streams in on the client is the per-trip photography (`usePlacePhoto` → Wikipedia),
 * which is genuinely slow and genuinely external. That stays where it is.
 */
export const dynamic = "force-dynamic";

export default function TripsPage() {
  return <TripsView initialTrips={listTrips().map(toTripSummary)} />;
}
