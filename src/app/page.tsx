"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ItineraryCard from "@/components/ItineraryCard";
import FeedbackLoop from "@/components/FeedbackLoop";
import TierPicker from "@/components/TierPicker";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import { useHeroLayout } from "@/components/AppShell";
import { closestTier, isTripTooLong, MAX_TRIP_DAYS, tripDays, TierId } from "@/lib/tiers";
import { Itinerary } from "@/lib/types";
import { useTripCamera } from "@/lib/useTripCamera";

type Step = "form" | "tier" | "result";

const inputClass =
  "mt-1 w-full rounded-xl border border-card-border bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";
const primaryButtonClass =
  "rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
const ghostButtonClass =
  "rounded-full px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-tag-neutral-bg";
const cardClass = "card rounded-2xl p-5 sm:p-6";

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

  // The globe is a hero band behind the form until there's an itinerary to show, at which
  // point the shell reverts to its split panes — the itinerary is far too dense to layer.
  const hero = step !== "result";
  useHeroLayout(hero);

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
    <main className="flex min-h-full flex-col gap-6 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h1
          className={`font-display text-2xl font-semibold tracking-tight ${
            hero ? "text-accent-foreground" : "text-foreground"
          }`}
        >
          TripMate
        </h1>
        <Link
          href="/trips"
          className={`text-sm font-medium ${
            // Full opacity, not /80 — at 14px this needs the full 4.5:1 against the scrim.
            hero
              ? "text-accent-foreground hover:underline"
              : "text-accent hover:text-accent-hover"
          }`}
        >
          My trips
        </Link>
      </div>

      {/* `mt-auto` rather than centring on the parent: an auto margin collapses to 0 once the
          content outgrows the space, so a tall tier card on a short viewport stays fully
          reachable instead of being centre-clipped. The bottom margin sets how far the card
          sits down over the globe band. `contents` makes this wrapper vanish from layout in
          split mode, so the result step renders exactly as it did before. */}
      <div
        className={
          hero ? "mx-auto mt-auto mb-[12vh] w-full max-w-2xl space-y-4" : "contents"
        }
      >
        {step === "form" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              chooseStyle();
            }}
            className={`grid grid-cols-2 gap-4 ${cardClass}`}
          >
            <label className="col-span-2 text-sm font-medium text-foreground/80">
              Destination
              <input
                required
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Kyoto, Japan"
                className={inputClass}
              />
            </label>
            <label className="text-sm font-medium text-foreground/80">
              Start date
              <input
                required
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-medium text-foreground/80">
              End date
              <input
                required
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="col-span-2 text-sm font-medium text-foreground/80">
              Total budget ($)
              <input
                required
                type="number"
                min={0}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className={inputClass}
              />
            </label>
            <button type="submit" className={`col-span-2 mt-1 ${primaryButtonClass}`}>
              Choose your style
            </button>
          </form>
        )}

        {step === "tier" && (
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
              <button
                type="button"
                onClick={generate}
                disabled={generating}
                className={primaryButtonClass}
              >
                {generating ? "Generating itinerary…" : "Generate itinerary"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-300/60 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>

      {step === "result" && itinerary && !selectedStop && (
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

      {step === "result" && itinerary && selectedStop && (
        <PlaceDetailPanel
          stop={selectedStop}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onBack={closeDetail}
        />
      )}
    </main>
  );
}
