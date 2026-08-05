"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DayList from "@/components/DayList";
import BudgetBar from "@/components/BudgetBar";
import FeedbackLoop from "@/components/FeedbackLoop";
import TierPicker from "@/components/TierPicker";
import { closestTier, tripDays, TierId } from "@/lib/tiers";
import { Itinerary, Stop } from "@/lib/types";

const ItineraryMap = dynamic(() => import("@/components/ItineraryMap"), {
  ssr: false,
});

type Step = "form" | "tier" | "result";

const inputClass =
  "mt-1 w-full rounded-xl border border-card-border bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";
const primaryButtonClass =
  "rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
const ghostButtonClass =
  "rounded-full px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-foreground/5";
const cardClass =
  "rounded-2xl border border-card-border bg-card p-5 shadow-[0_1px_2px_rgba(32,28,25,0.04),0_8px_24px_-12px_rgba(32,28,25,0.12)] sm:p-6";

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState(1000);
  const [tier, setTier] = useState<TierId>("midrange");

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseStyle() {
    const days = tripDays(startDate, endDate);
    setTier(closestTier(budget, days));
    setStep("tier");
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
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <div className="mb-10 flex items-center justify-between">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          TripMate
        </h1>
        <Link href="/trips" className="text-sm font-medium text-accent hover:text-accent-hover">
          My trips
        </Link>
      </div>

      {step === "form" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            chooseStyle();
          }}
          className={`mb-8 grid grid-cols-2 gap-4 ${cardClass}`}
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
        <div className={`mb-8 space-y-5 ${cardClass}`}>
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Choose your style
            </h2>
            <p className="mt-1 text-sm text-muted">
              Rough estimates for {tripDays(startDate, endDate)} day(s) in {destination}. Pick the
              one closest to the trip you want.
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
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {step === "result" && itinerary && (
        <div className="space-y-6">
          <ItineraryMap destination={destination} selectedStop={selectedStop} />
          <div className={cardClass}>
            <BudgetBar days={itinerary.days} budget={budget} />
          </div>
          <DayList days={itinerary.days} onSelectStop={setSelectedStop} />
          <FeedbackLoop
            onSave={save}
            onRefine={refine}
            saving={saving}
            refining={refining}
          />
        </div>
      )}
    </main>
  );
}
