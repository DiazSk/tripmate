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
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <div className="mb-10 flex items-center justify-between">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          My trips
        </h1>
        <Link href="/" className="text-sm font-medium text-accent hover:text-accent-hover">
          New trip
        </Link>
      </div>

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {!loading && trips.length === 0 && (
        <div className="rounded-2xl border border-dashed border-card-border p-8 text-center">
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
            className="block rounded-2xl border border-card-border bg-card p-5 shadow-[0_1px_2px_rgba(32,28,25,0.04),0_8px_24px_-12px_rgba(32,28,25,0.12)] transition-colors hover:border-accent/40"
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
