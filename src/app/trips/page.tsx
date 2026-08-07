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
    <main className="flex min-h-full flex-col gap-6 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          My trips
        </h1>
        <Link href="/" className="text-sm font-medium text-accent hover:text-accent-hover">
          New trip
        </Link>
      </div>

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {!loading && trips.length === 0 && (
        <div className="card rounded-2xl border-dashed p-8 text-center">
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
            className="card block rounded-2xl p-5 transition-colors hover:border-accent/40"
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
    </main>
  );
}
