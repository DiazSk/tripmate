"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import ItineraryCard from "@/components/ItineraryCard";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import { DayPlan, Itinerary, Trip } from "@/lib/types";
import { useTripCamera } from "@/lib/useTripCamera";
import { findStopLocation, upcomingStopsAfter } from "@/lib/itinerary";

type ActualCostTarget = "lodging" | number;

/** Hardcoded trip for visually inspecting this page at /trip/preview without a real generation round-trip. */
const PREVIEW_TRIP: Trip = {
  id: "preview",
  destination: "Paris, France",
  startDate: "2026-09-01",
  endDate: "2026-09-03",
  budget: 1200,
  itinerary: {
    tier: "midrange",
    days: [
      {
        date: "2026-09-01",
        weather: "Pleasant and mild, 13.6-21°C, ideal for sightseeing",
        lodging: { name: "Hotel Pulitzer Paris", cost: 160, note: "Boutique 4-star hotel in Le Marais district" },
        stops: [
          { name: "CDG Airport to Hotel Transfer", lat: 48.8566, lng: 2.3642, cost: 45, note: "Private taxi to Le Marais", time: "9:00 AM", durationLabel: "45 minutes", tags: ["Transportation", "Arrival"], category: "transit" },
          { name: "Breakfast at Hotel Café", lat: 48.8566, lng: 2.3642, cost: 18, note: "Pastries, croissants, and fresh coffee", time: "9:45 AM", durationLabel: "30 minutes", tags: ["Casual", "Hotel"], category: "food" },
          { name: "Île de la Cité & Notre-Dame", lat: 48.853, lng: 2.3499, cost: 0, note: "Walk around iconic cathedral and island", time: "10:15 AM", durationLabel: "1 hour", tags: ["Must-See", "Free"], category: "other" },
          { name: "Lunch at Bistro Paul Bert", lat: 48.853, lng: 2.345, cost: 35, note: "Classic French bistro with traditional cuisine", time: "11:15 AM", durationLabel: "1.5 hours", tags: ["Local", "Michelin-Recommended"], category: "food" },
          { name: "Musée d'Orsay with Private Guide", lat: 48.8601, lng: 2.3265, cost: 80, note: "Impressionist masterpieces with expert commentary", time: "12:45 PM", durationLabel: "3 hours", tags: ["Museum", "Premium"], category: "entry" },
          { name: "Afternoon Café Break", lat: 48.8601, lng: 2.33, cost: 12, note: "Coffee and pastry rest stop", time: "3:45 PM", durationLabel: "30 minutes", tags: ["Casual", "Break"], category: "food" },
          { name: "Le Marais Boutique Shopping", lat: 48.8566, lng: 2.3642, cost: 60, note: "Curated vintage and designer boutiques", time: "4:15 PM", durationLabel: "1.5 hours", tags: ["Shopping", "Local"], category: "other" },
          { name: "Dinner at Le Petit Pontoise", lat: 48.8566, lng: 2.352, cost: 45, note: "Classic Parisian bistro with charming ambiance", time: "6:00 PM", durationLabel: "1.5 hours", tags: ["Dinner", "Local"], category: "food" },
        ],
      },
      {
        date: "2026-09-02",
        weather: "Cooler day, 12.2-18.3°C, perfect for museums and indoor activities",
        lodging: { name: "Hotel Pulitzer Paris", cost: 160, note: "Second night at same boutique hotel" },
        stops: [
          { name: "Breakfast at Local Café", lat: 48.8566, lng: 2.3642, cost: 12, note: "Croissants and café au lait", time: "9:00 AM", durationLabel: "30 minutes", tags: ["Casual", "Local"], category: "food" },
          { name: "Louvre Museum", lat: 48.8606, lng: 2.3376, cost: 22, note: "World's largest art museum, iconic masterpieces", time: "9:30 AM", durationLabel: "3 hours", tags: ["Museum", "Must-See"], category: "entry" },
          { name: "Lunch near Louvre", lat: 48.8606, lng: 2.3376, cost: 28, note: "Quick casual bistro lunch", time: "12:30 PM", durationLabel: "1 hour", tags: ["Convenient", "Casual"], category: "food" },
          { name: "Sainte-Chapelle", lat: 48.8509, lng: 2.3475, cost: 15, note: "Stunning stained glass windows and Gothic architecture", time: "1:30 PM", durationLabel: "1.5 hours", tags: ["Historic", "Must-See"], category: "entry" },
          { name: "Afternoon Café Break", lat: 48.8509, lng: 2.3475, cost: 12, note: "Rest with coffee and pastry", time: "3:00 PM", durationLabel: "30 minutes", tags: ["Casual", "Break"], category: "food" },
          { name: "French Cooking Class", lat: 48.8566, lng: 2.352, cost: 95, note: "Market-to-table cooking experience with local ingredients", time: "3:30 PM", durationLabel: "2.5 hours", tags: ["Experience", "Premium"], category: "entry" },
          { name: "Dinner at Cooking Class Venue", lat: 48.8566, lng: 2.352, cost: 60, note: "Enjoy prepared dishes with wine pairing", time: "6:00 PM", durationLabel: "1.5 hours", tags: ["Dinner", "Included"], category: "food" },
        ],
      },
      {
        date: "2026-09-03",
        weather: "Beautiful day, 16.1-25.1°C, excellent for outdoor sightseeing",
        stops: [
          { name: "Breakfast at Local Café", lat: 48.8566, lng: 2.3642, cost: 12, note: "Final morning pastry and coffee", time: "9:00 AM", durationLabel: "30 minutes", tags: ["Casual", "Local"], category: "food" },
          { name: "Eiffel Tower Fast-Track Entry", lat: 48.8584, lng: 2.2945, cost: 35, note: "Skip-the-line access with summit views", time: "9:30 AM", durationLabel: "2.5 hours", tags: ["Must-See", "Premium"], category: "entry" },
          { name: "Lunch near Eiffel Tower", lat: 48.8584, lng: 2.2945, cost: 30, note: "Casual lunch with tower views", time: "12:00 PM", durationLabel: "1 hour", tags: ["Views", "Casual"], category: "food" },
          { name: "Seine River Walk & Shopping", lat: 48.8566, lng: 2.2922, cost: 40, note: "Stroll along the Seine, browse riverside boutiques", time: "1:00 PM", durationLabel: "2 hours", tags: ["Romantic", "Shopping"], category: "other" },
          { name: "Afternoon Café", lat: 48.8699, lng: 2.3073, cost: 15, note: "Rest and refreshments", time: "3:00 PM", durationLabel: "30 minutes", tags: ["Casual", "Break"], category: "food" },
          { name: "Arc de Triomphe", lat: 48.8738, lng: 2.295, cost: 18, note: "Iconic monument with rooftop city views", time: "3:30 PM", durationLabel: "1.5 hours", tags: ["Must-See", "Views"], category: "entry" },
          { name: "Champs-Élysées Shopping", lat: 48.8699, lng: 2.3073, cost: 60, note: "Luxury shopping on world's most famous avenue", time: "5:00 PM", durationLabel: "2 hours", tags: ["Shopping", "Luxury"], category: "other" },
          { name: "Seine Dinner Cruise", lat: 48.8566, lng: 2.2922, cost: 95, note: "3-course gourmet dinner with illuminated city views", time: "7:00 PM", durationLabel: "3 hours", tags: ["Romantic", "Premium"], category: "food" },
        ],
      },
    ],
  },
};

