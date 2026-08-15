import Link from "next/link";
import { redirect } from "next/navigation";
import { listTrips } from "@/lib/db";

/**
 * Stable dev entry point: `/trip/latest` opens the most recently saved trip.
 *
 * Exists so iterating on the edit loop doesn't cost a full plan-and-generate cycle. A hot reload
 * on this URL lands back on a real itinerary with the chat ready, instead of resetting the home
 * page's wizard to step one. Unlike `/trip/preview` (a hardcoded fixture) this is a real database
 * row, so edits made here actually persist and can be re-checked after the reload.
 *
 * A static segment wins over `[id]`, so this never collides with a trip whose id is "latest".
 */
export default function LatestTripPage() {
  const [newest] = listTrips();

  if (newest) redirect(`/trip/${newest.id}`);

  return (
    <main className="pointer-events-auto flex min-h-full items-center justify-center p-8">
      <div className="glass-itinerary max-w-md rounded-2xl p-6 text-center">
        <h1 className="font-display text-lg font-semibold text-foreground">No saved trips yet</h1>
        <p className="mt-2 text-sm text-muted">
          Plan and save one trip; after that this URL always reopens the most recent itinerary, so
          you can keep editing without generating again.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
        >
          Plan a trip
        </Link>
      </div>
    </main>
  );
}
