"use client";

import { use, useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import ItineraryCard from "@/components/ItineraryCard";
import FocusEditMode from "@/components/FocusEditMode";
import { useFocusEdit } from "@/lib/useFocusEdit";
import { DayEditUpdates } from "@/components/DayHeader";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import DockedPanel from "@/components/DockedPanel";
import ErrorNote from "@/components/ErrorNote";
import { Itinerary, Trip } from "@/lib/types";
import { useTripCamera } from "@/lib/useTripCamera";
import { dayPlanned, daySpend, findStopLocation, upcomingStopsAfter } from "@/lib/itinerary";
import { formatMoney } from "@/lib/format";
import { devLabel } from "@/lib/devInspector";

/** Fallback shown only when the thrown error carries no message of its own. */
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

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
  const { id } = use(params);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissedDays, setDismissedDays] = useState<Set<number>>(new Set());
  const [rebalancingDay, setRebalancingDay] = useState<number | null>(null);
  // Owned here, not inside ItineraryCard: opening a stop's detail unmounts the card, so local
  // state there would reset the view to Day 1 on the way back.
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  // Step 7 edit session. Unlike the pre-save view, every accepted edit here is persisted.
  const focus = useFocusEdit(itinerary);
  const [savingFocus, setSavingFocus] = useState(false);

  const {
    flyToDestinationByName,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  } = useTripCamera(trip?.destination ?? "", trip?.id);

  useEffect(() => {
    if (id === "preview") {
      // Kept out of this route's client bundle: the fixture lives in its own module,
      // loaded with a dynamic import so real trips don't pay for it.
      import("@/lib/previewTrip").then(({ PREVIEW_TRIP }) => {
        setError(null);
        setTrip(PREVIEW_TRIP);
        setItinerary(PREVIEW_TRIP.itinerary);
        flyToDestinationByName(PREVIEW_TRIP.destination, !hasStops(PREVIEW_TRIP.itinerary));
      });
      return;
    }
    fetch(`/api/trips/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load trip");
        setError(null);
        setTrip(data);
        setItinerary(data.itinerary);
        await flyToDestinationByName(data.destination, !hasStops(data.itinerary));
      })
      .catch((e) => setError(errorMessage(e, "We couldn't load this trip.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function persist(updated: Itinerary) {
    if (id === "preview") return;
    const res = await fetch(`/api/trips/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itinerary: updated }),
    });
    if (!res.ok) throw new Error("That amount didn't save. Check your connection and re-enter it.");

    // An edit can now change the trip's LENGTH (the chat can add or remove days), which moves the
    // end date. The route recomputes it from the saved itinerary, so take its answer rather than
    // deriving a second one here — otherwise the header keeps showing the old date range until a
    // reload.
    const saved = await res.json().catch(() => null);
    if (saved?.endDate) {
      setTrip((prev) => (prev && prev.endDate !== saved.endDate ? { ...prev, endDate: saved.endDate } : prev));
    }
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
    persist(updated).catch((e) => setError(errorMessage(e, "That amount didn't save.")));
    setDismissedDays((prev) => {
      const next = new Set(prev);
      next.delete(dayIndex);
      return next;
    });
  }

  /** A hand-rearranged itinerary from the card's drag-and-drop. `moveStop` has already re-timed
   *  every day it touched, so this only has to commit it — and it saves immediately rather than
   *  waiting for a Save button, matching how the actual-cost inputs on this page already behave. */
  function handleRearrange(next: Itinerary) {
    setItinerary(next);
    setError(null);
    persist(next).catch((e) => setError(errorMessage(e, "That change didn't save.")));
  }

  function handleEditDay(dayIndex: number, updates: DayEditUpdates) {
    if (!itinerary) return;
    const updated: Itinerary = structuredClone(itinerary);
    Object.assign(updated.days[dayIndex], updates);
    setItinerary(updated);
    setError(null);
    persist(updated).catch((e) => setError(errorMessage(e, "That change didn't save.")));
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
          tripId: trip.id,
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
      setError(errorMessage(e, "We couldn't rebalance the rest of the trip. Your plan is unchanged."));
    } finally {
      setRebalancingDay(null);
    }
  }

  const overspendDayIndex = itinerary
    ? itinerary.days.findIndex((day, i) => !dismissedDays.has(i) && daySpend(day) > dayPlanned(day))
    : -1;
  const hasOverspend = overspendDayIndex !== -1;
  const overspendRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hasOverspend) overspendRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hasOverspend]);

  return (
    <main className="dashboard-page min-h-full">
      {/* Same bounded, right-docked panel the home page's result view uses — keeps
          every "content over the globe" surface visually consistent. */}
      <DockedPanel collapsible wide={!!focus.target}>
        <div className="space-y-4" {...devLabel("ResultPanel")}>
          {error && <ErrorNote>{error}</ErrorNote>}
          {!trip && !error && <p className="text-sm text-muted">Loading…</p>}

          {hasOverspend && itinerary && (
            <div
              ref={overspendRef}
              role="status"
              className="glass-itinerary flex flex-col items-start justify-between gap-3 rounded-2xl border p-4 text-sm sm:flex-row sm:items-center"
              style={{ borderColor: "rgba(239, 68, 68, 0.3)" }}
            >
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400" strokeWidth={2} />
                <div>
                  <p className="font-semibold text-red-400 tabular-nums">
                    Day {overspendDayIndex + 1} ran{" "}
                    {formatMoney(
                      daySpend(itinerary.days[overspendDayIndex]) -
                        dayPlanned(itinerary.days[overspendDayIndex])
                    )}{" "}
                    over plan
                  </p>
                  <p className="text-muted">Rebalance the rest of the trip?</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setDismissedDays((prev) => new Set(prev).add(overspendDayIndex))}
                  disabled={rebalancingDay === overspendDayIndex}
                  className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 disabled:opacity-50"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={() => handleRebalance(overspendDayIndex)}
                  disabled={rebalancingDay === overspendDayIndex}
                  className="inline-flex min-h-11 items-center rounded-full bg-red-600 px-3 text-sm font-medium text-white transition-all duration-150 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 active:scale-[0.98] disabled:opacity-50"
                >
                  {rebalancingDay === overspendDayIndex ? "Rebalancing…" : "Rebalance"}
                </button>
              </div>
            </div>
          )}

          {/* Focus Mode replaces the result card entirely — the standard view's budget bar, day
              tabs and cost footers simply aren't rendered while editing. */}
          {trip && focus.target && focus.draft && (
            <FocusEditMode
              trip={trip}
              userAnswers={trip.userAnswers ?? null}
              draft={focus.draft}
              dayIndex={focus.target.dayIndex}
              scope={focus.target.scope}
              tripId={trip.id}
              dirty={focus.dirty}
              saving={savingFocus}
              onDraftChange={focus.applyDraft}
              onCancel={focus.cancel}
              onSave={async () => {
                const committed = focus.save();
                if (!committed) return;
                setSavingFocus(true);
                setItinerary(committed);
                setError(null);
                try {
                  await persist(committed);
                } catch (e) {
                  setError(errorMessage(e, "That change didn't save."));
                } finally {
                  setSavingFocus(false);
                }
              }}
            />
          )}

          {/* Kept mounted (not unmounted) behind the stop-detail panel below, so the active
              day, this panel's scroll position and the stop tour's interval all survive the
              round trip instead of resetting when ItineraryCard remounts. */}
          {!focus.target && (
            <div className={selectedStop ? "hidden" : "space-y-4"}>
              {/* Above the card, not below it: at the foot of the panel this sat under the
                  floating trace/terminal button in the same bottom-right corner, and a
                  30-day trip buried it behind a full scroll of the itinerary. */}
              {trip && itinerary && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => focus.open(0, "trip")}
                    className="pointer-events-auto rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-white/10"
                  >
                    Refine with AI
                  </button>
                </div>
              )}

              {trip && itinerary && (
                <ItineraryCard
                  itinerary={itinerary}
                  budget={trip.budget}
                  destination={trip.destination}
                  onSelectStop={selectStop}
                  editable
                  onLodgingActualCostChange={(dayIndex, value) =>
                    handleActualCostChange(dayIndex, "lodging", value)
                  }
                  activeDayIndex={activeDayIndex}
                  onActiveDayChange={setActiveDayIndex}
                  onEditDay={handleEditDay}
                  // Same window "Refine with AI" opens, just starting on the day whose icon was
                  // clicked: one chat surface with day navigation, rather than a second
                  // day-locked variant that looked identical but couldn't reach other days.
                  onChatDay={(dayIndex) => focus.open(dayIndex, "trip")}
                  onItineraryChange={handleRearrange}
                  trip={trip}
                />
              )}

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
        </div>
      </DockedPanel>
    </main>
  );
}
