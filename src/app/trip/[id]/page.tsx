"use client";

import { use, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import DayList from "@/components/DayList";
import BudgetBar from "@/components/BudgetBar";
import { Trip } from "@/lib/types";

const ItineraryMap = dynamic(() => import("@/components/ItineraryMap"), {
  ssr: false,
});

export default function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/trips/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load trip");
        setTrip(data);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          {trip ? trip.destination : "Trip"}
        </h1>
        <Link href="/trips" className="text-sm text-orange-600 hover:underline">
          My trips
        </Link>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {!trip && !error && <p className="text-sm text-gray-500">Loading…</p>}

      {trip && (
        <div className="space-y-6">
          <p className="text-sm text-gray-500">
            {trip.startDate} – {trip.endDate}
          </p>
          <ItineraryMap days={trip.itinerary.days} />
          <BudgetBar days={trip.itinerary.days} budget={trip.budget} />
          <DayList days={trip.itinerary.days} />
        </div>
      )}
    </main>
  );
}
