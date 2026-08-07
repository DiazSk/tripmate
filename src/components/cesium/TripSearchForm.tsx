"use client";

import { useState } from "react";
import type { TripFormData } from "@/hooks/useTripState";

const TRENDING_DESTINATIONS: { label: string; trending?: boolean }[] = [
  { label: "Kyoto", trending: true },
  { label: "Tokyo" },
  { label: "Paris" },
  { label: "Bali" },
];

const LABEL_CLASS = "block text-xs font-medium text-[rgba(240,240,240,0.9)]";
const INPUT_CLASS =
  "mt-1.5 w-full rounded-lg border border-white/15 bg-slate-900/65 px-3 py-2 text-white placeholder:text-white/40 outline-none transition-colors [color-scheme:dark] focus:border-orange-500/80 focus:ring-2 focus:ring-orange-500/20";

export default function TripSearchForm({
  onSubmit,
  disabled,
  submitting,
}: {
  onSubmit: (data: TripFormData) => void;
  disabled?: boolean;
  submitting?: boolean;
}) {
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState(1000);

  return (
    <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-2xl backdrop-blur-xl">
      <h2
        className="text-2xl font-bold tracking-tight text-white"
        style={{ textShadow: "0 2px 12px rgba(0,0,0,0.45)" }}
      >
        Plan your next trip
      </h2>
      <p className="mt-1.5 text-sm text-white/85">
        Tell us where and when — we&apos;ll build a day-by-day itinerary that fits your
        budget.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ destination, startDate, endDate, budget });
        }}
        className="mt-4 flex flex-col gap-3 md:flex-row md:items-end"
      >
        <label className={`${LABEL_CLASS} md:flex-[2]`}>
          Destination or vibe
          <input
            required
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Kyoto, Japan"
            className={INPUT_CLASS}
          />
        </label>

        <label className={`${LABEL_CLASS} md:flex-1`}>
          Start date
          <input
            required
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>

        <label className={`${LABEL_CLASS} md:flex-1`}>
          End date
          <input
            required
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>

        <label className={`${LABEL_CLASS} md:flex-1`}>
          Total budget ($)
          <input
            required
            type="number"
            min={0}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>

        <button
          type="submit"
          disabled={disabled || submitting}
          className="mt-1 shrink-0 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-5 py-2.5 font-semibold text-white shadow-lg shadow-orange-500/25 transition-all hover:scale-[1.02] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:brightness-100 md:mt-0"
        >
          {submitting ? "Finding destination…" : disabled ? "Loading globe…" : "Plan My Trip"}
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {TRENDING_DESTINATIONS.map((d) => (
          <button
            key={d.label}
            type="button"
            onClick={() => setDestination(d.label)}
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:border-orange-400/50 hover:bg-white/10 hover:text-white"
          >
            {d.trending ? `🔥 ${d.label}` : d.label}
          </button>
        ))}
      </div>
    </div>
  );
}
