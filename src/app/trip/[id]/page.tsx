"use client";

import { use, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import DayList from "@/components/DayList";
import BudgetBar from "@/components/BudgetBar";
import PageHeader from "@/components/PageHeader";
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
  const [hoveredStop, setHoveredStop] = useState<string | null>(null);

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
      <PageHeader
        title={trip ? trip.destination : "Trip"}
        navLabel="My trips"
        navHref="/trips"
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {!trip && !error && <p className="text-sm text-stone-500">Loading…</p>}

      {trip && (
        <div className="space-y-8">
          <p className="-mt-6 text-sm text-stone-500">
            {trip.startDate} – {trip.endDate}
          </p>
          <ItineraryMap days={trip.itinerary.days} hoveredStop={hoveredStop} />
          <BudgetBar days={trip.itinerary.days} budget={trip.budget} />
          <DayList
            days={trip.itinerary.days}
            budget={trip.budget}
            hoveredStop={hoveredStop}
            onHoverStop={setHoveredStop}
          />
        </div>
      )}
    </main>
  );
}
