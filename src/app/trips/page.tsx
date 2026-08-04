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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">My trips</h1>
        <Link href="/" className="text-sm text-orange-600 hover:underline">
          New trip
        </Link>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && trips.length === 0 && (
        <p className="text-sm text-gray-500">No saved trips yet.</p>
      )}

      <div className="space-y-3">
        {trips.map((trip) => (
          <Link
            key={trip.id}
            href={`/trip/${trip.id}`}
            className="block rounded-lg border border-gray-200 p-4 hover:border-orange-300 hover:bg-orange-50"
          >
            <div className="font-semibold text-gray-900">{trip.destination}</div>
            <div className="text-sm text-gray-500">
              {trip.startDate} – {trip.endDate} · Budget ${trip.budget}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
