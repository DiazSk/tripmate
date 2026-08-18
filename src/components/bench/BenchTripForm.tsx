"use client";

import { useState } from "react";
import { INTEREST_TAGS } from "@/components/InterestPicker";
import { MAX_STARRED_PRIORITIES } from "@/lib/userAnswers";
import type { CustomTripInput } from "@/lib/bench/customTrip";

/**
 * The benchmark's own trip form: the same inputs the real app collects, so a developer can bench a
 * trip they care about instead of only the frozen fixtures.
 *
 * Submitting runs the app's REAL Step 2a fetch (geocode, weather, holidays, candidate POIs), then
 * reconcile and POI enrichment, and freezes the result. Nothing is generated here — the trip is
 * just prepared. That separation is deliberate: the bundle has to be fixed BEFORE any model sees
 * it, or the models are answering subtly different questions (see customTrip.ts).
 *
 * Fields mirror `UserAnswers` exactly, including the app's own `INTEREST_TAGS` vocabulary and the
 * 3-star cap, so the flags this produces are byte-identical to what the traveler-facing flow would
 * have produced for the same answers.
 */

const GROUPS: { value: CustomTripInput["group"]; label: string }[] = [
  { value: "solo", label: "Solo" },
  { value: "couple", label: "Couple" },
  { value: "family_with_kids", label: "Family with kids" },
];
const STYLES: { value: CustomTripInput["explorerStyle"]; label: string }[] = [
  { value: "packed", label: "Packed" },
  { value: "mixed", label: "Mixed" },
  { value: "relaxed", label: "Relaxed" },
  { value: "offbeat", label: "Offbeat" },
];
const ENERGIES: { value: CustomTripInput["energy"]; label: string }[] = [
  { value: "high", label: "High" },
  { value: "moderate", label: "Moderate" },
  { value: "low", label: "Low" },
];
const CROWDS: { value: CustomTripInput["crowds"]; label: string }[] = [
  { value: "love", label: "Love them" },
  { value: "mixed", label: "Mixed" },
  { value: "avoid", label: "Avoid" },
];

