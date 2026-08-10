"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ItineraryCard from "@/components/ItineraryCard";
import FeedbackLoop from "@/components/FeedbackLoop";
import TierPicker from "@/components/TierPicker";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import GenerationLoader from "@/components/cesium/GenerationLoader";
import { PinIcon } from "@/components/icons";
import { closestTier, isTripTooLong, MAX_TRIP_DAYS, tripDays, TierId } from "@/lib/tiers";
import { Itinerary } from "@/lib/types";
import { useTripCamera } from "@/lib/useTripCamera";
import { upcomingStopsAfter } from "@/lib/itinerary";
import { GeoSuggestion, suggestDestinations } from "@/lib/weather";

type Step = "form" | "tier" | "result";

const primaryButtonClass =
  "rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
const ghostButtonClass =
  "rounded-full px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-tag-neutral-bg";
// Shared glass-over-globe card treatment — same class the itinerary/detail
// panels use, reused here for consistency across every step of this page.
const cardClass = "glass-itinerary rounded-2xl p-5 sm:p-6";

const darkLabelClass = "text-sm font-medium text-white/80";
const darkInputClass =
  "mt-1 w-full rounded-xl border border-white/15 bg-[rgba(255,255,255,0.08)] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";

function suggestionLabel(s: GeoSuggestion): string {
  return s.country ? `${s.name}, ${s.country}` : s.name;
}

function DestinationField({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: GeoSuggestion) => void;
}) {
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const requestIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldRef = useRef<HTMLLabelElement>(null);

  // Debounce is driven from the input's own onChange rather than an effect watching `value` —
  // selecting a suggestion also changes `value` via onChange(label), and an effect would have no
  // way to tell that apart from typing without re-triggering (and re-opening) the fetch.
  function handleInputChange(next: string) {
    onChange(next);
    if (timerRef.current) clearTimeout(timerRef.current);

    const query = next.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    timerRef.current = setTimeout(async () => {
      const results = await suggestDestinations(query);
      if (requestId !== requestIdRef.current) return; // a newer keystroke superseded this request
      setSuggestions(results);
      setOpen(results.length > 0);
    }, 300);
  }

  // Click-outside to close, rather than input onBlur — onBlur would fire before a
  // suggestion's onClick and close the list before the click registers.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (fieldRef.current && !fieldRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function handleSelect(s: GeoSuggestion) {
    if (timerRef.current) clearTimeout(timerRef.current);
    requestIdRef.current++; // invalidate any in-flight fetch
    onChange(suggestionLabel(s));
    setSuggestions([]);
    setOpen(false);
    onSelect(s);
  }

  return (
    <label ref={fieldRef} className={`relative min-w-[200px] flex-[2] ${darkLabelClass}`}>
      Destination
      <input
        required
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        placeholder="Kyoto, Japan"
        autoComplete="off"
        className={darkInputClass}
      />
      {open && (
        <ul className="geo-suggest-dropdown absolute inset-x-0 top-full mt-1 max-h-64 overflow-y-auto py-1">
          {suggestions.map((s, i) => (
            <li key={`${s.name}-${s.lat}-${s.lon}-${i}`}>
              <button
                type="button"
                onClick={() => handleSelect(s)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/10"
              >
                <PinIcon className="h-4 w-4 shrink-0 text-white/50" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{s.name}</span>
                  {(s.admin1 || s.country) && (
                    <span className="block truncate text-xs text-[#94A3B8]">
                      {[s.admin1, s.country].filter(Boolean).join(", ")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

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
    flyToDestinationByCoords,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  } = useTripCamera(destination);

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
      className={`flex min-h-full flex-col gap-6 bg-transparent p-5 sm:p-6 ${!preResult ? "dashboard-page" : ""}`}
    >
      <GenerationLoader active={generating} />

      {/* Anchored near the top of the hero band (not vertically centred) and wider than the
          tier/result cards, per the destination-form redesign. `contents` makes this wrapper
          vanish from layout in split mode, so the result step renders exactly as it did before.
          mt-10 (2.5rem) clears the floating "TripMate" header text above it. */}
      <div className={preResult ? "mx-auto mt-10 w-full max-w-6xl space-y-4" : "contents"}>
        {step === "form" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              chooseStyle();
            }}
            className="form-card-black flex flex-wrap items-end gap-3 p-5 sm:p-6"
          >
            <DestinationField
              value={destination}
              onChange={setDestination}
              onSelect={(s) => flyToDestinationByCoords(s.lat, s.lon, s.name)}
            />
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
            <button
              type="submit"
              className="btn-neon shrink-0 rounded-full px-5 py-2.5 text-sm active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
            >
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
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>

      {step === "result" && itinerary && (
        // Docked panel floating over the full-screen globe rather than a normal-flow
        // block — `fixed` escapes AppShell's own scrollable content pane entirely, so
        // this positions relative to the viewport and scrolls independently.
        <div className="fixed top-6 right-6 bottom-6 left-6 z-10 m-0 space-y-6 overflow-y-auto sm:left-auto sm:w-[40%] sm:min-w-[360px] sm:max-w-[520px]">
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
