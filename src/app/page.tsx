"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DayList from "@/components/DayList";
import BudgetBar from "@/components/BudgetBar";
import FeedbackLoop from "@/components/FeedbackLoop";
import { Itinerary } from "@/lib/types";

const ItineraryMap = dynamic(() => import("@/components/ItineraryMap"), {
  ssr: false,
});

export default function Home() {
  const router = useRouter();
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState(1000);

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, startDate, endDate, budget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate itinerary");
      setItinerary(data.itinerary);
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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">TripMate</h1>
        <Link href="/trips" className="text-sm text-orange-600 hover:underline">
          My trips
        </Link>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          generate();
        }}
        className="mb-8 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 p-4"
      >
        <label className="col-span-2 text-sm">
          Destination
          <input
            required
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Kyoto, Japan"
            className="mt-1 w-full rounded-md border border-gray-300 p-2"
          />
        </label>
        <label className="text-sm">
          Start date
          <input
            required
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 p-2"
          />
        </label>
        <label className="text-sm">
          End date
          <input
            required
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 p-2"
          />
        </label>
        <label className="col-span-2 text-sm">
          Total budget ($)
          <input
            required
            type="number"
            min={0}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-gray-300 p-2"
          />
        </label>
        <button
          type="submit"
          disabled={generating}
          className="col-span-2 rounded-md bg-orange-600 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {generating ? "Generating itinerary…" : "Generate itinerary"}
        </button>
      </form>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {itinerary && (
        <div className="space-y-6">
          <ItineraryMap days={itinerary.days} />
          <BudgetBar days={itinerary.days} budget={budget} />
          <DayList days={itinerary.days} />
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
