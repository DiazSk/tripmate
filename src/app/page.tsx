"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ItineraryCard from "@/components/ItineraryCard";
import FeedbackLoop from "@/components/FeedbackLoop";
import TierPicker from "@/components/TierPicker";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import UnboxingContainer from "@/components/cesium/UnboxingContainer";
import { useHeroLayout } from "@/components/AppShell";
import { closestTier, isTripTooLong, MAX_TRIP_DAYS, tripDays, TierId } from "@/lib/tiers";
import { ContainerTheme, DEFAULT_CONTAINER_THEME, Itinerary } from "@/lib/types";
import { useTripCamera } from "@/lib/useTripCamera";
import { upcomingStopsAfter } from "@/lib/itinerary";

type Step = "form" | "tier" | "result";

// Decorative and non-blocking: the unboxing container just shows the default
// theme until/unless this resolves, so a slow or failed call never holds up
// the actual search flow.
async function fetchContainerTheme(destination: string): Promise<ContainerTheme> {
  try {
    const res = await fetch(`/api/container-theme?destination=${encodeURIComponent(destination)}`);
    const data = await res.json();
    return data.theme ?? DEFAULT_CONTAINER_THEME;
  } catch {
    return DEFAULT_CONTAINER_THEME;
  }
}

const primaryButtonClass =
  "rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
const ghostButtonClass =
  "rounded-full px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-tag-neutral-bg";
const cardClass = "card rounded-2xl p-5 sm:p-6";

// Dark variant, scoped to the destination search form only — the rest of the
// flow (tier picker, results) stays on the light "card" theme.
const darkCardClass = "rounded-2xl border border-white/10 bg-stone-950/90 p-5 sm:p-6";
const darkLabelClass = "text-sm font-medium text-white/80";
const darkInputClass =
  "mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";

// Structural/interaction classes only — background is the animated
// `cta-gradient-loop` sweep (globals.css). Glassmorphism: backdrop-blur + a
// faint top-edge highlight border, so the globe behind it stays partly visible.
const ctaButtonClass =
  "rounded-full border border-white/30 px-5 py-2.5 text-sm font-semibold backdrop-blur-md transition-all duration-150 hover:scale-[1.02] hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";

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
  const [containerTheme, setContainerTheme] = useState<ContainerTheme>(DEFAULT_CONTAINER_THEME);

  // open while choosing a style (destination resolved), closed while generating, hidden otherwise.
  const giftBoxState = step === "tier" ? (generating ? "closed" : "open") : "hidden";

  const {
    flyToDestinationByName,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  } = useTripCamera(destination);

  // `hero` still drives this page's own cosmetics (dark dashboard header/nav once results
  // exist, destination-form positioning) — but AppShell itself is now always told to use the
  // full-screen-globe overlay layout (not the split panes), even once there's an itinerary,
  // so the globe stays visible behind the glass card instead of the shell reverting away
  // from it.
  const hero = step !== "result";
  useHeroLayout(true);

  async function chooseStyle() {
    if (isTripTooLong(startDate, endDate)) {
      setError(`Trips over ${MAX_TRIP_DAYS} days aren't supported — please choose a shorter date range.`);
      return;
    }
    setError(null);
    const days = tripDays(startDate, endDate);
    setTier(closestTier(budget, days));
    setStep("tier");
    fetchContainerTheme(destination).then(setContainerTheme);
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
      className={`flex min-h-full flex-col gap-6 bg-transparent p-5 sm:p-6 ${!hero ? "dashboard-page" : ""}`}
    >
      <UnboxingContainer state={giftBoxState} theme={containerTheme} />

      {/* Dashboard (result) view has no top navbar at all, per request — form/tier
          steps keep it. */}
      {hero && (
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-accent-foreground">
            TripMate
          </h1>
          <Link
            href="/trips"
            // Full opacity, not /80 — at 14px this needs the full 4.5:1 against the scrim.
            className="text-sm font-medium text-accent-foreground hover:underline"
          >
            My memories
          </Link>
        </div>
      )}

      {/* Anchored near the top of the hero band (not vertically centred) and wider than the
          tier/result cards, per the destination-form redesign. `contents` makes this wrapper
          vanish from layout in split mode, so the result step renders exactly as it did before. */}
      <div className={hero ? "mx-auto mt-4 w-full max-w-6xl space-y-4" : "contents"}>
        {step === "form" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              chooseStyle();
            }}
            className={`flex flex-wrap items-end gap-3 ${darkCardClass}`}
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
            <button
              type="submit"
              className={`shrink-0 cta-gradient-loop ${ctaButtonClass}`}
              style={{
                color: "#0F172A",
                boxShadow: "0 0 15px rgba(255, 255, 255, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.35)",
              }}
            >
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
          <div
            className={
              hero
                ? "rounded-xl border border-red-300/60 bg-red-50 p-3 text-sm text-red-800"
                : "rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
            }
          >
            {error}
          </div>
        )}
      </div>

      {step === "result" && itinerary && (
        // Docked panel floating over the full-screen globe rather than a normal-flow
        // block — `fixed` escapes AppShell's own scrollable content pane entirely, so
        // this positions relative to the viewport and scrolls independently.
        <div className="fixed top-6 right-6 bottom-6 z-10 m-0 w-[40%] min-w-[360px] max-w-[520px] space-y-6 overflow-y-auto">
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
