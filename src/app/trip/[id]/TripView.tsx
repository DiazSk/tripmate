"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ItineraryCard from "@/components/ItineraryCard";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import { headerLinkClass } from "@/components/BrandMark";
import ErrorNote from "@/components/ErrorNote";
import DockedPanel from "@/components/DockedPanel";
import { Itinerary, Trip } from "@/lib/types";
import { useTripCamera } from "@/lib/useTripCamera";
import { dayPlanned, daySpend, findStopLocation, upcomingStopsAfter } from "@/lib/itinerary";
import { formatMoney } from "@/lib/format";

type ActualCostTarget = "lodging" | number;

/** When the itinerary has stops, ItineraryCard's own effect frames the day's route — so the
 *  destination flight must be suppressed or it lands second and clobbers that framing. */
const hasStops = (itinerary?: Itinerary | null) =>
  !!itinerary?.days.some((d) => d.stops.length > 0);

export default function TripView({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Still the params promise, unwrapped here rather than in the server page that renders this:
  // awaiting it there would block the shell for nothing.
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
      import("@/lib/previewTrip").then(({ PREVIEW_TRIP }) => {
        setTrip(PREVIEW_TRIP);
        setItinerary(PREVIEW_TRIP.itinerary);
        flyToDestinationByName(PREVIEW_TRIP.destination, !hasStops(PREVIEW_TRIP.itinerary));
      });
      return;
    }
    fetch(`/api/trips/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setTrip(data);
        setItinerary(data.itinerary);
        await flyToDestinationByName(data.destination, !hasStops(data.itinerary));
      })
      .catch((e) =>
        setError(e instanceof Error && e.message ? e.message : "We couldn't load this trip.")
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Throws on a failed write. Losing a logged spend silently is the one failure on
   *  this page that costs data, so every caller has to have somewhere to put it. */
  async function persist(updated: Itinerary) {
    if (id === "preview") return;
    const res = await fetch(`/api/trips/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itinerary: updated }),
    });
    if (!res.ok) throw new Error("That amount didn't save. Check your connection and re-enter it.");
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
    setError(null);
    persist(updated).catch((e: Error) => setError(e.message));
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
    setError(null);
    try {
      const spentThroughDay = itinerary.days
        .slice(0, dayIndex + 1)
        .reduce((sum, day) => sum + daySpend(day), 0);
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
      if (!res.ok) throw new Error(data.error);

      const updated: Itinerary = {
        ...itinerary,
        days: [...itinerary.days.slice(0, dayIndex + 1), ...data.days],
      };
      setItinerary(updated);
      await persist(updated);
      setDismissedDays((prev) => new Set(prev).add(dayIndex));
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "We couldn't rebalance the rest of the trip. Your plan is unchanged."
      );
    } finally {
      setRebalancingDay(null);
    }
  }

  const overspendDayIndex = itinerary
    ? itinerary.days.findIndex(
        (day, i) => !dismissedDays.has(i) && daySpend(day) > dayPlanned(day)
      )
    : -1;
  const hasOverspend = overspendDayIndex !== -1;
  const rebalancing = rebalancingDay === overspendDayIndex;

  // The banner is inserted above whatever the user was just looking at, and the
  // browser's own scroll anchoring then holds that content still — which scrolls the
  // banner off the top of the panel. An alert nobody sees isn't one, so it asks for
  // the space it needs. `block: "nearest"` scrolls the panel by the minimum.
  const overspendRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hasOverspend) overspendRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hasOverspend, overspendDayIndex]);

  return (
    <main className="dashboard-page min-h-full">
      {/* Same bounded, right-docked panel the home page's result view uses — keeps
          every "content over the globe" surface visually consistent. */}
      <DockedPanel collapsible className="space-y-4">
        <div className="flex justify-end">
          <Link href="/trips" className={headerLinkClass}>
            My memories
          </Link>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
        {!trip && !error && (
          <p role="status" className="text-sm text-muted">
            Loading this trip…
          </p>
        )}

        {hasOverspend && itinerary && (
          <div
            ref={overspendRef}
            role="status"
            className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm sm:flex-row sm:items-center"
          >
            <p className="text-red-400">
              Day {overspendDayIndex + 1} ran{" "}
              <span className="tabular-nums">
                {formatMoney(
                  daySpend(itinerary.days[overspendDayIndex]) -
                    dayPlanned(itinerary.days[overspendDayIndex])
                )}
              </span>{" "}
              over plan. Rebalance the rest of the trip?
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setDismissedDays((prev) => new Set(prev).add(overspendDayIndex))}
                // Disabled mid-flight: dismissing used to hide the banner while the
                // request was still running, and the day got re-dismissed on completion.
                disabled={rebalancing}
                className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-red-400 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-400/60 focus-visible:outline-none disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => handleRebalance(overspendDayIndex)}
                disabled={rebalancing}
                className="inline-flex min-h-11 items-center rounded-full bg-red-600 px-3 text-sm font-medium text-white transition-all duration-150 hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-400/60 focus-visible:outline-none active:scale-[0.98] disabled:opacity-50"
              >
                {rebalancing ? "Rebalancing…" : "Rebalance"}
              </button>
            </div>
          </div>
        )}

        {/* Hidden rather than unmounted, so the active day, the panel's scroll position
            and the tour all survive a trip to a place detail and back. */}
        {trip && itinerary && (
          <div className={selectedStop ? "hidden" : undefined}>
            <ItineraryCard
              itinerary={itinerary}
              budget={trip.budget}
              destination={trip.destination}
              onSelectStop={selectStop}
              onLodgingActualCostChange={(dayIndex, value) =>
                handleActualCostChange(dayIndex, "lodging", value)
              }
            />
          </div>
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
      </DockedPanel>
    </main>
  );
}
