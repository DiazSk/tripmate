"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TripSummary } from "@/lib/types";

export default function TripsPage() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/trips")
      .then((res) => res.json())
      .then((data) => setTrips(data.trips))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="dashboard-page min-h-full">
      {/* Same bounded, right-docked panel every other "content over the globe"
          surface uses (home page result view, /trip/[id]). */}
      <div className="fixed top-6 right-6 bottom-6 left-6 z-10 m-0 space-y-6 overflow-y-auto sm:left-auto sm:w-[40%] sm:min-w-[360px] sm:max-w-[520px]">
        <div className="flex items-center justify-between rounded-2xl bg-slate-950/70 px-4 py-3 backdrop-blur-sm">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            My memories
          </h1>
          <Link href="/" className="text-sm font-medium text-accent-foreground hover:underline">
            New trip
          </Link>
        </div>

        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && trips.length === 0 && (
          <div className="glass-itinerary rounded-2xl border-dashed p-8 text-center">
            <p className="text-sm text-muted">No saved trips yet.</p>
            <Link
              href="/"
              className="mt-3 inline-block rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-[0.98]"
            >
              Plan your first trip
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {trips.map((trip) => (
            <Link
              key={trip.id}
              href={`/trip/${trip.id}`}
              className="glass-itinerary block rounded-2xl p-5 transition-colors hover:bg-white/5"
            >
              <div className="font-display text-base font-semibold text-foreground">
                {trip.destination}
              </div>
              <div className="mt-1 text-sm text-muted">
                {trip.startDate} – {trip.endDate} · Budget ${trip.budget}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