function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const FIELD = "w-full rounded border border-stone-300 px-2 py-1 text-sm";
const LABEL = "block text-xs font-medium text-stone-600";

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className={LABEL}>{label}</span>
      <div className="mt-1 flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded border px-2 py-1 text-xs ${
              value === o.value
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-300 text-stone-600"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function BenchTripForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (input: CustomTripInput) => Promise<{ error?: string; notes?: { field: string; detail: string }[] }>;
}) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("Kyoto, Japan");
  const [startDate, setStartDate] = useState(isoInDays(30));
  const [endDate, setEndDate] = useState(isoInDays(33));
  const [budget, setBudget] = useState("2000");
  const [purpose, setPurpose] = useState("");
  const [explorerStyle, setExplorerStyle] = useState<CustomTripInput["explorerStyle"]>("mixed");
  const [group, setGroup] = useState<CustomTripInput["group"]>("couple");
  const [energy, setEnergy] = useState<CustomTripInput["energy"]>("moderate");
  const [crowds, setCrowds] = useState<CustomTripInput["crowds"]>("mixed");
  const [priorities, setPriorities] = useState<string[]>(["Culture & History", "Food"]);
  const [starred, setStarred] = useState<string[]>(["Culture & History", "Food"]);
  const [customPois, setCustomPois] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [stayBooked, setStayBooked] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<{ field: string; detail: string }[]>([]);

  const toggleTag = (tag: string) => {
    setPriorities((cur) => {
      const next = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag];
      if (!next.includes(tag)) setStarred((s) => s.filter((t) => t !== tag));
      return next;
    });
  };

  const toggleStar = (tag: string) => {
    setStarred((cur) => {
      if (cur.includes(tag)) return cur.filter((t) => t !== tag);
      if (cur.length >= MAX_STARRED_PRIORITIES) return cur;
      return [...cur, tag];
    });
  };

  const submit = async () => {
    setError(null);
    setNotes([]);
    if (!destination.trim()) return setError("Destination is required.");
    if (endDate < startDate) return setError("End date must be on or after the start date.");

    const result = await onCreate({
      destination: destination.trim(),
      startDate,
      endDate,
      budget: Number(budget) || 0,
      purpose: purpose.trim(),
      explorerStyle,
      group,
      energy,
      crowds,
      priorities,
      topPriorities: starred.slice(0, MAX_STARRED_PRIORITIES),
      customPois: customPois
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      arrivalTime: arrivalTime || null,
      departureTime: departureTime || null,
      stayBooked: stayBooked.trim() || null,
    });

    if (result.error) setError(result.error);
    else setNotes(result.notes ?? []);
  };

  if (!open) {
    return (
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-stone-900">Bench your own trip</h2>
            <p className="text-xs text-stone-500">
              Runs the real Step 2a fetch + reconcile, freezes the bundle, then every model plans
              that identical trip.
            </p>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-md border border-stone-300 px-3 py-1.5 text-sm"
          >
            New trip…
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-stone-300 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-stone-900">Bench your own trip</h2>
        <button onClick={() => setOpen(false)} className="text-xs text-stone-500 underline">
          Close
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className={LABEL} htmlFor="bench-dest">Destination</label>
          <input
            id="bench-dest"
            className={FIELD}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Kyoto, Japan"
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="bench-start">Start date</label>
          <input id="bench-start" type="date" className={FIELD} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className={LABEL} htmlFor="bench-end">End date</label>
          <input id="bench-end" type="date" className={FIELD} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        <div>
          <label className={LABEL} htmlFor="bench-budget">Budget (USD)</label>
          <input id="bench-budget" type="number" className={FIELD} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        <div className="lg:col-span-3">
          <label className={LABEL} htmlFor="bench-purpose">Purpose (free text)</label>
          <input
            id="bench-purpose"
            className={FIELD}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="First trip to Japan, temples and food without the worst crowds"
          />
        </div>

        <Choice label="Explorer style" value={explorerStyle} options={STYLES} onChange={setExplorerStyle} />
        <Choice label="Group" value={group} options={GROUPS} onChange={setGroup} />
        <Choice label="Energy" value={energy} options={ENERGIES} onChange={setEnergy} />
        <Choice label="Crowds" value={crowds} options={CROWDS} onChange={setCrowds} />
      </div>

      <div className="mt-3">
        <span className={LABEL}>
          Interests — star up to {MAX_STARRED_PRIORITIES} that matter most (those drive the plan)
        </span>
        <div className="mt-1 flex flex-wrap gap-1">
          {INTEREST_TAGS.map((tag) => {
            const on = priorities.includes(tag);
            const star = starred.includes(tag);
            return (
              <span key={tag} className="inline-flex">
                <button
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-l border px-2 py-1 text-xs ${
                    on ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 text-stone-600"
                  }`}
                >
                  {tag}
                </button>
                <button
                  type="button"
                  disabled={!on}
                  onClick={() => toggleStar(tag)}
                  title={star ? "Starred" : "Star this"}
                  className={`rounded-r border border-l-0 px-1.5 py-1 text-xs disabled:opacity-30 ${
                    star ? "border-amber-500 bg-amber-100 text-amber-800" : "border-stone-300 text-stone-400"
                  }`}
                >
                  ★
                </button>
              </span>
            );
          })}
        </div>
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-stone-600">Already booked (optional)</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="bench-arrival">Arrival time (day 1)</label>
            <input id="bench-arrival" type="time" className={FIELD} value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="bench-departure">Departure time (last day)</label>
            <input id="bench-departure" type="time" className={FIELD} value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="bench-stay">Stay already booked</label>
            <input id="bench-stay" className={FIELD} value={stayBooked} onChange={(e) => setStayBooked(e.target.value)} placeholder="Guesthouse in Gion" />
          </div>
        </div>
        <div className="mt-2">
          <label className={LABEL} htmlFor="bench-pois">Must-visit places (comma separated)</label>
          <input id="bench-pois" className={FIELD} value={customPois} onChange={(e) => setCustomPois(e.target.value)} placeholder="Fushimi Inari Taisha, Nishiki Market" />
        </div>
      </details>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {busy ? "Fetching trip data…" : "Prepare trip"}
        </button>
        <span className="text-xs text-stone-500">
          Fetches once and freezes — no model is called yet.
        </span>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {notes.length > 0 && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <p className="font-medium">Trip prepared, with degraded sources:</p>
          <ul className="ml-4 list-disc">
            {notes.map((n, i) => (
              <li key={i}>
                <code>{n.field}</code> — {n.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
