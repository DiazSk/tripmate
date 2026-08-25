"use client";

import { useEffect, useRef, useState } from "react";
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
import { useGlobeOnScreen } from "@/lib/mapCamera";
import { dayPlanned, daySpend, findStopLocation, upcomingStopsAfter } from "@/lib/itinerary";
import { formatMoney } from "@/lib/format";
import { devLabel } from "@/lib/devInspector";
import { clearUnseenDay, markUnseenDays } from "@/lib/unseenChanges";

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
  id,
  initialTrip,
}: {
  id: string;
  /** Read server-side by this route's page component. Null only for `/trip/preview`, whose
   *  fixture is not in the database and is loaded below instead. */
  initialTrip: Trip | null;
}) {
  const [trip, setTrip] = useState<Trip | null>(initialTrip);
  const [itinerary, setItinerary] = useState<Itinerary | null>(initialTrip?.itinerary ?? null);
  const [error, setError] = useState<string | null>(null);
  const [dismissedDays, setDismissedDays] = useState<Set<number>>(new Set());
  const [rebalancingDay, setRebalancingDay] = useState<number | null>(null);
  // Owned here, not inside ItineraryCard: opening a stop's detail unmounts the card, so local
  // state there would reset the view to Day 1 on the way back.
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  /** Shut on arrival, same as the result view: a saved trip opens on its own clustered map and
   *  the plan is one click away. Owned here because `ItineraryCard` reads it too — see the
   *  `panelCollapsed` prop. */
  const [planCollapsed, setPlanCollapsed] = useState(true);
  /** 0-based days a chat turn changed while the traveler was reading a different one. Owned here
   *  rather than in the card because the chat that produces them lives beside it, not inside it. */
  const [unseenChangedDays, setUnseenChangedDays] = useState<number[]>([]);
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

  // This route is the globe, for its whole life. `not-found.tsx` and `/trip/latest`'s empty-DB
  // card are separate components that never mount this one — which is exactly why the gate is a
  // mounted-component declaration rather than a `/trip/` path prefix.
  useGlobeOnScreen(true);

  // The trip itself already arrived as a prop; this effect only has to move the camera. The
  // `/api/trips/[id]` fetch that used to live here was a second read of a row the server had
  // just read to render this very component.
  useEffect(() => {
    if (id === "preview") {
      // Kept out of this route's client bundle: the fixture lives in its own module,
      // loaded with a dynamic import so real trips don't pay for it. It is also the one
      // trip with no database row, which is why it cannot arrive as a prop.
      import("@/lib/previewTrip").then(({ PREVIEW_TRIP }) => {
        setError(null);
        setTrip(PREVIEW_TRIP);
        setItinerary(PREVIEW_TRIP.itinerary);
        flyToDestinationByName(PREVIEW_TRIP.destination, !hasStops(PREVIEW_TRIP.itinerary));
      });
      return;
    }
    if (initialTrip) {
      flyToDestinationByName(initialTrip.destination, !hasStops(initialTrip.itinerary));
    }
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
      <DockedPanel
        collapsible
        wide={!!focus.target}
        collapsed={planCollapsed}
        onCollapsedChange={setPlanCollapsed}
        // What the capsule carries while the panel is shut — the trip at a glance, so
        // "which day was I reading" survives a look at the map.
        capsule={
          trip
            ? {
                title: trip.destination,
                subtitle: itinerary?.days.length
                  ? `${itinerary.days.length} ${itinerary.days.length === 1 ? "day" : "days"}`
                  : undefined,
                step: itinerary?.days.length ? `Day ${activeDayIndex + 1}` : undefined,
              }
            : undefined
        }
      >
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
              sessionId={trip.chatSessionId ?? null}
              dirty={focus.dirty}
              saving={savingFocus}
              onDaysModified={(days) =>
                setUnseenChangedDays((prev) =>
                  markUnseenDays(days, focus.target?.dayIndex ?? activeDayIndex, prev)
                )
              }
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
                  30-day trip buried it behind a full scroll of the itinerary.

                  `px-5` below `sm`: the panel is full-bleed there, and this row — unlike its
                  `.glass-itinerary` sibling, which insets its own inner box — has nothing to
                  inset it, so the label sat hard against the screen edge. */}
              {trip && itinerary && (
                <div className="flex justify-end px-5 sm:px-0">
                  <button
                    type="button"
                    onClick={() => focus.open(0, "trip")}
                    // No `hover:bg-*` here: `.refine-affordance` and `.glass-control` both set
                    // `background` as unlayered rules in `globals.css`, which outrank every
                    // `@layer utilities` declaration regardless of specificity — so the utility
                    // that used to sit here was dead, and the app's most prominent secondary
                    // action had no hover at all. Both states are defined beside those base
                    // rules now. `transition-colors` is what animates them.
                    className="refine-affordance glass-control pointer-events-auto rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors"
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
                  unseenChangedDays={unseenChangedDays}
                  onActiveDayChange={(next) => {
                    setActiveDayIndex(next);
                    // Looking at the day is what marks it read.
                    setUnseenChangedDays((prev) => clearUnseenDay(prev, next));
                  }}
                  onEditDay={handleEditDay}
                  // Same window "Refine with AI" opens, just starting on the day whose icon was
                  // clicked: one chat surface with day navigation, rather than a second
                  // day-locked variant that looked identical but couldn't reach other days.
                  onChatDay={(dayIndex) => focus.open(dayIndex, "trip")}
                  onItineraryChange={handleRearrange}
                  trip={trip}
                  panelCollapsed={planCollapsed}
                  onMinimize={() => setPlanCollapsed(true)}
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
