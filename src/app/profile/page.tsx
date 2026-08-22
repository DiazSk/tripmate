import { listTrips, readProfile } from "@/lib/db";
import { toTripSummary } from "@/lib/tripPayload";
import ProfileForm from "./ProfileForm";

/**
 * Server half of `/profile`: reads the saved traveler profile and hands it to the form.
 *
 * Worth being precise about what this buys, because it is not streaming. `better-sqlite3` is a
 * synchronous driver, so `readProfile()` returns before this function does — there is nothing to
 * suspend on and a `<Suspense>` boundary or `loading.tsx` here would wrap something that never
 * pends. What it removes is the round trip: the form used to render defaults, mount, fetch
 * `/api/profile`, and re-render with the real values, which is both a wasted request and a
 * visible flip of every picker. Now the first paint is already correct.
 *
 * `/api/profile` stays — the form still PUTs through it to save, and it is the write path.
 *
 * `listTrips()` is the second synchronous read, for the recent-trips preview in the form's photo
 * column, and it is the same call `/trips` and `/trip/latest` already make (ordered
 * `created_at DESC`, so "recent" needs no sort here). Sliced to three: one large photo plus a row
 * of two thumbnails is the whole preview, and reading the rest would be reading rows to throw
 * away. `toTripSummary` rather than the raw row, so the client half gets the app's camelCase
 * surface and never sees `start_date`.
 *
 * What still streams in on the client is the per-trip photography (`usePlacePhoto` → Wikipedia),
 * exactly as on `/trips`.
 */
export const dynamic = "force-dynamic";

const RECENT_TRIP_COUNT = 3;

export default function ProfilePage() {
  return (
    <ProfileForm
      initialProfile={readProfile()}
      recentTrips={listTrips().slice(0, RECENT_TRIP_COUNT).map(toTripSummary)}
    />
  );
}
