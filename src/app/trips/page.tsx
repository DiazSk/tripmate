"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TripSummary } from "@/lib/types";
import ErrorNote from "@/components/ErrorNote";
import DockedPanel from "@/components/DockedPanel";
import { formatDateRange, formatMoney } from "@/lib/format";

export default function TripsPage() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Three things this has to get right, and it used to get none of them: check the
    // status (a 500 that renders the empty state tells you your saved trips are gone),
    // default the array (an error payload has no `trips` key, so this set state to
    // undefined and `trips.map` crashed the route on the very next render), and have
    // somewhere to put the failure.
    fetch("/api/trips")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setTrips(data.trips ?? []);
      })
      .catch(() => setError("We couldn't load your memories. Reload to try again."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="dashboard-page min-h-full">
      {/* Not collapsible: there is no route drawn on this surface, so there is no map
          under the panel worth revealing. */}
      <DockedPanel>
        {/* The page's own title. Its "New trip" action used to sit beside it here —
            moved into the global nav (Navbar.tsx), which now carries it on this route. */}
        <h1 className="hero-legible font-display text-2xl font-semibold tracking-tight text-foreground">
          My memories
        </h1>

        {loading && (
          <p role="status" className="text-sm text-muted">
            Loading your memories…
          </p>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        {!loading && !error && trips.length === 0 && (
          <div className="glass-itinerary rounded-2xl border-dashed p-8 text-center">
            {/* "No saved trips yet" on a page titled "My memories" named the same thing
                two ways in one viewport. */}
            <p className="text-sm text-muted">No memories yet.</p>
            <Link
              href="/"
              className="mt-3 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none active:scale-[0.98]"
            >
              Plan your first trip
            </Link>
          </div>
        )}

        {trips.length > 0 && (
          <ul className="space-y-3">
            {trips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/trip/${trip.id}`}
                  className="glass-itinerary block rounded-2xl p-5 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  {/* h2, not a styled div: the list had no structure to navigate by. */}
                  <h2 className="font-display text-base font-semibold text-foreground">
                    {trip.destination}
                  </h2>
                  <div className="mt-1 text-sm text-muted tabular-nums">
                    {formatDateRange(trip.startDate, trip.endDate)} ·{" "}
                    {formatMoney(trip.budget)} budget
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DockedPanel>
    </main>
  );
}