function dayPlannedTotal(day: DayPlan) {
  return (day.lodging?.cost ?? 0) + day.stops.reduce((s, stop) => s + stop.cost, 0);
}

function dayActualTotal(day: DayPlan) {
  const lodging = day.lodging ? day.lodging.actualCost ?? day.lodging.cost : 0;
  return lodging + day.stops.reduce((s, stop) => s + (stop.actualCost ?? stop.cost), 0);
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
    if (id === "preview") {
      Promise.resolve().then(() => {
        setTrip(PREVIEW_TRIP);
        setItinerary(PREVIEW_TRIP.itinerary);
        flyToDestinationByName(PREVIEW_TRIP.destination);
      });
      return;
    }
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
    <main className="dashboard-page flex min-h-full flex-col gap-6 bg-[#0B0F19] p-5 sm:p-6">
      <div className="dashboard-navbar -mx-5 -mt-5 flex justify-end px-5 py-4 sm:-mx-6 sm:-mt-6 sm:px-6">
        <Link href="/trips" className="text-sm font-medium text-[#94A3B8] hover:text-white">
          My memories
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {!trip && !error && <p className="text-sm text-muted">Loading…</p>}

      {hasOverspend && itinerary && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm sm:flex-row sm:items-center">
          <p className="text-red-400">
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
              className="rounded-full px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10"
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

      {trip && itinerary && selectedStop && (
        <PlaceDetailPanel
          stop={selectedStop}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onBack={closeDetail}
          actualCost={selectedStop.actualCost}
          onActualCostChange={handleStopActualCostChange}
          upcomingStops={upcomingStopsAfter(itinerary, selectedStop)}
          onSelectUpcoming={selectStop}
        />
      )}
    </main>
  );
}
