"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ItineraryCard from "@/components/ItineraryCard";
import FeedbackLoop from "@/components/FeedbackLoop";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import ScrollStory from "@/components/blue-hour/ScrollStory";
import TripFormConsole from "@/components/blue-hour/TripFormConsole";
import GenerationLoader from "@/components/cesium/GenerationLoader";
import ErrorNote from "@/components/ErrorNote";
import DockedPanel from "@/components/DockedPanel";
import { closestTier, isTripTooLong, MAX_TRIP_DAYS, tripDays, TierId } from "@/lib/tiers";
import { Itinerary } from "@/lib/types";
import { GeocodeOutcome, useTripCamera } from "@/lib/useTripCamera";
import { useMapCamera } from "@/lib/mapCamera";
import { upcomingStopsAfter } from "@/lib/itinerary";

type Step = "landing" | "plan" | "result";

/** The server's own message when it wrote one for a person, this operation's own
 *  sentence otherwise — a network throw has a message like "Failed to fetch". */
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("landing");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState(1000);
  const [tier, setTier] = useState<TierId>("midrange");
  const [geocode, setGeocode] = useState<GeocodeOutcome>("found");

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
  // and camera. Stepping plan → landing inside this page doesn't remount, so backToLanding()
  // calls resetToHome() itself.
  useEffect(() => {
    resetToHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drives this page's own cosmetics (dark dashboard header/nav once results exist,
  // destination-form positioning) — AppShell's layout itself no longer varies by route/step.
  // Also gates the map control stack via .map-chrome-hidden: hidden on landing (that step is
  // a poster, not a map to read) and on plan (the panel reaches the bottom-left corner below
  // ~1292px), shown on result. Do not "simplify" this to step === "landing".
  const preResult = step !== "result";

  // Null until both dates are set, so the tier cards show per-day rates rather than a total
  // derived from tripDays' floor-at-1.
  const days = startDate && endDate ? tripDays(startDate, endDate) : null;

  // The cap used to be discoverable only by submitting: the picker happily offered a
  // five-year range and then the form refused it. `tripDays` counts inclusively, so
  // the last allowed end date is start + 29.
  const maxEndDate = startDate
    ? new Date(new Date(startDate).getTime() + (MAX_TRIP_DAYS - 1) * 86400000)
        .toISOString()
        .slice(0, 10)
    : undefined;

  // Auto-pick tracks budget and dates live, right up until the user picks a card themselves —
  // that live coupling is the whole point of merging the form and the tier step. A ref, not
  // state, because flipping the flag must not re-run the effect that reads it.
  const tierTouched = useRef(false);
  useEffect(() => {
    if (tierTouched.current || days === null) return;
    setTier(closestTier(budget, days));
  }, [budget, days]);

  function pickTier(next: TierId) {
    tierTouched.current = true;
    setTier(next);
  }

  // One geocode per completed edit of the destination field, fired on blur. Not on a
  // keystroke debounce: mapCamera's flyTo calls stopAutoRotate(), which is a permanent lock
  // only resetToHome() ever clears, so the first keystroke-triggered flight would kill the
  // idle spin for the session — and the overlapping 2.5s flights visibly lurch the camera
  // through everywhere the prefix matched on the way to the real destination.
  const lastFlownRef = useRef("");
  async function flyToTypedDestination() {
    const name = destination.trim();
    if (!name || name === lastFlownRef.current) return;
    lastFlownRef.current = name;
    setGeocode(await flyToDestinationByName(name));
  }

  function backToLanding() {
    setStep("landing");
    setError(null);
    // Required, not cosmetic: a blur-triggered flight left the spin locked and a pin dropped.
    // resetToHome is the only thing that clears the pin and calls startAutoRotate() again.
    resetToHome();
  }

  /** Cross-field rules the browser's own constraint validation can't express. */
  function validate(): string | null {
    if (endDate < startDate) return "End date must be on or after the start date.";
    if (isTripTooLong(startDate, endDate)) {
      return `Trips longer than ${MAX_TRIP_DAYS} days aren't supported. Choose a shorter date range.`;
    }
    return null;
  }

  async function generate() {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, startDate, endDate, budget, tier }),
      });
      const data = await res.json();
      // Each of the three operations names itself in its fallback: "Something went
      // wrong" was the message for generate, refine and save alike, which told you
      // neither what failed nor what to do next.
      if (!res.ok) throw new Error(data.error);
      setItinerary(data.itinerary);
      setStep("result");
    } catch (e) {
      setError(errorMessage(e, "We couldn't build your itinerary. Try generating again."));
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
      if (!res.ok) throw new Error(data.error);
      setItinerary(data.itinerary);
    } catch (e) {
      setError(errorMessage(e, "We couldn't apply that change. Your current plan is unchanged."));
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
      if (!res.ok) throw new Error(data.error);
      router.push(`/trip/${data.id}`);
    } catch (e) {
      setError(errorMessage(e, "We couldn't save this trip. Try again."));
      setSaving(false);
    }
  }

  return (
    // pt-[calc(var(--nav-h)+1.25rem)]: clearance for the fixed glass navbar (AppShell
    // renders it above this content). Only the top padding changes — ScrollStory's own
    // cancelling wrapper mirrors this exact value so its full-bleed sections still
    // reach the very top, behind the (transparent) nav, unaffected by this gap.
    <main
      className={`flex min-h-full flex-col gap-6 bg-transparent p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)] ${!preResult ? "dashboard-page" : "map-chrome-hidden blue-hour-scene font-scene-body"}`}
    >
      {/* Refining is the same 30–60s wait as generating and used to show only a changed
          word on a button, with the stale itinerary still fully interactive underneath. */}
      <GenerationLoader active={generating || refining} mode={refining ? "refine" : "generate"} />

      {/* The plan step's own "My memories" link used to render here — moved into the
          global nav (Navbar.tsx), which now carries it on every step of this route. */}

      {/* The scroll story owns its own full-bleed beats (each min-h-[140dvh]) rather than
          living inside <main>'s flex-1 centering column — it needs real scroll height, not
          a single centered viewport. */}
      {step === "landing" && <ScrollStory onPlan={() => setStep("plan")} />}

      {/* Form and tier picker merged into one card: the dates and budget are what price the
          tiers, so splitting them across two steps meant choosing a style blind. One <form>
          around both halves so the browser's own constraint validation gates the submit
          button that now sits below the tier cards. Extracted to TripFormConsole so this
          step's markup can be redesigned in isolation from `landing`/`result`. */}
      {step === "plan" && !generating && (
        <TripFormConsole
          destination={destination}
          onDestinationChange={(value) => {
            setDestination(value);
            setGeocode("found");
          }}
          onDestinationBlur={flyToTypedDestination}
          geocode={geocode}
          startDate={startDate}
          onStartDateChange={setStartDate}
          endDate={endDate}
          onEndDateChange={setEndDate}
          maxEndDate={maxEndDate}
          budget={budget}
          onBudgetChange={setBudget}
          days={days}
          tier={tier}
          onPickTier={pickTier}
          onBack={backToLanding}
          onSubmit={generate}
          error={error}
        />
      )}

      {step === "result" && itinerary && (
        // Docked panel floating over the full-screen globe rather than a normal-flow
        // block — `fixed` escapes AppShell's own scrollable content pane entirely, so
        // this positions relative to the viewport and scrolls independently.
        <DockedPanel collapsible busy={refining}>
          {/* Hidden, not unmounted. ItineraryCard owns the active day index, the panel
              owns its scroll position, and the tour owns its interval — unmounting the
              card to show a place detail threw all three away, so coming back from a
              stop on day 5 landed you on day 1 at the top of the panel. */}
          <div className={selectedStop ? "hidden" : "space-y-6"}>
            <ItineraryCard
              itinerary={itinerary}
              budget={budget}
              destination={destination}
              onSelectStop={selectStop}
            />
            {error && <ErrorNote>{error}</ErrorNote>}
            <FeedbackLoop onSave={save} onRefine={refine} saving={saving} refining={refining} />
          </div>

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
        </DockedPanel>
      )}
    </main>
  );
}
