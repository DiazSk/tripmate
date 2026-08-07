"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader title="My trips" navLabel="New trip" navHref="/" />

      {loading && <p className="text-sm text-stone-500">Loading…</p>}
      {!loading && trips.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center">
          <p className="text-sm text-stone-500">No saved trips yet.</p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm font-medium text-orange-700 hover:text-orange-800"
          >
            Plan your first trip →
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {trips.map((trip) => (
          <Link
            key={trip.id}
            href={`/trip/${trip.id}`}
            className="block rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50"
          >
            <div className="font-semibold text-stone-900">{trip.destination}</div>
            <div className="text-sm text-stone-500">
              {trip.startDate} – {trip.endDate} · Budget ${trip.budget}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
