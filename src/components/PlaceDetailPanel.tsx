"use client";

import { useEffect, useRef } from "react";
import { PlaceDetail, Stop } from "@/lib/types";
import BackButton from "@/components/BackButton";
import { devLabel } from "@/lib/devInspector";
import { formatMoney } from "@/lib/format";

/** The field labels inside this panel. Uppercase is a field-label device in this
 *  system, but a styled div is not a heading — these were unreachable by heading
 *  navigation, which is the main way a long panel gets skimmed. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{children}</h2>
  );
}

export default function PlaceDetailPanel({
  stop,
  detail,
  loading,
  error,
  onBack,
  actualCost,
  onActualCostChange,
  upcomingStops,
  onSelectUpcoming,
}: {
  stop: Stop;
  detail: PlaceDetail | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  actualCost?: number;
  onActualCostChange?: (value: number | undefined) => void;
  /** Remaining stops for the same day, in order — powers the "Next up" quick-nav list. */
  upcomingStops?: Stop[];
  onSelectUpcoming?: (stop: Stop) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Selecting a stop unmounts the row that had focus, so focus lands on <body> and
  // a keyboard or screen-reader user is left at the top of the document with no
  // indication the panel opened. Move it to the panel's own heading instead — and
  // re-run per stop, because "Next up" swaps the content without remounting.
  useEffect(() => {
    headingRef.current?.focus();
  }, [stop.name]);

  const numberFieldClass =
    "h-11 w-24 rounded-md border border-card-border bg-white/10 pr-2 pl-6 text-base tabular-nums text-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

  return (
    <div
      className="glass-itinerary flex flex-col rounded-none p-5 sm:rounded-2xl sm:p-6"
      {...devLabel("PlaceDetailPanel")}
    >
      <BackButton onClick={onBack} className="mb-4">
        Back to itinerary
      </BackButton>

      {/* tabIndex={-1} makes the heading a focus target without putting it in the tab
          order — it is where focus goes when this panel replaces the itinerary. */}
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-xl font-semibold text-foreground focus-visible:outline-none"
      >
        {stop.name}
      </h1>
      {stop.note && <p className="mt-1 text-sm text-muted">{stop.note}</p>}

      {/* The guidebook text arrives from a model call per stop and nothing here is
          instant, so the region announces its own state rather than filling silently. */}
      <div className="mt-5 space-y-4 text-sm" aria-busy={loading} aria-live="polite">
        {loading && (
          <>
            <span className="sr-only">Looking up {stop.name}…</span>
            <div className="animate-pulse space-y-3" aria-hidden="true">
              <div className="h-3 w-full rounded bg-foreground/10" />
              <div className="h-3 w-5/6 rounded bg-foreground/10" />
              <div className="h-3 w-2/3 rounded bg-foreground/10" />
            </div>
          </>
        )}

        {error && !loading && <p className="text-sm text-alert">{error}</p>}

        {detail && !loading && (
          <>
            {detail.history && <p className="leading-relaxed text-foreground/90">{detail.history}</p>}
            {detail.bestTime && (
              <div>
                <FieldLabel>Best time to visit</FieldLabel>
                <p className="mt-1 text-foreground/90">{detail.bestTime}</p>
              </div>
            )}
            {detail.duration && (
              <div>
                <FieldLabel>Suggested duration</FieldLabel>
                <p className="mt-1 text-foreground/90">{detail.duration}</p>
              </div>
            )}
            {/* Guarded: an empty tips array used to leave the heading standing over an
                empty list. */}
            {detail.tips?.length > 0 && (
              <div>
                <FieldLabel>Tips</FieldLabel>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/90">
                  {detail.tips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* A response can succeed and carry nothing — the panel body was then simply
            blank, with no loading, no error and nothing to read. */}
        {!loading && !error && !detail && (
          <p className="text-sm text-muted">
            No guidebook entry for this place yet. Reopening it will try again.
          </p>
        )}

        {onSelectUpcoming && upcomingStops && upcomingStops.length > 0 && (
          <div className="border-t border-card-border pt-4">
            <FieldLabel>Next up</FieldLabel>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
              {upcomingStops.map((next, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelectUpcoming(next)}
                  className="min-h-11 shrink-0 rounded-xl border border-card-border bg-white/10 px-3 py-2 text-left transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <div className="text-sm font-medium text-foreground">{next.name}</div>
                  {(next.time || next.durationLabel) && (
                    <div className="text-xs text-muted">
                      {[next.time, next.durationLabel].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-card-border pt-4">
          <span className="font-medium tabular-nums text-foreground">
            Estimated {formatMoney(stop.cost)}
          </span>
          {onActualCostChange && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Actual
              <span className="relative flex items-center">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 text-base text-muted"
                >
                  $
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="decimal"
                  // Same reasoning as the lodging field in `ItineraryCard`: the wrapping label's
                  // "Actual" is a name, not a useful one, and the `$` beside it is aria-hidden.
                  aria-label={`Actual cost in dollars for ${stop.name}`}
                  title="What you actually paid. Replaces the estimate in this trip's budget total."
                  defaultValue={actualCost}
                  onBlur={(e) =>
                    onActualCostChange(e.target.value === "" ? undefined : Number(e.target.value))
                  }
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className={numberFieldClass}
                />
              </span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
