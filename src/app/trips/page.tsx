import type { Metadata } from "next";

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
/**
 * The browser tab, the bookmark and any shared link all said **"TripMate — Plan your trip"** — the
 * root layout's title, inherited because this route never set one. That is the landing page's copy
 * on a page for looking back at trips already taken, and it is the wrong word in the place a
 * visitor sees most often and can least ignore: a tab strip with several TripMate tabs open had no
 * way to tell them apart. `/trip/[id]` already set the convention with `"<destination> · TripMate"`,
 * so this follows it rather than inventing a second shape.
 *
 * Static rather than `generateMetadata`: the title does not depend on the data, and the count in
 * the hero would be a worse title than the page's own name.
 */
export const metadata: Metadata = {
  title: "My memories · TripMate",
  description:
    "Every trip you've planned and saved, as a postcard wall — reopen any itinerary on the globe.",
};

export const dynamic = "force-dynamic";

export default function TripsPage() {
  return <TripsView initialTrips={listTrips().map(toTripSummary)} />;
}
