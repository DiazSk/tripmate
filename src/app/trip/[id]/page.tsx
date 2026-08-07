"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import ItineraryCard from "@/components/ItineraryCard";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import { DayPlan, Itinerary, Stop, Trip } from "@/lib/types";
import { useTripCamera } from "@/lib/useTripCamera";

type ActualCostTarget = "lodging" | number;

function dayPlannedTotal(day: DayPlan) {
  return (day.lodging?.cost ?? 0) + day.stops.reduce((s, stop) => s + stop.cost, 0);
}

function dayActualTotal(day: DayPlan) {
  const lodging = day.lodging ? day.lodging.actualCost ?? day.lodging.cost : 0;
  return lodging + day.stops.reduce((s, stop) => s + (stop.actualCost ?? stop.cost), 0);
}

function findStopLocation(
  itinerary: Itinerary,
  stop: Stop
): { dayIndex: number; stopIndex: number } | null {
  for (let d = 0; d < itinerary.days.length; d++) {
    const s = itinerary.days[d].stops.findIndex(
      (x) => x.name === stop.name && x.lat === stop.lat && x.lng === stop.lng
    );
    if (s !== -1) return { dayIndex: d, stopIndex: s };
  }
  return null;
}

export default function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissedDays, setDismissedDays] = useState<Set<number>>(new Set());
  const [rebalancingDay, setRebalancingDay] = useState<number | null>(null);

  const {
    flyToDestinationByName,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  } = useTripCamera(trip?.destination ?? "");

  useEffect(() => {
    fetch(`/api/trips/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load trip");
        setTrip(data);
        setItinerary(data.itinerary);
        await flyToDestinationByName(data.destination);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function persist(updated: Itinerary) {
    await fetch(`/api/trips/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itinerary: updated }),
    });
  }

  function handleActualCostChange(
    dayIndex: number,
    target: ActualCostTarget,
    value: number | undefined
  ) {
    if (!itinerary) return;
    const updated: Itinerary = structuredClone(itinerary);
    const day = updated.days[dayIndex];
    if (target === "lodging") {
      if (day.lodging) day.lodging.actualCost = value;
    } else {
      day.stops[target].actualCost = value;
    }
    setItinerary(updated);
    persist(updated);
    setDismissedDays((prev) => {
      const next = new Set(prev);
      next.delete(dayIndex);
      return next;
    });
  }

  function handleStopActualCostChange(value: number | undefined) {
    if (!itinerary || !selectedStop) return;
    const loc = findStopLocation(itinerary, selectedStop);
    if (!loc) return;
    handleActualCostChange(loc.dayIndex, loc.stopIndex, value);
  }

  async function handleRebalance(dayIndex: number) {
    if (!itinerary || !trip) return;
    setRebalancingDay(dayIndex);
    try {
      const spentThroughDay = itinerary.days
        .slice(0, dayIndex + 1)
        .reduce((sum, day) => sum + dayActualTotal(day), 0);
      const remainingBudget = Math.max(trip.budget - spentThroughDay, 0);
      const remainingDays = itinerary.days.slice(dayIndex + 1);

      if (remainingDays.length === 0) {
        setDismissedDays((prev) => new Set(prev).add(dayIndex));
        return;
      }

      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rebalance: true,
          destination: trip.destination,
          tier: itinerary.tier,
          remainingDays,
          remainingBudget,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to rebalance");

      const updated: Itinerary = {
        ...itinerary,
        days: [...itinerary.days.slice(0, dayIndex + 1), ...data.days],
      };
      setItinerary(updated);
      await persist(updated);
      setDismissedDays((prev) => new Set(prev).add(dayIndex));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rebalance");
    } finally {
      setRebalancingDay(null);
    }
  }

  const overspendDayIndex = itinerary
    ? itinerary.days.findIndex((day, i) => !dismissedDays.has(i) && dayActualTotal(day) > dayPlannedTotal(day))
    : -1;
  const hasOverspend = overspendDayIndex !== -1;

  return (
    <main className="flex min-h-full flex-col gap-6 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {trip ? trip.destination : "Trip"}
        </h1>
        <Link href="/trips" className="text-sm font-medium text-accent hover:text-accent-hover">
          My trips
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {!trip && !error && <p className="text-sm text-muted">Loading…</p>}

      {trip && itinerary && (
        <p className="-mt-4 text-sm text-muted">
          {trip.startDate} – {trip.endDate}
        </p>
      )}

      {hasOverspend && itinerary && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-red-300/60 bg-red-50 p-4 text-sm sm:flex-row sm:items-center">
          <p className="text-red-800">
            Day {overspendDayIndex + 1} ran $
            {(
              dayActualTotal(itinerary.days[overspendDayIndex]) -
              dayPlannedTotal(itinerary.days[overspendDayIndex])
            ).toFixed(0)}{" "}
            over plan — rebalance the rest of the trip?
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => setDismissedDays((prev) => new Set(prev).add(overspendDayIndex))}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Dismiss
            </button>
            <button
              onClick={() => handleRebalance(overspendDayIndex)}
              disabled={rebalancingDay === overspendDayIndex}
              className="rounded-full bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-all duration-150 hover:bg-red-700 active:scale-[0.98] disabled:opacity-50"
            >
              {rebalancingDay === overspendDayIndex ? "Rebalancing…" : "Rebalance"}
            </button>
          </div>
        </div>
      )}

      {trip && itinerary && !selectedStop && (
        <ItineraryCard
          itinerary={itinerary}
          budget={trip.budget}
          destination={trip.destination}
          onSelectStop={selectStop}
          editable
          onLodgingActualCostChange={(dayIndex, value) =>
            handleActualCostChange(dayIndex, "lodging", value)
          }
        />
      )}

      {trip && selectedStop && (
        <PlaceDetailPanel
          stop={selectedStop}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onBack={closeDetail}
          actualCost={selectedStop.actualCost}
          onActualCostChange={handleStopActualCostChange}
        />
      )}
    </main>
  );
}
