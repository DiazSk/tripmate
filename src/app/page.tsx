"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ItineraryCard from "@/components/ItineraryCard";
import FeedbackLoop from "@/components/FeedbackLoop";
import TierPicker from "@/components/TierPicker";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import GenerationLoader from "@/components/cesium/GenerationLoader";
import { closestTier, isTripTooLong, MAX_TRIP_DAYS, tripDays, TierId } from "@/lib/tiers";
import { Itinerary } from "@/lib/types";
import { useTripCamera } from "@/lib/useTripCamera";
import { useMapCamera } from "@/lib/mapCamera";
import { upcomingStopsAfter } from "@/lib/itinerary";

type Step = "form" | "tier" | "result";

const primaryButtonClass =
  "rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
const ghostButtonClass =
  "rounded-full px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-tag-neutral-bg";
// Shared glass-over-globe card treatment — same class the itinerary/detail
// panels use, reused here for consistency across every step of this page.
// `pointer-events-auto` opts back in from AppShell's `pointer-events-none` overlay, which
// exists so the Cesium canvas underneath stays draggable. Every interactive box needs it.
const cardClass = "glass-itinerary pointer-events-auto rounded-2xl p-5 sm:p-6";

const darkLabelClass = "text-sm font-medium text-white/80";
const darkInputClass =
  "mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState(1000);
  const [tier, setTier] = useState<TierId>("midrange");

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    flyToDestinationByName,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  } = useTripCamera(destination);
  const { resetToHome } = useMapCamera();

  // Mount-only on purpose. The globe lives above the route boundary and never unmounts, so
  // arriving here from /trips ("New trip") would otherwise keep the last trip's route, markers
  // and camera. Remounting is exactly the signal we want: Back from the style step doesn't
  // remount, so it keeps the destination framed rather than flying back out to the globe.
  useEffect(() => {
    resetToHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drives this page's own cosmetics (dark dashboard header/nav once results exist,
  // destination-form positioning) — AppShell's layout itself no longer varies by route/step.
  const preResult = step !== "result";

  async function chooseStyle() {
    if (isTripTooLong(startDate, endDate)) {
      setError(`Trips over ${MAX_TRIP_DAYS} days aren't supported — please choose a shorter date range.`);
      return;
    }
    setError(null);
    const days = tripDays(startDate, endDate);
    setTier(closestTier(budget, days));
    setStep("tier");
    await flyToDestinationByName(destination);
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, startDate, endDate, budget, tier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate itinerary");
      setItinerary(data.itinerary);
      setStep("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  }

  async function refine(feedback: string) {
    setRefining(true);
    setError(null);
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          startDate,
          endDate,
          budget,
          previousItinerary: itinerary,
          feedback,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to refine itinerary");
      setItinerary(data.itinerary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRefining(false);
    }
  }

  async function save() {
    if (!itinerary) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, startDate, endDate, budget, itinerary }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save trip");
      router.push(`/trip/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <main
      className={`flex min-h-full flex-col gap-6 bg-transparent p-5 sm:p-6 ${!preResult ? "dashboard-page" : "map-chrome-hidden"}`}
    >
      <GenerationLoader active={generating} />

      {/* Dashboard (result) view has no top navbar at all, per request — form/tier
          steps keep it. */}
      {preResult && (
        <div className="pointer-events-auto flex items-center justify-between rounded-2xl bg-slate-950/70 px-4 py-3 backdrop-blur-sm">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-accent-foreground">
            TripMate
          </h1>
          <Link href="/trips" className="text-sm font-medium text-accent-foreground hover:underline">
            My memories
          </Link>
        </div>
      )}

      {/* Anchored near the top of the hero band (not vertically centred) and wider than the
          tier/result cards, per the destination-form redesign. `contents` makes this wrapper
          vanish from layout in split mode, so the result step renders exactly as it did before. */}
      <div className={preResult ? "mx-auto mt-4 w-full max-w-6xl space-y-4" : "contents"}>
        {step === "form" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              chooseStyle();
            }}
            className={`flex flex-wrap items-end gap-3 ${cardClass}`}
          >
            <label className={`min-w-[200px] flex-[2] ${darkLabelClass}`}>
              Destination
              <input
                required
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Kyoto, Japan"
                className={darkInputClass}
              />
            </label>
            <label className={`min-w-[140px] flex-1 ${darkLabelClass}`}>
              Start date
              <input
                required
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={darkInputClass}
              />
            </label>
            <label className={`min-w-[140px] flex-1 ${darkLabelClass}`}>
              End date
              <input
                required
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={darkInputClass}
              />
            </label>
            <label className={`min-w-[130px] flex-1 ${darkLabelClass}`}>
              Total budget ($)
              <input
                required
                type="number"
                min={0}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className={darkInputClass}
              />
            </label>
            <button type="submit" className={`shrink-0 ${primaryButtonClass}`}>
              Choose your style
            </button>
          </form>
        )}

        {step === "tier" && !generating && (
          <div className={`space-y-5 ${cardClass}`}>
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">
                Choose your style
              </h2>
              <p className="mt-1 text-sm text-muted">
                Rough estimates for {tripDays(startDate, endDate)} day(s) in {destination}. Pick
                the one closest to the trip you want.
              </p>
            </div>
            <TierPicker days={tripDays(startDate, endDate)} selected={tier} onSelect={setTier} />
            <div className="flex justify-between pt-1">
              <button type="button" onClick={() => setStep("form")} className={ghostButtonClass}>
                Back
              </button>
              <button type="button" onClick={generate} className={primaryButtonClass}>
                Generate itinerary
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="pointer-events-auto rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>

      {step === "result" && itinerary && (
        // Docked panel floating over the full-screen globe rather than a normal-flow
        // block — `fixed` escapes AppShell's own scrollable content pane entirely, so
        // this positions relative to the viewport and scrolls independently.
        <div className="pointer-events-auto fixed top-6 right-6 bottom-6 left-6 z-10 m-0 space-y-6 overflow-y-auto sm:left-auto sm:w-[40%] sm:min-w-[360px] sm:max-w-[520px]">
          {!selectedStop && (
            <>
              <ItineraryCard
                itinerary={itinerary}
                budget={budget}
                destination={destination}
                onSelectStop={selectStop}
              />
              <FeedbackLoop onSave={save} onRefine={refine} saving={saving} refining={refining} />
            </>
          )}

          {selectedStop && (
            <PlaceDetailPanel
              stop={selectedStop}
              detail={detail}
              loading={detailLoading}
              error={detailError}
              onBack={closeDetail}
              upcomingStops={upcomingStopsAfter(itinerary, selectedStop)}
              onSelectUpcoming={selectStop}
            />
          )}
        </div>
      )}
    </main>
  );
}
